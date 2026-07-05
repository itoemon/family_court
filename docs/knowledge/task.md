# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1（design.md 取り扱い）**: `docs/knowledge/design.md` は永続累積資料である。FEAT-003 / FEAT-004 等の既存設計を **絶対に削除・短縮・全面書き換えしないこと**。アーキは design.md を **必ず Read で全体を把握してから、末尾に新規セクション `## MON-001 PR-A クレジット基盤（消費・サービスキー・無料付与）` を追記**する。プロンプトの「# 詳細設計書」テンプレートは追記する**セクションの構造**であり、ファイル全体を置換する指示ではない。既存セクションは 1 行も消さない。
>
> **重要 2（フルパイプライン）**: 本タスクは課金サブシステムの追加であり、アーキ → ビルド → テスタ → オーディの**フルパイプライン**で進める（リード先行実装ではない）。
>
> **重要 3（migration の冪等化）**: 新規 migration は OPS-002 の方針に従い冪等に書く（`ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS ... → CREATE POLICY` / `CREATE OR REPLACE FUNCTION`）。理由は `supabase/schema.sql`（本番スナップショット）と二重適用しても停止しないようにするため。
>
> **重要 4（スキーマキャッシュ）**: 新カラム（`profiles.credits` 等）を migration で追加した後、PostgREST のスキーマキャッシュ再読込が必要。`run_migrations`（agents.sh）と `setup-test-db.sh` は PR #59 で適用後に `NOTIFY pgrst, 'reload schema';` を自動実行するようになっているので、パイプライン経由なら追加対応は不要。手動適用時のみ注意。

## 今回のタスク

ケース作成に **クレジット制課金の基盤**を導入する（MON-001 の第 1 段階 = PR-A）。

**バックログ ID**: MON-001（クレジット制課金）
**ブランチ**: ビルドが `feature/<timestamp>` 形式で新規作成する（`scripts/agents.sh` のハードコード命名に従う）

---

### スコープ確定事項（2026-06-24 ダイチ確認）

MON-001 全体の最終ゴールは「Stripe Checkout でクレジットを購入できる」状態（スコープ②）だが、**本 PR-A は Stripe を含まないクレジット基盤のみ**を実装する。Stripe 決済・購入 UI は後続の **PR-B** で扱う（本 PR ではスコープ外）。理由: PR-A は Stripe キー無しで実装・検証でき（`TEST_MODE` モックで AI 呼び出しを回避できる）、PR-B のキー準備と並行できるため。

ダイチが確定済みの方針:

1. **課金モデル**: 原告（ケース作成者）が
   - **BYOK（`profiles.api_key_encrypted` あり）→ クレジット消費なし**、自分のキーで全 AI 実行（現行どおり）
   - **BYOK なし & クレジット ≥ 1 → ケース作成時に 1 消費**し、そのケースの全 AI 実行は**サービス側 API キー**を使う
   - **BYOK なし & クレジット 0 → ケース作成を 402 でブロック**（クレジット不足。購入導線は PR-B、本 PR では「不足」メッセージ + プロフィール等への案内で可）
2. **消費単位**: 1 クレジット = 1 ケース。**ケース作成時（`POST /api/cases`）に 1 消費**する。1 ケース内の AI 実行（opening / 各ターン / closing / 判決）は何回呼んでも追加消費しない（作成時のモードに従う）。
3. **無料お試しクレジット**: 新規ユーザーに **3 個**付与する。

---

### 背景

現状、裁判官 AI・弁護人 AI・判決生成はすべて**原告の BYOK（`profiles.api_key_encrypted`）必須**である。キー未登録ユーザーは各 AI ルートで「APIキーが登録されていません」(400) になり、AI 機能を一切使えない（`app/api/cases/[id]/verdict/route.ts:31` 等）。MON-001 はこの「非 BYOK ユーザーが**クレジットを消費してサービスのキーで AI を使える**」道を新設し、サービス側が負担する API 料金を将来課金で賄う基盤を作る。

AI 生成関数（`lib/judge.ts:generateJudgeMessage(params, apiKey)` / `lib/defense.ts` / `lib/claude.ts`）はいずれも **API キーを引数で受け取る**設計なので、サービスキーへの差し替えは「呼び出し側でどのキーを使うか決める」だけで済む。

backlog [MON-001]、依存: FEAT-006（cases フェーズ）/ 既存 BYOK 実装。

---

### スコープ（IN / OUT）

