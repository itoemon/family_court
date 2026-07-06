# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1（design.md 取り扱い）**: `docs/knowledge/design.md` は永続累積資料である。既存設計（FEAT-003/004・MON-001 PR-A 等）を**絶対に削除・短縮・全面書き換えしないこと**。**末尾に新規セクション `## MON-001 PR-B Stripe クレジット購入` を純追記**する。
>
> **重要 2（実装体制）**: 本タスクはリードがハーネスの Agent（サブエージェント）で実装する。agents.sh の engineer は本環境で不安定なため使わない。実装後はリードが tsc/lint/E2E/アドバサリアル検証を直接行う。
>
> **重要 3（migration の冪等化）**: 新規 migration は OPS-002 方針で冪等に（`CREATE OR REPLACE FUNCTION` / `CREATE TABLE IF NOT EXISTS` / `ADD COLUMN IF NOT EXISTS`）。`schema.sql`（本番スナップショット）と二重適用しても停止しないこと。末尾に `NOTIFY pgrst, 'reload schema';`。
>
> **重要 4（お金のクリティカリティ）**: 本タスクは実決済が絡む。**webhook 署名検証・二重付与防止（冪等性）・金額/クレジット数の改ざん防止**を最優先で正しく実装する。曖昧点はビルドに丸投げせず設計で確定する。

## 今回のタスク

MON-001 の第 2 段階 = PR-B。**Stripe Checkout でクレジットを購入できる**ようにする。PR-A で導入したクレジット基盤（`profiles.credits` / `consume_credit` / 402 ゲート）の上に、残高を**増やす**正規経路（決済）を追加する。

**バックログ ID**: MON-001（クレジット制課金）PR-B
**依存**: MON-001 PR-A（PR #61、`profiles.credits` / `consume_credit` / `refund_credit`）、Stripe。

---

### スコープ確定事項（2026-07-05 ダイチ確認 / リード決定）

1. **決済手段**: Stripe **Checkout**（Stripe ホスト型の決済ページ）。カード情報は自前で扱わない。`mode: "payment"`（都度購入、サブスクではない。サブスクはスコープ③で将来）。
2. **クレジットパッケージ（3 段。価格はリードに一任・運用しながら調整）**:
   | id | クレジット | 価格(JPY) |
   |---|---|---|
   | `credits_10` | 10 | 500 |
   | `credits_30` | 30 | 1200 |
   | `credits_100` | 100 | 3500 |
   - パッケージ定義は**コードに一元化**（`lib/credit-packages.ts`）。Stripe 側に Product/Price を事前作成せず、Checkout Session 作成時に **`price_data` をインライン指定**（`currency: "jpy"`、`unit_amount` は JPY なので**最小単位＝円そのまま**＝500/1200/3500、`quantity: 1`）。価格変更はコード変更のみで済む。
3. **付与単位**: 決済成功（`checkout.session.completed`）を **webhook** で受けて、購入者の `profiles.credits` にパッケージのクレジット数を加算する。
4. **冪等性**: Stripe は webhook を複数回送りうる。**同一イベント/セッションで二重付与しない**こと（後述の `stripe_events` テーブルで dedup）。

---

### データモデル変更

新規 migration `supabase/migrations/<timestamp>_mon001b_stripe_purchase.sql`（既存最大 timestamp `20260705190001` より後・冪等）:

1. **`grant_credit(p_user_id uuid, p_amount integer)`**: クレジットを原子的に加算する関数（PR-A の consume/refund と同じ堅牢化）。
   - `security definer` / `set search_path = ''` / `update public.profiles set credits = credits + p_amount where id = p_user_id returning credits`。
   - `p_amount` の妥当性（正の整数・上限）は**呼び出し側（webhook）でパッケージ定義と照合して保証**する（関数は素直に加算）。防御的に `p_amount > 0` の check を関数内に入れてもよい。
   - `revoke execute ... from public, anon, authenticated` + `grant execute ... to service_role`（RPC 非露出・admin のみ）。
2. **`stripe_events` テーブル（webhook 冪等性・二重付与防止）**:
   - `create table if not exists public.stripe_events ( id text primary key, type text, created_at timestamptz default now() not null );`
   - `id` は Stripe の **event.id**（`evt_...`）。webhook 処理の最初に `insert ... on conflict (id) do nothing` し、**挿入行数が 0 なら既処理**として付与をスキップする（原子的 dedup）。
   - `alter table public.stripe_events enable row level security;`（ポリシーなし = service_role のみアクセス。guest_tokens と同じ方針）。
   - `grant` は付けない（service_role は RLS/grant をバイパス）。
3. `schema.sql` にも `grant_credit` 関数・`stripe_events` テーブルを反映（スナップショット整合）。
4. 末尾 `notify pgrst, 'reload schema';`。

---

### API 仕様（追加）

