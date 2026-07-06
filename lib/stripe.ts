import "server-only";
import Stripe from "stripe";

// MON-001 PR-B: Stripe クライアントの集約。サーバ専用（STRIPE_SECRET_KEY は NEXT_PUBLIC_ なし）。
export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);