**IN（本 PR-A で実装する）**:
- `profiles.credits` カラム追加（integer、デフォルト 3、非負制約。migration、冪等）
- `cases` に課金モードを記録するカラム追加（例 `uses_service_key boolean not null default false`。migration、冪等）
- クレジットを原子的に 1 減算する Postgres 関数 `consume_credit(uuid)`（SECURITY DEFINER、`UPDATE ... WHERE credits > 0 RETURNING`。同時実行で二重消費しない）
- 無料お試し 3 個の付与（`profiles.credits` のカラムデフォルトを 3 にすることで、既存の `handle_new_user` トリガの insert で自動付与される設計を基本とする。設計書で「デフォルト値による付与」か「トリガ明示付与」かを判断し根拠を書く）
- `POST /api/cases` のクレジット判定: BYOK 有無 → 消費要否を決め、不足時 402 ブロック、`cases.uses_service_key` をセット
- AI 実行時のキー解決の一元化: 「`cases.uses_service_key=true` なら `process.env.SERVICE_ANTHROPIC_API_KEY`、false なら原告の BYOK 復号キー」を返すヘルパー（例 `lib/case-ai-key.ts`）を作り、現在 `api_key_encrypted` を直接読んでいる全 AI ルートを張り替える
- クレジット残高の表示 UI（プロフィール `/profile` か `/me`、またはヘッダー。既存パターンに合わせて設計書で選択）
- ケース作成画面（`/case/new` 等）で、非 BYOK かつ残高 0 のとき作成を抑止し残高不足を伝える UI（購入リンクは PR-B のプレースホルダで可）
- `SERVICE_ANTHROPIC_API_KEY` を `.env.test.example` / 環境定義に追記（値は入れない。PR-A の E2E は `TEST_MODE=1` モックで実 AI を回避するため実キー不要）
- E2E spec（下記「テスト観点」）

**OUT（本 PR-A では実装しない・設計書に明記）**:
- Stripe 連携全般（Checkout / webhook / 購入 UI / 価格設定）→ **PR-B**
- サブスクリプション月額プラン（MON-001 のスコープ③、将来）
- クレジットの返金・有効期限・履歴台帳（消費ログテーブル）
- 管理者用のクレジット手動付与 UI（必要なら SQL 直叩きで足りる）
- 広告（MON-002）

---

### データモデル変更

新規 migration（例: `supabase/migrations/<timestamp>_mon001_credits.sql`）を**冪等**に作成する:

- `profiles.credits integer not null default 3` を `ADD COLUMN IF NOT EXISTS` で追加。非負制約（`check (credits >= 0)`）も付ける。既存行はデフォルト 3 でバックフィルされる（既存ユーザーへの一度きりの無料付与として許容する旨を設計書に明記）
- `cases.uses_service_key boolean not null default false` を `ADD COLUMN IF NOT EXISTS` で追加（このケースの AI 実行にサービスキーを使うか。作成時に確定）
- `consume_credit(p_user_id uuid) returns integer`（または boolean）を `CREATE OR REPLACE FUNCTION` で定義。`SECURITY DEFINER`、`search_path = ''`。`UPDATE public.profiles SET credits = credits - 1 WHERE id = p_user_id AND credits > 0 RETURNING credits` で、成功時は残高、残高 0 で減算不可なら NULL/負値等の「消費できなかった」シグナルを返す。`PUBLIC` からの EXECUTE は REVOKE し、`authenticated` には付与しない（**サーバ（admin / service role）からのみ呼ぶ**。クライアントから直接 RPC で叩けないようにする。FEAT-004 の `private.is_law_member` と同じ「public スキーマに置かない or REVOKE」方針を踏襲し、RPC 露出を避ける）
- RLS: `profiles` の既存ポリシーは「自分のみ参照/更新可」。`credits` 列もこれで読めるが、**クライアントが credits を直接 UPDATE して増やせない**ことが重要。現状 `profiles` の update ポリシーは `using (auth.uid() = id)` で自分の行を更新できてしまうため、クレジット増加の不正を防ぐ設計を検討し設計書に明記する（案: credits の変更はサーバ（admin）経由のみとし、必要なら列単位の防御や、消費は `consume_credit` 関数経由に限定する方針を記述）

**注意**: 既存テスト DB（`eckrccrfnblzdbflnssf`）は populated。ビルド/テスタ実行前にこの migration をテスト DB へ適用する必要がある（冪等なので再適用安全。リードが適用、または `run_migrations` が自動適用）。`supabase/schema.sql`（本番スナップショット = 冷凍庫）への反映方針も設計書に記載する（新カラム・関数は migration が真実。OPS-002 参照）。

---

### API 仕様（変更・追加）

すべて既存パターンに従う: `createSessionClient()` で認証確認 → 書き込みは `createAdminClient()` → パスパラメータは `isUuid()` 検証 → エラーは 400/401/402/403/404/500 体系。

