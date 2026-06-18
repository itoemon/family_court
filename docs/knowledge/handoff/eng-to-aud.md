# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-004 — 法案 Hub（公開・インポート機能）
**日時**: 2026-06-18
**ブランチ**: feature/20260618-181925

由来: backlog [FEAT-004]。`docs/knowledge/design.md` 末尾 `## FEAT-004 法案 Hub（公開・インポート）` および `docs/knowledge/handoff/arch-to-eng.md` を参照。

---

## 変更・新規ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260618181925_feat004_laws_is_public.sql` | 新規 | `laws.is_public` 追加 + `laws_select_public` ポリシー + 部分インデックス（冪等） |
| `lib/types.ts` | 変更 | `Law` に `is_public` 追加、`PublicLawListItem` 新設（`owner_id` を持たない） |
| `lib/laws-public.ts` | 新規 | `fetchPublicLaws` / `normalizeQuery` / `PUBLIC_LAWS_LIMIT` の共有ロジック |
| `app/api/laws/[id]/visibility/route.ts` | 新規 | PATCH 公開トグル（オーナーのみ） |
| `app/api/laws/public/route.ts` | 新規 | GET Hub 一覧（認証ユーザー） |
| `app/api/laws/[id]/import/route.ts` | 新規 | POST 純クローン import |
| `app/laws/hub/page.tsx` + `_components/{HubSearch,PublicLawCard,ImportButton}.tsx` | 新規 | Hub ページ |
| `app/laws/[id]/_components/VisibilityToggle.tsx` | 新規 | オーナー向け公開トグル UI |
| `app/laws/[id]/page.tsx` | 変更 | `is_public` を SELECT に追加、オーナー分岐に `VisibilityToggle` を配置 |
| `app/laws/page.tsx` | 変更 | `/laws/hub` への導線リンク追加 |
| `tests/e2e/feat004-laws-hub.spec.ts` | 新規 | E2E（公開→Hub出現→import→元法律不変、非公開非出現、認可境界） |

---

## 設計書からの逸脱・実装上の判断

1. **検索方式は設計推奨の (B) を採用**（注意事項①の確定）。Hub 初期表示は Server Component が `searchParams.q` で SSR し、以降の絞り込みは `HubSearch`（Client）が 300ms debounce で `GET /api/laws/public?q=...` を fetch して結果を差し替える。初期表示と検索結果は同じ `PublicLawCard` を共有。`res.ok` を検査し失敗時はリストを壊さずエラー表示（LOW-002 踏襲、エラー色 `rose-*`）。

2. **配色: 新規プライマリ操作（import / 公開トグル ON）に `brand-700/800` を採用**。design.md「配色トーン（stone ベース、`brand-700/800` をプライマリに）」に従った。ただし既存 `app/laws/page.tsx` の「法律を作る」ボタンは `stone-800` を使っており、新規 import/公開ボタンと色が異なる点に留意（既存ボタンは変更していない）。`brand-500` は不使用、エラーは `rose-*`。

3. **条文プレビューは CSS `line-clamp-4`**（注意事項②の確定）。`whitespace-pre-wrap` でプレーンテキスト描画、`dangerouslySetInnerHTML` 不使用。HTML/スクリプト注入なし。

4. **`owner_display_name` 欠落時のフォールバックは「（名前未設定）」**（注意事項③の確定）。`lib/laws-public.ts` で解決。

5. **件数上限到達 UI**: ヘッダに「（新着 50 件）」と常時注記。明示的な「50件で打ち切り」警告は最小実装として省略（注意事項⑤、省略可の確定）。

