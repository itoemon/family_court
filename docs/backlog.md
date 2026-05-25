# バックログ

オーディが監査で検出した未修正の指摘を蓄積するファイルです。
リードがセッション開始時・PR マージ後にダイチへ内容を共有します。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映してください。

---

## 未対応

### MEDIUM

#### [MEDIUM] HMAC トークンが決定論的で個別取り消し不可（lib/guest-token.ts） (由来: audit_20260520_084404.md)

- **内容**: `computeToken` の HMAC 入力が `"${caseId}:defendant"` のみ。ランダム要素・タイムスタンプなし。Cookie キャプチャ時に 7 日間再利用可能。個別セッション取り消し不可。
- **修正案**: DB にトークンテーブルを追加し、nonce を発行する設計に変更（スキーマ変更必要）。
- **備考**: DB スキーマ変更が必要なため別タスクで対応。

---

---

## 対応済み

| PR | 内容 |
|----|------|
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