1. **`POST /api/cases`（変更）** — ケース作成時のクレジット判定
   - 認証必須（現行どおり 401）。`topic` 検証は現行維持
   - 原告（= `user.id`）の `profiles.api_key_encrypted` を読む
     - **BYOK あり**: `uses_service_key=false` でケース作成。クレジット消費なし
     - **BYOK なし**: `consume_credit(user.id)` を admin 経由で呼ぶ
       - 消費成功 → `uses_service_key=true` でケース作成
       - 残高 0 で消費失敗 → **402** `{ error: "クレジットが不足しています。…" }` を返し、ケースは作成しない（INSERT しない）
   - 消費とケース INSERT の整合: 「消費したのにケース作成に失敗」を避ける順序を設計書で明記（推奨: 先に consume_credit、INSERT 失敗時は補償的に +1 戻すか、INSERT を先に試みるか。トレードオフを書く）
   - レスポンス: 現行どおり作成ケース。残高や課金モードを含めるかは設計書で判断

2. **クレジット残高の取得**: 専用 API を新設するか、既存の profile 読み取り（`/profile`・`/me`・`app/page.tsx` が既に `profiles` を select している）に `credits` を足すだけにするかを設計書で選ぶ。最小実装を優先

3. **AI 実行ルート（変更・キー解決の張り替え）**: 現在 `api_key_encrypted` を直接読んで `decryptApiKey` しているすべての箇所を、新ヘルパー経由に統一する。対象:
   - `app/api/cases/[id]/verdict/route.ts`
   - `app/api/cases/[id]/argument/route.ts`
   - `app/api/cases/[id]/route.ts`（opening）
   - `app/api/cases/[id]/end-proposal/route.ts`
   - `lib/case-closing.ts`（closing INSERT 経路）
   - `app/api/cases/[id]/defense/route.ts`（弁護人 AI・**リード補足1で追加**）
   - `app/api/cases/[id]/defense/draft/route.ts`（弁護人 AI ドラフト・**リード補足1で追加**）
   - **注**: defense 2 ルートも原告の `api_key_encrypted` を復号して弁護人 AI を呼ぶため、張り替え必須（漏らすとサービスキーケースで弁護人 AI が 400 に倒れる）。詳細は design.md「リード補足（2026-06-24 設計レビュー指摘）」参照
   - ヘルパー（例 `lib/case-ai-key.ts:resolveCaseAiKey(case, plaintiffProfile)`）が「`uses_service_key` なら `process.env.SERVICE_ANTHROPIC_API_KEY`、else 復号 BYOK キー」を返す。サービスキー未設定（env 欠落）時の挙動（500 + 明示エラー）も定義
   - **注意**: 非 BYOK = サービスキーになったことで、従来「`api_key_encrypted` が NULL なら 400/警告」だった分岐の意味が変わる。サービスキーケースでは BYOK が NULL でも正常に AI を実行する。各ルートのガードを新ヘルパーの結果ベースに正しく書き換えること

---

### コンポーネント設計（UI）

1. **クレジット残高表示**: 既存の `profiles` 読み取り箇所（`/profile`・`/me`・ヘッダーのいずれか）に「残りクレジット: N」を表示。配色・トーンは既存踏襲
2. **ケース作成画面のガード**: `/case/new`（または作成フォーム）で、非 BYOK かつ残高 0 のときに作成ボタンを抑止し「クレジットが不足しています（BYOK なら無料）」を伝える。購入リンクは PR-B のプレースホルダ（`#` または準備中表示）で可
3. BYOK ユーザーには「自分のキーを使うのでクレジット消費なし」が伝わると親切（任意、設計書で判断）

---

### セキュリティ設計

- **クレジット改ざん防止**: クライアントが `profiles.credits` を直接増やせないこと。consume は `consume_credit`（サーバのみ呼べる）経由、付与はサーバ（admin）/トリガのみ。`profiles` の self-update ポリシーで credits を上書きできてしまう穴を塞ぐ方針を設計書に明記
- **サービスキー秘匿**: `SERVICE_ANTHROPIC_API_KEY` はサーバ専用 env（`NEXT_PUBLIC_` を付けない）。クライアントに絶対渡さない。レスポンスにも含めない
- **消費の原子性**: 同時に複数ケースを作成しても二重消費・マイナス残高にならないこと（`WHERE credits > 0` + RETURNING で担保）
- 入力検証: 現行の `topic` 検証維持。パス UUID 検証維持
- 402 ブロック時にクレジットを誤って消費しないこと（消費に失敗したら作成もしない）

---

