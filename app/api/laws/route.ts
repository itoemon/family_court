import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";

export async function GET() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  const admin = createAdminClient();

  const { data: memberships, error } = await admin
    .from("law_members")
    .select("law_id")
    .eq("user_id", user.id);

  if (error) {
    console.error("[GET /api/laws] memberships query failed:", error);
    return NextResponse.json({ error: "法律一覧の取得に失敗しました" }, { status: 500 });
  }

  if (!memberships || memberships.length === 0) {
    return NextResponse.json([]);
  }

  const lawIds = memberships.map(m => m.law_id);

  const { data: laws, error: lawsError } = await admin
    .from("laws")
    .select("id, name, article, owner_id, created_at")
    .in("id", lawIds)
    .order("created_at", { ascending: false });

  if (lawsError) {
    console.error("[GET /api/laws] laws query failed:", lawsError);
    return NextResponse.json({ error: "法律一覧の取得に失敗しました" }, { status: 500 });
  }

  if (!laws || laws.length === 0) {
    return NextResponse.json([]);
  }

  const ownerIds = [...new Set(laws.map(l => l.owner_id))];
  const { data: ownerProfiles } = await admin
    .from("profiles")
    .select("id, display_name")
    .in("id", ownerIds);

  const profileMap = new Map((ownerProfiles ?? []).map(p => [p.id, p.display_name]));

  const { data: memberCounts } = await admin
    .from("law_members")
    .select("law_id")
    .in("law_id", lawIds);

  const countMap = new Map<string, number>();
  for (const m of memberCounts ?? []) {
    countMap.set(m.law_id, (countMap.get(m.law_id) ?? 0) + 1);
  }

  const { data: proposals } = await admin
    .from("law_proposals")
    .select("law_id")
    .in("law_id", lawIds);

  const proposalSet = new Set((proposals ?? []).map(p => p.law_id));

  const result = laws.map(law => ({
    id: law.id,
    name: law.name,
    article: law.article,
    owner_id: law.owner_id,
    owner_name: profileMap.get(law.owner_id) ?? "",
    member_count: countMap.get(law.id) ?? 0,
    has_active_proposal: proposalSet.has(law.id),
    created_at: law.created_at,
  }));

  return NextResponse.json(result);
}

export async function POST(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "未ログイン" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストの解析に失敗しました" }, { status: 400 });
  }

  const { name, article } = body as Record<string, unknown>;

  if (typeof name !== "string" || name.trim().length === 0) {
    return NextResponse.json({ error: "法律名は必須です" }, { status: 400 });
  }
  if (name.length > 100) {
    return NextResponse.json({ error: "法律名は100文字以内で入力してください" }, { status: 400 });
  }
  if (typeof article !== "string" || article.trim().length === 0) {
    return NextResponse.json({ error: "条文は必須です" }, { status: 400 });
  }
  if (article.length > 2000) {
    return NextResponse.json({ error: "条文は2000文字以内で入力してください" }, { status: 400 });
  }

  const admin = createAdminClient();

  const { data: law, error: lawError } = await admin
    .from("laws")
    .insert({ name: name.trim(), article: article.trim(), owner_id: user.id })
    .select("id")
    .single();

  if (lawError) {
    console.error("[POST /api/laws] insert law failed:", lawError);
    return NextResponse.json({ error: "法律の作成に失敗しました" }, { status: 500 });
  }

  const { error: memberError } = await admin
    .from("law_members")
    .insert({ law_id: law.id, user_id: user.id });

  if (memberError) {
    console.error("[POST /api/laws] insert member failed:", memberError);
    return NextResponse.json({ error: "法律の作成に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ id: law.id }, { status: 201 });
}
