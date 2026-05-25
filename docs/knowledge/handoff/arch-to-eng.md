# アーキ → ビルド handoff

## タスク概要

MEDIUM 指摘 2 件（B-1: UUID 露出防止・B-2: ログアウトエラー通知）の修正。新機能なし、DB スキーマ変更なし。

---

## 実装チェックリスト

### 1. B-1: `defendantId` を型定義・レスポンス・内部処理から削除

変更は 3 ファイル・各 1 行削除のみ。TypeScript の型チェックが通れば完了。

#### 1-1. `lib/types.ts`

`Case` インターフェースから `defendantId` フィールドを削除する。

```ts
// 変更前
export interface Case {
  id: string;
  topic: string;
  defendantId: string | null;  // ← 削除
  callerRole?: "plaintiff" | "defendant" | "observer";
  // ...
}
```

#### 1-2. `lib/case-response.ts`

返却オブジェクトから `defendantId` 行を削除する（74 行目付近）。

```ts
// 変更前（この1行を削除）
defendantId: c.defendant_id ?? null,
```

`defendant` オブジェクト（`{ name: ..., joinedAt: ... }`）は残すこと。

#### 1-3. `app/api/cases/[id]/verdict/route.ts`

`caseForClaude` オブジェクトから `defendantId` 行を削除する（46 行目付近）。

```ts
// 変更前（この1行を削除）
defendantId: c.defendant_id ?? null,
```

このファイルは API レスポンスに `defendantId` を返していない（`return NextResponse.json({ phase: "verdict", verdict })` のみ）。型合わせのための行であり、削除しても処理への影響はない。

**確認**: `tsc --noEmit` でコンパイルエラーが出ないこと。

---

### 2. B-2: ログアウト失敗時のユーザー通知

4 ファイルに変わる。新規作成 2 件・修正 2 件。

#### 2-1. `app/actions/auth.ts`（修正）

`cookies` を import し、`signOut` エラー時に `flash_error` Cookie をセットする。

```ts
'use server'

import { createSessionClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import { cookies } from 'next/headers'

export async function logout(): Promise<void> {
  const supabase = await createSessionClient()
  const { error } = await supabase.auth.signOut()
  if (error) {
    console.error('signOut error:', error)
    const cookieStore = await cookies()
    cookieStore.set('flash_error', 'logout_failed', {
      path: '/',
      httpOnly: true,
      maxAge: 30,
    })
  }
  redirect('/')
}
```

#### 2-2. `app/layout.tsx`（修正）

`cookies()` で `flash_error` を読み取り、値があれば `<ErrorBanner>` を差し込む。`RootLayout` は Server Component のまま。

追加する import:
```ts
import { cookies } from 'next/headers'
import ErrorBanner from '@/app/components/ErrorBanner'
```

`RootLayout` を `async` に変更し、Cookie を読み取る:
```tsx
export default async function RootLayout({ children }: ...) {
  const cookieStore = await cookies()
  const flashError = cookieStore.get('flash_error')?.value ?? null

  return (
    <html ...>
      <body ...>
        <Suspense ...><Header /></Suspense>
        {flashError && <ErrorBanner errorCode={flashError} />}
        <div className="flex-1">{children}</div>
        <Footer />
      </body>
    </html>
  )
}
```

**注意**: `ErrorBanner` は Client Component だが、`flashError` を props で渡す形式のため `Suspense` でのラップは不要。

#### 2-3. `app/components/ErrorBanner.tsx`（新規作成）

```tsx
'use client'

import { useState, useEffect } from 'react'

const ERROR_MESSAGES: Record<string, string> = {
  logout_failed: 'ログアウト処理でエラーが発生しました。再度お試しください。',
}

interface ErrorBannerProps {
  errorCode: string
}

export default function ErrorBanner({ errorCode }: ErrorBannerProps) {
  const [visible, setVisible] = useState(true)

  useEffect(() => {
    // Cookie を削除する（表示は1度だけ）
    fetch('/api/clear-flash').catch(() => {})
  }, [])

  if (!visible) return null

  const message = ERROR_MESSAGES[errorCode] ?? 'エラーが発生しました。'

  return (
    <div className="bg-rose-50 border-b border-rose-100 px-4 py-3 flex items-center justify-between">
      <p className="text-rose-700 text-sm">{message}</p>
      <button
        onClick={() => setVisible(false)}
        className="text-rose-400 hover:text-rose-600 text-lg leading-none ml-4"
        aria-label="閉じる"
      >
        ×
      </button>
    </div>
  )
}
```

**ポイント**:
- `useEffect` で `/api/clear-flash` を fetch → Cookie が削除される → ページリロードしても再表示されない
- `ERROR_MESSAGES` に未知のコードが来た場合はフォールバックメッセージを表示する
- スタイルは既存のエラー表示（`bg-rose-50 border border-rose-100 text-rose-700`）に合わせる
- バナーはヘッダーの直下、コンテンツの上に表示される（layout.tsx の差し込み位置による）

#### 2-4. `app/api/clear-flash/route.ts`（新規作成）

```ts
import { NextResponse } from 'next/server'

export async function GET() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('flash_error', '', { path: '/', maxAge: 0 })
  return res
}
```

---

## 実装順序の推奨

1. **B-1**（3 行削除・型チェックで確認完了）→ 2. **B-2**（4 ファイル・動作確認が必要）

B-1 を先に完了させると `tsc` が通るようになり、B-2 の実装中に型エラーで混乱しない。

---

## 確認項目

### B-1
- [ ] `tsc --noEmit` がエラーなしで通る
- [ ] `GET /api/cases/[id]` のレスポンスに `defendantId` が含まれない（ブラウザの Network タブで確認）
- [ ] ケースルームの表示・参加・発言が正常に動作する

### B-2
- [ ] 正常なログアウトで `flash_error` Cookie がセットされない（正常時は何も表示されない）
- [ ] エラー時（signOut が失敗するケースは手動で再現困難なため、`auth.ts` に一時的に `const error = new Error('test')` を代入して確認してもよい）、バナーが表示される
- [ ] バナーの「×」ボタンで非表示になる
- [ ] ページリロード後にバナーが再表示されない（Cookie が削除されていることを確認）

---

## 注意事項

- **`defendant` オブジェクトは削除しない**: B-1 で削除するのは UUID (`defendantId`) のみ。名前・参加日時の `defendant: { name, joinedAt }` は残す
- **`Header.tsx` は変更不要**: ログアウトボタンの `form action={handleLogout}` はそのまま。`auth.ts` の変更のみで対応できる
- **`app/page.tsx` は変更不要**: Cookie 方式のため URL パラメータ不要。`app/page.tsx` は Client Component のまま変更しない
- **バックログ更新**: 修正完了後、バックログの B-1・B-2 を「対応済み」へ移動すること

---

## 未解決事項（ビルドの判断不要・スコープ外）

- HMAC トークンの決定論化（DB スキーマ変更が必要 → 別タスク）
- `/my-role` エンドポイント新設（B-1 の UUID 削除で代替と判断 → 不要）
- LOW 指摘（middleware・layout・history エラー）→ 調査の結果、実装済みまたは許容範囲
