import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const { id } = await params;
  if (!isUuid(id)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }
  const admin = createAdminClient();

  const { data: request, error: fetchError } = await admin
    .from("friend_requests")
    .select("id, sender_id, receiver_id, status")
    .eq("id", id)
    .single();

  if (fetchError || !request) {
    return NextResponse.json({ error: "フレンド関係が見つかりません" }, { status: 404 });
  }

  if (request.sender_id !== user.id && request.receiver_id !== user.id) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  if (request.status !== "accepted") {
    return NextResponse.json({ error: "フレンド関係が見つかりません" }, { status: 404 });
  }

  const { error: deleteError } = await admin
    .from("friend_requests")
    .delete()
    .eq("id", id);

  if (deleteError) {
    console.error("[friends/delete] delete failed:", deleteError);
    return NextResponse.json({ error: "削除に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