#### 1. `POST /api/credits/checkout`（Checkout セッション作成・認証ユーザー）
- 認証必須（未認証 401）。
- リクエスト: `{ packageId: "credits_10" | "credits_30" | "credits_100" }`。**サーバ側で `lib/credit-packages.ts` の定義と照合**し、未知の id は 400。**金額・クレジット数はクライアントから受け取らず、必ずサーバのパッケージ定義を正**とする（改ざん防止の要）。
- Stripe Checkout Session を作成:
  - `mode: "payment"`
  - `line_items: [{ price_data: { currency: "jpy", unit_amount: <pkg.jpy>, product_data: { name: "<pkg.credits> クレジット" } }, quantity: 1 }]`
  - `success_url` / `cancel_url`: `/profile`（または `/credits`）へ。`NEXT_PUBLIC_SITE_URL` 基点（未設定時は request origin フォールバック。PR #42 の signup と同方針）。`success_url` に `?purchase=success` 等のクエリを付けて UI で完了トースト表示可。
  - **`metadata: { userId: <user.id>, credits: <pkg.credits>, packageId }`**（webhook がこの metadata から誰にいくつ付与するか決める）。`client_reference_id: user.id` も併用してよい。
- レスポンス: `{ url: session.url }`。クライアントは `window.location = url` で Stripe へ遷移。
- 秘密: `STRIPE_SECRET_KEY` はサーバ専用 env。クライアントへ渡さない。

#### 2. `POST /api/stripe/webhook`（Stripe からの決済結果通知）
- **認証なし**（Stripe が呼ぶ）。代わりに**署名検証で正当性を担保**する。
- **生のリクエストボディ**を取得して `stripe.webhooks.constructEvent(rawBody, sig, process.env.STRIPE_WEBHOOK_SECRET)` で検証（Next.js App Router では `await req.text()` で raw body を取得。JSON パース前の生文字列が必要）。署名不一致は 400。
- `event.type === "checkout.session.completed"` のみ処理（他は 200 で無視）。
- **冪等性**: `admin.from("stripe_events").insert({ id: event.id, type: event.type })`。重複（`23505` on conflict）なら**既処理として何もせず 200**。`on conflict do nothing` 相当を使い、挿入できた時のみ付与へ進む。
- 付与: `session.metadata` から `userId` / `credits` を取得（`credits` を parseInt、サーバ定義と再照合して妥当性確認 = クライアント/セッション改ざん耐性）。`admin.rpc("grant_credit", { p_user_id: userId, p_amount: credits })`。
- 成功時 200。付与処理中の例外は 500（Stripe が再送 → dedup で二重付与しない）。
- **重要**: このルートは `createAdminClient()`（service_role）で DB 操作。`createSessionClient()` は使わない（Cookie 認証がないため）。

---

### コンポーネント設計（UI）

1. **`lib/credit-packages.ts`（新規）**: パッケージ定義の単一の真実。`export const CREDIT_PACKAGES = [{ id:"credits_10", credits:10, jpy:500 }, ...] as const;` + id→定義の lookup ヘルパー。サーバ/クライアント両方から import 可（秘密を含まない・純データ）。
2. **購入 UI**: `/profile`（残高表示の近く）に 3 パッケージの購入ボタンを置く。各ボタン → `POST /api/credits/checkout` → 返った `url` へ遷移。**PR-A の `app/page.tsx` の「クレジットの購入は準備中です」プレースホルダを、`/profile`（またはクレジット購入セクション）への導線に差し替える**（作成ガード時に「購入する」リンクを機能させる）。
   - 専用ページ `/credits` を作るか `/profile` 内セクションかは実装判断。最小は `/profile` 内セクション + `app/page.tsx` のプレースホルダをそのリンクに。
3. 決済完了後の戻り先（`?purchase=success`）で「クレジットを追加しました」的なフィードバック表示（任意・最小で可）。配色は既存トーン（stone / `brand-700/800`、成功は控えめに）。

---

### セキュリティ設計

- **金額/クレジット数の改ざん防止**: Checkout の金額・付与クレジット数は**サーバの `lib/credit-packages.ts` のみを正**とする。クライアントから金額・クレジット数を受け取らない（`packageId` のみ受け取りサーバで解決）。webhook でも metadata の `credits` をサーバ定義と再照合。
- **webhook 署名検証**: `STRIPE_WEBHOOK_SECRET` で `constructEvent`。検証前に DB を触らない。raw body で検証。
- **二重付与防止**: `stripe_events(event.id)` の原子的 dedup。付与は挿入成功時のみ。
- **付与関数の秘匿**: `grant_credit` は service_role のみ EXECUTE（RPC 非露出）。`profiles` の UPDATE 権限は PR-A で既に authenticated/anon から REVOKE 済み → grant も admin 経由のみ。
- **秘密の非露出**: `STRIPE_SECRET_KEY` / `STRIPE_WEBHOOK_SECRET` はサーバ専用（`NEXT_PUBLIC_` なし）。`NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY` のみクライアント可（本実装は Checkout リダイレクト方式なので publishable すら不要な可能性 = サーバで session 作成し url へ飛ばすだけ。使わないなら import しない）。
- webhook ルートを Next.js が body パースしてしまうと署名検証が壊れる点に注意（App Router の Route Handler は `req.text()` で raw を取れる。Pages API の `bodyParser:false` 相当の考慮）。

