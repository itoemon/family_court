# ビルド → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: PR #4 コパ指摘 3 件の修正
**コミット**: e843f53
**日時**: 2026-05-21

---

## 実装上の判断・変更点

### 設計書通りに実装した点

- `app/api/cases/[id]/argument/route.ts`: `callerRole` 導出ブロック（`createSessionClient()` → `getUser()` → UUID照合 → `verifyGuestToken`）全体を try-catch で囲み、例外発生時に JSON 500 + 隠蔽メッセージを返すよう修正。
- `app/components/Header.tsx`: `LogoutButton`（`'use client'`）の import を廃止し、インライン Server Action `handleLogout` を定義して `<form action={handleLogout}>` に置き換え。

### 設計書から逸脱した点

**1. `<form action={logout}>` の代わりにインライン Server Action を使用**

task.md の記述例は `<form action={logout}>` だが、`logout` の戻り型（`Promise<void | { error: string }>`）が React 19 の form action 型（`(formData: FormData) => void | Promise<void>`）と不一致であり、TypeScript コンパイルエラーになる。

そのため、Header.tsx 内にインライン Server Action `handleLogout` を定義し、内部で `await logout()` を呼び出す形にした。`handleLogout` の戻り型は `Promise<void>` であり form action 型に適合する。また、Header ではログアウトエラー表示が不要なため、`logout()` の戻り値（`{ error: string }`）は破棄して問題ない。

**2. `LogoutButton.tsx` 自体は変更なし**

task.md の Fix 3（「'use client' のスコープを絞る」）は、Header.tsx での使用廃止（Fix 2）により達成されるため、`LogoutButton.tsx` 本体への変更は不要と判断した。profile ページでは引き続き `LogoutButton` を使用しており、エラー表示（`useActionState`）が意味を持つ。

---

## オーディへの注意点

### 重点テストケース

1. **ヘッダーのログアウト（Server Action 化）**
   - ヘッダーの「ログアウト」ボタンを押下 → ルートへリダイレクトされること
   - ヘッダーが Server Component のまま動作しており、クライアント JS が不要なこと（`LogoutButton` の `useActionState` が引き込まれていない）

2. **プロフィールページの LogoutButton（変更なし）**
   - プロフィールページのログアウトボタンが引き続き動作すること
   - ログアウト失敗時に `state.error` が表示される動線は維持されている（ただしテスト困難な経路）

3. **`verifyGuestToken` の try-catch（argument/route.ts）**
   - `GUEST_TOKEN_SECRET` が未設定の状態で POST `/api/cases/[id]/argument` を呼び出した場合、500 + `{ error: "サーバー設定エラーが発生しました。管理者に連絡してください。" }` が返ること
   - エラーメッセージに "GUEST_TOKEN_SECRET" という文字列が含まれないこと（情報隠蔽）
   - `GUEST_TOKEN_SECRET` が正常設定されている場合、従来通りにゲスト被告が発言できること

### セキュリティ確認ポイント

- Header の `handleLogout` は Server Action であり、クライアントへの `logout` 関数の露出はない。
- `argument/route.ts` の catch ブロックで、スタックトレースや環境変数名をクライアントに渡さないことを確認すること。

---

## 未実装・スコープ外にしたこと

（PR #3 から継続のバックログ。今回のスコープ外）

| バックログ | 内容 |
|-----------|------|
| MEDIUM-001 | GET レスポンスから `plaintiff_id` / `defendant_id` UUID を除外 |
| MEDIUM-002 | HMAC トークンの決定論的問題（取り消し・個別セッション無効化） |
| LOW-001 (route.ts) | ゲスト名の最大長バリデーションなし |
| LOW-001 (claude.ts) | `validateApiKey` のエラー種別区別 |
| MEDIUM (auth.ts) | ログアウト失敗時のユーザー通知 |
| LOW (layout.tsx) | `<main>` タグの二重ネスト |
