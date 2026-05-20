# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

コパ（PR #3）の指摘対応。以下 4 件を修正する。

## 修正対象

### 1. ゲスト被告のmyRole復元（CRITICAL）
ページリロード後に `myRole` が null になり、ゲスト被告が発言フォームを表示できない。
`GET /api/cases/[id]` のレスポンスにサーバー側で `callerRole` を含めて返し、クライアントがそれを使って `myRole` を復元できるようにすること。
Cookie の存在と `verifyGuestToken` による検証をサーバー側で行う。

### 2. setHasApiKey の状態不整合
`app/profile/page.tsx` の保存処理で、APIキーを送信していない場合（表示名のみ更新）でも `setHasApiKey(true)` を呼んでいる。
APIキーフィールドが入力されている場合のみ `setHasApiKey(true)` を呼ぶか、サーバーレスポンスで登録状態を返して同期すること。

### 3. GUEST_TOKEN_SECRET 未設定時のガード
`lib/guest-token.ts` が `process.env.GUEST_TOKEN_SECRET!` を non-null アサーションで参照しており、未設定時に実行時例外になる。
関数内で明示的にガードし、未設定時は原因が追えるエラーを返すこと（500 + 説明文）。

### 4. catch でエラーメッセージが活かされない
`app/profile/page.tsx` の API 呼び出しで `data.error` を `Error` に載せているが、catch 側が常に固定メッセージを表示しており `err.message` が使われていない。
catch(err) で `err.message` を表示に反映すること。

## スコープ外

- MEDIUM/LOW バックログの指摘（別タスクで管理）
- UI デザインの変更
- 新機能追加
