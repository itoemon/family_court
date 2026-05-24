import { redirect } from "next/navigation";
import Link from "next/link";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import type { HistoryCase } from "@/lib/types";

type CaseRow = {
  id: string;
  topic: string;
  phase: string;
  created_at: string;
  plaintiff_id: string;
  defendant_id: string | null;
  defendant_guest_name: string | null;
};

type ProfileRow = {
  id: string;
  display_name: string;
};

export default async function HistoryPage() {
  const supabase = await createSessionClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/auth/login");

  const admin = createAdminClient();

  const { data: rawCases, error } = await admin
    .from("cases")
    .select(
      "id, topic, phase, created_at, plaintiff_id, defendant_id, defendant_guest_name"
    )
    .or(`plaintiff_id.eq.${user.id},defendant_id.eq.${user.id}`)
    .eq("phase", "verdict")
    .order("created_at", { ascending: false });

  if (error) throw error;

  const cases: CaseRow[] = rawCases ?? [];

  const opponentIds = new Set<string>();
  for (const c of cases) {
    if (user.id === c.plaintiff_id && c.defendant_id) {
      opponentIds.add(c.defendant_id);
    } else if (user.id === c.defendant_id && c.plaintiff_id) {
      opponentIds.add(c.plaintiff_id);
    }
  }

  const profileMap = new Map<string, string>();
  if (opponentIds.size > 0) {
    const { data: profiles } = await admin
      .from("profiles")
      .select("id, display_name")
      .in("id", Array.from(opponentIds));
    if (profiles) {
      for (const p of profiles as ProfileRow[]) {
        profileMap.set(p.id, p.display_name);
      }
    }
  }

  const historyCases: HistoryCase[] = cases.map((c) => {
    const opponentName =
      user.id === c.plaintiff_id
        ? (c.defendant_guest_name ??
            (c.defendant_id
              ? (profileMap.get(c.defendant_id) ?? "（不明）")
              : "（不明）"))
        : (profileMap.get(c.plaintiff_id) ?? "（不明）");

    return {
      id: c.id,
      topic: c.topic,
      phase: c.phase,
      createdAt: c.created_at,
      opponentName,
    };
  });

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10">
        <div className="mb-8">
          <h1 className="text-2xl font-bold text-stone-800">過去のケース</h1>
          <p className="text-stone-500 text-sm mt-1">判決が出た話し合いの記録</p>
        </div>

        {historyCases.length === 0 ? (
          <div className="bg-white rounded-2xl border border-stone-100 shadow-sm p-10 text-center">
            <p className="text-stone-400 text-sm">まだ過去のケースはありません</p>
          </div>
        ) : (
          <ul className="space-y-3">
            {historyCases.map((c) => (
              <li key={c.id}>
                <Link
                  href={`/case/${c.id}`}
                  className="block bg-white rounded-2xl border border-stone-100 shadow-sm px-5 py-4 hover:border-stone-300 transition-colors"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold text-stone-800 text-sm truncate">
                        {c.topic}
                      </p>
                      <p className="text-stone-400 text-xs mt-1">
                        相手: {c.opponentName}
                      </p>
                    </div>
                    <div className="shrink-0 flex flex-col items-end gap-1">
                      <span className="inline-block text-xs bg-stone-100 text-stone-500 rounded-full px-2.5 py-0.5">
                        判決完了
                      </span>
                      <p className="text-xs text-stone-400">
                        {new Date(c.createdAt).toLocaleDateString("ja-JP")}
                      </p>
                    </div>
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
