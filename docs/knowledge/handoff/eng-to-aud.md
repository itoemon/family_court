# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: PR #3 コパ指摘 4 件の修正
**コミット**: 1e081ce
**日時**: 2026-05-20

---

## 実装上の判断・変更点

### 設計書通りに実装した点

- `lib/guest-token.ts`: `computeToken` の先頭に `GUEST_TOKEN_SECRET` 未設定ガードを追加。`!` アサーション除去。
- `app/api/cases/[id]/route.ts`: GET ハンドラに `callerRole` 算出ロジックを追加しレスポンスに付与。`createSessionClient().auth.getUser()` + UUID 照合（認証済み）/ Cookie + `verifyGuestToken`（ゲスト）の順で判定。
- `app/api/profile/route.ts`: PATCH 成功後、`update().select("api_key_encrypted").single()` でサーバー側の現在値を取得し `hasApiKey: boolean` をレスポンスに含める。
- `app/case/[id]/page.tsx`: `restoreRole` の Supabase UUID 比較を削除し、`data.callerRole` から `setMyRole` するように変更。
- `app/profile/page.tsx`: `setHasApiKey(data.hasApiKey)` に変更。catch で `err.message` を `setMessage` に反映。

### 設計書から逸脱した点

**1. PATCH ハンドラの `generateGuestToken` に try-catch を追加（設計書に明記なし）**

設計書 Fix 3 セクションに「各 API Route の catch ブロックで捕捉し 500 を返す」と記載があり、`generateGuestToken` を呼ぶ PATCH ハンドラもその対象と判断して追加した。変更は最小限（`generateGuestToken` 呼び出し箇所をラップするのみ）。

**2. `callerRole === "plaintiff"` もクライアントで `setMyRole` する**

元の `restoreRole` は defendant 復元専用だったが、新実装では plaintiff も復元される。URL パラメータ `?role=plaintiff` なしで原告がアクセスした場合も `myRole` が設定される。セキュリティ上の問題はない（判定はサーバー側で完結）。

**3. `lib/types.ts` の `Case` に `callerRole?` を追加**

設計書の「データモデル変更なし」は DB スキーマの意味と判断。API レスポンスの型定義に追加しないと TypeScript コンパイルエラーになるため追加した。optional（`?`）にしているのは PATCH レスポンスが `callerRole` を含まないため。

---

## オーディへの注意点

### 重点テストケース

1. **ゲスト被告のリロード復元**
   - ゲストとして参加 → ページリロード → 発言フォームが表示されること（`myRole === "defendant"` が復元される）
   - Cookie `guest_defendant_{id}` が存在しない状態でリロード → `myRole` が null のまま（Observer として扱われる）

2. **`callerRole` の正確性**
   - 原告（Supabase セッションあり）: `callerRole === "plaintiff"`
   - 認証済み被告（Supabase セッションあり）: `callerRole === "defendant"`
   - ゲスト被告（Cookie 有効）: `callerRole === "defendant"`
   - Cookie なし・無効 / 第三者ユーザー: `callerRole === "observer"`

3. **`hasApiKey` の正確性**
   - API キーなしで表示名のみ更新 → 既存キーがあれば `hasApiKey` は `true` のまま
   - 初めて API キーを登録 → `hasApiKey === true` になること

4. **catch のエラーメッセージ表示**
   - プロフィール保存失敗時（例：無効 API キー）→ "APIキーが無効です。Anthropic コンソールで確認してください。" が表示されること

5. **`GUEST_TOKEN_SECRET` 未設定ガード**
   - 環境変数未設定時、`GET /api/cases/[id]` と `PATCH /api/cases/[id]`（ゲスト参加）が 500 + JSON エラーメッセージを返すこと
   - エラーメッセージに "GUEST_TOKEN_SECRET" という文字列が含まれないこと（情報隠蔽）

### セキュリティ確認ポイント

- GET レスポンスに `plaintiff_id` / `defendant_id` UUID が含まれている（MEDIUM-001 はスコープ外）。今回の修正でクライアントが UUID をロール判定に使わなくなったことで実害は減少しているが、将来のタスクで除去予定。
- HMAC の決定論的問題（MEDIUM-002）は未修正のまま。

---

## 未実装・スコープ外にしたこと

| バックログ | 内容 |
|-----------|------|
| MEDIUM-001 | GET レスポンスから `plaintiff_id` / `defendant_id` UUID を除外 |
| MEDIUM-002 | HMAC トークンの決定論的問題（取り消し・個別セッション無効化） |
| LOW-001 (route.ts) | ゲスト名の最大長バリデーションなし |
| LOW-001 (claude.ts) | `validateApiKey` のエラー種別区別 |
| MEDIUM (auth.ts) | ログアウト失敗時のユーザー通知 |
| LOW (layout.tsx) | `<main>` タグの二重ネスト |
