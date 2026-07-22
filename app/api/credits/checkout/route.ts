import { NextRequest, NextResponse } from "next/server";
import { createSessionClient } from "@/lib/supabase/server";
import { getStripe } from "@/lib/stripe";
import { getCreditPackage } from "@/lib/credit-packages";

// MON-001 PR-B: Stripe Checkout Session を作成する（認証ユーザーのみ）。
// 金額 / クレジット数はクライアントから受け取らず、必ずサーバの lib/credit-packages.ts を正とする。
export async function POST(req: NextRequest) {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "ログインが必要です" }, { status: 401 });

  let body: { packageId?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "リクエストが不正です" }, { status: 400 });
  }

  const pkg = getCreditPackage(body.packageId);
  if (!pkg) {
    return NextResponse.json({ error: "不明なパッケージです" }, { status: 400 });
  }

  // 戻り先の基点: NEXT_PUBLIC_SITE_URL を優先、未設定なら request origin（PR #42 と同方針）。
  const origin = process.env.NEXT_PUBLIC_SITE_URL || new URL(req.url).origin;

  try {
    const stripe = getStripe(); // 遅延初期化（try 内で構築し、キー未設定は既存 catch で 500 整形）。
    const session = await stripe.checkout.sessions.create({
      mode: "payment",
      // card 限定にして同期決済に固定する。非同期決済（支払い確定前に completed が飛ぶ手段）を
      // 有効化させず、webhook の payment_status==="paid" ガードと合わせて未確定付与を防ぐ。
      payment_method_types: ["card"],
      line_items: [
        {
          price_data: {
            currency: "jpy",
            unit_amount: pkg.jpy, // JPY はゼロ小数通貨 → 円そのもの
            product_data: { name: `${pkg.credits} クレジット` },
          },
          quantity: 1,
        },
      ],
      success_url: `${origin}/profile?purchase=success`,
      cancel_url: `${origin}/profile?purchase=cancel`,
      client_reference_id: user.id,
      // webhook はこの metadata から誰にいくつ付与するかを決める（credits は文字列で格納）。
      metadata: {
        userId: user.id,
        credits: String(pkg.credits),
        packageId: pkg.id,
      },
    });

    if (!session.url) {
      return NextResponse.json({ error: "決済ページの作成に失敗しました" }, { status: 500 });
    }
    return NextResponse.json({ url: session.url });
  } catch (err) {
    console.error("[credits/checkout] stripe session create failed:", err);
    return NextResponse.json({ error: "決済ページの作成に失敗しました" }, { status: 500 });
  }
}
