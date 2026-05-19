# 設計書: 共通ヘッダー・フッター

## 概要

全ページに表示される共通ヘッダー・フッターを実装する。

ヘッダーは Supabase セッションを参照してログイン状態を判定し、認証リンクを出し分ける。
フッターはコピーライト表記のみを持つシンプルな静的コンポーネントとする。
いずれも Next.js App Router の Server Component として実装し、`app/layout.tsx` に組み込む。

---

## 画面・API 設計

### ヘッダー（`app/components/Header.tsx`）

```
[左] 家庭裁判所（ロゴテキスト → / へのリンク）
[右] ログイン済み : プロフィールへのリンク ／ ログアウトボタン
     未ログイン   : ログインへのリンク ／ サインアップへのリンク
```

- コンポーネント種別: **async Server Component**（`'use client'` 禁止）
- セッション取得: `createSessionClient()` → `supabase.auth.getUser()`
  - `getSession()` はキャッシュ値を返すため使用しない
- ログアウト: `<form action={logout}>` + Server Action（`app/actions/auth.ts` の `logout()`）  
  Server Action 内で `supabase.auth.signOut()` → `redirect('/')`

#### Tailwind カラー設計

| 要素 | クラス |
|---|---|
| ヘッダー背景 | `bg-stone-50 border-b border-stone-200` |
| ロゴテキスト | `text-stone-800 font-semibold text-lg` |
| ナビリンク | `text-stone-600 hover:text-stone-900 transition-colors` |
| ログアウトボタン | `text-stone-500 hover:text-stone-700 text-sm` |

対立感・緊張感を与える赤・黒・原色系は使用しない。`stone` 系をベーストーンとする（要件書のデザイン原則）。

#### レイアウト構造

```html
<header class="bg-stone-50 border-b border-stone-200">
  <div class="max-w-4xl mx-auto px-4 py-3 flex items-center justify-between">
    <a href="/">家庭裁判所</a>
    <!-- ログイン済み -->
    <nav>
      <a href="/profile">プロフィール</a>
      <form action={logout}><button type="submit">ログアウト</button></form>
    </nav>
    <!-- 未ログイン -->
    <nav>
      <a href="/login">ログイン</a>
      <a href="/signup">サインアップ</a>
    </nav>
  </div>
</header>
```

---

### フッター（`app/components/Footer.tsx`）

```
© 2026 家庭裁判所
```

- 同期 Server Component（非同期処理なし）
- Tailwind: `bg-stone-100 text-stone-400 text-sm text-center py-4`

#### レイアウト構造

```html
<footer class="bg-stone-100 text-stone-400 text-sm text-center py-4">
  © 2026 家庭裁判所
</footer>
```

---

### `app/layout.tsx` の変更

`Header`・`Footer` を import し、`{children}` を `<main className="flex-1">` でラップする。
`body` に `min-h-screen flex flex-col` を付与することで、フッターがコンテンツ量によらず常に最下部に収まる。

```html
<body class="min-h-screen flex flex-col bg-white text-stone-900">
  <Header />
  <main class="flex-1">
    {children}
  </main>
  <Footer />
</body>
```

---

### Server Action（`app/actions/auth.ts`）

```ts
'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'

export async function logout() {
  const supabase = createSessionClient()
  await supabase.auth.signOut()
  redirect('/')
}
```

- ファイルは `app/actions/auth.ts` に新規作成
- `'use server'` ディレクティブ必須
- ログアウト後は必ず `redirect('/')` する（ログイン必須ページに残留するとエラーになる）

---

## データモデル変更

なし。UI コンポーネントの追加のみ。DB スキーマ・API エンドポイントの変更は不要。

---

## 実装ステップ（ビルドへの指示）

**Step 1: `app/actions/auth.ts` の作成**

`app/actions/auth.ts` を新規作成し、`logout` Server Action をエクスポートする。
`createSessionClient()` で Supabase クライアントを生成し、`signOut()` 後に `redirect('/')` を呼ぶ。

**Step 2: `app/components/Footer.tsx` の作成**

`app/components/Footer.tsx` を新規作成する。
同期 Server Component として、`<footer>` タグ内に `© 2026 家庭裁判所` を表示する。
Tailwind: `bg-stone-100 text-stone-400 text-sm text-center py-4`

**Step 3: `app/components/Header.tsx` の作成**

`app/components/Header.tsx` を新規作成する。
`async` Server Component として定義し、`createSessionClient()` → `auth.getUser()` の結果でナビゲーションを分岐する。
ログアウトは `<form action={logout}>` 内の `<button type="submit">` で実装する。
`'use client'` は付与しない。

**Step 4: `app/layout.tsx` の更新**

既存の `app/layout.tsx` を編集し、`Header`・`Footer` を import する。
`body` タグに `min-h-screen flex flex-col` を追加し、`{children}` を `<main className="flex-1">` でラップする。

> **順序の意図**: Step 1 でログアウト Action を先に用意することで、Step 3 の Header 実装時に import がすぐ通る。Step 2 のフッターを先に完成させ、最後の layout.tsx 更新で全体を繋ぐ。

---

## 注意事項・制約

1. **Server Component 必須**: `createSessionClient()` は Server Component 専用（ADR-002）。`Header.tsx` に `'use client'` を付与してはならない。ログアウト処理は Server Action + `<form>` で完結させる。

2. **セッション取得メソッド**: `auth.getUser()` を使うこと。`auth.getSession()` はキャッシュされた値を返すため、ログアウト直後の状態が正しく反映されないリスクがある。

3. **配色制約**: ヘッダー・フッターともに `stone` 系カラーを維持し、赤・強調原色を使わないこと。要件書のデザイン原則（「対立や緊張感を煽る配色・表現は避ける」）に従う。

4. **レイアウト崩れの確認**: `<main className="flex-1">` の追加により、既存ページのレイアウトが変化する可能性がある。特に既存ページが独自に `min-h-screen` を持っている場合は調整が必要。

5. **`app/components/` ディレクトリ**: 存在しない場合はディレクトリごと作成すること。

6. **ナビゲーションメニューは対象外**: 要件書の対象外定義に従い、ヘッダーにはロゴと認証状態表示のみを実装する。ページ間ナビゲーションのリンクは追加しない。
