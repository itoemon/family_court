# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。**既存の設計（FEAT-001〜FEAT-003、MEDIUM-001、LOW バッチ等、過去 PR の設計）を絶対に削除・短縮しないこと**。本タスクの内容は `design.md` の末尾に新規セクションとして **追記** すること（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは UI のみの改修である。RLS / migration / DB スキーマには **一切手を加えない**。新規 npm 依存も追加しない。

## 今回のタスク

ヘッダーをアバター起点のドロップダウンメニュー方式に刷新し、全画面サイズ（PC・タブレット・スマートフォン）で一貫した表示にする **設計と実装**。

**バックログ ID**: `FEAT-RESP-HEADER`（`docs/backlog.md` 参照）

---

### 背景

- 現状の `app/components/Header.tsx` は認証時に「過去のケース / フレンド / プロフィール / ログアウト」の 4 リンクを `flex gap-4` で横並びに配置している。
- 横並びテキストリンクのため、スマートフォン幅（375–390px）でロゴと干渉し、折り返しまたは溢れが発生する。
- プロジェクト全体で Tailwind の `sm:` `md:` `lg:` ブレークポイントが現状一切使われておらず（grep で 0 件）、本対応では breakpoint を持ち込まない方針で「全画面サイズで同じ UI」へ統一する。

---

### 要件（リード確定事項）

#### 1. レイアウト（全画面サイズ統一）

- ヘッダーは「ロゴ（左） + アバター（右）」の 2 要素のみで構成する。
- アバターをクリック（タップ）するとドロップダウンメニューが展開する。
- 横並びテキストリンクは廃止する。breakpoint は使用しない。

#### 2. アバターの表示

| 状態 | 表示 |
|------|------|
| 認証時 (`profiles.avatar_url` が設定済み) | アバター画像を丸型表示 |
| 認証時 (`profiles.avatar_url` が未設定) | 人型シルエットアイコンを丸型背景で表示 |
| 未認証時 | 人型シルエットアイコンを薄いグレー背景で表示 |

- アバター画像は `profiles.avatar_url`（FEAT-002 で実装済み、Supabase Storage の `avatars` バケット）から取得する。
- 人型アイコンは SVG（heroicons `user` 相当）またはインライン SVG。新規 npm 依存は追加しない。

#### 3. ドロップダウンメニュー項目

**認証時**:
1. 過去のケース (`/history`)
2. フレンド (`/friends`)
3. プロフィール (`/profile`)
4. 区切り線
5. ログアウト（Server Action 経由、既存 `app/actions/auth.ts` の `logout()` を再利用）

**未認証時**:
1. ログイン (`/auth/login`)
2. サインアップ (`/auth/signup`)

#### 4. ドロップダウンの挙動

- アバターボタンをクリックすると開閉トグル。
- メニュー外側クリックで閉じる。
- `Escape` キーで閉じる。
- メニュー項目をクリックすると遷移後（または Server Action 実行後）に閉じる。
- 開いている間、アバターボタンに `aria-expanded="true"` を付与する。
- メニューには `role="menu"`、項目には `role="menuitem"` を付与する。
- フォーカスリングは既存配色トーン（`brand-*` / `stone-*`）に合わせる。

#### 5. 配色・トーン

- 既存トーンを踏襲する: 背景 `bg-stone-50`、境界 `border-stone-200`、テキスト `text-stone-600/800`。
- アクセントは `brand-700/800`（`brand-500` は WCAG 非対応で不使用）。
- 区切り線や hover 背景は既存パレットの範囲内で選定する。
- 新規カラートークンは追加しない。

---

### 解決すべき設計上の課題

#### A. Server / Client 境界の設計

- 現行 `Header.tsx` は Server Component（`async` + `createSessionClient`）。
- ドロップダウンの開閉はクライアントインタラクションのため、Client Component に分割する必要がある。
- 設計指針:
  - 親 (Server): user / profile の取得を担当し、Props（認証状態・アバター URL・表示名 など必要最小限）を子に渡す。
  - 子 (Client, 例: `app/components/HeaderUserMenu.tsx`): ドロップダウン制御と項目描画を担当。
- 子コンポーネントの命名・配置（`app/components/` 直下か `_components/` 配下か）はアーキが既存構成（`app/components/Header.tsx` の隣に置く慣例）に合わせて決定する。

#### B. ログアウトの Server Action 呼び出し

- 既存実装は Server Component 内に `'use server'` 関数を定義し `<form action={handleLogout}>` で呼んでいる。
- Client Component から Server Action を呼ぶ場合は、`app/actions/auth.ts` の `logout` を直接 import して `<form action={logout}>` する形が最短。挙動を変えないこと。

#### C. プロフィール取得クエリの追加

