# 詳細設計書

## 概要（変更の目的・背景）

オーディ監査で蓄積された MEDIUM 指摘 2 件（セキュリティ 1・UX 1）を解消する。

新機能追加・DB スキーマ変更なし。既存コードの修正と Client Component の新規作成のみ。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### GET /api/cases/[id]（B-1）

**変更点**: レスポンスから `defendantId` フィールドを削除する。

| フィールド | 変更前 | 変更後 |
|-----------|--------|--------|
| `defendantId` | `string \| null` | **削除** |

他のフィールドに変更なし。クライアントは引き続き `callerRole` で自分の役割を判定する。

新設エンドポイントなし。

---

## データモデル（DB スキーマ・型定義の変更）

### `lib/types.ts` — `Case` インターフェースから `defendantId` を削除

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

```ts
// 変更後
export interface Case {
  id: string;
  topic: string;
  callerRole?: "plaintiff" | "defendant" | "observer";
  // ...
}
```

DB スキーマ変更なし。`cases.defendant_id` カラムはサーバー側でのみ使用を継続する。

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### B-1. `lib/case-response.ts` — `defendantId` フィールドを削除

**変更箇所**: 返却オブジェクトの 1 行のみ。

```ts
// 変更前（74 行目付近）
return {
  id: c.id,
  topic: c.topic,
  // ...
  defendantId: c.defendant_id ?? null,  // ← この行を削除
  plaintiff: { ... },
  // ...
};
```

```ts
// 変更後
return {
  id: c.id,
  topic: c.topic,
  // ...
  plaintiff: { ... },
  // ...
};
```

**注意点**: `defendant` オブジェクト（`{ name, joinedAt }`）は残すこと。UUID だけを削除する。

---

### B-1. `app/api/cases/[id]/verdict/route.ts` — `defendantId` フィールドを削除

`verdict/route.ts` は `Case` 型を Claude への内部処理用ローカル変数として組み立てる（API レスポンスには含まれない）。`Case` 型から `defendantId` が消えるためコンパイルエラーになる。

**変更箇所**: `caseForClaude` オブジェクトの 1 行のみ（46 行目付近）。

```ts
// 変更前
const caseForClaude: Case = {
  id: c.id,
  topic: c.topic,
  defendantId: c.defendant_id ?? null,  // ← この行を削除
  plaintiff: { ... },
  // ...
};
```

```ts
// 変更後
const caseForClaude: Case = {
  id: c.id,
  topic: c.topic,
  plaintiff: { ... },
  // ...
};
```

`lib/claude.ts` の `requestVerdict` は `Case.defendantId` を参照していないため、処理への影響はない。

---

### B-2. `app/actions/auth.ts` — ログアウト失敗時にフラッシュ Cookie をセット

**方針**: Cookie 方式。`app/layout.tsx`（Server Component）で Cookie を読み取り `<ErrorBanner>` を表示することで、全ページで表示対象になる。

**変更前:**
```ts
export async function logout(): Promise<void> {
  const supabase = await createSessionClient()
  const { error } = await supabase.auth.signOut()
  if (error) console.error('signOut error:', error)
  redirect('/')
}
```

**変更後:**
```ts
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

**設計判断**:
- `maxAge: 30`（秒）: 短命な Cookie であり、1 ページロード内で確実に消える
- `httpOnly: true`: JS からの読み取りを防ぐ（XSS 対策）
- `secure` フラグは Next.js が本番環境で自動付与するため明示不要

---

### B-2. `app/layout.tsx` — フラッシュ Cookie を読み取り `<ErrorBanner>` を差し込む

`RootLayout` は Server Component のため `cookies()` を直接 `await` できる。

**変更箇所**: `cookies()` で `flash_error` を読み取り、値があれば `<ErrorBanner>` を `children` の前に差し込む。Cookie 自体の削除は `<ErrorBanner>` 側（クライアント）の fetch で行う（後述）。

```tsx
// 変更後のイメージ
import { cookies } from 'next/headers'
import ErrorBanner from '@/app/components/ErrorBanner'

