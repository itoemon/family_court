# アーキ → ビルド 引き継ぎメモ（FEAT-004 法案 Hub）

このメモは `docs/knowledge/design.md` 末尾の `## FEAT-004 法案 Hub（公開・インポート）` セクションと併読すること。
矛盾があれば `task.md` → `design.md` → 本メモの順で優先する。

ブランチはビルドが `feature/<timestamp>` 形式で新規作成する（`scripts/agents.sh` のハードコード命名に従う）。本タスクはアーキ → ビルド → テスタ → オーディの**フルパイプライン**（リード先行実装ではない）。

---

## このタスクの一行サマリ

`laws` に `is_public` を 1 列足し、「公開法律を全認証ユーザーが SELECT できる RLS ポリシー」を OR で追加するだけで Hub の土台ができる。あとは (1) 公開トグル API、(2) Hub 一覧 API、(3) 純クローン import API、(4) Hub ページ + トグル UI を既存 `laws` パターンに乗せて作る。**新しく広げる可視範囲は `laws.name` / `laws.article` だけ**。メンバー・招待・提案・投票は 1 ビットも公開しない。

---

## 設計上の主要判断と理由

### 1. 既存ポリシーを書き換えず、PERMISSIVE ポリシーを「OR で足す」

- **判断**: `laws_select_member_or_invitee`（MEDIUM-001 / PR #26）は一切触らない。新規 `laws_select_public ... USING (is_public = true)` を**追加**する。
- **理由**: PostgreSQL は同一テーブル・同一コマンドの複数 PERMISSIVE ポリシーを OR 評価する。既存ポリシー（メンバー等に許可）と新ポリシー（公開に許可）が OR されるので、「メンバーは非公開法律も見える」かつ「全員が公開法律を見える」が両立する。既存を書き換えないため、メンバー閲覧 UX のリグレッションが構造的に起きない。
- **重要**: 新ポリシーは必ず `TO authenticated` を付ける。`anon` には評価させない（確定方針 3・FEAT-002 LOW-001 の最小権限教訓）。`GRANT` は変更しない。

### 2. `is_public` 既定は `false`（明示的オプトイン）

- **判断**: `ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false`。
- **理由**: 既存の全法律はマイグレーション後も非公開のまま。公開は必ずオーナーの明示操作（visibility トグル）でのみ起こる。「気づいたら公開されていた」事故を防ぐ。

### 3. visibility 変更で `updated_at` を触らない

- **判断**: `PATCH /api/laws/[id]/visibility` は `is_public` だけ UPDATE し、`updated_at` は据え置く。
- **理由**: FEAT-003 で `updated_at` は「条文改定が合意成立した時刻」の意味論で使っている（改定合意時に `now()`）。公開状態は条文改定ではない。`updated_at` を動かすと「最終改定日時」の意味が壊れ、一覧の並びや表示に意図しない影響が出る。

### 4. Hub の `owner_display_name` だけ admin で引く

- **判断**: `laws`（`is_public=true`）の SELECT は `createSessionClient()`（新 RLS で二層防御）。オーナーの `profiles.display_name` のみ `createAdminClient()` でバッチ取得（`.in("id", ownerIds)` 1 クエリ）。`owner_id` は応答整形時に捨てる。
- **理由**: オーナーは他人であり、`profiles` の他人行 SELECT 権限は本人行のみに絞られている（MEDIUM-001 でも `profiles` 他者列の開放は意図的にスコープ外）。display_name だけ admin で narrow に引くのは FEAT-003 `GET /api/laws` がオーナー名を解決していたのと同一パターン。`api_key_encrypted` 等の機微列は SELECT しないこと。

### 5. インポートは純クローン（`name` + `article` のみ）

- **判断**: import は新規 `laws` を作り、`name` 同一・`article` コピー・`owner_id`=インポーター・`is_public=false` で INSERT、続けて `law_members` に本人を INSERT（FEAT-003 の「作成者=オーナー兼メンバー」初期化と同手順）。
- **理由**: 確定方針 2。元法律のメンバー/招待/提案/投票はコピーせず、出自リンク（`imported_from` 等）も持たない。元法律と新法律の間にデータ参照関係を作らない。
- **重要**: import 経路はインポート元 `laws` 行を `is_public` 読み取りにしか使わない。**元法律を UPDATE/DELETE しないこと**（所有者・条文・行数が不変であることをテスタが検証する）。

### 6. Hub の検索は `GET /api/laws/public` をクライアントから叩く（推奨 (B)）

