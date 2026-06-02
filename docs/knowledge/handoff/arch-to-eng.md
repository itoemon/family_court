# アーキ → ビルド 引き継ぎメモ（FEAT-RESP-HEADER）

## タスク概要

`app/components/Header.tsx` を「ロゴ＋アバター起点のドロップダウンメニュー」方式に刷新する **UI のみ** の改修。バックログ ID `FEAT-RESP-HEADER`。

詳細設計は `docs/knowledge/design.md` 末尾の **「FEAT-RESP-HEADER 対応: ヘッダーをアバター起点のドロップダウンメニュー方式に刷新」** セクションを参照すること。

**最重要事項（絶対条件）**:

- RLS / migration / DB スキーマには **一切** 触らない（`supabase/` 配下不可侵）。
- 新規 npm 依存を追加しない（ヘッドレス UI ライブラリ等を含む）。
- breakpoint（`sm:` `md:` `lg:` `xl:`）を導入しない（全画面サイズで同一 UI）。
- 配色は `stone-*` / `brand-700` / `brand-800` のみ。`brand-500` は使わない。赤系 / rose 系はログアウト項目にも使わない。
- `app/actions/auth.ts` の `logout` 関数本体を変更しない（import 経路のみ確認可）。
- `middleware.ts`・`profiles` テーブル構造・`tailwind.config.*`・`package.json` を変更しない。
- 正常系の認証ガード挙動（middleware の保護ルートリダイレクト等）は完全に不変。

---

## 実装順序

順序を守ると各ステップ単体で検証しやすい。

### Step 1: 現行構造の把握

1. `app/components/Header.tsx` を Read し、現行 Server Component の構造を把握する：
   - `createSessionClient` 作成位置
   - `auth.getUser()` 呼び出し
   - 既存の `'use server'` ローカル関数の有無（あれば移行後は除去対象）
   - 横並びリンク `<nav>` の構造（廃棄対象）
2. `app/actions/auth.ts` の `logout` シグネチャを Read で確認する（Client から `<form action={logout}>` で呼べる形か）。
3. `app/layout.tsx` で `<Header />` がどう呼ばれているか確認する（マウント箇所は不変が条件）。
4. 本バージョン Next.js での Server Action と `<form action>` の組み合わせを `node_modules/next/dist/docs/` で確認する（`AGENTS.md` の方針）。Client Component から Server Action を直接 import する形が正規かを必ず確認すること。

### Step 2: Server Component（`Header.tsx`）の責務縮小

`app/components/Header.tsx` をリファクタする。

- `auth.getUser()` に加えて、`createSessionClient` 経由で `profiles.select("avatar_url, display_name").eq("id", user.id).single()` を実行する。
- `createAdminClient` は使用しない（RLS 経由・MEDIUM-001 方針）。
- 取得失敗時は `avatarUrl: null` / `displayName: null` で握りつぶす（throw しない）。
- 既存の横並びリンク `<nav>` および Header 内の `'use server'` ローカル関数（あれば）を削除し、右側に `<HeaderUserMenu isAuthenticated={...} avatarUrl={...} displayName={...} />` のみを置く。
- ヘッダー全体は `flex items-center justify-between` で左：ロゴ、右：`<HeaderUserMenu />`。
- `<Header />` のシグネチャ（引数なし・Server Component）を維持する。`app/layout.tsx` 側を変更しないため。

### Step 3: `HeaderUserMenu.tsx` の新設（Client Component）

`app/components/HeaderUserMenu.tsx` を **新規作成** する。冒頭に `"use client";` を必ず置く。

Props 型：

```typescript
type HeaderUserMenuProps = {
  isAuthenticated: boolean;
  avatarUrl: string | null;
  displayName: string | null;
};
```

state / ref：

```typescript
const [isOpen, setIsOpen] = useState(false);
const rootRef = useRef<HTMLDivElement>(null);
const buttonRef = useRef<HTMLButtonElement>(null);
const menuId = useId(); // aria-controls 紐付け用
```

アバターボタン（トリガ）：

- `<button ref={buttonRef} type="button" aria-haspopup="menu" aria-expanded={isOpen} aria-controls={menuId} aria-label={isAuthenticated ? "アカウントメニューを開く" : "メニューを開く"} onClick={() => setIsOpen(p => !p)}>` でアバターを描画。
- 認証時かつ `avatarUrl !== null`：`<img src={avatarUrl} alt={displayName ?? ""} width={32} height={32} className="rounded-full ..." />`。
- 認証時かつ `avatarUrl === null`：丸型 `bg-stone-200` 背景 + インライン人型 SVG（`text-stone-600 w-5 h-5`、`aria-hidden="true"`）。
- 未認証時：丸型 `bg-stone-100` 背景 + インライン人型 SVG（`text-stone-500 w-5 h-5`、`aria-hidden="true"`）。

