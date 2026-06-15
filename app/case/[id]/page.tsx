import { Suspense } from "react";
import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";
import CaseRoom from "./CaseRoom";

// phase は in-session でも進行するため、リクエスト毎に最新値を読む必要がある
export const dynamic = "force-dynamic";

// CaseRoom は useSearchParams() を直接呼ぶため、Suspense 境界で包む。
// BUG-008: Next.js 16 App Router の公式ガイダンス遵守。
function CaseRoomSkeleton() {
  return (
    <main className="min-h-screen bg-stone-50 flex items-center justify-center p-6">
      <p className="text-stone-400 text-sm">読み込み中…</p>
    </main>
  );
}

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const admin = createAdminClient();
  const { data: c, error } = await admin
    .from("cases")
    .select("phase")
    .eq("id", id)
    .maybeSingle();

  if (error) {
    console.error("[case page] failed to fetch case phase", { id, error });
    throw new Error("ケース情報の取得に失敗しました");
  }
  if (!c) notFound();
  if (c.phase === "verdict") redirect(`/case/${id}/verdict`);

  return (
    <Suspense fallback={<CaseRoomSkeleton />}>
      <CaseRoom caseId={id} />
    </Suspense>
  );
}
