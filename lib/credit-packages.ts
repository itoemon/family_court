// MON-001 PR-B: クレジットパッケージ定義の単一の真実（Single Source of Truth）。
// 純データ（秘密なし）のためサーバ / クライアント双方から import 可。
// 金額・クレジット数はここだけを正とし、クライアントからは受け取らない（改ざん防止）。
// jpy は Stripe の unit_amount。JPY はゼロ小数通貨なので円そのものを渡す。

export interface CreditPackage {
  id: string;
  credits: number;
  jpy: number;
}

export const CREDIT_PACKAGES = [
  { id: "credits_10", credits: 10, jpy: 500 },
  { id: "credits_30", credits: 30, jpy: 1200 },
  { id: "credits_100", credits: 100, jpy: 3500 },
] as const satisfies readonly CreditPackage[];

export type CreditPackageId = (typeof CREDIT_PACKAGES)[number]["id"];

// packageId → 定義 lookup。未知 id は undefined（呼び出し側で 400 等に倒す）。
export function getCreditPackage(id: unknown): CreditPackage | undefined {
  if (typeof id !== "string") return undefined;
  return CREDIT_PACKAGES.find((p) => p.id === id);
}