ドロップダウン本体：

- `<div id={menuId} role="menu" aria-orientation="vertical" className="absolute right-0 mt-2 w-48 bg-stone-50 border border-stone-200 rounded-md shadow-md ...">`。
- 認証時：
  - `<Link href="/history" role="menuitem" onClick={() => setIsOpen(false)}>過去のケース</Link>`
  - `<Link href="/friends" role="menuitem" onClick={() => setIsOpen(false)}>フレンド</Link>`
  - `<Link href="/profile" role="menuitem" onClick={() => setIsOpen(false)}>プロフィール</Link>`
  - `<div role="separator" className="border-t border-stone-200" />`
  - `<form action={logout} onSubmit={() => setIsOpen(false)}><button type="submit" role="menuitem">ログアウト</button></form>`
- 未認証時：
  - `<Link href="/auth/login" role="menuitem" onClick={() => setIsOpen(false)}>ログイン</Link>`
  - `<Link href="/auth/signup" role="menuitem" onClick={() => setIsOpen(false)}>サインアップ</Link>`

トリガとドロップダウンは `<div ref={rootRef} className="relative">` で包み、外側クリック判定の起点にする。

### Step 4: 開閉ハンドリング（外側クリック / Escape）

`HeaderUserMenu.tsx` 内の `useEffect` で、`isOpen === true` の間だけ document に登録する。cleanup で必ず `removeEventListener` する。

```typescript
useEffect(() => {
  if (!isOpen) return;
  const onMouseDown = (e: MouseEvent) => {
    if (!rootRef.current?.contains(e.target as Node)) setIsOpen(false);
  };
  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === "Escape") {
      setIsOpen(false);
      buttonRef.current?.focus();
    }
  };
  document.addEventListener("mousedown", onMouseDown);
  document.addEventListener("keydown", onKeyDown);
  return () => {
    document.removeEventListener("mousedown", onMouseDown);
    document.removeEventListener("keydown", onKeyDown);
  };
}, [isOpen]);
```

- `click` ではなく `mousedown` を使うこと（理由は design.md「開閉トリガ」節参照。`click` だとメニュー項目クリック時のバブル順で挙動が壊れる）。
- `Escape` クローズ時はトリガにフォーカスを戻す（アクセシビリティ上のフォーカス迷子防止）。
- 常時購読は避ける（`isOpen` 依存配列で開いている間だけ）。

### Step 5: 人型 SVG アイコン

外部ライブラリを入れずインライン SVG で実装する。heroicons 24/solid の `user` をリファレンスとした単純なシルエットでよい。

- 同じ SVG リテラルを「認証時 + avatar 未設定」と「未認証時」の 2 箇所で使うため、ファイル先頭に小さなローカル関数 `function UserSilhouette({ className }: { className?: string })` を切ると重複が減る。
- `aria-hidden="true"` を付与し、ラベル情報はトリガボタンの `aria-label` で表現する。
- 新規 npm 依存（`@heroicons/react` 等）は **追加禁止**。SVG リテラルを直書きすること。

### Step 6: フォーカス・配色・トーンの当て込み

- フォーカスリング：`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50` を基本に。
- メニュー項目 hover：`hover:bg-stone-100 hover:text-stone-900`。
- 配色は **stone と brand-700/800 のみ**。`brand-500` を絶対に使わないこと。
- ログアウトは赤系 / rose 系を使わない（温かみトーン維持）。
- breakpoint 修飾子（`sm:` `md:` `lg:` `xl:`）を一切付けないこと。Tailwind クラスはすべて無修飾の単一バリアントで書く。

### Step 7: 動作確認

下記「動作確認シナリオ」を全件パスさせる。リードのチェック前に手元で全シナリオ自己確認すること。

---

## 設計判断の理由

### Client / Server の分割を `HeaderUserMenu.tsx` 単位で切った理由

ドロップダウン開閉は完全にクライアント状態であり、`useState` / `useEffect` / `useRef` が必須。一方、`profiles` 取得は RLS 経由 SELECT を Server で済ませる方が安全（Client に余分な情報を持たせない）。Server で取得 → 表示に必要な最小 Props を Client に渡す形が最も自然で、責務境界も明瞭。

### `createAdminClient` ではなく `createSessionClient` を使う理由

MEDIUM-001 で確立済みの方針「Server Component の `profiles` 読み取りは RLS 二層防御」に整合させる。`avatar_url` / `display_name` は機微列ではないため、`profiles` の自分自身行ポリシー（FEAT-002 で設定済み）で通る。新規 RLS は不要。

### 外側クリック検知に `mousedown` を使う理由

