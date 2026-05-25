# バックログ

オーディが監査で検出した未修正の指摘を蓄積するファイルです。
リードがセッション開始時・PR マージ後にダイチへ内容を共有します。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映してください。

---

## 未対応

### LOW

#### [LOW-001] `createSessionClient()` が try-catch 外（`defense/draft/route.ts:26`） (由来: audit_20260525_185446.md)

- **内容**: 26 行目の `createSessionClient()` が try-catch で保護されていない。他の全 Route は try-catch 内で呼んでいるため挙動が一貫しない。例外時に Next.js デフォルトエラーハンドラが動作し、開発環境でスタックトレースが露出しうる。
- **修正案**: 既存 Route のパターンに倣い、26–27 行目を try-catch で包む。

#### [LOW-002] `guest_tokens.token_hash` に UNIQUE 制約なし（`supabase/migrations/20260525000003_add_guest_tokens.sql`） (由来: audit_20260525_185446.md)

- **内容**: HMAC-SHA256 の衝突確率は実用上ゼロだが、アプリバグで同一ハッシュが複数 INSERT された際に DB レベルで検知できない。
- **修正案**: `CREATE UNIQUE INDEX ON guest_tokens(token_hash);` をマイグレーションに追加する。

---

## 対応済み

| PR | 内容 |
|----|------|
| PR #16 (F-1) | HMAC ゲストトークンを nonce ベースに刷新（guest_tokens テーブル追加） |
| PR #15 (E-1) | `defense.ts` generateDraft の defenseHistory に truncate 適用 |
| PR #15 (E-2) | `route.ts` PATCH 非 asGuest パスを try-catch で保護 |
| PR #15 (E-3) | `layout.tsx` `<main>` → `<div>`（確認済み・実装済み） |
| PR #15 (E-4) | `validateApiKey` エラー種別区別（AuthenticationError のみ false） |
| PR #15 (E-5) | `history/page.tsx` Supabase エラーログ（確認済み・実装済み） |
| PR #15 (E-6) | `middleware.ts` 保護パスをプレフィックスマッチに変更 |
| PR #14 (D-1) | `defense.ts` dialogHistory.content に truncate 適用・text-utils.ts に切り出し |
| PR #14 (D-2) | `defense/route.ts` 認証ユーザーパスを try-catch で保護 |
| PR #14 (D-5) | `judge_messages` 空文字列挿入ガード × 3箇所 |
| PR #14 (C-1) | `verifyGuestToken` try-catch 保護（argument / defense / draft の 3ファイル） |
| PR #14 (C-2) | `GUEST_TOKEN_SECRET` 未設定時のフェイルファスト（lib/guest-token.ts） |
| PR #14 (C-3) | プロンプトインジェクション対策（escapeXml + truncate(50)） |
| PR #14 (C-4) | profiles 重複クエリ削減・contradiction_warnings に .limit(100) |
| PR #14 (D-3) | `clear-flash` Cookie 削除に httpOnly: true（確認済み） |
| PR #14 (D-4) | A-2 テスト env チェック（確認済み） |
| PR #14 (D-6) | ゲスト名 DB バリデーション 50文字（確認済み） |
| PR #13 (B-1) | `defendantId`（被告 UUID）を認証なし API レスポンスから除去 |
| PR #13 (B-2) | ログアウト失敗時のフラッシュ Cookie + ErrorBanner 実装 |
| PR #12       | middleware の保護パス整備・Suspense 境界・logout エラー処理 |
