import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; invId: string }> }
) {
  const { id: lawId, invId } = await params;
  if (!isUuid(lawId) || !isUuid(invId)) {
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

  const { status } = body as Record<string, unknown>;
  if (status !== "accepted" && status !== "rejected") {
    return NextResponse.json({ error: "status は accepted または rejected を指定してください" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: invitation } = await admin
    .from("law_invitations")
    .select("id, law_id, invitee_id, status")
    .eq("id", invId)
    .eq("law_id", lawId)
    .maybeSingle();

  if (!invitation) return NextResponse.json({ error: "招待が見つかりません" }, { status: 404 });
  if (invitation.invitee_id !== user.id) {
    return NextResponse.json({ error: "この招待の対象者ではありません" }, { status: 403 });
  }
  if (invitation.status !== "pending") {
    return NextResponse.json({ error: "既に処理済みの招待です" }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("law_invitations")
    .update({ status })
    .eq("id", invId);

  if (updateError) {
    console.error("[PATCH /api/laws/[id]/invitations/[invId]] update failed:", updateError);
    return NextResponse.json({ error: "招待の更新に失敗しました" }, { status: 500 });
  }

  if (status === "accepted") {
    const { error: memberError } = await admin
      .from("law_members")
      .insert({ law_id: invitation.law_id, user_id: user.id });

    if (memberError) {
      console.error("[PATCH /api/laws/[id]/invitations/[invId]] member insert failed:", memberError);
      return NextResponse.json({ error: "メンバーへの追加に失敗しました" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
