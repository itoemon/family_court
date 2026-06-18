import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { fetchPublicLaws, normalizeQuery } from "@/lib/laws-public";

// GET /api/laws/public — Hub 一覧（認証ユーザー）。name 部分一致検索 + 件数上限。
export async function GET(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const q = normalizeQuery(req.nextUrl.searchParams.get("q"));

  try {
    const laws = await fetchPublicLaws({ sessionClient: supabase, adminClient: createAdminClient(), q });
    return NextResponse.json(laws);
  } catch {
    return NextResponse.json({ error: "公開法律の取得に失敗しました" }, { status: 500 });
  }
}
