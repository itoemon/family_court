# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-001（igiari リネーム）+ IMP-002（色調統一）
**日時**: 2026-05-26

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `app/globals.css` | 変更 | `@theme` ブロックで brand-50〜brand-900 を定義 |
| `app/layout.tsx` | 変更 | metadata.title / description を igiari ブランドに更新、openGraph 追加 |
| `app/components/Header.tsx` | 変更 | 「家庭裁判所」→「igiari」 |
| `app/components/Footer.tsx` | 変更 | 「家庭裁判所」→「igiari」 |
| `app/page.tsx` | 変更 | 見出し「家庭裁判所」→「igiari」、rose→brand（ボタン・フォーカス・アイコン背景） |
| `app/auth/login/page.tsx` | 変更 | サブテキスト更新、rose→brand（ボタン・フォーカス・アイコン・リンク） |
| `app/auth/signup/page.tsx` | 変更 | rose→brand（ボタン・フォーカス・アイコン・リンク） |
| `app/profile/page.tsx` | 変更 | rose→brand（ボタン・フォーカス・アイコン）。エラー色は維持 |
| `app/case/[id]/page.tsx` | 変更 | indigo→brand（原告・参加画面）、rose→brand（待機中招待ボタン）、pre-existing lint 修正 |
| `app/case/[id]/verdict/page.tsx` | 変更 | indigo→brand（原告判決バナー・スコアバー・バブル） |
| `README.md` | 変更 | igiari ブランドに合わせて書き直し |
| `package.json` | 変更 | `name` を `igiari` に変更 |

---

## 実装上の判断・設計書からの逸脱

### G-1: サービス名リネーム

- 設計書の対象ファイルをすべて修正した。
- `app/layout.tsx` に `openGraph` フィールドを追加（設計書の metadata サンプルに含まれていたため追加）。
- キャッチコピーは「大切な人とおだやかに話し合える場所 — AI 裁判官が判決を下す」とした（「温かみ・裁判形式」「対立感を煽らない」要件を両立する文言）。
- `package-lock.json` の `name` フィールドは変更していない（`npm install` 実行時に自動更新される）。

### G-2: 色調統一

- Tailwind v4 + `tailwind.config.ts` なしの構成を確認。`app/globals.css` の `@theme` にブランドパレットを定義した。
- `gray-*` は実コードに存在せず（すでに `stone-*` へ移行済み）。変更不要。
- `blue-*` も実コードに存在せず。代わりに `indigo-*`（原告ロール・参加画面）が使われていたため、これを `brand-*` へ置換した。
- `rose-*` は複数の用途で使われていた。以下のように扱いを分けた:
  - **変更した箇所**: 主要アクションボタン（ホーム・ログイン・サインアップ・プロフィール画面）、フォームフォーカスリング、一次リンク → `brand-*` へ置換
  - **維持した箇所**: 被告ロール（対話バブル・チップ・送信ボタン）— 原告（brand 色）と被告（rose 色）を視覚的に区別するための設計的判断。エラー表示（ErrorBanner・フォームエラー段落）— ステータス色として機能するため維持。
- `teal-*`（弁護人AI タブ・チャット）、`amber-*`（審議中スピナー・矛盾警告）、`emerald-*`（保存成功メッセージ）は今回スコープ外の既存色として変更しなかった。

### 付随修正（スコープ外だが触れたファイルのクリーンアップ）

`app/case/[id]/page.tsx` に pre-existing lint エラーが 2 件あった:
1. `ContradictionWarning` 型が import されていたが未使用 → 削除
2. `react-hooks/set-state-in-effect` 警告（`useEffect` 内で `fetchDefenseMessages()` を直接呼び出している）→ このファイルで既に使われているパターン（`// eslint-disable-next-line`）で抑制

---

## テスタ・オーディへの注意点

### 重点確認ポイント

1. **`brand-*` クラスの描画確認**: `@theme` ディレクティブで定義した CSS 変数が正しく Tailwind クラスとして認識されているか。ブラウザ DevTools で `--color-brand-500` が解決されているか確認すること。

2. **被告バブルと原告バブルの色区別**: 裁判ルーム（`/case/[id]`）で原告（amber系）と被告（rose系）のバブルが視覚的に区別できること。

3. **エラー表示の維持**: フォームエラー（login・signup・profile・ケース画面）の `rose-*` スタイルが意図通り表示されること。`ErrorBanner` のスタイルが維持されていること。

4. **`igiari` 表記の網羅性**: UI 上・メタタグ（ブラウザのタブタイトル・OGP）で「家庭裁判所」が残っていないこと。`docs/agents/tester.md` の E2E テストが `toHaveTitle(/家庭裁判所/)` を参照している可能性があるため、テストコードの更新要否を確認すること。

5. **白テキスト on brand-500**: プライマリボタン（`bg-brand-500 text-white`）の可読性。amber-500（#f59e0b）は明るい黄色のため、白テキストとのコントラスト比が低い可能性がある。視覚確認を推奨。

### セキュリティ観点

本変更はテキストとスタイリングのみ。認証・認可・入力検証・API ロジックへの影響なし。

---

## 未実装・スコープ外

| 項目 | 理由 |
|---|---|
| ロゴ画像・ファビコンの新規作成 | task.md でスコープ外 |
| ドメイン取得・Supabase プロジェクト名変更 | task.md でスコープ外 |
| `package-lock.json` の `name` 更新 | `npm install` 後に自動反映 |
| `tests/e2e/` の pre-existing lint エラー | 書き込み権限外（@typescript-eslint/no-explicit-any 12 件） |
