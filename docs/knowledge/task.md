# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

コパ（PR #4）の指摘対応。以下 3 件を修正する。

## 修正対象

### 1. argument/route.ts — verifyGuestToken の try-catch 欠落（MEDIUM）

`app/api/cases/[id]/argument/route.ts` の POST ハンドラで `verifyGuestToken()` を try-catch なしで呼んでいる。
`GUEST_TOKEN_SECRET` 未設定時などに例外がスローされると非 JSON の 500 が返り、エラー内容が漏れる可能性がある。
`app/api/cases/[id]/route.ts` の GET/PATCH ハンドラと同様に try-catch で囲み、JSON 500 + 隠蔽メッセージを返すこと。

### 2. Header.tsx — LogoutButton（'use client'）の使用を廃止（LOW）

`app/components/Header.tsx` が `LogoutButton`（`'use client'`）を使っており、Server Component のヘッダーにクライアント JS が引き込まれている。
ヘッダーのログアウトは `<form action={logout}><button type="submit">ログアウト</button></form>` のサーバーフォームに戻すこと。
スタイルは既存の Header のデザインを維持すること。

### 3. LogoutButton.tsx — 'use client' のスコープを絞る（LOW）

`app/components/LogoutButton.tsx` が `'use client'` + `useActionState` を使っており、全利用箇所にクライアント JS が影響する。
プロフィールページ（`app/profile/page.tsx`）では引き続き LogoutButton を使ってよいが、
Header ではサーバーフォームを使う（修正 2 と対になる）。
LogoutButton 自体を削除する必要はない。ただし、クライアント状態（エラー表示）が実際に必要な場所でのみ使用されるよう整理すること。

## スコープ外

- 上記 3 件以外の変更
- UI デザインの変更
- 新機能追加
