# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1（design.md 取り扱い）**: `docs/knowledge/design.md` は約 180KB の**永続累積資料**である。FEAT-003 等の既存設計を **絶対に削除・短縮・全面書き換えしないこと**。アーキは design.md を **必ず Read で全体を把握してから、末尾に新規セクション `## FEAT-004 法案 Hub（公開・インポート）` を追記**する。プロンプトの「# 詳細設計書」テンプレートは追記する**セクションの構造**であり、ファイル全体を置換する指示ではない。既存セクションは 1 行も消さない。
>
> **重要 2（フルパイプライン）**: 本タスクは新サブシステムの追加であり、アーキ → ビルド → テスタ → オーディの**フルパイプライン**で進める（リード先行実装ではない）。
>
> **重要 3（migration の冪等化）**: 新規 migration は OPS-002 の方針に従い冪等に書く（`ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS ... → CREATE POLICY`）。理由は `supabase/schema.sql`（本番スナップショット）と二重適用しても停止しないようにするため。

## 今回のタスク

法律（FEAT-003）に **公開 Hub とインポート機能**を追加する。

**バックログ ID**: FEAT-004
**ブランチ**: ビルドが `feature/<timestamp>` 形式で新規作成する（`scripts/agents.sh` のハードコード命名に従う）

---

### スコープ確定事項（2026-06-18 ダイチ確認）

3 つの方針はダイチが確定済み。設計・実装はこの前提で行う:

1. **公開モデル = `is_public` トグル**: `laws` に `is_public` (boolean) を 1 つ追加し、オーナーが ON/OFF で Hub 公開を切り替える最小モデル。`visibility` enum 等の拡張はしない。
2. **インポート = 純クローン**: 公開法案の `name` + `article` をコピーしてインポーターがオーナーの**新規法律**を作る。出自リンク（imported_from 等）は**持たない**。
3. **Hub の可視範囲 = 認証ユーザーのみ**: 既存 `laws` が `authenticated` 限定 GRANT なのと一貫させる。anon 公開はしない。`/laws/hub` は middleware の `/laws` プレフィックス保護に既に含まれる（middleware 変更不要、要確認）。

---

### 背景

FEAT-003 で「オーナー + 招待メンバーのみ閲覧可」の法律機能を実装済み。`laws` には公開フラグが無く、フレンド外のユーザーが他人の良い法律を再利用する手段がない。FEAT-004 は「オーナーが任意で法律を公開 → 他ユーザーが Hub で閲覧 → 自分の新規法律としてインポート」という流れを追加する。

backlog [FEAT-004]、依存: FEAT-003 / FEAT-002。

---

### スコープ（IN / OUT）

**IN（本タスクで実装する）**:
- `laws.is_public` カラム追加（migration、冪等）
- 公開法律を全認証ユーザーが SELECT できる RLS ポリシー追加
- 公開トグル API（オーナーのみ）
- 公開法律一覧 API（Hub 用、認証ユーザー、name 部分一致検索 + 件数上限）
- インポート API（公開法律を純クローンして新規法律を作成）
- Hub ページ（`/laws/hub`）: 公開法律の一覧・検索・条文プレビュー・インポートボタン
- `/laws/[id]` のオーナー向け公開トグル UI（現在の公開状態表示 + 切替）
- `/laws` または Hub への導線（ナビリンク）
- E2E spec（公開トグル → Hub 出現 → 別ユーザーがインポート → 新規法律所有 → 元法律不変、非公開は Hub 非出現、非公開化で Hub から消える）

**OUT（本タスクでは実装しない・スコープ外として設計書に明記）**:
- `visibility` enum 化 / 限定公開
- インポート出自リンク・元作者クレジット表示
- anon（未認証）への Hub 公開・SEO
- いいね / 人気度 / タグ / カテゴリ
- 公開法律へのコメント・モデレーション・通報
- 非メンバーによる公開法律の `/laws/[id]` 詳細ページ閲覧（Hub 内プレビューで完結させる）
- インポート時の重複検知（同じ法律を何度でもインポート可で良い）

---

### データモデル変更

