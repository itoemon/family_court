# バックログ

オーディが監査で検出した未修正の指摘を蓄積するファイルです。
リードがセッション開始時・PR マージ後にダイチへ内容を共有します。
アーキは次の設計時にここを参照し、関連する指摘を設計に反映してください。

---

## 未対応

### MEDIUM

#### [MEDIUM] `defense.ts` の `dialogHistory.content` に `truncate` 未適用（lib/defense.ts） (由来: audit_20260525_161728.md)

- **内容**: `escapeXml` は適用済みだが、`dialogHistory` の各 `content` に `truncate` が未適用。長大な発言内容がプロンプトにそのまま展開されるため、プロンプトインジェクションの攻撃面が残る。
- **修正案**: `escapeXml(truncate(a.content, 500))` に変更する。

#### [MEDIUM] `defense/route.ts` 認証ユーザーパスが try-catch 外（app/api/cases/[id]/defense/route.ts:15-24） (由来: audit_20260525_161728.md)

- **内容**: `resolveAuth` 内の認証ユーザーパス（L15–L24）が try-catch の外にある。Supabase クライアント初期化失敗時に未捕捉例外が発生しうる。
- **修正案**: 認証ユーザーパスも try-catch で囲み、例外時に 500 レスポンスを返す。

#### [MEDIUM] HMAC トークンが決定論的で個別取り消し不可（lib/guest-token.ts） (由来: audit_20260520_084404.md)

- **内容**: `computeToken` の HMAC 入力が `"${caseId}:defendant"` のみ。ランダム要素・タイムスタンプなし。Cookie キャプチャ時に 7 日間再利用可能。個別セッション取り消し不可。
- **修正案**: DB にトークンテーブルを追加し、nonce を発行する設計に変更（スキーマ変更必要）。
- **備考**: DB スキーマ変更が必要なため別タスクで対応。

---

### LOW

#### [LOW] layout.tsx の `<main>` が子ページと二重になりうる（app/layout.tsx:33） (由来: audit_20260519_162635.md)

- **内容**: layout が `<main>` でラップしているため、子ページが `<main>` を持つと HTML 仕様違反になる。
- **修正案**: layout のラッパーを `<div>` に変更するか、子ページは `<main>` を使わないと規約化する。

#### [LOW] ゲスト名（defendantName）に最大長バリデーションなし（app/api/cases/[id]/route.ts:87-90） (由来: audit_20260520_083154.md)

- **内容**: `PATCH /api/cases/[id]` のゲスト参加パスで `body.defendantName` の DB 書き込み前の最大長検証がない。プロンプト埋め込みは `truncate(50)` で保護済みだが、DB には無制限長が書き込まれうる。
- **修正案**: バリデーションブロックに `if (body.defendantName.length > 50) return error(400)` を追加する。

#### [LOW] `validateApiKey` がエラー種別を区別しない（lib/claude.ts:17） (由来: audit_20260520_084404.md)

- **内容**: あらゆる例外を `catch {}` で握りつぶして `false` を返す。Anthropic 障害時に正常なキーでも「無効」と表示される。
- **修正案**: `AuthenticationError`（401/403）のみキャッチして `false` を返し、それ以外は再 throw する。

#### [LOW] 空文字列が judge_messages に挿入される（lib/judge.ts:26） (由来: audit_20260524_183938.md)

- **内容**: `generateJudgeMessage` が `""` を返したとき呼び出し元で空チェックせず INSERT するため、本文なしのバブルが表示される。
- **修正案**: 呼び出し元で `if (!content) return;` を追加する。DB に `check (content <> '')` 制約を追加する。

#### [LOW] Supabase エラーが無言で握りつぶされる（app/history/page.tsx:40, 55-63） (由来: audit_20260524_193621.md)

- **内容**: `if (error) throw error;` でエラー詳細がユーザーに露出しないが、可観測性がゼロ。プロフィール取得クエリはエラー時に無言で空配列になる。
- **修正案**: `console.error("[history] query failed:", error)` を追加し、意味のあるエラーメッセージを throw する。

#### [LOW] A-2 テストで `E2E_TEST_EMAIL_B`・`E2E_TEST_PASSWORD_B` が必須チェックから漏れている（tests/e2e/security-fixes.spec.ts:7-13） (由来: audit_20260525_120211.md)

- **内容**: `beforeEach` の必須環境変数チェックに `_B` 系変数が含まれていない。未設定 CI 環境でランタイムエラーになる。
- **修正案**: `required` 配列に `E2E_TEST_EMAIL_B`・`E2E_TEST_PASSWORD_B` を追加する。

#### [LOW] middleware の保護パス判定が完全一致のみ（middleware.ts:32-34） (由来: audit_20260524_193621.md)

- **内容**: `PROTECTED_PATHS.has(pathname)` の完全一致判定のため、将来のサブルートが保護されない。現時点は Server Component の二重保護があるため実害なし。
- **修正案**: `pathname.startsWith("/history")` 等のプレフィックスマッチに変更する。

#### [LOW] `/api/clear-flash` の Cookie 削除で `httpOnly: true` が未指定（app/api/clear-flash/route.ts:5） (由来: audit_20260525_132523.md)

- **内容**: `auth.ts` でセット時に `httpOnly: true` を指定しているが、削除時に省略されている。一貫性を欠く。
- **修正案**: `res.cookies.set('flash_error', '', { path: '/', maxAge: 0, httpOnly: true })` に統一する。

---

## 対応済み

| PR | 内容 |
|----|------|
| PR #14 (C-1) | `verifyGuestToken` try-catch 保護（argument / defense / draft の 3ファイル） |
| PR #14 (C-2) | `GUEST_TOKEN_SECRET` 未設定時のフェイルファスト（lib/guest-token.ts） |
| PR #14 (C-3) | プロンプトインジェクション対策（escapeXml + truncate(50)、lib/judge.ts / lib/defense.ts） |
| PR #14 (C-4) | profiles 重複クエリ削減・contradiction_warnings に .limit(100) |
| PR #13 (B-1) | `defendantId`（被告 UUID）を認証なし API レスポンスから除去 |
| PR #13 (B-2) | ログアウト失敗時のフラッシュ Cookie + ErrorBanner 実装 |
| PR #12       | middleware の保護パス整備・Suspense 境界・logout エラー処理 |
