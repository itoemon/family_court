import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function PATCH(
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

  const { new_owner_id } = body as Record<string, unknown>;
  if (typeof new_owner_id !== "string" || !UUID_REGEX.test(new_owner_id)) {
    return NextResponse.json({ error: "new_owner_id が不正です" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: law } = await admin
    .from("laws")
    .select("owner_id")
    .eq("id", lawId)
    .maybeSingle();

  if (!law) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });
  if (law.owner_id !== user.id) {
    return NextResponse.json({ error: "オーナーのみ移譲できます" }, { status: 403 });
  }

  const { data: targetMember } = await admin
    .from("law_members")
    .select("id")
    .eq("law_id", lawId)
    .eq("user_id", new_owner_id)
    .maybeSingle();

  if (!targetMember) {
    return NextResponse.json({ error: "移譲先のユーザーはメンバーではありません" }, { status: 409 });
  }

  const { error: updateError } = await admin
    .from("laws")
    .update({ owner_id: new_owner_id })
    .eq("id", lawId);

  if (updateError) {
    console.error("[PATCH /api/laws/[id]/owner] update failed:", updateError);
    return NextResponse.json({ error: "オーナー権の移譲に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
