# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

バックログに蓄積された MEDIUM 指摘 2件を修正する。
新機能追加・DBスキーマ変更なし。既存コードの修正のみ。

## 背景・目的

オーディ監査で指摘されたセキュリティ・UX 改善を解消する。
LOW 指摘（middleware・layout・history エラー）はコードを確認した結果、すでに実装済みまたは許容範囲と判断し対象外。

## 修正対象

### B-1. `defendantId`（ユーザーUUID）を API レスポンスから除去

- **ファイル**: `lib/case-response.ts`
- **現状**: `buildCaseResponse` が `defendantId: c.defendant_id ?? null` を返しており、
  認証なしの `GET /api/cases/[id]` から誰でも被告の内部 UUID を取得できる。
- **調査結果**: クライアント（`app/case/[id]/page.tsx` 等）は `callerRole` で役割を判定しており、
  `defendantId` を参照していないことを確認済み。
- **修正**: `buildCaseResponse` の返却オブジェクトから `defendantId` フィールドを削除する。
- **注意**: `defendant` オブジェクト（`{ name, joinedAt }`）は残すこと。UUID のみ削除。

### B-2. ログアウト失敗時のユーザー通知

- **ファイル**: `app/actions/auth.ts`、`app/components/Header.tsx`
- **現状**: `supabase.auth.signOut()` がエラーを返しても `console.error` のみでユーザーには
  何も伝えずに `/` へリダイレクトする。
- **修正方針**:
  - `logout()` アクションをエラー時に `redirect('/') ` する前に、
    Next.js の `cookies()` を使ってフラッシュメッセージ Cookie を1件セットする
    （`Set-Cookie: flash_error=logout_failed; Path=/; HttpOnly; Max-Age=30`）
  - `Header.tsx` を Server Component のまま維持する
  - ホームページ（`app/page.tsx`）または共通レイアウト（`app/layout.tsx`）で
    フラッシュ Cookie を読み取り、Client Component として `<ErrorBanner>` を表示する
  - `<ErrorBanner>` は「ログアウト処理でエラーが発生しました。再度お試しください。」を
    表示し、自動的に Cookie を削除する（表示後に1度だけ消える）
- **代替案（アーキが判断可）**: Cookie ではなく URL パラメータ経由でも可（`/?error=logout_failed`）。
  ただし Server Component のみで完結できる方法を優先する。

## スコープ外

- HMAC トークンの決定論化（DBスキーマ変更が必要 → 別タスク）
- `/my-role` エンドポイント新設（B-1 の UUID 削除で代替可能と判断）
- 新機能追加・UI の大幅変更・DBスキーマ変更
- LOW 指摘（調査の結果、実装済みまたは許容範囲と判断）
