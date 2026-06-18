import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

// PATCH /api/laws/[id]/visibility — 公開トグル（オーナーのみ）
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: lawId } = await params;
  if (!isUuid(lawId)) {
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

  const { is_public } = body as Record<string, unknown>;
  if (typeof is_public !== "boolean") {
    return NextResponse.json({ error: "is_public は真偽値で指定してください" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: law } = await admin
    .from("laws")
    .select("owner_id")
    .eq("id", lawId)
    .maybeSingle();

  if (!law) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });
  if (law.owner_id !== user.id) {
    return NextResponse.json({ error: "オーナーのみ公開設定を変更できます" }, { status: 403 });
  }

  // is_public のみ更新。updated_at は触らない（条文改定の意味論を壊さないため）。
  const { error: updateError } = await admin
    .from("laws")
    .update({ is_public })
    .eq("id", lawId);

  if (updateError) {
    console.error("[PATCH /api/laws/[id]/visibility] update failed:", updateError);
    return NextResponse.json({ error: "公開設定の変更に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: lawId, is_public });
}
