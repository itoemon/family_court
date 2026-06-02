# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-RESP-HEADER — ヘッダーをアバター起点のドロップダウンメニュー方式に刷新（全画面サイズ統一）
**日時**: 2026-06-02
**ブランチ**: feature/20260602-095634

由来: `docs/backlog.md` の `[FEAT-RESP-HEADER] ヘッダーのレスポンシブ対応（スマホ最適化）`

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `app/components/Header.tsx` | 変更（リファクタ） | Server Component。`createSessionClient` で `profiles.avatar_url` / `display_name` を取得し、`<HeaderUserMenu />` に Props 渡し。横並びリンク `<nav>` および Server Component 内ローカル `'use server'` 関数（`handleLogout`）を撤去 |
| `app/components/HeaderUserMenu.tsx` | 新規（Client Component） | アバタートリガ＋ドロップダウンメニュー。`isOpen` 状態、外側クリック（`mousedown`）・Escape クローズ、`role="menu"` / `role="menuitem"` / `aria-expanded` / `aria-controls` / `aria-haspopup` 付与、ログアウト `<form action={logout}>` 描画 |

**触っていないファイル（設計どおりスコープ外）**:

- `app/actions/auth.ts`（既存 `logout` を import のみ。関数本体は不変）
- `app/layout.tsx`（`<Header />` 呼び出し位置・シグネチャ不変）
- `middleware.ts`
- `supabase/` 配下すべて（RLS・migration・スキーマ）
- `profiles` テーブル
- `package.json` / `package-lock.json`（新規 npm 依存なし）
- `tailwind.config.*` 等の Tailwind 設定（カラートークン追加なし）
- ヘッダー以外のページ・コンポーネント

---

## 実装上の判断・設計書からの逸脱

設計書（`docs/knowledge/design.md`「FEAT-RESP-HEADER 対応」）と引き継ぎメモ（`arch-to-eng.md`）に忠実に実装した。**設計からの逸脱なし**。実装段階で判断した点を以下に列挙する。

1. **ドロップダウン横幅**: 設計推奨の `w-48` を採用。実機で表示崩れが見つかれば `w-44`〜`w-52` で微調整可（arch-to-eng.md 未解決事項 2）。

2. **メニュー上部の「ユーザー識別行」**: 設計どおり **省略**。`displayName` はアバター画像 `alt` 属性とトリガ `aria-label` 経由でのみ表現する。最小実装に留め、必要なら別タスクで追加可（arch-to-eng.md 未解決事項 3）。

3. **アバター画像 `onError` フォールバック**: 設計どおり **初版未実装**。`avatarUrl !== null` の Props 判定のみで分岐し、Supabase Storage URL の失効が実機で頻発するようなら別 backlog で対応（arch-to-eng.md 未解決事項 1）。

4. **画像コンポーネント**: 設計どおり素の `<img>` を採用（`next/image` 不使用）。`next.config` の `images.remotePatterns` 変更を避けるため、本対応のスコープに収めた。ESLint の `@next/next/no-img-element` は当該 1 行のみ disable コメントで抑制。
   - 既存の `app/profile/page.tsx` は `next/image` を使っているが、本対応では `next.config` 設定変更を避けるため流儀を揃えなかった（arch-to-eng.md 未解決事項 5）。設計判断（arch-to-eng.md「`next/image` ではなく素の `<img>` を使う理由」）に従う。

5. **人型 SVG**: 設計どおりインライン SVG をローカル関数 `UserSilhouette({ className })` として直書き。`@heroicons/react` 等の npm 依存は **追加しない**。`aria-hidden="true"` を付与し、ラベル情報はトリガ `aria-label` で表現。

6. **`logout` Server Action の呼び出し**: 既存 `app/components/LogoutButton.tsx`（Client Component）が同パターン（`'use client'` + `import { logout } from '@/app/actions/auth'` + `<form action={logout}>`）を採用済み。本バージョン Next.js での Client Component → Server Action 呼び出しシグネチャとして同一に揃えた。`logout` 関数本体は不変（arch-to-eng.md 未解決事項 4）。

