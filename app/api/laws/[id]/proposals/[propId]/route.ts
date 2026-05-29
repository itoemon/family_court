import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string; propId: string }> }
) {
  const { id: lawId, propId } = await params;
  if (!isUuid(lawId) || !isUuid(propId)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }

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
  if (law.owner_id !== user.id) {
    return NextResponse.json({ error: "オーナーのみ提案を取り下げられます" }, { status: 403 });
  }

  const { data: proposal } = await admin
    .from("law_proposals")
    .select("id")
    .eq("id", propId)
    .eq("law_id", lawId)
    .maybeSingle();

  if (!proposal) return NextResponse.json({ error: "提案が見つかりません" }, { status: 404 });

  const { error: deleteError } = await admin
    .from("law_proposals")
    .delete()
    .eq("id", propId);

  if (deleteError) {
    console.error("[DELETE /api/laws/[id]/proposals/[propId]] delete failed:", deleteError);
    return NextResponse.json({ error: "提案の取り下げに失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