6. **`q` 正規化**: `trim` → 100 文字に切り詰め → LIKE 特殊文字（`\` `%` `_`）をエスケープ（`\` を先に処理）。`ilike("name", "%"+escaped+"%")` で部分一致。ワイルドカード注入・全件マッチを防止。

---

## 着手前確認の結果（arch-to-eng「grep / 確認すること」への回答）

- **middleware の `/laws` 保護**: `middleware.ts:32` の `PROTECTED_PATH_PREFIXES` に `/laws` があり、`pathname === p || pathname.startsWith(p + "/")` の**プレフィックスマッチ**。`/laws/hub` は保護対象に入る。**middleware 変更不要**（確認のみ）。
- **`POST /api/laws` の初期化手順**: `laws` INSERT（`.select("id").single()`）→ `law_members` INSERT の 2 文。import でも**同一手順**を再現（トランザクション/RPC は新規導入せず）。`law_members` INSERT 失敗時は 500 を返す（FEAT-003 と同じ。孤児 `laws` 行の可能性も FEAT-003 と同一挙動。新規整合性機構は導入しない）。
- **レートリミット**: `POST /api/laws` にレートリミット呼び出しは無い。import でも踏襲して**設けない**。
- **Route Handler `params`**: 本バージョン（Next 16.2.6）では `params: Promise<{ id: string }>`。既存ルートに合わせ `await params` 後に `isUuid()` ガード。`searchParams` も `Promise`（Hub ページで `await`）。`npm run build` で型生成・検証が通ることを確認済み。
- **`isUuid` import**: `@/lib/text-utils`。**`profiles.display_name`** 解決は `createAdminClient()` で `.in("id", ownerIds)`（FEAT-003 `GET /api/laws` と同パターン）。機微列（`api_key_encrypted` 等）は SELECT しない。

---

## テスタへの注意点

- **migration の適用が前提**: テスト DB（`eckrccrfnblzdbflnssf`）へ `20260618181925_feat004_laws_is_public.sql` を適用しないと `is_public` 列・`laws_select_public` ポリシーが無く、Hub・公開トグルが動かない。**適用はリードが実施**（task.md / 冪等なので再適用安全）。
- **新規 spec**: `tests/e2e/feat004-laws-hub.spec.ts`。`E2E_TEST_EMAIL_A/B` + `PASSWORD_A/B` + `NEXT_PUBLIC_SUPABASE_URL` + `SUPABASE_SECRET_KEY` を要求（未設定時は `test.skip`）。DB 直接検証は `@supabase/supabase-js` の admin client（既存 `bug005-closing-trigger.spec.ts` 同パターン）。
- 認可テスト（403）は `page.request.patch/post` で認証 cookie 付きの直接 API 呼び出しを使用。
- UI セレクタ依存箇所: 公開トグルボタン文言「Hub に公開する」「非公開にする」、バッジ「公開中」「非公開」、import ボタン「インポート」、検索 placeholder「法律名で検索」。
- 既存 `tests/e2e/laws.spec.ts`（CRITICAL-L01〜L04）+ CRITICAL（M01〜M04）のリグレッションが無いこと（`laws_select_member_or_invitee` は未変更、新ポリシーは OR で追加のみ）。

---

## オーディへの注意点（観点への対応状況）

- **RLS 境界**: `laws_select_public` は `is_public = true` のみ・`TO authenticated` 限定で OR 追加。既存 `laws_select_member_or_invitee` は未変更。`law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` の SELECT ポリシーも未変更（メンバーのみ）。→ 非メンバーは非公開法律を読めず、公開法律でもメンバー/招待/提案/投票は観測不能。
- **認可（API 層）**: visibility はオーナー照合（`owner_id !== user.id` → 403）、import は元法律 `is_public !== true` → 403 / 行なし → 404。いずれも `createAdminClient()` で読み取り判定後に書き込み。
- **情報漏洩**: Hub API レスポンスは `PublicLawListItem`（`owner_id` 無し）。`fetchPublicLaws` が `owner_id` を整形時に破棄、`owner_display_name` のみ返す。
- **純クローン / 元法律不変**: import は元 `laws` 行を `is_public` 読み取りにしか使わず UPDATE/DELETE しない。`name`+`article` のみ複製、出自リンク無し、`is_public=false` で INSERT。E2E `FEAT-004-E01` が元法律不変（`toEqual`）を検証。
- **migration 冪等性**: `ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS → CREATE` / `CREATE INDEX IF NOT EXISTS`、`BEGIN`/`COMMIT`。`schema.sql` は未編集（OPS-002 冷凍庫）。
- **詳細ページ・ガード未緩和**: `/laws/[id]/page.tsx` の非メンバー redirect は変更していない（`VisibilityToggle` はオーナー分岐内にのみ追加）。公開法律でも非メンバーは詳細ページに入れず、Hub プレビューで完結。

---

## 未実装・スコープ外（task.md / design.md「スコープ外」に準拠）

- `visibility` enum 化・限定公開、import 出自リンク・元作者クレジット、`anon` 公開・SEO・OGP、いいね/タグ/カテゴリ、コメント/モデレーション、非メンバーの詳細ページ閲覧、Hub ページネーション（50 件固定）、書き込み系レートリミット。
- `applied.txt` は未更新（本 migration はまだテスト DB へ適用されていない＝リードが適用する。適用済み一覧の真実を保つため意図的に触れていない）。
