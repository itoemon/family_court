import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { checkAndApplyConsensus } from "@/lib/laws/consensus";
import { isUuid } from "@/lib/text-utils";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; propId: string }> }
) {
  const { id: lawId, propId } = await params;
  if (!isUuid(lawId) || !isUuid(propId)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }

  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const { approved } = body as Record<string, unknown>;
  if (typeof approved !== "boolean") {
    return NextResponse.json({ error: "approved は boolean で指定してください" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: member } = await admin
    .from("law_members")
    .select("id")
    .eq("law_id", lawId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "メンバーではありません" }, { status: 403 });

  const { data: proposal } = await admin
    .from("law_proposals")
    .select("id")
    .eq("id", propId)
    .eq("law_id", lawId)
    .maybeSingle();

  if (!proposal) return NextResponse.json({ error: "提案が見つかりません" }, { status: 404 });

  const { error: upsertError } = await admin
    .from("law_proposal_votes")
    .upsert(
      { proposal_id: propId, user_id: user.id, approved, voted_at: new Date().toISOString() },
      { onConflict: "proposal_id,user_id" }
    );

  if (upsertError) {
    console.error("[POST /api/laws/[id]/proposals/[propId]/votes] upsert failed:", upsertError);
    return NextResponse.json({ error: "投票に失敗しました" }, { status: 500 });
  }

  await checkAndApplyConsensus(admin, lawId, propId);

  return NextResponse.json({ ok: true });
}
