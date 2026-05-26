import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

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

  const { invitee_id } = body as Record<string, unknown>;
  if (typeof invitee_id !== "string" || !UUID_REGEX.test(invitee_id)) {
    return NextResponse.json({ error: "invitee_id が不正です" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: law } = await admin
    .from("laws")
    .select("owner_id")
    .eq("id", lawId)
    .maybeSingle();

  if (!law) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });
  if (law.owner_id !== user.id) {
    return NextResponse.json({ error: "オーナーのみ招待できます" }, { status: 403 });
  }

  const { data: inviteeProfile } = await admin
    .from("profiles")
    .select("id")
    .eq("id", invitee_id)
    .maybeSingle();

  if (!inviteeProfile) {
    return NextResponse.json({ error: "指定されたユーザーが存在しません" }, { status: 404 });
  }

  const { data: friendship } = await admin
    .from("friend_requests")
    .select("id")
    .or(
      `and(sender_id.eq.${user.id},receiver_id.eq.${invitee_id}),` +
      `and(sender_id.eq.${invitee_id},receiver_id.eq.${user.id})`
    )
    .eq("status", "accepted")
    .maybeSingle();

  if (!friendship) {
    return NextResponse.json({ error: "フレンドではありません" }, { status: 409 });
  }

  const { data: existingMember } = await admin
    .from("law_members")
    .select("id")
    .eq("law_id", lawId)
    .eq("user_id", invitee_id)
    .maybeSingle();

  if (existingMember) {
    return NextResponse.json({ error: "既にメンバーです" }, { status: 409 });
  }

  const { data: existingInvitation } = await admin
    .from("law_invitations")
    .select("id, status")
    .eq("law_id", lawId)
    .eq("invitee_id", invitee_id)
    .maybeSingle();

  if (existingInvitation?.status === "pending") {
    return NextResponse.json({ error: "既に招待済みです" }, { status: 409 });
  }

  const { data: invitation, error: insertError } = await admin
    .from("law_invitations")
    .insert({ law_id: lawId, invitee_id, status: "pending" })
    .select("id")
    .single();

  if (insertError) {
    if (insertError.code === "23505") {
      return NextResponse.json({ error: "既に招待済みです" }, { status: 409 });
    }
    console.error("[POST /api/laws/[id]/invitations] insert failed:", insertError);
    return NextResponse.json({ error: "招待の作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: invitation.id }, { status: 201 });
}
