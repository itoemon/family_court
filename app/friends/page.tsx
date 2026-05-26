import { redirect } from "next/navigation";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import type { FriendListItem, IncomingRequest } from "@/lib/types";
import FriendList from "./_components/FriendList";
import RequestList from "./_components/RequestList";
import SearchSection from "./_components/SearchSection";

export default async function FriendsPage() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const admin = createAdminClient();

  const [friendsResult, requestsResult] = await Promise.all([
    admin
      .from("friend_requests")
      .select("id, sender_id, receiver_id")
      .or(`sender_id.eq.${user.id},receiver_id.eq.${user.id}`)
      .eq("status", "accepted"),
    admin
      .from("friend_requests")
      .select("id, sender_id, created_at")
      .eq("receiver_id", user.id)
      .eq("status", "pending")
      .order("created_at", { ascending: false }),
  ]);

  if (friendsResult.error || requestsResult.error) {
    console.error("[friends] fetch failed:", friendsResult.error ?? requestsResult.error);
    throw new Error("フレンド情報の取得に失敗しました");
  }

  const friendRequests = friendsResult.data ?? [];
  const incomingRequests = requestsResult.data ?? [];

  // フレンドと送信者のプロフィールを一括取得
  const friendIds = friendRequests.map(r =>
    r.sender_id === user.id ? r.receiver_id : r.sender_id
  );
  const senderIds = incomingRequests.map(r => r.sender_id);
  const allIds = [...new Set([...friendIds, ...senderIds])];

  const profileMap = new Map<string, { id: string; display_name: string; avatar_url: string | null }>();
  if (allIds.length > 0) {
    const { data: profiles, error: profilesError } = await admin
      .from("profiles")
      .select("id, display_name, avatar_url")
      .in("id", allIds);
    if (profilesError) {
      console.error("[friends] profiles fetch failed:", profilesError);
      throw new Error("プロフィール情報の取得に失敗しました");
    }
    for (const p of profiles ?? []) {
      profileMap.set(p.id, p);
    }
  }

  const friends: FriendListItem[] = friendRequests.map(r => {
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

  const requests: IncomingRequest[] = incomingRequests.map(r => {
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

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-stone-800">フレンド</h1>
          <p className="text-stone-500 text-sm mt-1">
            ユーザーを検索してフレンド申請を送ることができます
          </p>
        </div>
        <SearchSection />
        <RequestList initialRequests={requests} />
        <FriendList initialFriends={friends} />
      </div>
    </main>
  );
}