新規 migration（例: `supabase/migrations/<timestamp>_feat004_laws_is_public.sql`）を**冪等**に作成する:

- `laws` に `is_public boolean not null default false` を `ADD COLUMN IF NOT EXISTS` で追加
- 公開法律閲覧用の RLS ポリシーを追加（既存 `laws_select_member_or_invitee` は**変更しない**。OR 評価される別ポリシーを足す）:
  - 例: `DROP POLICY IF EXISTS laws_select_public ON public.laws; CREATE POLICY laws_select_public ON public.laws FOR SELECT TO authenticated USING (is_public = true);`
  - 効果: メンバーでなくても `is_public=true` の法律は認証ユーザーが SELECT できる
- `law_members` / `law_invitations` 等の他テーブルは公開でも非メンバーに見せない（Hub では `laws` 本体だけ見せ、メンバー情報・提案・投票は出さない）

**注意**: 既存テスト DB は populated なので、ビルド/テスタ実行前にこの migration をテスト DB へ適用する必要がある（冪等なので再適用安全。リードが適用する）。`supabase/schema.sql` への反映方針も設計書に記載する（schema.sql は本番スナップショット = 冷凍庫。新カラムは migration が真実。OPS-002 参照）。

---

### API 仕様（追加）

すべて既存パターンに従う: `createSessionClient()` で認証確認 → 書き込みは `createAdminClient()` → パスパラメータは `isUuid()` で検証 → エラーは 400/401/403/404/409/500 体系。

1. **`PATCH /api/laws/[id]/visibility`**（公開トグル、オーナーのみ）
   - body: `{ is_public: boolean }`
   - 認可: `laws.owner_id === user.id`。違反は 403
   - `laws.is_public` を更新。`updated_at` は触らない（公開状態変更は条文改定ではないため。設計書で根拠を明記）
   - レスポンス: 更新後の `{ id, is_public }`

2. **`GET /api/laws/public`**（Hub 一覧、認証ユーザー）
   - クエリ: `?q=<name 部分一致>`（任意、trim + 長さ上限）
   - `is_public = true` の法律を新しい順に返す。MVP の件数上限は 50（設計書で根拠明記）
   - 各要素: `{ id, name, article, owner_display_name, created_at }`。**`owner_id` は返さない**（display_name のみ）。owner の display_name 取得方法（join/別クエリ）と admin 利用範囲を設計書で明示
   - 認可: 認証必須。RLS（`laws_select_public`）と整合

3. **`POST /api/laws/[id]/import`**（純クローン）
   - パス `[id]` = インポート元の公開法律
   - 前提: インポート元が `is_public = true`（でなければ 403/404）。認証必須
   - 動作: 新規 `laws` を作成（`name` はインポート元と同一、`article` コピー、`owner_id` = インポーター、`is_public = false`）+ `law_members` にインポーターを追加。FEAT-003 の法律作成 POST と同じ初期化（オーナー = メンバー）を踏襲
   - レスポンス: `{ id }`（新規法律の ID）。UI はこれで `/laws/[id]` に遷移
   - 既存の `name` / `article` の文字数制約（name 100 / article 2000）を流用

---

### コンポーネント設計（UI）

1. **`/laws/hub`（Server Component）+ Client 子**:
   - 公開法律のデータ取得（Server で直接 supabase か API 経由かは設計書で選択。FEAT-003 の `/laws` ページが Server で直接 supabase を読むパターンに合わせる）
   - 一覧表示: 各公開法律の `name` / オーナー表示名 / `article`（プレビュー、長文は省略 or 折りたたみ）/ インポートボタン
   - 検索ボックス（name 部分一致、Client 側 or クエリ）
   - インポートボタン → `POST /api/laws/[id]/import` → 成功で `/laws/<newid>` へ遷移
   - 配色・トーンは既存 laws UI を踏襲

2. **公開トグル UI（`/laws/[id]` のオーナー分岐）**:
   - 現在の公開状態を表示し、ON/OFF 切替（`PATCH /api/laws/[id]/visibility`）
   - オーナーのみ表示。非オーナーには出さない
   - 既存 `MemberList` / `ProposalPanel` と同居する詳細画面に自然に収まる配置

