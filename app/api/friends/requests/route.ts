import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import type { IncomingRequest } from "@/lib/types";
import { UUID_REGEX } from "@/lib/text-utils";

export async function GET() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const admin = createAdminClient();

  const { data: requests, error } = await admin
    .from("friend_requests")
    .select("id, sender_id, created_at")
    .eq("receiver_id", user.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  if (error) {
    console.error("[friends/requests] query failed:", error);
    return NextResponse.json({ error: "リクエスト一覧の取得に失敗しました" }, { status: 500 });
  }

  if (!requests || requests.length === 0) {
    return NextResponse.json([]);
  }

  const senderIds = requests.map(r => r.sender_id);
  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", senderIds);

  if (profileError) {
    console.error("[friends/requests] profile query failed:", profileError);
    return NextResponse.json({ error: "プロフィールの取得に失敗しました" }, { status: 500 });
  }

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

  const result: IncomingRequest[] = requests.map(r => {
    const profile = profileMap.get(r.sender_id);
    return {
      id: r.id,
      sender: {
        id: r.sender_id,
        display_name: profile?.display_name ?? "",
        avatar_url: profile?.avatar_url ?? null,
      },
      created_at: r.created_at,
    };
  });

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const { receiver_id } = body as Record<string, unknown>;
  if (typeof receiver_id !== "string" || !UUID_REGEX.test(receiver_id)) {
    return NextResponse.json({ error: "receiver_id が不正です" }, { status: 400 });
  }

  if (receiver_id === user.id) {
    return NextResponse.json({ error: "自分自身へのリクエストは送信できません" }, { status: 409 });
  }

  const admin = createAdminClient();

  // アプリ層の重複チェック（DB UNIQUE 制約との二重防衛）
  const { data: existing, error: existingError } = await admin
    .from("friend_requests")
    .select("id")
    .or(
      `and(sender_id.eq.${user.id},receiver_id.eq.${receiver_id}),and(sender_id.eq.${receiver_id},receiver_id.eq.${user.id})`
    )
    .in("status", ["pending", "accepted"])
    .limit(1);

  if (existingError) {
    console.error("[friends/requests] duplicate check failed:", existingError);
    return NextResponse.json({ error: "リクエストの送信に失敗しました" }, { status: 500 });
  }

  if (existing && existing.length > 0) {
    return NextResponse.json({ error: "既にリクエスト済みまたはフレンドです" }, { status: 409 });
  }

  const { data: inserted, error: insertError } = await admin
    .from("friend_requests")
    .insert({ sender_id: user.id, receiver_id, status: "pending" })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "既にリクエスト済みまたはフレンドです" }, { status: 409 });
    }
    if (insertError.code === "23503") {
      return NextResponse.json({ error: "指定されたユーザーが存在しません" }, { status: 400 });
    }
    console.error("[friends/requests] insert failed:", insertError);
    return NextResponse.json({ error: "リクエストの送信に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: inserted.id }, { status: 201 });
}