`click` イベントでは、メニュー項目 `<Link>` クリック時にバブル順序の影響で「閉じる」が先に発火してから遷移処理が走るパターンがあり、項目挙動が不安定になりやすい。`mousedown` + `ref.contains` の組み合わせは React 系の慣用で安定し、外部ライブラリを足さずに済む。

### 矢印キーナビゲーションを必須としない理由

task.md の要件では「必須は Escape のみ」。完全な ARIA メニューパターン（roving tabindex + ↑↓ 移動）は実装コストが高く、Tab 移動でもアクセシビリティ最低限を満たす。本対応では Escape クローズと Tab 到達のみを必須とし、矢印キー対応は将来の改善余地として残す。

### `next/image` ではなく素の `<img>` を使う理由

Supabase Storage のホストを `next.config` の `images.domains` / `remotePatterns` に追加する変更が本対応のスコープ（UI のみ）を超える可能性がある。既存の `app/profile/page.tsx` 等が `<img>` で扱っているなら同じ流儀に揃える（実装時に既存挙動と整合させること）。

### Props を最小集合に絞る理由

Server → Client の境界を越える情報は最小限にする。`user.id` / `email` / `api_key_encrypted` 等を Client に流すと、表示に不要な機微情報がブラウザに露出する。`isAuthenticated` / `avatarUrl` / `displayName` の 3 値（すべて `string | null | boolean`）で UI 要件は満たせるため、それ以上は渡さない。

---

## 実装上の注意事項

- **`supabase/` を開かない・触らない**。RLS / migration / スキーマは本 PR の対象外。
- **`profiles` テーブル構造を変えない**。読み取りのみ。
- **`middleware.ts` を変えない**。認証ガード挙動を不変とする。
- **`tailwind.config.*` を変えない**。カラートークンの追加不可。
- **`package.json` / `package-lock.json` を変えない**。新規 npm 依存禁止。
- **breakpoint 修飾子（`sm:` `md:` `lg:` `xl:`）を一切使わない**。Tailwind クラスはすべて無修飾の単一バリアントで書くこと。
- **`brand-500` を使わない**。`brand-700` / `brand-800` のみ。
- **赤系 / rose 系をログアウト項目に使わない**。stone トーンで統一。
- **`logout` の関数本体を変えない**。`app/actions/auth.ts` を編集する必要は基本ない（import 経路だけ確認すること）。
- **Server → Client Props はシリアライズ可能な値のみ**。Supabase クライアント本体やオブジェクトを Props で渡さない。`string` / `null` / `boolean` に限定。
- **`user.id` を Client に渡さない**。表示に必要な最小集合のみ。
- **既存の Header 利用箇所（`app/layout.tsx`）を変えない**。`<Header />` のシグネチャ（引数なし）を維持。
- **`app/components/HeaderUserMenu.tsx` の冒頭に `"use client";` を必ず書く**。
- **`import { logout } from ...` の import パスは既存ファイルの慣習に合わせる**（相対 or `@/...`）。既存 Header.tsx の import 記法を流用するのが最も安全。
- **`profiles` 取得失敗を例外として扱わない**。`null` フォールバックで握りつぶし、500 を投げない。
- **インライン SVG 直書き**。`@heroicons/react` 等の依存追加は禁止。

---

## 動作確認シナリオ

### 表示確認

- **S1（認証時 + アバター画像あり）**: `profiles.avatar_url` が Supabase Storage の有効 URL に設定されているアカウントでログインし、ヘッダー右にアバター画像が丸型で表示されることを確認。
- **S2（認証時 + アバター画像なし）**: `profiles.avatar_url = null` のアカウントでログインし、人型 SVG が `bg-stone-200` 丸型背景で表示されることを確認。
- **S3（未認証）**: ログアウト状態でトップを開き、人型 SVG が `bg-stone-100` 丸型背景（より淡いトーン）で表示されることを確認。
- **S4（画面幅 375px）**: DevTools で 375 × 667 にして、ロゴとアバターが横並びで干渉なく収まることを確認。横スクロール発生なし。
- **S5（画面幅 768px / 1280px）**: タブレット / PC 幅でも同一 UI（breakpoint 差分なし）。

### ドロップダウン開閉

- **S6（クリック開閉）**: アバターをクリック → メニュー表示。再度クリック → 閉じる。
- **S7（外側クリック）**: メニュー開状態でメニュー外をクリック → 閉じる。
- **S8（Escape）**: メニュー開状態で Escape 押下 → 閉じる。直後にトリガ（アバターボタン）にフォーカスが戻ることを確認（Tab を 1 回押すと次のフォーカス先に進むか）。
- **S9（項目クリックで閉じる）**: メニュー項目 `<Link>` クリックで遷移後、新画面でドロップダウンが閉じている状態であることを確認。

