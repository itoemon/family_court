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

  // 原告の表示名と BYOK（api_key_encrypted）の有無を取得。
  // 取得失敗を握りつぶすと BYOK ユーザーでも hasByok=false と誤判定して
  // クレジットを消費し得るため、失敗時はクレジット消費前に 500 で停止する。
  const { data: profile, error: profileError } = await admin
    .from("profiles")
    .select("display_name, api_key_encrypted")
    .eq("id", user.id)
    .single();

  if (profileError || !profile) {
    console.error("[cases] profile fetch failed:", profileError);
    return NextResponse.json({ error: "プロフィールの取得に失敗しました" }, { status: 500 });
  }

  const hasByok = !!profile.api_key_encrypted;

  // MON-001: クレジット判定。
  // - BYOK あり → 消費なし・uses_service_key=false。
  // - BYOK なし → consume_credit を先に呼ぶ。NULL(残高0) なら 402 で INSERT しない。
  //   整数(消費成功) なら uses_service_key=true で INSERT。INSERT 失敗時は補償で +1 戻す。
  let usesServiceKey = false;
  if (!hasByok) {
    const { data: remaining, error: consumeError } = await admin.rpc("consume_credit", {
      p_user_id: user.id,
    });
    if (consumeError) {
      console.error("[cases] consume_credit failed:", consumeError);
      return NextResponse.json({ error: "クレジットの処理に失敗しました" }, { status: 500 });
    }
    // remaining が null（更新行なし＝残高 0）なら消費できていない → 402。ケースは作らない。
    if (remaining === null || remaining === undefined) {
      return NextResponse.json(
        {
          error:
            "クレジットが不足しています。ご自分の Claude API キーを登録（BYOK）すると無料でご利用いただけます。",
        },
        { status: 402 }
      );
    }
    usesServiceKey = true;
  }

  // max_rounds は DB default (3) に委ねる。FEAT-006 で固定値となったため明示指定しない。
  const { data, error } = await admin
    .from("cases")
    .insert({
      topic: body.topic.trim(),
      plaintiff_id: user.id,
      uses_service_key: usesServiceKey,
    })
    .select()
    .single();

  if (error) {
    // 消費済みだが INSERT に失敗した場合は補償でクレジットを 1 戻す（安全側に倒す）。
    // read-then-write は並行更新で上書き競合するため、原子的加算の refund_credit RPC を使う。
    if (usesServiceKey) {
      const { error: refundError } = await admin.rpc("refund_credit", {
        p_user_id: user.id,
      });
      if (refundError) {
        console.error("[cases] credit refund failed after insert error:", refundError);
      }
    }
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  return NextResponse.json({
    ...data,
    plaintiff: { name: profile?.display_name ?? "提案者", joinedAt: data.created_at },
    defendant: null,
    arguments: [],
    verdict: null,
  }, { status: 201 });
}
