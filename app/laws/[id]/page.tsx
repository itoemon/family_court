import { redirect, notFound } from "next/navigation";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import ArticleSection from "./_components/ArticleSection";
import MemberList from "./_components/MemberList";
import InvitePanel from "./_components/InvitePanel";
import ProposalPanel from "./_components/ProposalPanel";
import InvitationAccept from "./_components/InvitationAccept";
import VisibilityToggle from "./_components/VisibilityToggle";

export default async function LawDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id: lawId } = await params;

  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  const admin = createAdminClient();

  const { data: law } = await supabase
    .from("laws")
    .select("id, name, article, owner_id, is_public, created_at, updated_at")
    .eq("id", lawId)
    .maybeSingle();

  if (!law) notFound();

  const { data: members } = await supabase
    .from("law_members")
    .select("user_id, joined_at")
    .eq("law_id", lawId);

  const isMember = (members ?? []).some(m => m.user_id === user.id);
  if (!isMember) {
    const { data: invitation } = await supabase
      .from("law_invitations")
      .select("id")
      .eq("law_id", lawId)
      .eq("invitee_id", user.id)
      .eq("status", "pending")
      .maybeSingle();

    if (!invitation) redirect("/laws");

    return (
      <main className="min-h-screen bg-stone-50">
        <div className="max-w-xl mx-auto px-4 py-10 space-y-4">
          <div>
            <h1 className="text-2xl font-bold text-stone-800">{law.name}</h1>
            <p className="text-stone-500 text-sm mt-1">この法律に招待されています</p>
          </div>
          <div className="bg-stone-50 rounded-lg p-4">
            <p className="text-stone-700 text-sm whitespace-pre-wrap leading-relaxed line-clamp-6">
              {law.article}
            </p>
          </div>
          <InvitationAccept lawId={lawId} invitationId={invitation.id} />
        </div>
      </main>
    );
  }

  const memberIds = (members ?? []).map(m => m.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", memberIds);

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

  const [invitationsResult, proposalResult] = await Promise.all([
    supabase
      .from("law_invitations")
      .select("id, invitee_id, status")
      .eq("law_id", lawId)
      .eq("status", "pending"),
    supabase
      .from("law_proposals")
      .select("id, proposal_type, proposed_by, proposed_article, created_at")
      .eq("law_id", lawId)
      .maybeSingle(),
  ]);

  const invitations = invitationsResult.data ?? [];
  const inviteeIds = invitations.map(i => i.invitee_id);
  const { data: inviteeProfiles } = inviteeIds.length > 0
    ? await admin.from("profiles").select("id, display_name").in("id", inviteeIds)
    : { data: [] };
  const inviteeMap = new Map((inviteeProfiles ?? []).map(p => [p.id, p.display_name]));

  const proposal = proposalResult.data;
  let votes: { user_id: string; approved: boolean; voted_at: string }[] = [];
  if (proposal) {
    const { data: votesData } = await supabase
      .from("law_proposal_votes")
      .select("user_id, approved, voted_at")
      .eq("proposal_id", proposal.id);
    votes = votesData ?? [];
  }

  const isOwner = law.owner_id === user.id;

  const memberData = (members ?? []).map(m => ({
    user_id: m.user_id,
    display_name: profileMap.get(m.user_id)?.display_name ?? "",
    avatar_url: profileMap.get(m.user_id)?.avatar_url ?? null,
    joined_at: m.joined_at,
  }));

  const pendingInvitations = invitations.map(i => ({
    id: i.id,
    invitee_id: i.invitee_id,
    invitee_name: inviteeMap.get(i.invitee_id) ?? "",
  }));

  const activeProposal = proposal
    ? {
        id: proposal.id,
        proposal_type: proposal.proposal_type as "amendment" | "deletion",
        proposed_by: proposal.proposed_by,
        proposed_article: proposal.proposed_article,
        created_at: proposal.created_at,
        votes,
      }
    : null;

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
        <ArticleSection
          lawId={lawId}
          name={law.name}
          article={law.article}
          updatedAt={law.updated_at}
        />
        <ProposalPanel
          lawId={lawId}
          isOwner={isOwner}
          isMember={true}
          members={memberData}
          currentUserId={user.id}
          activeProposal={activeProposal}
        />
        <MemberList
          lawId={lawId}
          currentUserId={user.id}
          isOwner={isOwner}
          members={memberData}
          ownerId={law.owner_id}
        />
        {isOwner && (
          <InvitePanel
            lawId={lawId}
            existingMemberIds={memberData.map(m => m.user_id)}
            pendingInviteeIds={pendingInvitations.map(i => i.invitee_id)}
          />
        )}
        {isOwner && (
          <VisibilityToggle lawId={lawId} isPublic={law.is_public} />
        )}
      </div>
    </main>
  );
}
