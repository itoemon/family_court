import { notFound, redirect } from "next/navigation";
import { createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";
import CaseRoom from "./CaseRoom";

export default async function CasePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!isUuid(id)) notFound();

  const admin = createAdminClient();
  const { data: c } = await admin.from("cases").select("phase").eq("id", id).single();
  if (!c) notFound();
  if (c.phase === "verdict") redirect(`/case/${id}/verdict`);

  return <CaseRoom caseId={id} />;
}
