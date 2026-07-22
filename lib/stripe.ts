import "server-only";
import Stripe from "stripe";

// MON-001 PR-B: Stripe クライアントの集約。サーバ専用（STRIPE_SECRET_KEY は NEXT_PUBLIC_ なし）。
//
// 遅延初期化する。モジュール読込時に `new Stripe(process.env.STRIPE_SECRET_KEY!)` を実行すると、
// 本番ビルドの "collect page data"（Stripe を import するルートの静的解析）時に、キーが未注入だと
// Stripe コンストラクタが例外を投げて **ビルド全体が失敗**する（PR-B が本番デプロイ不能だった直接原因）。
// 初回使用時にのみ構築し、以降はメモ化した同一インスタンスを返すことで、ビルド時のキー要求を無くす。
let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    const key = process.env.STRIPE_SECRET_KEY;
    if (!key) throw new Error("STRIPE_SECRET_KEY が未設定です");
    _stripe = new Stripe(key);
  }
  return _stripe;
}
