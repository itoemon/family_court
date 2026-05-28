import { redirect } from "next/navigation";
import Link from "next/link";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import PendingInvitations from "./_components/PendingInvitations";

export default async function LawsPage() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const admin = createAdminClient();

  const { data: memberships } = await supabase
    .from("law_members")
    .select("law_id")
    .eq("user_id", user.id);

  const lawIds = (memberships ?? []).map(m => m.law_id);

  let laws: {
    id: string;
    name: string;
    article: string;
    owner_id: string;
    created_at: string;
  }[] = [];

  let ownerNames = new Map<string, string>();
  const memberCounts = new Map<string, number>();
  let proposalSet = new Set<string>();

  const { data: rawPendingInvitations } = await supabase
    .from("law_invitations")
    .select("id, law_id")
    .eq("invitee_id", user.id)
    .eq("status", "pending");

  const pendingInvitations: {
    id: string;
    lawId: string;
    lawName: string;
    ownerName: string;
  }[] = [];

  if ((rawPendingInvitations ?? []).length > 0) {
    const invLawIds = rawPendingInvitations!.map(i => i.law_id);
    const { data: invLaws } = await supabase
      .from("laws")
      .select("id, name, owner_id")
      .in("id", invLawIds);

    const invOwnerIds = [...new Set((invLaws ?? []).map(l => l.owner_id))];
    const { data: invOwnerProfiles } = invOwnerIds.length > 0
      ? await admin.from("profiles").select("id, display_name").in("id", invOwnerIds)
      : { data: [] };

    const invLawMap = new Map((invLaws ?? []).map(l => [l.id, l]));
    const invOwnerMap = new Map((invOwnerProfiles ?? []).map(p => [p.id, p.display_name]));

    for (const inv of rawPendingInvitations!) {
      const law = invLawMap.get(inv.law_id);
      if (!law) continue;
      pendingInvitations.push({
        id: inv.id,
        lawId: inv.law_id,
        lawName: law.name,
        ownerName: invOwnerMap.get(law.owner_id) ?? "",
      });
    }
  }

  if (lawIds.length > 0) {
    const [lawsResult, memberCountResult, proposalResult] = await Promise.all([
      supabase.from("laws").select("id, name, article, owner_id, created_at").in("id", lawIds).order("created_at", { ascending: false }),
      supabase.from("law_members").select("law_id").in("law_id", lawIds),
      supabase.from("law_proposals").select("law_id").in("law_id", lawIds),
    ]);

    laws = lawsResult.data ?? [];

    for (const m of memberCountResult.data ?? []) {
      memberCounts.set(m.law_id, (memberCounts.get(m.law_id) ?? 0) + 1);
    }

    proposalSet = new Set((proposalResult.data ?? []).map(p => p.law_id));

    const ownerIds = [...new Set(laws.map(l => l.owner_id))];
    if (ownerIds.length > 0) {
      const { data: profiles } = await admin
        .from("profiles")
        .select("id, display_name")
        .in("id", ownerIds);
      ownerNames = new Map((profiles ?? []).map(p => [p.id, p.display_name]));
    }
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">法律</h1>
            <p className="text-stone-500 text-sm mt-1">あなたが参加している法律の一覧</p>
          </div>
          <Link
            href="/laws/new"
            className="px-4 py-2 bg-stone-800 text-white text-sm rounded-lg hover:bg-stone-700 transition-colors"
          >
            法律を作る
          </Link>
        </div>

        <PendingInvitations invitations={pendingInvitations} />

        {laws.length === 0 ? (
          <div className="text-center py-16 text-stone-400">
            <p className="text-lg">まだ法律がありません</p>
            <p className="text-sm mt-1">「法律を作る」から新しいルールを定めましょう</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {laws.map(law => (
              <li key={law.id}>
                <Link
                  href={`/laws/${law.id}`}
                  className="block bg-white border border-stone-200 rounded-xl p-5 hover:border-stone-400 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex-1 min-w-0">
                      <p className="font-semibold text-stone-800 truncate">{law.name}</p>
                      <p className="text-stone-500 text-sm mt-1 line-clamp-2">{law.article}</p>
                    </div>
                    {proposalSet.has(law.id) && (
                      <span className="shrink-0 px-2 py-1 bg-amber-100 text-amber-700 text-xs rounded-full font-medium">
                        提案中
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-4 mt-3 text-xs text-stone-400">
                    <span>オーナー: {ownerNames.get(law.owner_id) ?? ""}</span>
                    <span>メンバー {memberCounts.get(law.id) ?? 0}人</span>
                    <span>{new Date(law.created_at).toLocaleDateString("ja-JP")}</span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>
    </main>
  );
}
