# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。既存の設計（FEAT-001〜FEAT-006、MEDIUM-001、LOW バッチ、FEAT-RESP-HEADER、BUG-002/003 等、過去 PR の設計）を絶対に削除・短縮しないこと。本タスクの内容は `design.md` の末尾に新規セクションとして追記済み（`## BUG-007 対応`）であり、再度追記し直す必要はない（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは **リードが先行実装を済ませた状態でテスタ・オーディに渡している**。アーキ・ビルドは省略する。テスタは E2E spec 追加と実行、オーディはリード実装の差分監査が主目的。

## 今回のタスク

`/auth/login` でメール+パスワードを入力して「ログイン」を押した際に、認証は成功するがページ遷移が発生せず、ヘッダー等の UI ステータスだけがログイン後の状態に切り替わってログインページに留まる症状を修正する。

**バックログ ID**: `BUG-007`（`docs/backlog.md` 参照）
**PR**: #44（ブランチ `fix/bug007-login-redirect`、HEAD `3fbc528`）

---

### 背景

2026-06-15 ダイチが手動確認で発見した症状。`app/auth/login/page.tsx` の signin 成功後ハンドラに 2 つの問題が同居していた。

1. `router.push("/")` 直後の `router.refresh()` が後勝ちして current page（login）の Server Component を再描画してしまい、push の遷移効果を打ち消していた疑い。
2. `next` クエリパラメータが解釈されておらず、常に `"/"` 固定で遷移していた。

---

### 修正方針（実装済み）

`app/auth/login/page.tsx` の `handleLogin` 関数を以下のように修正済み（PR #44 差分: `+9 / -4`）。

1. `router.refresh()` の呼び出しを削除。push 先（`/` 等）が新しい auth cookie で server-render される際に Server Component の最新化が起きるため、current page を強制再描画する必要はない。
2. `useSearchParams()` を導入し、`searchParams.get("next") || "/"` で遷移先を解決。`?next=` が付いていない場合は従来通り `"/"` にフォールバックする。
3. エラー時の処理を `else { ... }` から `if (error) { ...; return; }` の early return に整理。可読性向上。

---

### スコープ外（本 PR で扱わない）

- **middleware（`middleware.ts:38`）の `next` パラメータ付与**: 現状 middleware は `/auth/login` リダイレクト時に `next` クエリを付けていない。これは別タスクとして残し、本 PR では login 側のフォールバック先柔軟性のみを担保する（前方互換）。
- **ログアウト後のリダイレクト先処理**: signout が同様の問題を抱えているかは別検証。
- **ログイン後の遷移先を `/me` 等にユーザーごとカスタマイズする機能**。

---

### テスト観点（テスタが書く E2E spec の方向性）

`tests/e2e/` に以下の観点で spec を追加する。`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー（`e2e_user_a@example.com` / `E2eTest123!`）は既にテスト DB に存在する。

1. **通常ログイン**: `/auth/login` で `e2e_user_a` の credential を入力して signin → URL が `/auth/login` から離れて遷移していること。具体的には `/` または middleware による振り分け先（保護パスでなければ `/`）に変わっていること。
2. **`?next=` 付きログイン**: `/auth/login?next=/history` を開いて signin → `/history` に遷移すること。
3. **誤ったパスワード**: 既存のエラーメッセージ「メールアドレスまたはパスワードが違います」が表示され、URL は `/auth/login` のまま留まること（リグレッション確認）。

テスタが新規 spec を書く際の参考: 既存の `tests/e2e/` 内のログイン関連 spec の慣習に合わせること（`page: Page` 型化、hard assertion、`Response.status()` での 5xx チェック等は session_context の運用パターン参照）。

---

### 監査観点（オーディが見るべき論点）

design.md `## BUG-007 対応 → 監査観点` セクションに記載した 3 点を中心に確認する。要点:

1. **`router.refresh()` 削除による副作用の有無**: 削除したことで、ログイン後にヘッダー等の Server Component が古い state を残すケースがないか。push 先のページが新規 server-render される際に最新の auth cookie が読まれるという前提が崩れる経路がないか。
2. **`useSearchParams()` の Next 16 Suspense 要件**: 既存 `app/case/[id]/CaseRoom.tsx` が同パターン（Suspense なしの client component で `useSearchParams`）でビルド通過しているが、build 警告が出ていないか確認。
3. **`next` パラメータの open redirect 脆弱性**: 外部 URL（例: `?next=https://evil.example.com`）が渡されたときに `router.push(next)` で外部に遷移する経路がないか。Next.js の `router.push` は内部パス前提だが、念のため検証する。脆弱性ありと判断した場合は `next.startsWith("/") && !next.startsWith("//")` 程度のガード追加を推奨する。

---

### 補足

- 既存実装の差分は `git diff main app/auth/login/page.tsx` で確認可能。
- E2E spec の追加先は `tests/e2e/auth-login.spec.ts`（新規）または既存 spec への追加のどちらでもよい。命名は既存 spec の慣習に合わせる。
- リード実装の妥当性検証が主目的のため、テスタが spec 実行で fail を出した場合はリードがフィードバックを受けて修正する想定。オーディの HIGH 指摘も同様。