7. **`profiles` 取得失敗時のフォールバック**: Server Component 側で `single()` の結果が `null` の場合に `avatarUrl: null` / `displayName: null` で握りつぶす分岐を明示。500 は投げない（design.md「セキュリティ設計 / profiles 取得経路」）。

8. **Server → Client Props の最小化**: `isAuthenticated` / `avatarUrl` / `displayName` の 3 値のみ（すべて `string` / `null` / `boolean`）。`user.id` / `email` / `api_key_encrypted` 等の機微情報は **渡していない**（design.md「Server / Client 間の情報受け渡し」）。

9. **外側クリック検知**: 設計どおり `mousedown` + `ref.contains` を採用（`click` ではない）。`isOpen === true` の間だけ document に登録し、cleanup で `removeEventListener`（常時購読を避け副作用最小化）。

10. **Escape クローズ時のフォーカス戻し**: トリガボタンに `buttonRef.current?.focus()` でフォーカスを戻す（フォーカス迷子防止）。

11. **配色**: `stone-50` / `stone-100` / `stone-200` / `stone-600` / `stone-700` / `stone-900` および `brand-700`（フォーカスリングのみ）に限定。`brand-500` は **不使用**。ログアウトに赤系 / rose 系は **不使用**（stone トーン統一）。

12. **breakpoint**: `sm:` / `md:` / `lg:` / `xl:` を **一切使用していない**（grep で 0 件確認）。全画面サイズで同一の見た目。

---

## テスタ・オーディへの注意点

### 前提条件

- **DB / migration の適用は不要**。本 PR は **アプリケーションコードのみ**（`app/components/` 2 ファイルのみ変更）。`supabase/` 配下・RLS・スキーマには一切手を加えていない。
- `profiles` の自分自身行 SELECT は FEAT-002 で既設の RLS で通る前提（新規 RLS なし）。
- 既存 `app/actions/auth.ts` の `logout` Server Action は完全に不変。挙動も従来どおり（成功時 `redirect('/')`、失敗時 `flash_error` Cookie 経由のエラー表示）。

### 重点確認シナリオ（arch-to-eng.md S1〜S25 準拠）

#### 表示確認

| シナリオ | 期待される挙動 |
|---|---|
| S1 認証時 + avatar_url あり | ヘッダー右にアバター画像が丸型（32×32）で表示 |
| S2 認証時 + avatar_url なし | 人型 SVG が `bg-stone-200` 丸型背景＋`text-stone-600` で表示 |
| S3 未認証 | 人型 SVG が `bg-stone-100`（より淡い）丸型背景＋`text-stone-500` で表示 |
| S4 375×667 | ロゴとアバターが横並びで干渉なく収まる。横スクロール発生なし |
| S5 768 / 1280 | 同一 UI。breakpoint 差分なし |

#### ドロップダウン開閉

| シナリオ | 期待される挙動 |
|---|---|
| S6 クリック開閉 | アバタークリックで開閉トグル |
| S7 外側クリック | メニュー開状態で外側 `mousedown` → 閉じる |
| S8 Escape | Escape 押下で閉じ、直後にトリガにフォーカスが戻る（Tab 1 回で次フォーカスに進む） |
| S9 項目クリック | `<Link>` クリック後、遷移先で `isOpen` 初期値 `false`（コンポーネント再マウント）のため自動的に閉じている |

#### メニュー項目（認証時）

| シナリオ | 期待される挙動 |
|---|---|
| S10 過去のケース | `/history` 遷移、従来通り |
| S11 フレンド | `/friends` 遷移、従来通り |
| S12 プロフィール | `/profile` 遷移、従来通り |
| S13 ログアウト | 既存 `logout` Server Action 実行 → `redirect('/')`。再ログインも従来通り |

#### メニュー項目（未認証時）

| シナリオ | 期待される挙動 |
|---|---|
| S14 ログイン | `/auth/login` 遷移 |
| S15 サインアップ | `/auth/signup` 遷移 |

#### アクセシビリティ