3. **導線**: `/laws` 一覧ページ（または共通ヘッダ）から `/laws/hub` へのリンク

---

### セキュリティ設計

- 公開トグルはオーナーのみ（`owner_id` 照合）。インポートは元法律が `is_public=true` の場合のみ
- Hub 一覧・インポートは認証必須。anon には開放しない
- 公開法律でも**メンバー情報・提案・投票は非メンバーに見せない**（`laws` 本体のみ公開）
- `owner_display_name` 以外のオーナー個人情報（`owner_id`、メール等）を API レスポンスに含めない
- `article` はテキストとして描画（既存 `ArticleSection` パターン）。HTML 注入を許さない
- 入力検証: `is_public` は boolean、`q` は文字列 trim + 長さ上限、パス UUID 検証
- レートリミット: 法律作成・インポートは書き込みなので既存の ratelimit 方針があれば踏襲（設計書で確認）

---

### テスト観点（テスタ向け）

E2E は既存 `tests/e2e/laws.spec.ts` の admin client fast-path・複数ユーザーコンテキストパターンを踏襲する。`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。最低限:

- **公開トグル**: オーナー A が法律を公開 → `laws.is_public=true` を確認 → 別ユーザー B の Hub 一覧に出現
- **インポート**: B が Hub から A の公開法律をインポート → B 所有の新規法律が作られ `name`/`article` が一致、`owner_id`=B、`is_public=false`。**元法律（A 所有）は不変**（行数・所有者変わらず）
- **非公開は非出現**: 非公開法律は B の Hub 一覧に出ない
- **非公開化**: A が公開を OFF → Hub 一覧から消える
- **認可**: 非オーナーが visibility PATCH → 403。非公開法律を import → 403/404
- 既存 laws spec（CRITICAL-L01〜L04）+ CRITICAL M01〜M04 がリグレッションしないこと
- 新規 spec ファイル（例 `tests/e2e/feat004-laws-hub.spec.ts`）は untracked のままにせず commit に含める（[[feedback-commit-check]]）

---

### オーディに対する観点

- RLS: `laws_select_public` 追加で「非メンバーが非公開法律を読めない」境界が壊れていないこと（公開のみ開放）
- 認可: visibility はオーナーのみ、import は公開法律のみ、を API 層で確実に検証していること
- 情報漏洩: Hub API が `owner_id` 等の個人情報を返していないこと、メンバー/提案/投票を非メンバーに出していないこと
- インポートが純クローンであり元法律を変更しないこと（オーナー・行が不変）
- migration が冪等であること（`ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS`）
- **git status 最終確認**: 新規 spec / migration / handoff ログの取りこぼしがないこと（[[feedback-commit-check]]）

---

### 関連ファイル（想定）

- `supabase/migrations/<timestamp>_feat004_laws_is_public.sql`（新規）
- `app/api/laws/[id]/visibility/route.ts`（新規）
- `app/api/laws/public/route.ts`（新規）
- `app/api/laws/[id]/import/route.ts`（新規）
- `app/laws/hub/page.tsx` + `_components/`（新規）
- `app/laws/[id]/` の公開トグル UI（既存に追記）
- `tests/e2e/feat004-laws-hub.spec.ts`（新規）
- `docs/knowledge/design.md`（**末尾に FEAT-004 セクションを追記**）

---

### 既存資産の再利用指針（ビルド向け）

- API 認可: `createSessionClient()` / `createAdminClient()` の分離、`isUuid()` 検証（`lib/text-utils.ts`）
- フレンド連携は本タスクでは不要（Hub は全認証ユーザー対象）
- UI: 既存 `app/laws/` のコンポーネント・配色トーンを踏襲。`ArticleSection` の条文描画パターンを再利用
- 法律作成の初期化（オーナー = メンバー登録）は FEAT-003 の `POST /api/laws` 実装を参照してインポートでも踏襲
- middleware は `/laws` プレフィックスで既に保護済み（`/laws/hub` も対象）。要確認、変更不要なら設計書にその旨記載