- 現行 Header は `auth.getUser()` のみ。`profiles.avatar_url` `profiles.display_name` を読むクエリを追加する。
- `createSessionClient`（RLS 経由）で `profiles` テーブルを `select("avatar_url, display_name").eq("id", user.id).single()` する形を採用する（`createAdminClient` は使用しない。MEDIUM-001 の二層防御方針に整合）。
- 取得失敗時は人型アイコンへフォールバックする（500 を投げない）。

#### D. アクセシビリティ

- WAI-ARIA メニューパターンに準拠する（最低限、上記 4 の `aria-expanded` / `role="menu"` / `role="menuitem"` を満たす）。
- キーボード操作: アバターボタン Tab で到達 → Enter / Space で開閉 → 矢印キーは任意（実装コストとのバランスでアーキ判断、必須は Escape のみ）。

---

### スコープ外（重要）

- マイページ実装は別タスク（FEAT-005、backlog 参照）。今回は触らない。
- ヘッダー以外のコンポーネント・ページのレスポンシブ調整は **行わない**（実機検証は別タスクで実施）。
- アバターアップロード機能・`profiles` テーブル構造の変更は行わない（FEAT-002 で完了済み）。
- RLS / migration / DB スキーマの変更は一切行わない。
- 新規 npm 依存の追加は行わない（ヘッドレス UI ライブラリ等）。
- breakpoint（`sm:` `md:` `lg:`）の導入は行わない。
- ロゴデザイン・サービス名表記の変更は行わない。

---

### 期待する設計成果物

#### 1. `docs/knowledge/design.md` への **追記**（既存内容は保持）

末尾に以下のセクションを **追加** する（既存の章は一切変更しないこと）。

```
## FEAT-RESP-HEADER 対応: ヘッダーをアバター起点のドロップダウンメニュー方式に刷新

### 概要
（目的・背景・全画面サイズ統一の方針）

### 影響範囲
- app/components/Header.tsx（Server Component、リファクタ）
- app/components/HeaderUserMenu.tsx（新設、Client Component。命名・配置はアーキ確定）
- app/actions/auth.ts（既存 logout 関数を Client から参照、関数本体は不変）

### コンポーネント設計
- Server Component の責務（user + profile 取得、Props 受け渡し）
- Client Component の責務（ドロップダウン状態管理、外側クリック検知、Escape ハンドリング、項目描画）
- アバター表示の状態分岐（avatar_url あり / なし / 未認証）

### アクセシビリティ設計
- aria-expanded / role="menu" / role="menuitem"
- Escape クローズ
- フォーカスリングの配色

### 制約・前提条件
- 新規 npm 依存なし
- breakpoint なし（全画面サイズ統一）
- DB / RLS は触らない
- 配色は既存 stone/brand トーンに限定
```

#### 2. `docs/knowledge/handoff/arch-to-eng.md` の更新

ビルドへの引き継ぎメモ。以下を含める:
- Server / Client 分割の手順
- `profiles` クエリ追加（`createSessionClient` 経由、フォールバック方針）
- 外側クリック検知の実装方針（`useEffect` + `mousedown` + `ref.contains` で十分。ライブラリ不要）
- Escape ハンドリングの実装方針
- Server Action（logout）を Client から呼ぶ際の form 構成
- リグレッション確認シナリオ（認証時 / 未認証時 / avatar_url 未設定時の表示確認、各メニュー項目の遷移確認、ログアウトの動作確認）

---

### 制約・前提

- **`design.md` は永続資料**: 既存セクション（FEAT-001〜FEAT-003、MEDIUM-001、LOW バッチ等）は **絶対に削除しない**。末尾に追記すること。
- RLS / migration / DB スキーマは一切変更しない。
- 新規 npm 依存を追加しない。
- breakpoint（`sm:` `md:` `lg:`）を導入しない。本対応は全画面サイズで同じ UI とする方針。
- 配色は既存 `stone-*` / `brand-700/800` の範囲で完結させる。`brand-500` は使用しない。
- ログアウトの挙動（Server Action）は不変とする。
- 認証チェック・ガード（middleware 含む）の挙動を変更しない。

---

### 関連ファイル

- `app/components/Header.tsx`（リファクタ対象）
- `app/actions/auth.ts`（既存 `logout` を再利用）
- `app/profile/page.tsx`（`profiles` テーブル参照例、設計の参考）
- `lib/types.ts`（`profiles` の型定義: `avatar_url` / `display_name`）
- `lib/supabase/server.ts`（`createSessionClient`）
- `app/layout.tsx`（`<Header />` 呼び出し箇所、参照のみ）
- `docs/knowledge/design.md`（設計書、**末尾に追記**）
- `docs/backlog.md`（FEAT-RESP-HEADER の起源）
