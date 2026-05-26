import { NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import type { FriendListItem } from "@/lib/types";

export async function GET() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const admin = createAdminClient();

  const { data: requests, error } = await admin
    .from("friend_requests")
    .select("id, sender_id, receiver_id")
    .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
    .eq("status", "accepted");

  if (error) {
    console.error("[friends] query failed:", error);
    return NextResponse.json({ error: "フレンド一覧の取得に失敗しました" }, { status: 500 });
  }

  if (!requests || requests.length === 0) {
    return NextResponse.json([]);
  }

  const friendIds = requests.map(r =>
    r.sender_id === user.id ? r.receiver_id : r.sender_id
  );

  const { data: profiles, error: profileError } = await admin
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", friendIds);

  if (profileError) {
    console.error("[friends] profile query failed:", profileError);
    return NextResponse.json({ error: "プロフィールの取得に失敗しました" }, { status: 500 });
  }

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

  const result: FriendListItem[] = requests.map(r => {
    const friendId = r.sender_id === user.id ? r.receiver_id : r.sender_id;
    const profile = profileMap.get(friendId);
    return {
      request_id: r.id,
      friend: {
        id: friendId,
        display_name: profile?.display_name ?? "",
        avatar_url: profile?.avatar_url ?? null,
      },
    };
  });

  return NextResponse.json(result);
}
