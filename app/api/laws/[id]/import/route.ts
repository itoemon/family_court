import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { isUuid } from "@/lib/text-utils";

// POST /api/laws/[id]/import — 公開法律を純クローンして新規法律を作成する。
// 元法律は読み取りのみ（is_public 判定）。name + article のみ複製、出自リンクは持たない。
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: lawId } = await params;
  if (!isUuid(lawId)) {
    return NextResponse.json({ error: "不正な ID 形式です" }, { status: 400 });
  }

  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const admin = createAdminClient();

  const { data: source, error: sourceError } = await admin
    .from("laws")
    .select("id, name, article, is_public")
    .eq("id", lawId)
    .maybeSingle();

  if (sourceError) {
    console.error("[POST /api/laws/[id]/import] source SELECT failed:", sourceError);
    return NextResponse.json({ error: "インポートに失敗しました" }, { status: 500 });
  }
  if (!source) return NextResponse.json({ error: "法律が見つかりません" }, { status: 404 });
  if (source.is_public !== true) {
    return NextResponse.json({ error: "公開されていない法律はインポートできません" }, { status: 403 });
  }

  // FEAT-003 POST /api/laws と同一の初期化手順（laws INSERT → law_members INSERT）。
  const { data: law, error: lawError } = await admin
    .from("laws")
    .insert({ name: source.name, article: source.article, owner_id: user.id, is_public: false })
    .select("id")
    .single();

  if (lawError) {
    console.error("[POST /api/laws/[id]/import] insert law failed:", lawError);
    return NextResponse.json({ error: "インポートに失敗しました" }, { status: 500 });
  }

  const { error: memberError } = await admin
    .from("law_members")
    .insert({ law_id: law.id, user_id: user.id });

  if (memberError) {
    console.error("[POST /api/laws/[id]/import] insert member failed:", memberError);
    return NextResponse.json({ error: "インポートに失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: law.id }, { status: 201 });
}
