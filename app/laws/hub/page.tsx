import { redirect } from "next/navigation";
import Link from "next/link";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { fetchPublicLaws, normalizeQuery } from "@/lib/laws-public";
import HubSearch from "./_components/HubSearch";

export default async function LawsHubPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string }>;
}) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const { q: rawQuery } = await searchParams;
  const q = normalizeQuery(rawQuery);

  let initialLaws = [] as Awaited<ReturnType<typeof fetchPublicLaws>>;
  try {
    initialLaws = await fetchPublicLaws({ sessionClient: supabase, adminClient: createAdminClient(), q });
  } catch {
    // 初期取得失敗時は空一覧で描画する（クライアント検索で復帰可能）。
  }

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">法律 Hub</h1>
            <p className="text-stone-500 text-sm mt-1">公開されている法律を探してインポートできます（新着 {50} 件）</p>
          </div>
          <Link
            href="/laws"
            className="px-4 py-2 border border-stone-300 text-stone-700 text-sm rounded-lg hover:bg-stone-100 transition-colors"
          >
            自分の法律へ
          </Link>
        </div>

        <HubSearch initialLaws={initialLaws} initialQuery={typeof rawQuery === "string" ? rawQuery : ""} />
      </div>
    </main>
  );
}
