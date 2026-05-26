# アーキ → ビルド 引き継ぎメモ

## タスク概要

FEAT-001（サービス名 `igiari` リネーム）と IMP-002（色調統一）を同一 PR で実施する。API・DB 変更はなし。UI テキストとスタイリングのみの変更。

---

## 実装順序

1. `README.md` の記述更新（ビルドリスクなし・最初に終わらせる）
2. `package.json` の `name` フィールド（任意・影響範囲ゼロ）
3. `app/layout.tsx` の metadata・OGP 更新
4. 各ページの表示テキスト置換（`家庭裁判所`・`Family Court` を全検索してから置換）
5. `tailwind.config.ts` または `globals.css` に `brand` パレット定義（Tailwind v4 の方式に従う）
6. 全コンポーネントの色クラス置換（設計書のマッピング表に従う）

**順序の根拠**: テキスト変更（1〜4）はビルド失敗リスクがゼロのため先行させる。色変更（5〜6）は定義が先に必要なため、パレット定義（5）を色置換（6）より先に行う。

---

## 判断根拠

### なぜ amber 系を brand パレットのベースにするか

要件定義書の「温かみのある・柔らかい雰囲気。対立感・緊張感を煽らない」「赤・強調原色を避ける」という非機能要件から、寒色（青）や強い原色は不適切。amber は明度の幅が広く（50〜900）、背景・アクセント・テキストをすべてカバーできる。また Tailwind 組み込みパレットと同値にすることで、stone との組み合わせ調整や将来のカラー変更が容易になる。

### なぜ gray-\* → stone-\* とするか

`gray-*`（クールグレー）は青みを帯びており、amber/orange 系の brand パレットと並べたときに色調の乖離が生じる。`stone-*`（ウォームグレー）は中性〜暖色の傾きがあり、brand パレットとの視覚的親和性が高い。

### なぜ `brand` エイリアスを使うか

amber-500 を直接使うと将来ブランドカラーが変わったときに全コンポーネントの書き換えが必要になる。`brand-500` というエイリアスを一箇所で定義しておけば、トークン値の変更のみで全体に反映できる。

---

## 注意事項（実装前に必ず確認）

### Next.js のバージョン差異（最重要）

環境定義書では Next.js **16.2.6**（要件定義書には 14 と記載があるが環境定義書が正）。AGENTS.md に「This is NOT the Next.js you know... Read the relevant guide in `node_modules/next/dist/docs/` before writing any code.」と明記されている。

`app/layout.tsx` の `Metadata` 型・`metadata` export の書き方・OGP の設定方法などが v14 と異なる可能性があるため、**実装前に `node_modules/next/dist/docs/` を確認すること**。

### Tailwind v4 の設定方式（カラーパレット定義）

環境は Tailwind CSS **4.x**。v4 ではカスタムカラーの定義方式が v3 から変わっている。

プロジェクトの `tailwind.config.ts` と `app/globals.css` を先に読んで現行方式を把握してから実装すること。

**v4 方式（`globals.css` に `@theme` ディレクティブ）**:

```css
@import "tailwindcss";

@theme {
  --color-brand-50: #fffbeb;
  --color-brand-100: #fef3c7;
  --color-brand-200: #fde68a;
  --color-brand-300: #fcd34d;
  --color-brand-400: #fbbf24;
  --color-brand-500: #f59e0b;
  --color-brand-600: #d97706;
  --color-brand-700: #b45309;
  --color-brand-800: #92400e;
  --color-brand-900: #78350f;
}
```

**v3 方式（`tailwind.config.ts` の `theme.extend.colors`）**:

```ts
theme: {
  extend: {
    colors: {
      brand: {
        50: '#fffbeb',
        100: '#fef3c7',
        200: '#fde68a',
        300: '#fcd34d',
        400: '#fbbf24',
        500: '#f59e0b',
        600: '#d97706',
        700: '#b45309',
        800: '#92400e',
        900: '#78350f',
      },
    },
  },
},
```

v4 では `tailwind.config.ts` が無視される構成になっている場合がある。プロジェクトの実際の動作方式を確認してから選択すること。

### 文字列置換の網羅性

`家庭裁判所`・`Family Court`・`family-court`（package.json 等）を全ファイルで検索し、ヒット箇所をすべて確認してから置換する。`template literal` や動的文字列として埋め込まれている箇所も見逃さないこと。コメント・JSDoc も対象。

### ステータス系カラーは変更しない

`red-*`（エラー）、`green-*`（成功）など、状態を意味する色は変更しない。デザイン上の見た目の問題があっても、今回の変更対象は「青系・グレー系」の UI カラーのみ。

### `stone-*` パレットの利用可否確認

Tailwind v4 での `stone-*` の組み込み状況を確認すること。利用できない場合は `@theme` で同値の CSS 変数を定義して補完する。

---

## 未解決事項（実装時に判断が必要な箇所）

### 1. キャッチコピーの文言

`metadata.description` や UI 上のサブテキストの具体的な文言は設計書の対象外。「温かみのある・柔らかい雰囲気」「裁判形式の話し合い」という要件定義書の方針に沿って作成すること。

### 2. OGP 画像の alt テキスト

現行に `og:image` が設定されている場合、画像ファイル内のテキスト変更はスコープ外だが、`og:image:alt` など HTML 属性として存在する alt テキストは更新対象。現行コードを確認し、該当箇所があれば更新すること。

### 3. `gray-*` の用途判断

`gray-*` のうちニュートラルなもの（ボーダー・テキスト）は `stone-*` に、アクセント的な用途のものは `brand-*` に振り分ける。判断が難しい場合は `stone-*` を優先する。