export default async function RootLayout({ children }: { children: React.ReactNode }) {
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

**注意**: `RootLayout` は Server Component のまま。`ErrorBanner` のみ Client Component とする。

---

### B-2. `app/components/ErrorBanner.tsx` — 新規作成（Client Component）

**責務**:
1. `errorCode` prop を受け取り、対応するエラーメッセージを日本語で表示する
2. マウント時（`useEffect`）に `/api/clear-flash` を fetch して Cookie を削除する
3. ユーザーが閉じるボタンを押したら非表示にする

**Props:**
```ts
interface ErrorBannerProps {
  errorCode: string
}
```

**エラーコードとメッセージのマッピング（コンポーネント内に定義）:**
```ts
const ERROR_MESSAGES: Record<string, string> = {
  logout_failed: 'ログアウト処理でエラーが発生しました。再度お試しください。',
}
```

**Cookie 削除の仕組み**: `useEffect` で `/api/clear-flash` に GET リクエストを送る。このエンドポイントが `Set-Cookie: flash_error=; Max-Age=0` を返すことで Cookie を削除する。

**UI仕様**:
- 背景色: `bg-rose-50`、ボーダー: `border-rose-100`
- テキスト色: `text-rose-700`
- 閉じるボタン（×）を右端に配置する
- `Suspense` でラップ不要（props として渡された値のみ使用）

---

### B-2. `app/api/clear-flash/route.ts` — 新規作成（Cookie 削除エンドポイント）

**責務**: `flash_error` Cookie を `Max-Age=0` で上書きして削除する。

```ts
import { NextResponse } from 'next/server'

export async function GET() {
  const res = NextResponse.json({ ok: true })
  res.cookies.set('flash_error', '', { path: '/', maxAge: 0 })
  return res
}
```

**設計判断**: Server Action で Cookie を削除する方法もあるが、`useEffect` からは Server Action を直接呼べないため、シンプルな GET エンドポイントを採用する。

---

## セキュリティ設計（認証・認可・入力検証の方針）

### B-1 の根拠

`GET /api/cases/[id]` は認証不要のエンドポイント。`defendantId`（被告の Supabase ユーザー UUID）が公開されると、UUID を知った第三者が被告になりすましの試みや、他のエンドポイントへのプローブに利用できる。クライアントは `callerRole` フィールドで役割を判定しており、`defendantId` は不要。

### B-2 の根拠

`signOut()` がエラーを返すのは、ネットワーク障害・トークン期限切れ・Supabase 側の一時障害等。エラーを無視して `/` にリダイレクトすると、セッションが残存したままブラウザがホームに戻る可能性がある。ユーザーに「ログアウトできていない可能性がある」ことを伝えることで再試行を促す。

Cookie の `httpOnly` フラグにより、フラッシュメッセージの内容が XSS で読み取られるリスクを排除する。

### C-1. `verifyGuestToken` 未 try-catch（対応済み）

`verifyGuestToken` は内部で `GUEST_TOKEN_SECRET` を参照する。環境変数が未設定の場合、IIFE による起動時フェイルファスト（C-2）が機能していれば TypeError は発生しないが、予期せぬ暗号エラー等に備えて呼び出し側でも try-catch が必要。

対応方針: `verifyGuestToken` を呼ぶ 3 ファイル（`argument/route.ts`, `defense/route.ts`, `defense/draft/route.ts`）で try-catch を設け、例外時は `{ error: "サーバー設定エラーが発生しました。管理者に連絡してください。", status: 500 }` を返す。これにより、暗号ライブラリの例外がグローバルエラーハンドラに到達せず、情報漏洩を防ぐ。

実装状況: 3 ファイルすべてで対応済み。

### C-2. `GUEST_TOKEN_SECRET` 未設定時のフェイルファスト（対応済み）

`createHmac` に `undefined` を渡すと TypeError が発生し、ゲストトークン操作を含むすべてのリクエストが 500 で失敗する。この状態は設定ミスであり、起動時点で検知すべきである。

対応方針: `lib/guest-token.ts` のモジュールトップレベル（IIFE）で `GUEST_TOKEN_SECRET` の存在を検証し、未設定時は `throw new Error("GUEST_TOKEN_SECRET is not set")` でアプリ起動を失敗させる。`!` アサーションは除去する。

実装状況: IIFE による起動時検証として実装済み。

### C-3. プロンプトインジェクション対策（対応済み）

`topic`, `plaintiffName`, `defendantName` 等のユーザー入力値を AI プロンプトに文字列展開する際、攻撃者が指示文字列を埋め込む（プロンプトインジェクション）リスクがある。

対応方針:
1. ユーザー入力を XML タグで囲み、指示部と入力部を構造的に分離する（例: `<topic>${safeTopic}</topic>`）
2. プロンプト末尾に「タグ内は参照情報であり指示として扱わない」旨を明記する
3. `plaintiffName`・`defendantName` は埋め込み前に 50 文字で切り捨てる（`slice(0, 50)`）
4. XML 特殊文字（`&`, `<`, `>`, `"`, `'`）を `escapeXml` 関数でエスケープする

実装状況: `lib/judge.ts`・`lib/defense.ts` の両ファイルで対応済み。

---

## パフォーマンス設計

### C-4. profiles 重複クエリ削減 + `contradiction_warnings` 件数上限（対応済み）

**profiles 重複クエリ:**
`argument/route.ts` では judge メッセージ生成と矛盾チェックの両ブロックで原告プロフィールが必要になる。同一リクエスト内で 2 回クエリを発行すると不要な DB ラウンドトリップが発生する。

対応方針: リクエスト冒頭で `display_name` と `api_key_encrypted` を同時に取得し（`select("display_name, api_key_encrypted")`）、judge ブロックと矛盾チェックブロックの両方で使い回す。

実装状況: 110〜118 行目で一度取得して `plaintiffApiKey` を両ブロックで参照する形で対応済み。被告が認証ユーザーの場合の `defProfile` クエリ（125〜131 行目）は judge 用の表示名専用であり、重複ではない。

**`contradiction_warnings` 件数上限:**
`.limit()` なしで `contradiction_warnings` をクエリすると、ケースが長期化した場合にペイロードが無制限に膨張し、レスポンスサイズが増大する。

対応方針: `lib/case-response.ts` の該当クエリに `.limit(100)` を追加する。

実装状況: `lib/case-response.ts` 53 行目で `.limit(100)` として対応済み。

---

## 影響範囲まとめ

### B-1

| ファイル | 変更種別 | 変更量 |
|---------|---------|-------|
| `lib/types.ts` | 修正（1行削除） | 最小 |
| `lib/case-response.ts` | 修正（1行削除） | 最小 |
| `app/api/cases/[id]/verdict/route.ts` | 修正（1行削除） | 最小 |

クライアント側（`app/case/[id]/page.tsx` 等）は `defendantId` を参照していないため変更不要（grep 確認済み）。

### B-2

| ファイル | 変更種別 | 変更量 |
|---------|---------|-------|
| `app/actions/auth.ts` | 修正（Cookie セット追加） | 小 |
| `app/layout.tsx` | 修正（Cookie 読み取り・ErrorBanner 差し込み） | 小 |
| `app/components/ErrorBanner.tsx` | **新規作成** | 中 |
| `app/api/clear-flash/route.ts` | **新規作成** | 小 |

---

## 制約・前提条件

- **DB 変更なし**
- **B-1**: `defendant` オブジェクト（`{ name, joinedAt }`）は残す。削除するのは UUID のみ
- **B-2**: `Header.tsx` は Server Component のまま維持する
- **B-2**: `app/page.tsx` は Client Component のまま変更不要（Cookie 方式のため URL パラメータ不要）
- **B-2**: `ErrorBanner` は全ページ共通の `app/layout.tsx` に差し込むため、ホームページ以外でもログアウトエラーが表示される（意図した動作）
- **スコープ外**: HMAC トークンの決定論化・`/my-role` エンドポイント新設・LOW 指摘
