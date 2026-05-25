# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: F-1 HMAC ゲストトークンを nonce ベースに刷新（MEDIUM 1件）
**日時**: 2026-05-25

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `supabase/migrations/20260525000003_add_guest_tokens.sql` | 新設 | guest_tokens テーブルの DDL |
| `lib/guest-token.ts` | 変更 | 同期→非同期、nonce ベースの generateGuestToken / verifyGuestToken に刷新 |
| `app/api/cases/[id]/route.ts` | 変更 | GET・PATCH の verifyGuestToken / generateGuestToken を await に変更 |
| `app/api/cases/[id]/argument/route.ts` | 変更 | verifyGuestToken を await に変更 |
| `app/api/cases/[id]/defense/route.ts` | 変更 | verifyGuestToken を await に変更 |
| `app/api/cases/[id]/defense/draft/route.ts` | 変更 | verifyGuestToken を await に変更（設計書に記載なかったが型エラー解消のため修正） |

---

## 実装上の判断・変更点

### `app/api/cases/[id]/defense/draft/route.ts` — 設計書未記載だが修正

task.md・設計書・handoff の「影響ファイル」に `draft/route.ts` の記載がなかったが、`verifyGuestToken` を `await` しない場合 `Promise<boolean>` がそのまま評価され常に truthy になる（`tsc --noEmit` でエラー検出）。設計書の意図に従い `await` を追加した。オーディは意図との整合性を確認すること。

### `expires_at` の計算をアプリ側で行った件

設計書は「DB 側の `DEFAULT now() + INTERVAL '7 days'` を使う」と記載しているが、arch-to-eng.md で「Supabase JS Client では INSERT 時に SQL 式を直接渡せないため、アプリ側で ISO 文字列として計算する」と説明があり、その方針に従った。`new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString()` をアプリ側で生成して INSERT する。マイグレーション SQL に `DEFAULT` 句は設けていない（値を必ず明示することで整合性を保つ）。

### `join/route.ts` が存在しない件

task.md に `app/api/cases/[id]/join/route.ts` が影響ファイルとして記載されているが、当該ファイルは存在しない。ゲスト参加のトークン発行ロジックは `app/api/cases/[id]/route.ts` の PATCH ハンドラ内に統合されているため、そちらで対応した。

---

## オーディへの注意点

### 重点確認ポイント

1. **マイグレーション適用確認**
   - `supabase db push` または `supabase migration apply` で `guest_tokens` テーブルが作成されること。
   - RLS が有効で、anon・authenticated ロールから直接 SELECT できないこと（ポリシーなし = Service Role のみ通過）。

2. **トークン発行フロー**
   - ゲストとして参加すると `guest_tokens` テーブルにレコードが INSERT されること。
   - Cookie に nonce のみが格納され、`token_hash` はテーブルにのみ保存されること（Cookie 値と `token_hash` が異なることを確認）。

3. **トークン検証フロー**
   - 同じゲストが次のターンで発言・閲覧できること（`verifyGuestToken` が `true` を返す）。
   - `expires_at` を過去日時に書き換えたレコードで `verifyGuestToken` が `false` を返すこと。
   - `revoked_at` に値を入れたレコードで `verifyGuestToken` が `false` を返すこと。

4. **既存セッションへの影響**
   - マイグレーション適用後、旧方式（決定論的 HMAC）の Cookie を持つゲストは全員ログアウト状態になる（DB にレコードが存在しないため）。本番適用はトラフィックが少ない時間帯に推奨。

5. **`draft/route.ts` の await 追加**
   - `defense/draft` エンドポイントでゲストトークン検証が正しく機能すること（`await` 追加後に false 判定が正常に動くこと）。

6. **`tsc --noEmit` がエラーなしで通ること**（実装時確認済み）

### セキュリティ観点

- Cookie には nonce の平文のみ（64 桁 hex）が格納される。`token_hash` は DB にのみ存在し、Cookie からの偽造・延命が不可能になっていること。
- `verifyGuestToken` は `token_hash`・`case_id`・`expires_at`・`revoked_at` の 4 条件 AND で検証している。いずれか不一致で `false`（fail-closed）。

---

## 未実装・スコープ外

| 項目 | 理由 |
|---|---|
| ゲストトークンの手動取り消し UI | task.md にスコープ外と明記 |
| トークン一覧管理画面 | task.md にスコープ外と明記 |
| 期限切れレコードの定期クリーンアップ | スコープ外。`guest_tokens` は蓄積し続ける。Supabase pg_cron 等で別途対応が必要 |
| 他のトークン種別への応用 | スコープ外 |