### メニュー項目（認証時）

- **S10（過去のケース遷移）**: 「過去のケース」クリックで `/history` に遷移し従来通り動作。
- **S11（フレンド遷移）**: 「フレンド」クリックで `/friends` に遷移し従来通り動作。
- **S12（プロフィール遷移）**: 「プロフィール」クリックで `/profile` に遷移し従来通り動作。
- **S13（ログアウト）**: 「ログアウト」押下で既存挙動どおりログアウト処理が走り、ルートまたは `/auth/login` にリダイレクトされる。再ログインも従来通り。

### メニュー項目（未認証時）

- **S14（ログイン遷移）**: 「ログイン」クリックで `/auth/login` に遷移。
- **S15（サインアップ遷移）**: 「サインアップ」クリックで `/auth/signup` に遷移。

### アクセシビリティ

- **S16（aria-expanded）**: 開いている間はトリガに `aria-expanded="true"`、閉じている間は `"false"`（DevTools で確認）。
- **S17（role 属性）**: ドロップダウンに `role="menu"`、各項目に `role="menuitem"`、区切り線に `role="separator"`。
- **S18（キーボード到達）**: Tab だけでアバターまで到達できる。Enter / Space で開閉できる。Tab で項目間を移動できる。
- **S19（スクリーンリーダー）**: VoiceOver / NVDA 等でトリガが「アカウントメニューを開く / メニューを開く」とアナウンスされる。

### 配色・トーン

- **S20（カラー検証）**: DevTools の Computed Styles で hover / focus 時の色が `stone-100` / `stone-900` / `brand-700` の範囲内であることを確認。`brand-500` や赤系の混入なし。
- **S21（既存配色との整合）**: 背景 `stone-50`、境界 `stone-200` がフッターや他ページのトーンと食い違わないことを確認。

### リグレッション

- **S22（middleware 認証ガード不変）**: 未認証で保護ルート（例 `/history`）を直接叩くと従来通り `/auth/login` にリダイレクト。
- **S23（layout.tsx 不変）**: `<Header />` 呼び出し位置・Footer 表示位置に変化なし。
- **S24（profiles の他列に影響なし）**: API キー登録画面（`/profile`）で API キーの登録状況表示が従来通り。
- **S25（profiles 取得失敗時のフォールバック）**: 一時的にネットワークを切る等で `profiles` 取得に失敗させても、ヘッダーが 500 を出さず人型 SVG にフォールバックして描画される。

---

## 未解決事項・要確認

1. **アバター画像 `onError` フォールバック**: 初版では `avatarUrl !== null` だけで分岐し、画像読み込み失敗（URL 失効・CORS 等）に対する `onError` フォールバックは入れない。実機で失効頻度が高ければ別 backlog 項目として起票する判断をリードへ伝える。
2. **ドロップダウン横幅**: 推奨は `w-48`。最終決定はビルドの実装時に表示崩れがないか実機確認の上、`w-44` / `w-52` 範囲で微調整可。判断したサイズは PR 説明に明記する。
3. **メニュー上部の「ユーザー識別行」**: `displayName` をドロップダウン上部に小さく表示する案は **省略可**。最小実装ではメニュー項目のみで足り、表示するか否かは既存トーンとの馴染みを見て実装段階で判断してよい（どちらの選択でも task.md 要件は満たす）。判断結果は PR に書く。
4. **`<form action={logout}>` のシグネチャ**: 本バージョン Next.js での Client Component → Server Action の呼び出し方が `node_modules/next/dist/docs/` のドキュメントと一致するか確認すること（`AGENTS.md` 方針）。既存の Server Action 利用箇所が他にあれば書き方を揃える。
5. **`next/image` 採用可否**: 本対応では素の `<img>` を推奨したが、既存コードベースで Supabase Storage 画像を `next/image` で扱っている前例があればそれに揃える。`next.config` の `images` 設定を新規変更する場合はスコープ外として別タスク化する。
6. **矢印キーナビゲーション**: 本対応のスコープ外。Tab 到達と Escape クローズで最低限のキーボードアクセシビリティを担保する。完全な ARIA メニューパターン（roving tabindex + ↑↓ 移動）が必要となった時点で別タスクで対応。
7. **スコープ厳守**: マイページ（FEAT-005）、他ページのレスポンシブ調整、アバターアップロード機能の変更、`profiles` テーブル構造変更、RLS / migration / DB スキーマ変更、ロゴデザイン変更、新規 npm 依存追加、breakpoint 導入、`backlog.md` の他 LOW / FEAT / OPS / MON 項目はすべて本 PR スコープ外。混入させないこと。
