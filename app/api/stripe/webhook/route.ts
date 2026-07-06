import { NextRequest, NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/server";
import { stripe } from "@/lib/stripe";
import { getCreditPackage } from "@/lib/credit-packages";
import { isUuid } from "@/lib/text-utils";
import type Stripe from "stripe";

// MON-001 PR-B: Stripe 決済結果 webhook。認証なし（Stripe が呼ぶ）＝署名検証で正当性を担保する。
// Cookie 認証がないため DB 操作は createAdminClient()（service_role）のみ。
export async function POST(req: NextRequest) {
  // 署名検証は JSON パース前の raw body が必要。App Router の Route Handler は req.text() で取れる
  // （Next 16 の POST ルートハンドラはキャッシュされないため追加設定不要）。
  const raw = await req.text();
  const sig = req.headers.get("stripe-signature");
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!sig || !webhookSecret) {
    console.error("[stripe/webhook] missing signature or webhook secret");
    return NextResponse.json({ error: "署名がありません" }, { status: 400 });
  }

  let event: Stripe.Event;
  try {
    event = stripe.webhooks.constructEvent(raw, sig, webhookSecret);
  } catch (err) {
    console.error("[stripe/webhook] signature verification failed:", err);
    return NextResponse.json({ error: "署名検証に失敗しました" }, { status: 400 });
  }

  // checkout.session.completed 以外は無視（200）。
  if (event.type !== "checkout.session.completed") {
    return NextResponse.json({ received: true });
  }

  const session = event.data.object as Stripe.Checkout.Session;

  // 支払い完了（payment_status==="paid"）のみ付与する。checkout は card 限定で同期決済のため
  // 通常 paid だが、非同期決済（設定ドリフト等）で支払い確定前に completed が飛んだ場合に
  // 未確定のままクレジットを付与しないための防御。未確定は付与せず 200（再送で無限ループさせない）。
  if (session.payment_status !== "paid") {
    console.warn("[stripe/webhook] session not paid, skipping grant:", session.payment_status);
    return NextResponse.json({ received: true, ignored: true });
  }

  const userId = session.metadata?.userId;
  const packageId = session.metadata?.packageId;
  const creditsRaw = session.metadata?.credits;
  const credits = creditsRaw != null ? parseInt(creditsRaw, 10) : NaN;
  const pkg = getCreditPackage(packageId);

  // metadata の妥当性検証（改ざん / 欠落耐性）。サーバのパッケージ定義と再照合し、
  // クレジット数が一致する場合のみ付与する。異常時は付与せず 200（再送させない）。
  if (!userId || !isUuid(userId) || !pkg || pkg.credits !== credits) {
    console.error("[stripe/webhook] invalid or tampered metadata:", { userId, packageId, creditsRaw });
    return NextResponse.json({ received: true, ignored: true });
  }

  const admin = createAdminClient();

  // 記録（冪等）と付与を単一トランザクションで原子的に実行する。
  // 返り値: 新規付与なら amount(>0)、既処理なら 0。error は 500（Stripe が再送。原子的なので
  // 「付与 commit 後の再送で二重付与」も「記録だけ残って付与漏れ」も起きない）。
  const { data: granted, error } = await admin.rpc("record_stripe_event_and_grant", {
    p_event_id: event.id,
    p_type: event.type,
    p_user_id: userId,
    p_amount: pkg.credits,
  });

  if (error) {
    console.error("[stripe/webhook] record_stripe_event_and_grant failed:", error);
    return NextResponse.json({ error: "クレジット付与に失敗しました" }, { status: 500 });
  }

  return NextResponse.json({ received: true, granted: granted ?? 0 });
}
