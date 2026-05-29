import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: lawId } = await params;
  if (!isUuid(lawId)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }

  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const admin = createAdminClient();

  const { data: law, error: lawError } = await admin
    .from("laws")
    .select("id, name, article, owner_id, created_at, updated_at")
    .eq("id", lawId)
    .maybeSingle();

  if (lawError) {
    console.error("[GET /api/laws/[id]] law query failed:", lawError);
    return NextResponse.json({ error: "法律の取得に失敗しました" }, { status: 500 });
  }
  if (!law) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });

  const { data: members, error: membersError } = await admin
    .from("law_members")
    .select("user_id, joined_at")
    .eq("law_id", lawId);

  if (membersError) {
    console.error("[GET /api/laws/[id]] members query failed:", membersError);
    return NextResponse.json({ error: "メンバーの取得に失敗しました" }, { status: 500 });
  }

  const isMember = (members ?? []).some(m => m.user_id === user.id);
  if (!isMember) return NextResponse.json({ error: "メンバーではありません" }, { status: 403 });

  const memberIds = (members ?? []).map(m => m.user_id);
  const { data: profiles } = await admin
    .from("profiles")
    .select("id, display_name, avatar_url")
    .in("id", memberIds);

  const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));

  const { data: invitations } = await admin
    .from("law_invitations")
    .select("id, invitee_id, status")
    .eq("law_id", lawId)
    .eq("status", "pending");

  const inviteeIds = (invitations ?? []).map(i => i.invitee_id);
  const { data: inviteeProfiles } = inviteeIds.length > 0
    ? await admin.from("profiles").select("id, display_name").in("id", inviteeIds)
    : { data: [] };

  const inviteeMap = new Map((inviteeProfiles ?? []).map(p => [p.id, p.display_name]));

  const { data: proposal } = await admin
    .from("law_proposals")
    .select("id, proposal_type, proposed_by, proposed_article, created_at")
    .eq("law_id", lawId)
    .maybeSingle();

  let activeProposal = null;
  if (proposal) {
    const { data: votes } = await admin
      .from("law_proposal_votes")
      .select("user_id, approved, voted_at")
      .eq("proposal_id", proposal.id);

    activeProposal = {
      id: proposal.id,
      proposal_type: proposal.proposal_type,
      proposed_by: proposal.proposed_by,
      proposed_article: proposal.proposed_article,
      created_at: proposal.created_at,
      votes: (votes ?? []).map(v => ({
        user_id: v.user_id,
        approved: v.approved,
        voted_at: v.voted_at,
      })),
    };
  }

  return NextResponse.json({
    id: law.id,
    name: law.name,
    article: law.article,
    owner_id: law.owner_id,
    members: (members ?? []).map(m => ({
      user_id: m.user_id,
      display_name: profileMap.get(m.user_id)?.display_name ?? "",
      avatar_url: profileMap.get(m.user_id)?.avatar_url ?? null,
      joined_at: m.joined_at,
    })),
    pending_invitations: (invitations ?? []).map(i => ({
      id: i.id,
      invitee_id: i.invitee_id,
      invitee_name: inviteeMap.get(i.invitee_id) ?? "",
    })),
    active_proposal: activeProposal,
  });
}
