# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: BUG-007 — ログイン成功後にページ遷移しない問題の修正
**日時**: 2026-06-15
**ブランチ**: fix/bug007-login-redirect
**PR**: #44
**特記**: 本タスクはリードが先行実装を済ませた状態でテスタ・オーディに渡している。アーキ・ビルドは省略。リードが実装した差分の妥当性検証と E2E spec 追加が本パイプラインの主目的。

由来: `docs/backlog.md` の BUG-007、`docs/knowledge/design.md ## BUG-007 対応`。

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `app/auth/login/page.tsx` | 変更 | (1) `router.push("/")` 直後の `router.refresh()` 呼び出しを削除 (2) `useSearchParams()` を導入し `searchParams.get("next") \|\| "/"` で遷移先を解決 (3) エラー処理を `else` から `if (error) { ...; return; }` の early return に整理 |

差分: `+9 / -4`。

---

## 設計判断と注意事項

### `router.refresh()` を削除した根拠

`router.push(target)` の後に `router.refresh()` を呼ぶと、`refresh` が **current page**（push 前の login ページ）の Server Component を再描画する挙動を取り、結果として「push による遷移効果を打ち消す」「current page の Server Component だけが新しい auth cookie で再描画される」状態になっていた疑い。これがダイチが報告した「ステータス（ヘッダー等）はログイン後の状態に切り替わるが、ページ遷移しない」症状と整合する。

`router.refresh()` を削除しても、push 先（`/` 等）のページが新規に server-render される際に最新の auth cookie が読まれるため、Server Component の最新化は引き続き機能する。current page を強制再描画する必要性はない。

### `next` パラメータ対応の独立性

`useSearchParams().get("next")` が `null` の場合は `"/"` にフォールバックする。middleware（`middleware.ts:38`）の `/auth/login` リダイレクト時に `next` パラメータを付ける改修は本 PR のスコープ外で、middleware 側を別 PR で改修した時点で自動的に有効化される前方互換構成。

### Next 16 の Suspense 要件

`useSearchParams()` を client component で使うと build 時に Suspense 境界の警告が出る可能性があるが、既存の `app/case/[id]/CaseRoom.tsx` が同パターン（Suspense なしの client component で `useSearchParams`）でビルド通過しているため、本 PR でも同パターンを採用。Vercel preview build が SUCCESS を返せば問題なし。

### `next` の open redirect 観点

`router.push(next)` で外部 URL（例: `?next=https://evil.example.com`）を渡されると、外部ドメインに遷移するリスクが理屈上ある。ただし Next.js の `router.push` は内部パス前提の API のため、外部 URL を渡しても無視されるか、内部パスとして解釈される（`https://...` を path として扱う）挙動が一般的。本 PR では追加のサニタイズは入れていないが、オーディが open redirect の懸念を指摘した場合は `next` が `/` で始まる相対パスのみを許可する追加ガードを検討する。

---

## テスト観点（テスタへの引き継ぎ）

1. **通常ログイン**: `e2e_user_a@example.com` / `E2eTest123!` で `/auth/login` から signin → URL が `/` または middleware による振り分け先に変わり、login ページに留まらないこと。
2. **`?next=` 付きログイン**: `/auth/login?next=/history` を開いて signin → `/history` に遷移すること。
3. **誤ったパスワード**: 既存のエラーメッセージ「メールアドレスまたはパスワードが違います」表示が崩れないこと（リグレッション確認）。

E2E 実行環境: `TEST_MODE=1` 経由で `.env.test` を読み、テスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー（`e2e_user_a` / `e2e_user_b`）は既にテスト DB に存在する。

---

## 監査観点（オーディへの引き継ぎ）

design.md `## BUG-007 対応 → 監査観点` セクションに記載した 3 点を中心に確認すること。要点:

1. `router.refresh()` 削除による副作用の有無（push 先での Server Component 再描画が機能しているか）
2. `useSearchParams()` の Next 16 Suspense 要件への抵触の有無
3. `next` パラメータの open redirect 脆弱性の有無