- **判断**: Hub ページの初期表示は Server Component が `searchParams.q` で SSR（`fetchPublicLaws` 直接呼び出し）。以降の絞り込みは `HubSearch`（Client）が debounce して `GET /api/laws/public?q=...` を fetch し結果を差し替える。
- **理由**: task.md は `GET /api/laws/public` を IN スコープに明示。(B) を採るとこのエンドポイントが検索体験で実際に使われ、初期 SSR と live 検索が両立する。初期表示と検索結果は同じ `PublicLawCard` を共有して二重実装を避ける。
- **代替 (A)**: URL クエリ更新で Server 再レンダリングする案。実装は容易だが (A) でも `GET /api/laws/public` は IN スコープなので実装は必須。どちらでも task.md 要件は満たす（design.md「注意事項」参照）。

### 7. 取得ロジックは `lib/laws-public.ts` に 1 本化

- **判断**: Hub ページと `GET /api/laws/public` が共有する `fetchPublicLaws({ sessionClient, adminClient, q })` を新設ファイルに切り出す。
- **理由**: 同じ取得・整形（`owner_id` 除去・display_name 解決・件数上限）を 2 箇所に書くと、片方だけ直して漏洩境界がずれる。`lib/case-closing.ts` / `lib/text-utils.ts` 等、ロジックを lib に切り出す既存慣習に整合。

### 8. 公開法律の `/laws/[id]` 詳細は非メンバーに開放しない（リグレッション・ガード）

- **判断**: `laws_select_public` 追加後、非メンバーでも `laws` 行自体は SELECT 可能になる。だが `/laws/[id]/page.tsx` のメンバーシップ・ゲート（非メンバー・非 pending invitee を redirect）は**緩めない**。
- **理由**: task.md OUT スコープ「非メンバーによる公開法律の詳細ページ閲覧」。非メンバーの公開法律閲覧は Hub 内プレビューで完結させる。これはテストではなく実装制約として厳守する。

---

## 実装の順序（推奨）

1. **migration 新設**: `supabase/migrations/<timestamp>_feat004_laws_is_public.sql` を冪等に作成（`BEGIN`/`COMMIT`、`ADD COLUMN IF NOT EXISTS`、`DROP POLICY IF EXISTS laws_select_public` → `CREATE POLICY ... TO authenticated USING (is_public = true)`、部分インデックス `idx_laws_public_created` を `CREATE INDEX IF NOT EXISTS`）。design.md のコードブロックをそのまま使ってよい。
2. **型定義**: `lib/types.ts` の `Law` に `is_public: boolean` を追加。`PublicLawListItem`（`owner_id` を持たない）を新設。
3. **共有ヘルパー**: `lib/laws-public.ts` に `fetchPublicLaws` を実装（session で `laws` 読み + admin で display_name バッチ + `owner_id` 除去 + `q` の ilike/エスケープ + `limit(50)` + `order created_at desc`）。
4. **API 3 本**:
   - `app/api/laws/[id]/visibility/route.ts`（PATCH）
   - `app/api/laws/public/route.ts`（GET、`fetchPublicLaws` を呼ぶ）
   - `app/api/laws/[id]/import/route.ts`（POST）
   - いずれも先頭で `auth.getUser()` 401 → `isUuid(id)` 400 →（visibility は body 型検証）→ admin 読み取りで認可判定 → admin 書き込み、の順。
5. **Hub ページ**: `app/laws/hub/page.tsx` + `_components/`（`PublicLawCard` / `HubSearch` / `ImportButton`）。
6. **公開トグル UI**: `app/laws/[id]/_components/VisibilityToggle.tsx` を新設し、`/laws/[id]/page.tsx` のオーナー分岐でのみレンダリング。
7. **導線**: `app/laws/page.tsx` に `/laws/hub` へのリンクを 1 つ追加（推奨 (A)。ヘッダは触らない）。
8. **テスト DB へ migration 適用はリードが実施**（task.md 記載・冪等なので再適用安全）。ローカル動作確認後、テスタへ引き継ぐ。

---

## ビルドが着手前に grep / 確認すること

本設計は許可ディレクトリ（docs のみ）から書いており、`app/` `lib/` `supabase/` の実コードは読んでいない。以下はビルドが実コードで確認・整合させること。

