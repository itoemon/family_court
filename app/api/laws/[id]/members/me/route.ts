import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { checkAndApplyConsensus } from "@/lib/laws/consensus";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: lawId } = await params;

  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const admin = createAdminClient();

  const { data: law } = await admin
    .from("laws")
    .select("owner_id")
    .eq("id", lawId)
    .maybeSingle();

  if (!law) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });

  if (law.owner_id === user.id) {
    return NextResponse.json({ error: "オーナーは退会できません。先にオーナー権を移譲してください" }, { status: 403 });
  }

  const { data: member } = await admin
    .from("law_members")
    .select("id")
    .eq("law_id", lawId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "メンバーではありません" }, { status: 404 });

  const { data: proposal } = await admin
    .from("law_proposals")
    .select("id")
    .eq("law_id", lawId)
    .maybeSingle();

  if (proposal) {
    await admin
      .from("law_proposal_votes")
      .delete()
      .eq("proposal_id", proposal.id)
      .eq("user_id", user.id);
  }

  await admin
    .from("law_members")
    .delete()
    .eq("law_id", lawId)
    .eq("user_id", user.id);

  if (proposal) {
    await checkAndApplyConsensus(admin, lawId, proposal.id);
  }

  return NextResponse.json({ ok: true });
}
