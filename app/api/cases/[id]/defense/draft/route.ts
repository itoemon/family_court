import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { resolveCaseAiKey } from "@/lib/case-ai-key";
import { generateDraft } from "@/lib/defense";
import { isUuid } from "@/lib/text-utils";
import { aiRouteLimiter, rateLimitResponse, serviceAiCapResponse } from "@/lib/ratelimit";
import { SERVICE_AI_CALL_CAP } from "@/lib/limits";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: c } = await admin
    .from("cases")
    .select("*")
    .eq("id", id)
    .single();
  if (!c) {
    return NextResponse.json({ error: "ケースが見つかりません" }, { status: 404 });
  }

  // 認証済みユーザーの確認
  let session: Awaited<ReturnType<typeof createSessionClient>>;
  try {
    session = await createSessionClient();
  } catch (err) {
    console.error("[defense/draft] session client creation failed:", err);
    return NextResponse.json({ error: "認証セッションの取得に失敗しました" }, { status: 500 });
  }
  const { data: { user } } = await session.auth.getUser();

  let userId: string | null = null;
  let userRole: "plaintiff" | "defendant";

  if (user) {
    if (user.id !== c.plaintiff_id && user.id !== c.defendant_id) {
      return NextResponse.json({ error: "このケースへの参加権限がありません" }, { status: 403 });
    }
    userId = user.id;
    userRole = user.id === c.plaintiff_id ? "plaintiff" : "defendant";
  } else if (c.defendant_guest_name) {
    try {
      const cookieToken = req.cookies.get(`guest_defendant_${id}`)?.value;
      if (cookieToken && await verifyGuestToken(id, cookieToken)) {
        userId = null;
        userRole = "defendant";
      } else {
        return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
      }
    } catch (err) {
      console.error("verifyGuestToken failed:", err);
      return NextResponse.json({ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }, { status: 500 });
    }
  } else {
    return NextResponse.json({ error: "認証が必要です" }, { status: 401 });
  }

  // SEC-002 第 1 層: 身元確定後・キー解決前に横断レート制限を適用する。
  // 識別子は認証ユーザーは user.id、ゲスト被告は case 単位の guest:{caseId}（確定判断 3）。
  const rateKey = userId ?? `guest:${id}`;
  const rl = await aiRouteLimiter.limit(rateKey);
  if (!rl.success) {
    return rateLimitResponse(rl);
  }

  const { data: plaintiffProfile } = await admin
    .from("profiles")
    .select("api_key_encrypted, defense_custom_instruction")
    .eq("id", c.plaintiff_id)
    .single();

  // MON-001: ケースの課金モードに応じてキーを解決（サービスキー or 原告 BYOK）。
  const keyResult = resolveCaseAiKey(c, plaintiffProfile);
  if (!keyResult.ok) {
    console.error(`[defense/draft] key unresolved (plaintiff=${c.plaintiff_id}): ${keyResult.error}`);
    return NextResponse.json({ error: keyResult.error }, { status: keyResult.status });
  }
  const apiKey = keyResult.apiKey;

  const customInstruction = (plaintiffProfile?.defense_custom_instruction as string | null) ?? null;

  const defenseQuery = admin
    .from("defense_messages")
    .select("role, content")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: defenseRows } = userId
    ? await defenseQuery.eq("user_id", userId)
    : await defenseQuery.is("user_id", null);

  if (!defenseRows || defenseRows.length === 0) {
    return NextResponse.json(
      { error: "弁護人AIとのヒアリングを先に行ってください" },
      { status: 422 }
    );
  }

  const { data: argumentRows } = await admin
    .from("arguments")
    .select("role, content")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const dialogHistory = (argumentRows ?? []).map((a) => ({
    role: a.role as "plaintiff" | "defendant",
    content: a.content as string,
  }));

  const defenseHistory = defenseRows.map((r) => ({
    role: r.role as "user" | "assistant",
    content: r.content as string,
  }));

  // SEC-002 第 2 層（money-critical）: サービスキーケースのみ、Claude 呼び出しの直前に
  // 生成回数を原子的に消費する。NULL（上限到達）なら Claude を呼ばず 429 で弾く。draft は
  // defense_messages に保存しないため service_ai_calls が唯一のカウンタとなる。BYOK はスキップ。
  const usesServiceKey = c.uses_service_key === true;
  if (usesServiceKey) {
    const { data: calls, error: consumeError } = await admin.rpc("consume_service_ai_call", {
      p_case_id: id,
      p_cap: SERVICE_AI_CALL_CAP,
    });
    if (consumeError) {
      console.error("[defense/draft] consume_service_ai_call failed:", consumeError);
      return NextResponse.json({ error: "AI生成回数の確認に失敗しました" }, { status: 500 });
    }
    if (calls === null) {
      return serviceAiCapResponse();
    }
  }

  let draft: string;
  try {
    draft = await generateDraft(
      {
        topic: c.topic,
        dialogHistory,
        defenseHistory,
        userRole,
        customInstruction,
      },
      apiKey
    );
  } catch (err) {
    console.error("[defense/draft] AI generation failed:", err);
    // consume 済みで生成が失敗したらカウントを 1 戻す（確定判断 2・refund）。
    if (usesServiceKey) {
      const { error: refundError } = await admin.rpc("refund_service_ai_call", { p_case_id: id });
      if (refundError) console.error("[defense/draft] refund_service_ai_call failed:", refundError);
    }
    return NextResponse.json({ error: "回答案の生成に失敗しました" }, { status: 500 });
  }

  // 空 / 空白のみの回答案は失敗扱いにする（コパ指摘）。consume 済みなら refund して 500 を返し、
  // defense POST（空応答を失敗扱い＋refund）と対称にする。空を成功として返すとカウントだけ
  // 消費してユーザーが 1 回分を無為に失う。
  if (!draft.trim()) {
    console.error("[defense/draft] AI が空の回答案を返しました");
    if (usesServiceKey) {
      const { error: refundError } = await admin.rpc("refund_service_ai_call", { p_case_id: id });
      if (refundError) console.error("[defense/draft] refund_service_ai_call failed:", refundError);
    }
    return NextResponse.json({ error: "回答案の生成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ draft });
}
