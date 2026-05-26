import { createAdminClient } from "@/lib/supabase/server";

type AdminClient = ReturnType<typeof createAdminClient>;

export async function checkAndApplyConsensus(
  admin: AdminClient,
  lawId: string,
  proposalId: string
): Promise<void> {
  const { count: totalCount } = await admin
    .from("law_members")
    .select("*", { count: "exact", head: true })
    .eq("law_id", lawId);

  const { count: approvedCount } = await admin
    .from("law_proposal_votes")
    .select("*", { count: "exact", head: true })
    .eq("proposal_id", proposalId)
    .eq("approved", true);

  if (!totalCount || !approvedCount || totalCount !== approvedCount) return;

  const { data: proposal } = await admin
    .from("law_proposals")
    .select("proposal_type, proposed_article")
    .eq("id", proposalId)
    .maybeSingle();

  if (!proposal) return;

  if (proposal.proposal_type === "amendment") {
    await admin
      .from("laws")
      .update({ article: proposal.proposed_article, updated_at: new Date().toISOString() })
      .eq("id", lawId);

    await admin.from("law_proposals").delete().eq("id", proposalId);
  } else if (proposal.proposal_type === "deletion") {
    await admin.from("laws").delete().eq("id", lawId);
  }
}