| シナリオ | 期待される挙動 |
|---|---|
| S16 aria-expanded | 開いている間 `"true"`、閉じている間 `"false"`（DevTools で確認） |
| S17 role 属性 | メニュー本体に `role="menu"`、各項目に `role="menuitem"`、区切り線に `role="separator"` |
| S18 Tab 到達 | Tab だけでアバターまで到達可。Enter / Space で開閉。Tab で項目間移動可 |
| S19 スクリーンリーダー | トリガが `aria-label`（認証時「アカウントメニューを開く」/ 未認証時「メニューを開く」）でアナウンス |

#### 配色・トーン

| シナリオ | 期待される挙動 |
|---|---|
| S20 カラー検証 | hover / focus 時の色が `stone-100` / `stone-900` / `brand-700` の範囲内。`brand-500` / 赤系の混入なし |
| S21 既存配色整合 | 背景 `stone-50`、境界 `stone-200` がフッターや他ページのトーンと食い違わない |

#### リグレッション

| シナリオ | 期待される挙動 |
|---|---|
| S22 middleware 不変 | 未認証で `/history` 等保護ルートを直接叩くと従来通り `/auth/login` にリダイレクト |
| S23 layout.tsx 不変 | `<Header />` 呼び出し位置・Footer 表示位置に変化なし |
| S24 profiles 他列 | `/profile` で API キー登録状況表示が従来通り（本対応で `profiles` の他列に影響なし） |
| S25 profiles 取得失敗 | ネットワーク切等で `profiles` 取得失敗時にヘッダーが 500 を出さず人型 SVG にフォールバック |

### 確認時の留意事項

- **画像読み込み失敗時の `onError` フォールバック未実装**: `profiles.avatar_url` の URL が失効・CORS 失敗で読めない場合、ブラウザ既定の壊れ画像表示になる。`onError` フォールバックは設計どおり初版未対応のため、再現したら別 backlog 化を検討（リードへ報告）。
- **ドロップダウン横幅 `w-48`**: 表示崩れがあれば PR コメントで報告（`w-44` / `w-52` 範囲で微調整可）。
- **`<form action={logout}>` の `onSubmit`**: `setIsOpen(false)` を呼んでから Server Action 実行 → サーバ側 redirect で遷移するため、ユーザー視点では一瞬で閉じてリダイレクトされる。途中の閉じ動作は視認しづらい想定。
- **型・lint**: `npx tsc --noEmit`（エラーゼロ）および `npx eslint app/components/Header.tsx app/components/HeaderUserMenu.tsx`（エラーゼロ）を確認済み。リポジトリ全体の `npm run lint` には**既存の無関係なエラー**（`app/case/[id]/page.tsx` の `react-hooks/set-state-in-effect`、`tests/e2e/*.spec.ts` の `@typescript-eslint/no-explicit-any`）が残存しているが、いずれも本 PR で導入したものではない。

---

## 未実装・スコープ外にしたこと

| 項目 | 理由 |
|---|---|
| マイページ実装（FEAT-005） | task.md・設計書で明示的に別タスク |
| ヘッダー以外のページ・コンポーネントのレスポンシブ調整 | スコープ外（別タスクで実機検証） |
| アバターアップロード機能の変更 | FEAT-002 で完了済み・スコープ外 |
| `profiles` テーブル構造の変更 | スコープ外 |
| RLS / migration / DB スキーマの変更 | スコープ外（`supabase/` 配下未変更） |
| ロゴデザイン・サービス名表記の変更 | スコープ外 |
| 新規 npm 依存追加（`@heroicons/react` 等のヘッドレス UI ライブラリ） | task.md で禁止。SVG 直書きで対応 |
| breakpoint 修飾子（`sm:` `md:` `lg:` `xl:`）導入 | task.md で禁止。全画面サイズ同一 UI 方針 |
| 矢印キーによるメニュー項目間移動・完全な WAI-ARIA roving tabindex | スコープ外（必須は Escape のみ）。Tab 移動と Escape クローズで最低限のキーボードアクセシビリティを担保 |
| アバター画像 `onError` フォールバック | 設計どおり初版未実装。実機で実害があれば別タスク化 |
| `next/image` 採用および `next.config` の `images` 設定変更 | スコープ外。素の `<img>` で対応 |
