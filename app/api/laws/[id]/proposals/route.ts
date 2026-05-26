import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import type { ProposalType } from "@/lib/types";

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: lawId } = await params;

  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const { proposal_type, proposed_article } = body as Record<string, unknown>;

  if (proposal_type !== "amendment" && proposal_type !== "deletion") {
    return NextResponse.json({ error: "proposal_type は amendment または deletion を指定してください" }, { status: 400 });
  }

  if (proposal_type === "amendment") {
    if (typeof proposed_article !== "string" || proposed_article.trim().length === 0) {
      return NextResponse.json({ error: "改定案の条文は必須です" }, { status: 400 });
    }
    if (proposed_article.length > 2000) {
      return NextResponse.json({ error: "条文は2000文字以内で入力してください" }, { status: 400 });
    }
  }

  const admin = createAdminClient();

  const { data: law } = await admin
    .from("laws")
    .select("owner_id")
    .eq("id", lawId)
    .maybeSingle();

  if (!law) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });

  const { data: member } = await admin
    .from("law_members")
    .select("id")
    .eq("law_id", lawId)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!member) return NextResponse.json({ error: "メンバーではありません" }, { status: 403 });

  if (proposal_type === "deletion" && law.owner_id !== user.id) {
    return NextResponse.json({ error: "削除提案はオーナーのみが行えます" }, { status: 403 });
  }

  const { data: proposal, error: insertError } = await admin
    .from("law_proposals")
    .insert({
      law_id: lawId,
      proposal_type: proposal_type as ProposalType,
      proposed_by: user.id,
      proposed_article: proposal_type === "amendment"
        ? (proposed_article as string).trim()
        : null,
    })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "既に進行中の提案があります" }, { status: 409 });
    }
    console.error("[POST /api/laws/[id]/proposals] insert failed:", insertError);
    return NextResponse.json({ error: "提案の作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: proposal.id }, { status: 201 });
}
