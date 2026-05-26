import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";

export async function GET(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const q = req.nextUrl.searchParams.get("q");
  if (!q || q.length < 1 || q.length > 100) {
    return NextResponse.json({ error: "検索クエリは1〜100文字で指定してください" }, { status: 400 });
  }

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("search_users", {
    query: q,
    current_uid: user.id,
  });

  if (error) {
    console.error("[users/search] rpc failed:", error);
    return NextResponse.json({ error: "検索に失敗しました" }, { status: 500 });
  }

  return NextResponse.json(data ?? []);
}
