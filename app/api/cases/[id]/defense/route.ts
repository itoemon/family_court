import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { resolveCaseAuth } from "@/lib/case-auth";
import { resolveCaseAiKey } from "@/lib/case-ai-key";
import { generateDefenseResponse } from "@/lib/defense";
import { DefenseMessage } from "@/lib/types";
import { isUuid } from "@/lib/text-utils";
import { aiRouteLimiter, rateLimitResponse, serviceAiCapResponse } from "@/lib/ratelimit";
import { SERVICE_AI_CALL_CAP } from "@/lib/limits";

type RouteContext = { params: Promise<{ id: string }> };

async function resolveApiKey(
  caseRow: { plaintiff_id: string; uses_service_key: boolean },
  admin: ReturnType<typeof createAdminClient>
) {
  const { data: plaintiffProfile } = await admin
    .from("profiles")
    .select("api_key_encrypted, defense_custom_instruction")
    .eq("id", caseRow.plaintiff_id)
    .single();

  // MON-001: ケースの課金モードに応じてキーを解決（サービスキー or 原告 BYOK）。
  const keyResult = resolveCaseAiKey(caseRow, plaintiffProfile);
  if (!keyResult.ok) {
    console.error(`[defense] key unresolved for case (plaintiff=${caseRow.plaintiff_id}): ${keyResult.error}`);
    return { error: keyResult.error, status: keyResult.status } as const;
  }

  return {
    apiKey: keyResult.apiKey,
    customInstruction: (plaintiffProfile?.defense_custom_instruction as string | null) ?? null,
  } as const;
}

function toDefenseMessage(row: {
  id: string;
  role: string;
  content: string;
  created_at: string;
}): DefenseMessage {
  return {
    id: row.id,
    role: row.role as "user" | "assistant",
    content: row.content,
    createdAt: row.created_at,
  };
}

export async function GET(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const auth = await resolveCaseAuth(req, id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId, admin } = auth;

  const baseQuery = admin
    .from("defense_messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: rows } = userId
    ? await baseQuery.eq("user_id", userId)
    : await baseQuery.is("user_id", null);

  const messages: DefenseMessage[] = (rows ?? []).map(toDefenseMessage);
  return NextResponse.json({ messages });
}

export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const auth = await resolveCaseAuth(req, id);
  if ("error" in auth) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  const { userId, c, userRole, admin } = auth;

  // SEC-002 第 1 層: 認可通過後・キー解決前に横断レート制限を適用する。
  // 識別子は認証ユーザーは user.id、ゲスト被告は case 単位の guest:{caseId}（確定判断 3）。
  const rateKey = userId ?? `guest:${id}`;
  const rl = await aiRouteLimiter.limit(rateKey);
  if (!rl.success) {
    return rateLimitResponse(rl);
  }

  const keyResult = await resolveApiKey(c, admin);
  if ("error" in keyResult) {
    return NextResponse.json({ error: keyResult.error }, { status: keyResult.status });
  }
  const { apiKey, customInstruction } = keyResult;

  const body = await req.json();
  const content: string = body.content ?? "";
  if (!content.trim()) {
    return NextResponse.json({ error: "内容を入力してください" }, { status: 400 });
  }
  if (content.trim().length > 1000) {
    return NextResponse.json({ error: "1000文字以内で入力してください" }, { status: 400 });
  }

  const existingQuery = admin
    .from("defense_messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: existingRows } = userId
    ? await existingQuery.eq("user_id", userId)
    : await existingQuery.is("user_id", null);

  const { data: argumentRows } = await admin
    .from("arguments")
    .select("role, content")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const dialogHistory = (argumentRows ?? []).map((a) => ({
    role: a.role as "plaintiff" | "defendant",
    content: a.content as string,
  }));

  const defenseHistoryForAI = [
    ...(existingRows ?? []).map((r) => ({
      role: r.role as "user" | "assistant",
      content: r.content as string,
    })),
    { role: "user" as const, content: content.trim() },
  ];

  // SEC-002 第 2 層（money-critical）: サービスキーケースのみ、Claude 呼び出しの直前に
  // 生成回数を原子的に消費する。NULL（上限到達）なら Claude を呼ばず 429 で弾く。BYOK は
  // 当人負担のため本ステップを丸ごとスキップする（確定判断・適用ルート）。
  const usesServiceKey = c.uses_service_key === true;
  if (usesServiceKey) {
    const { data: calls, error: consumeError } = await admin.rpc("consume_service_ai_call", {
      p_case_id: id,
      p_cap: SERVICE_AI_CALL_CAP,
    });
    if (consumeError) {
      console.error("[defense] consume_service_ai_call failed:", consumeError);
      return NextResponse.json({ error: "AI生成回数の確認に失敗しました" }, { status: 500 });
    }
    if (calls === null) {
      // 上限到達（or 非サービスキーだが usesServiceKey で確認済みのため上限到達と一意）。
      return serviceAiCapResponse();
    }
  }

  // consume 済みで以降が失敗した場合の補償（確定判断 2）: カウントを 1 戻す。
  // 一過性のインフラ障害でユーザーが購入回数を不当に失わないことを優先する。
  async function refundIfConsumed() {
    if (!usesServiceKey) return;
    const { error } = await admin.rpc("refund_service_ai_call", { p_case_id: id });
    if (error) console.error("[defense] refund_service_ai_call failed:", error);
  }

  let aiText: string;
  try {
    aiText = await generateDefenseResponse(
      {
        topic: c.topic,
        dialogHistory,
        defenseHistory: defenseHistoryForAI,
        userRole,
        customInstruction,
      },
      apiKey
    );
  } catch (err) {
    console.error("[defense] AI generation failed:", err);
    await refundIfConsumed();
    return NextResponse.json({ error: "AI応答の生成に失敗しました" }, { status: 500 });
  }

  if (!aiText.trim()) {
    console.error("[defense] AI returned empty response");
    await refundIfConsumed();
    return NextResponse.json({ error: "AI応答の生成に失敗しました" }, { status: 500 });
  }

  const { error: insertUserError } = await admin
    .from("defense_messages")
    .insert({ case_id: id, user_id: userId, role: "user", content: content.trim() });
  if (insertUserError) {
    console.error("[defense] user message insert failed:", insertUserError);
    await refundIfConsumed();
    return NextResponse.json({ error: "メッセージの保存に失敗しました" }, { status: 500 });
  }

  const { error: insertAIError } = await admin
    .from("defense_messages")
    .insert({ case_id: id, user_id: userId, role: "assistant", content: aiText });
  if (insertAIError) {
    console.error("[defense] AI message insert failed:", insertAIError);
    await refundIfConsumed();
    return NextResponse.json({ error: "AI応答の保存に失敗しました" }, { status: 500 });
  }

  const latestQuery = admin
    .from("defense_messages")
    .select("id, role, content, created_at")
    .eq("case_id", id)
    .order("created_at", { ascending: true });

  const { data: latestRows } = userId
    ? await latestQuery.eq("user_id", userId)
    : await latestQuery.is("user_id", null);

  const messages: DefenseMessage[] = (latestRows ?? []).map(toDefenseMessage);
  return NextResponse.json({ messages });
}
