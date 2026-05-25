# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

バックログの MEDIUM 2件 + LOW 4件を修正する。
新機能追加・DBスキーマ変更なし。既存コードの修正のみ。

## 背景・目的

オーディ監査で指摘されたセキュリティ・品質改善を解消する。

## 修正対象

### D-1. `defense.ts` の `dialogHistory.content` に `truncate` 未適用

- **ファイル**: `lib/defense.ts`
- **現状**: `escapeXml` は適用済みだが、`dialogHistory` の各 `content` に `truncate` が未適用。
  長大な発言内容がプロンプトにそのまま展開され、プロンプトインジェクションの攻撃面が残る。
- **修正**: `dialogHistory` を展開する箇所で `escapeXml(truncate(a.content, 500))` に変更する。
  `truncate` 関数は同ファイル内（または `lib/judge.ts`）に既存のものを使い回すこと。

### D-2. `defense/route.ts` 認証ユーザーパスが try-catch 外

- **ファイル**: `app/api/cases/[id]/defense/route.ts`
- **現状**: `resolveAuth` 内の認証ユーザーパス（L15–L24）が try-catch の外にある。
  Supabase クライアント初期化失敗時に未捕捉例外が発生しうる。
- **修正**: 認証ユーザーパスも try-catch で囲み、例外時に
  `{ error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 }` を返す。
  既存の `argument/route.ts` の try-catch パターンを踏襲すること。

### D-3. `/api/clear-flash` の Cookie 削除で `httpOnly: true` が未指定

- **ファイル**: `app/api/clear-flash/route.ts`
- **現状**: `auth.ts` でセット時に `httpOnly: true` を指定しているが、削除時に省略されている。
- **修正**: `res.cookies.set('flash_error', '', { path: '/', maxAge: 0, httpOnly: true })` に統一する。

### D-4. A-2 テストで `E2E_TEST_EMAIL_B`・`E2E_TEST_PASSWORD_B` が必須チェックから漏れている

- **ファイル**: `tests/e2e/security-fixes.spec.ts`
- **現状**: `beforeEach` の必須環境変数チェックに `E2E_TEST_EMAIL_A`・`E2E_TEST_PASSWORD_A` のみ。
  `_B` 系変数が未設定の CI 環境でランタイムエラーになる。
- **修正**: `required` 配列に `E2E_TEST_EMAIL_B`・`E2E_TEST_PASSWORD_B` を追加する。

### D-5. 空文字列が `judge_messages` に挿入される

- **ファイル**: `app/api/cases/[id]/route.ts`・`app/api/cases/[id]/argument/route.ts`
- **現状**: `generateJudgeMessage` が `""` を返したとき、呼び出し元で空チェックせず INSERT するため
  本文なしのバブルが表示される。
- **修正**: `generateJudgeMessage` の戻り値を利用している箇所に `if (!content) return;` を追加する。

### D-6. ゲスト名（defendantName）の DB 書き込み前バリデーションなし

- **ファイル**: `app/api/cases/[id]/route.ts`
- **現状**: `PATCH /api/cases/[id]` のゲスト参加パスで `body.defendantName` の最大長検証がない。
  プロンプト埋め込みは `truncate(50)` で保護済みだが、DB には無制限長が書き込まれうる。
- **修正**: 既存のバリデーションブロックに以下を追加する。
  ```typescript
  if (typeof body.defendantName === "string" && body.defendantName.trim().length > 50) {
    return NextResponse.json({ error: "名前は50文字以内で入力してください" }, { status: 400 });
  }
  ```

## スコープ外

- HMAC トークンの決定論化（DBスキーマ変更が必要 → 別タスク）
- validateApiKey のエラー種別区別（後回し）
- middleware の保護パス判定改善（後回し）
- layout.tsx の `<main>` 二重ネスト（後回し）
- Supabase エラーログ追加（後回し）
- 新機能追加・UI 変更・DBスキーマ変更