---

### テスト観点（E2E / 統合）

Stripe のホスト決済ページは E2E で完了できないため、**webhook ハンドラと checkout セッション作成を分けて**検証する。テスト DB（`eckrccrfnblzdbflnssf`）+ `.env.test` の Stripe **テスト**キー + `STRIPE_WEBHOOK_SECRET`（テスト値）を使う。新規 spec `tests/e2e/mon001b-purchase.spec.ts`:

1. **checkout セッション作成**: 認証ユーザーが `POST /api/credits/checkout {packageId:"credits_10"}` → 200 + `url` が Stripe の checkout URL（`checkout.stripe.com` 等）であること。未知 packageId → 400。金額をクライアントから渡しても無視されること（サーバ定義が使われる）。
2. **webhook 付与**: `checkout.session.completed` イベントを **`stripe.webhooks.generateTestHeaderString({ payload, secret: STRIPE_WEBHOOK_SECRET })`** で署名して `POST /api/stripe/webhook` → 200。対象ユーザーの `credits` が +credits されること（admin で前後確認）。
3. **冪等性**: 同一 event.id の webhook を 2 回 POST → 2 回目は付与されない（credits が 1 回分のみ増加）。
4. **署名不正**: 不正な署名で POST → 400、付与なし。
5. 専用 ephemeral ユーザーで検証、後始末は `profiles`(ephemeral)/`stripe_events` 掃除。`e2e_user_a` を汚染しない。
6. 既存 mon001-credits / critical / bug005 がリグレッションしないこと。
- **注意**: webhook spec は Stripe SDK の署名生成を使うため、`stripe` パッケージが test でも import できること。実 Stripe API 呼び出しは checkout セッション作成（テストキーで実際に Stripe test mode に作成される・無害）のみ。

---

### 制約・前提条件 / デプロイ注意

- `stripe` npm パッケージを追加（`npm install stripe`）。サーバでのみ import。
- **env**: `STRIPE_SECRET_KEY` / `NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY`（PR-A キー移設で `.env.local`/`.env.test` + Vercel Preview に設定済み）、`STRIPE_WEBHOOK_SECRET`（テスト値は `.env.test`/`.env.local` に設定済み）。`.env.test.example` に 3 つのキー名を追記（値なし）。
- **本番/Preview の webhook secret**: Stripe ダッシュボードで **webhook endpoint（デプロイ URL の `/api/stripe/webhook`）を作成**すると `whsec_...` が発行される。それを Vercel の該当 scope に登録する（**この作業はダイチ/リードがデプロイ時に実施**。本 PR のコード実装・オフライン検証には不要）。
- **本番 Stripe live キー**: 現状 Preview にテストキーのみ。Production の Stripe 本番キー登録は本番公開時（別途）。
- PR-A の migration（`profiles.credits` 等）がテスト DB 適用済み。本 PR の migration もリードがテスト DB へ適用する。

---

### スコープ外（本 PR-B で実装しない）

- サブスクリプション月額プラン（MON-001 スコープ③、将来）。
- 返金 UI・購入履歴の詳細台帳（`stripe_events` は dedup 用の最小記録。購入履歴表示は将来）。
- 領収書・請求書 UI（Stripe が送るメール領収書で当面代替）。
- 広告（MON-002）。
- 本番 Stripe live 環境の実際の endpoint 作成・live キー登録（デプロイ運用作業）。

---

### 関連ファイル（想定）
- `supabase/migrations/<timestamp>_mon001b_stripe_purchase.sql`（新規）
- `lib/credit-packages.ts`（新規）
- `lib/stripe.ts`（新規・Stripe クライアント初期化を集約してもよい）
- `app/api/credits/checkout/route.ts`（新規）
- `app/api/stripe/webhook/route.ts`（新規）
- `app/profile/page.tsx` + 購入 UI コンポーネント（変更/新規）
- `app/page.tsx`（プレースホルダ購入導線を実リンクへ）
- `supabase/schema.sql`（`grant_credit`・`stripe_events` 反映）
- `.env.test.example`（Stripe キー名追記）
- `package.json`（`stripe` 追加）
- `tests/e2e/mon001b-purchase.spec.ts`（新規）
- `docs/knowledge/design.md`（**末尾に MON-001 PR-B セクションを純追記**）

### 既存資産の再利用指針
- クレジット加算は PR-A の consume/refund と同じ SECURITY DEFINER + service_role-only RPC パターン（`grant_credit`）。
- `createAdminClient()` / `createSessionClient()` 分離、`isUuid()` 検証。
- `NEXT_PUBLIC_SITE_URL` + origin フォールバック（PR #42）。
- RLS ポリシーなし + service_role のみ（`guest_tokens` パターン）を `stripe_events` に踏襲。
