import { NextRequest, NextResponse } from "next/server";
import { createSessionClient, createAdminClient } from "@/lib/supabase/server";
import { CreateCaseRequest } from "@/lib/types";

export async function POST(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  const body: CreateCaseRequest = await req.json();
  if (!body.topic?.trim()) {
    return NextResponse.json({ error: "議題は必須です" }, { status: 400 });
  }
  if (body.topic.trim().length > 200) {
    return NextResponse.json({ error: "議題は200文字以内で入力してください" }, { status: 400 });
  }

  const admin = createAdminClient();

  // 原告の表示名を取得
  const { data: profile } = await admin
    .from("profiles")
    .select("display_name")
    .eq("id", user.id)
    .single();

  // max_rounds は DB default (3) に委ねる。FEAT-006 で固定値となったため明示指定しない。
  const { data, error } = await admin
    .from("cases")
    .insert({
      topic: body.topic.trim(),
      plaintiff_id: user.id,
    })
    .select()
    .single();

  if (error) return NextResponse.json({ error: error.message }, { status: 500 });

  return NextResponse.json({
    ...data,
    plaintiff: { name: profile?.display_name ?? "提案者", joinedAt: data.created_at },
    defendant: null,
    arguments: [],
    verdict: null,
  }, { status: 201 });
}
