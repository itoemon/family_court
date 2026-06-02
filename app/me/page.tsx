import { redirect } from "next/navigation";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import MeHeader from "./_components/MeHeader";
import ProfileCard from "./_components/ProfileCard";
import FriendsCard from "./_components/FriendsCard";
import CasesCard from "./_components/CasesCard";
import LawsCard from "./_components/LawsCard";

const DIGEST_LIMIT = 5;
const INSTRUCTION_EXCERPT_MAX = 100;

type LawRole = "owner" | "member" | "invitee";

type LawDigestRow = {
  id: string;
  name: string;
  role: LawRole;
  sortKey: string;
};

function settledValue<T>(
  result: PromiseSettledResult<{ data: T | null; error: unknown } | null>,
  section: string,
): T | null {
  if (result.status === "rejected") {
    console.error(`[me] ${section} query rejected:`, result.reason);
    return null;
  }
  const r = result.value;
  if (!r) return null;
  if (r.error) {
    console.error(`[me] ${section} query failed:`, r.error);
    return null;
  }
  return r.data;
}

function truncateInstruction(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length <= INSTRUCTION_EXCERPT_MAX) return trimmed;
  return trimmed.slice(0, INSTRUCTION_EXCERPT_MAX) + "…";
}

export default async function MePage() {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const userId = user.id;

  const [
    profileResult,
    friendRowsResult,
    casesResult,
    membershipsResult,
    invitationsResult,
  ] = await Promise.allSettled([
    supabase
      .from("profiles")
      .select("display_name, avatar_url, defense_custom_instruction")
      .eq("id", userId)
      .maybeSingle(),
    supabase
      .from("friend_requests")
      .select("id, sender_id, receiver_id, created_at")
      .or(`sender_id.eq.${userId},receiver_id.eq.${userId}`)
      .eq("status", "accepted")
      .order("created_at", { ascending: false }),
    supabase
      .from("cases")
      .select("id, topic, created_at")
      .or(`plaintiff_id.eq.${userId},defendant_id.eq.${userId}`)
      .eq("phase", "verdict")
      .order("created_at", { ascending: false }),
    supabase
      .from("law_members")
      .select("law_id, joined_at")
      .eq("user_id", userId)
      .order("joined_at", { ascending: false }),
    supabase
      .from("law_invitations")
      .select("law_id, invited_at")
      .eq("invitee_id", userId)
      .eq("status", "pending")
      .order("invited_at", { ascending: false }),
  ]);

  const profile = settledValue<{
    display_name: string | null;
    avatar_url: string | null;
    defense_custom_instruction: string | null;
  }>(profileResult, "profile");

  const friendRows = settledValue<
    { id: string; sender_id: string; receiver_id: string; created_at: string }[]
  >(friendRowsResult, "friends") ?? null;

  const cases = settledValue<{ id: string; topic: string; created_at: string }[]>(
    casesResult,
    "cases",
  );

  const memberships = settledValue<{ law_id: string; joined_at: string }[]>(
    membershipsResult,
    "law_memberships",
  );

  const pendingInvitations = settledValue<{ law_id: string; invited_at: string }[]>(
    invitationsResult,
    "law_invitations",
  );

  // フレンドの相手プロフィール解決（profiles 跨ぎは admin の MEDIUM-001 carve-out）
  let friendsTotalCount: number | null = null;
  let friendsRecent: { id: string; displayName: string; avatarUrl: string | null }[] = [];
  if (friendRows !== null) {
    const friendIds = friendRows.map((r) =>
      r.sender_id === userId ? r.receiver_id : r.sender_id,
    );
    friendsTotalCount = friendIds.length;

    const recentIds = friendIds.slice(0, DIGEST_LIMIT);
    if (recentIds.length > 0) {
      const admin = createAdminClient();
      const { data: friendProfiles, error: friendProfilesError } = await admin
        .from("profiles")
        .select("id, display_name, avatar_url")
        .in("id", recentIds);
      if (friendProfilesError) {
        console.error("[me] friend profiles query failed:", friendProfilesError);
      }
      const profileMap = new Map(
        (friendProfiles ?? []).map((p) => [p.id as string, p]),
      );
      friendsRecent = recentIds.map((id) => {
        const p = profileMap.get(id);
        return {
          id,
          displayName: (p?.display_name as string | null) ?? "",
          avatarUrl: (p?.avatar_url as string | null) ?? null,
        };
      });
    }
  }

  // 過去のケースダイジェスト
  const casesTotalCount = cases === null ? null : cases.length;
  const casesRecent =
    cases === null
      ? []
      : cases.slice(0, DIGEST_LIMIT).map((c) => ({
          id: c.id,
          topic: c.topic,
          createdAt: c.created_at,
        }));

  // 法律ダイジェスト（メンバーシップ + pending 招待）
  // 両方のクエリが成功したときだけ totalCount を出す（片方失敗時はバッジ非表示に揃える）。
  let lawsTotalCount: number | null = null;
  let lawsRecent: { id: string; name: string; role: LawRole }[] = [];
  if (memberships !== null && pendingInvitations !== null) {
    const safeMemberships = memberships;
    const safeInvitations = pendingInvitations;
    lawsTotalCount = safeMemberships.length + safeInvitations.length;

    const memberLawIds = safeMemberships.map((m) => m.law_id);
    const inviteeLawIds = safeInvitations.map((i) => i.law_id);
    const allLawIds = [...new Set([...memberLawIds, ...inviteeLawIds])];

    let lawsRows: { id: string; name: string; owner_id: string }[] = [];
    if (allLawIds.length > 0) {
      const { data, error: lawsError } = await supabase
        .from("laws")
        .select("id, name, owner_id")
        .in("id", allLawIds);
      if (lawsError) {
        console.error("[me] laws query failed:", lawsError);
      }
      lawsRows = (data ?? []) as { id: string; name: string; owner_id: string }[];
    }

    const lawMap = new Map(lawsRows.map((l) => [l.id, l]));
    const membershipKeys = new Set(memberLawIds);

    const candidates: LawDigestRow[] = [];
    for (const m of safeMemberships) {
      const law = lawMap.get(m.law_id);
      if (!law) continue;
      const role: LawRole = law.owner_id === userId ? "owner" : "member";
      candidates.push({
        id: law.id,
        name: law.name,
        role,
        sortKey: m.joined_at,
      });
    }
    for (const i of safeInvitations) {
      if (membershipKeys.has(i.law_id)) continue;
      const law = lawMap.get(i.law_id);
      if (!law) continue;
      candidates.push({
        id: law.id,
        name: law.name,
        role: "invitee",
        sortKey: i.invited_at,
      });
    }

    // sortKey は ISO8601 文字列。降順（新しい順）で localeCompare すれば等値時 0 を返し
    // 比較関数の反対称性/推移性を満たす。
    candidates.sort((a, b) => b.sortKey.localeCompare(a.sortKey));
    lawsRecent = candidates
      .slice(0, DIGEST_LIMIT)
      .map(({ id, name, role }) => ({ id, name, role }));
  }

  const displayName = profile?.display_name ?? null;
  const avatarUrl = profile?.avatar_url ?? null;
  const instructionExcerpt = truncateInstruction(
    profile?.defense_custom_instruction ?? null,
  );

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <MeHeader displayName={displayName} avatarUrl={avatarUrl} />
        <ProfileCard
          titleId="me-section-profile"
          displayName={displayName}
          avatarUrl={avatarUrl}
          defenseCustomInstructionExcerpt={instructionExcerpt}
        />
        <FriendsCard
          titleId="me-section-friends"
          totalCount={friendsTotalCount}
          recent={friendsRecent}
        />
        <CasesCard
          titleId="me-section-cases"
          totalCount={casesTotalCount}
          recent={casesRecent}
        />
        <LawsCard
          titleId="me-section-laws"
          totalCount={lawsTotalCount}
          recent={lawsRecent}
        />
      </div>
    </main>
  );
}
