import { NextRequest, NextResponse } from "next/server";
import { createAdminClient, createSessionClient } from "@/lib/supabase/server";
import { verifyGuestToken } from "@/lib/guest-token";
import { decryptApiKey } from "@/lib/crypto";
import { generateDraft } from "@/lib/defense";

type RouteContext = { params: Promise<{ id: string }> };

export async function POST(
  req: NextRequest,
  { params }: RouteContext
) {
  const { id } = await params;
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

  const { data: plaintiffProfile } = await admin
    .from("profiles")
    .select("api_key_encrypted")
    .eq("id", c.plaintiff_id)
    .single();

  if (!plaintiffProfile?.api_key_encrypted) {
    console.error(`[defense/draft] plaintiff ${c.plaintiff_id} has no api_key_encrypted`);
    return NextResponse.json({ error: "APIキーが設定されていません" }, { status: 500 });
  }

  let apiKey: string;
  try {
    apiKey = decryptApiKey(plaintiffProfile.api_key_encrypted);
  } catch (err) {
    console.error("[defense/draft] api key decryption failed:", err);
    return NextResponse.json({ error: "APIキーの復号に失敗しました" }, { status: 500 });
  }

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

  let draft: string;
  try {
    draft = await generateDraft(
      {
        topic: c.topic,
        dialogHistory,
        defenseHistory,
        userRole,
      },
      apiKey
    );
  } catch (err) {
    console.error("[defense/draft] AI generation failed:", err);
    return NextResponse.json({ error: "回答案の生成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ draft });
}