- **FEAT-003 `POST /api/laws` の初期化手順**: import の `laws` + `law_members` 2 INSERT は、これと**同一手順**を再現する（エラーハンドリング・順序を含む）。本タスクで新たにトランザクション/RPC を導入しない。`law_members` INSERT 失敗時の挙動も FEAT-003 に揃える。
- **middleware の `/laws` 保護がプレフィックスマッチか**: FEAT-005 で `PROTECTED_PATH_PREFIXES` にプレフィックスマッチで `/laws` がある想定。`/laws/hub` が確かに保護対象に入ることを確認。完全一致判定だった場合のみ報告（その場合は別途対応が必要）。middleware は原則変更不要。
- **`POST /api/laws` にレートリミットが無いこと**: 無ければ import でも踏襲（設けない）。もし FEAT-003 法律作成にレートリミットがあれば import にも同様に付け、本メモの判断を上書きして報告。
- **Route Handler の `params` シグネチャ**: 本バージョンの Next.js（16.2.6）では `params` が `Promise` の可能性。`AGENTS.md` 方針に従い `node_modules/next/dist/docs/` で実シグネチャを確認し、`await params` 後にガードを置く。
- **`profiles.display_name` の列名・`createAdminClient()` の import 経路**: FEAT-003 `GET /api/laws` のオーナー名解決箇所を参照して合わせる。
- **`isUuid` の import 元**: `@/lib/text-utils`（PR #27）。
- **エラーレスポンスの形・文言**: 同種既存ルート（`app/api/laws/**`）の 400/401/403/404 と同形・同トーンに揃える。不正な ID 値をレスポンス/ログにエコーしない。
- **配色**: 既存 `app/laws/` のトーン（stone ベース、プライマリ `brand-700/800`、エラーは `rose-*`、`brand-500` 不使用）。

---

## テスタ向けの申し送り（design.md「テスト観点」と併読）

- 既存 `tests/e2e/laws.spec.ts` の admin client fast-path・複数ユーザーコンテキストパターンを踏襲。`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作。
- 新規 spec（例 `tests/e2e/feat004-laws-hub.spec.ts`）は **untracked のままにせず commit に含める**（コミット忘れ 2 回連続の教訓 `feedback_commit_check.md` / PR #46）。
- 最低限のシナリオ:
  - 公開トグル: A が公開 → `laws.is_public=true` 確認 → B の Hub 一覧に出現。
  - インポート: B が A の公開法律を import → B 所有の新規法律が作られ `name`/`article` 一致・`owner_id=B`・`is_public=false`、**元法律（A 所有）は不変**（行数・所有者変わらず）。
  - 非公開は非出現 / 非公開化で Hub から消える。
  - 認可: 非オーナーの visibility PATCH → 403、非公開法律の import → 403/404。
  - 既存 laws spec（CRITICAL-L01〜L04）+ CRITICAL M01〜M04 がリグレッションしないこと。

---

## オーディ向けの観点（task.md「オーディに対する観点」と併読）

- 非メンバーが**非公開**法律を読めないこと（`laws_select_public` は `is_public=true` のみ開放、OR の片側）。
- visibility はオーナーのみ、import は公開法律のみを **API 層で確実に検証**していること。
- Hub API が `owner_id` 等の個人情報を返していないこと、メンバー/招待/提案/投票を非メンバーに出していないこと。
- import が純クローンで元法律を変更しないこと（オーナー・行が不変）。
- migration が冪等（`ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS`）であること。
- 公開法律の `/laws/[id]` 詳細が非メンバーに開放されていないこと（メンバーシップ・ゲートが緩んでいないこと）。
- **git status 最終確認**: 新規 spec / migration / handoff ログの取りこぼしがないこと（`feedback_commit_check.md`）。

---

## 未解決事項（ビルドへ丸投げせず、明示的に残す論点）

1. **検索方式 (A)/(B) の最終選択**: design.md は (B)（client debounce fetch + SSR 初期表示）を推奨。実装容易性で (A)（URL クエリ更新 + Server 再レンダリング）に倒しても可。いずれにせよ `GET /api/laws/public` は実装必須。選択結果を eng→aud handoff に記録すること。
2. **条文プレビューの省略量**: `article` プレビューの文字数（先頭 100〜200 + `…`、または CSS `line-clamp`）は既存トーンに合わせて実装段階で確定。プレーンテキスト描画は必須。
3. **`owner_display_name` 欠落時のフォールバック文言**: 空文字 / 「（名前未設定）」のどちらにするかは既存（`MeHeader` 等）のフォールバックに揃える。
4. **件数上限到達の UI 表現**: 50 件上限到達時の注記有無は実装判断（最小実装では省略可）。
5. **`law_members` INSERT 失敗時の孤児 `laws` 行**: FEAT-003 `POST /api/laws` と同一挙動に従う。FEAT-003 の手順をビルドが確認し、もし整合性上の問題が見つかれば backlog に派生タスクとして記録（本タスクのスコープでは新規整合性機構を導入しない）。
