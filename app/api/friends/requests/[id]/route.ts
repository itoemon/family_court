import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const { action } = body as Record<string, unknown>;
  if (action !== "accept" && action !== "reject") {
    return NextResponse.json(
      { error: "action は accept または reject を指定してください" },
      { status: 400 }
    );
  }

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
    return NextResponse.json({ error: "リクエストが見つかりません" }, { status: 404 });
  }

  // 自分が receiver でないリクエストは操作不可
  if (request.receiver_id !== user.id) {
    return NextResponse.json({ error: "権限がありません" }, { status: 403 });
  }

  if (request.status !== "pending") {
    return NextResponse.json({ error: "リクエストが見つかりません" }, { status: 404 });
  }

  if (action === "accept") {
    const { error: updateError } = await admin
      .from("friend_requests")
      .update({ status: "accepted" })
      .eq("id", id);

    if (updateError) {
      console.error("[friends/requests/patch] update failed:", updateError);
      return NextResponse.json({ error: "承認に失敗しました" }, { status: 500 });
    }
  } else {
    // 拒否はレコード削除（再送を許容するため）
    const { error: deleteError } = await admin
      .from("friend_requests")
      .delete()
      .eq("id", id);

    if (deleteError) {
      console.error("[friends/requests/patch] delete failed:", deleteError);
      return NextResponse.json({ error: "拒否に失敗しました" }, { status: 500 });
    }
  }

  return NextResponse.json({ ok: true });
}