### テスト観点（テスタ向け）

E2E は既存 `tests/e2e/bug005-closing-trigger.spec.ts` の **admin client fast-path + 専用 ephemeral ユーザー**パターンを踏襲する。`TEST_MODE=1` で実 Anthropic を回避（`generateJudgeMessage` のモック分岐が既存）。テスト Supabase（`eckrccrfnblzdbflnssf`）対象。最低限:

- **BYOK ユーザー**: `api_key_encrypted` をセットしたユーザーがケース作成 → クレジット**消費されない**（前後で `credits` 不変）、`cases.uses_service_key=false`
- **非 BYOK ＆ 残高あり**: クレジット 3 のユーザーがケース作成 → `credits` が 2 に減る、`cases.uses_service_key=true`。AI 実行（TEST_MODE モック）が成功する
- **非 BYOK ＆ 残高 0**: `credits=0` のユーザーがケース作成 → **402**、ケースが作られない、残高 0 のまま
- **新規ユーザー無料付与**: 新規作成ユーザーの `credits` が **3**（カラムデフォルト / トリガ）
- **原子性**（可能なら）: 残高 1 のユーザーが連続/並行で 2 ケース作成しようとして、1 件だけ成功し残高が負にならない
- 既存の cases / bug005 等の AI 経路がリグレッションしないこと（BYOK 経路が従来どおり動く）
- 後始末: ephemeral ユーザー・ケースを admin で削除（case → user の順、FK 順守）。`e2e_user_a` を汚染しない
- 新規 spec ファイル（例 `tests/e2e/mon001-credits.spec.ts`）は untracked のままにせず commit に含める（[[feedback-commit-check]]）

---

### オーディに対する観点

- クレジット改ざん防止が実効的か（クライアントが credits を直接 UPDATE して増やせないか、`consume_credit` がクライアント RPC から叩けないか）
- サービスキーがクライアントに漏れていないか（`NEXT_PUBLIC_` 誤用なし、レスポンス非混入）
- 消費とケース作成の整合（402 時に消費しない、消費したら必ず作成 or 補償）
- 原子性（`WHERE credits > 0` + RETURNING、マイナス残高不可）
- AI ルートのキー解決張り替えで、BYOK 経路（従来）が壊れていないこと・サービスキー経路で BYOK NULL でも 400 に倒れないこと
- migration が冪等であること（`ADD COLUMN IF NOT EXISTS` / `CREATE OR REPLACE FUNCTION` / EXECUTE の REVOKE）
- **git status 最終確認**: 新規 spec / migration / handoff ログの取りこぼしがないこと（[[feedback-commit-check]]）

---

### 関連ファイル（想定）

- `supabase/migrations/<timestamp>_mon001_credits.sql`（新規）
- `lib/case-ai-key.ts`（新規・キー解決ヘルパー）
- `app/api/cases/route.ts`（変更・クレジット判定）
- `app/api/cases/[id]/verdict/route.ts` / `argument/route.ts` / `route.ts` / `end-proposal/route.ts`（変更・キー解決張り替え）
- `lib/case-closing.ts`（変更・キー解決張り替え）
- `lib/types.ts`（`Profile` に `credits`、`Case` に `uses_service_key` 追記）
- クレジット残高表示 UI（`app/profile/page.tsx` / `app/me/` / ヘッダーのいずれか）
- ケース作成ガード UI（`/case/new` 周辺）
- `.env.test.example`（`SERVICE_ANTHROPIC_API_KEY` 追記、値なし）
- `tests/e2e/mon001-credits.spec.ts`（新規）
- `docs/knowledge/design.md`（**末尾に MON-001 PR-A セクションを追記**）

---

### 既存資産の再利用指針（ビルド向け）

- API 認可: `createSessionClient()` / `createAdminClient()` の分離、`isUuid()` 検証（`lib/text-utils.ts`）
- 暗号: `lib/crypto.ts:decryptApiKey` を BYOK 復号にそのまま使用
- AI 呼び出し: `lib/judge.ts` / `lib/defense.ts` / `lib/claude.ts` は `apiKey` 引数を受け取る既存設計。差し替えは呼び出し側のキー解決のみ
- TEST_MODE モック: `generateJudgeMessage` の既存モック分岐を E2E で活用（実 AI・実課金を踏まない）
- SECURITY DEFINER + RPC 非露出: FEAT-004 の `private.is_law_member` 方針（`private` スキーマ or REVOKE EXECUTE）を `consume_credit` に踏襲
- 新規ユーザー付与: 既存 `handle_new_user` トリガ（`supabase/schema.sql:37`）。カラムデフォルトで足りるなら関数改変不要
