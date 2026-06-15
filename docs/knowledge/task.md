# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。
>
> **重要 1**: `docs/knowledge/design.md` は永続資料である。既存の設計を絶対に削除・短縮しないこと。本タスクの内容は `design.md` の末尾に新規セクションとして追記済み（`## FEAT-MIDDLEWARE-NEXT 対応`）であり、再度追記し直す必要はない（[[feedback-design-md]] 参照）。
>
> **重要 2**: 本タスクは **リードが先行実装を済ませた状態でテスタ・オーディに渡している**。アーキ・ビルドは省略する。テスタは E2E spec 追加と実行、オーディはリード実装の差分監査が主目的。

## 今回のタスク

`middleware.ts` の保護パス → `/auth/login` リダイレクトに `?next=` クエリパラメータを付与する。BUG-007 の修正時にスコープ外として残した残宿題を回収する。

**バックログ ID**: なし（BUG-007 のフォローアップ）
**ブランチ**: `feat/middleware-next-param`

---

### 背景

BUG-007（PR #44）で `app/auth/login/page.tsx` の `useSearchParams().get("next") || "/"` 解釈と open redirect ガード（URL パーサベース）は既に実装済み。一方 `middleware.ts:37-39` は依然として `next` クエリを付与せずリダイレクトしているため、保護パス（例: `/history`）にアクセスして未認証で蹴られた場合、ログイン後に `/history` ではなく `/` に飛ぶ挙動になっている。これを直す。

---

### 修正方針（実装済み）

`middleware.ts:37-39` の redirect を変更:

```ts
if (!user && isProtected) {
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}
```

`pathname + request.nextUrl.search` を `next` に格納する。リクエストクエリ（例: `?filter=verdict`）も保持される。

---

### スコープ外

- ハッシュフラグメントの保持（サーバサイドで受け取れない、別タスク）
- ログアウト後のリダイレクト先処理（別検証）
- ログイン後の遷移先カスタマイズ（別タスク）

---

### テスト観点（テスタが書く E2E spec の方向性）

`TEST_MODE=1` 経由でテスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。E2E ユーザー A/B（`e2e_user_a@example.com` / `e2e_user_b@example.com`、パスワード `E2eTest123!`）はテスト DB に存在。

1. **基本動作**: 未認証で `/history` にアクセス → URL が `/auth/login?next=%2Fhistory` または `/auth/login?next=/history` のいずれかの形（実装次第）に変わること。`new URL().searchParams.set` は値を自動エンコードするため、表示は %エンコード済みで OK。
2. **クエリ保持**: 未認証で `/history?filter=verdict` 等にアクセス → リダイレクト先 URL の `next` に元クエリも含まれていること。
3. **ログイン後の復帰**: 上記の状態でログイン → 元の保護パスに正しく戻ること。
4. **既存ログイン動作のリグレッション**: `/auth/login` を直接開いてログイン（`next` なし）→ `/` に遷移すること。BUG-007 で書いた `tests/e2e/auth-login.spec.ts` の BUG-007-1 がそのまま通ること。

既存 `tests/e2e/` の慣習に合わせる（`page: Page` 型化、hard assertion）。

---

### 監査観点（オーディが見るべき論点）

design.md `## FEAT-MIDDLEWARE-NEXT 対応 → 監査観点` セクションに記載した 3 点を中心に確認する:

1. `pathname + request.nextUrl.search` が常に内部パス由来であること（外部 URL 混入の経路がないこと）
2. `/auth/login` 自体が matcher で除外されているため無限リダイレクトループにならないこと
3. `searchParams.set("next", value)` の URLEncode が正しく機能していること

---

### 補足

- 既存実装の差分は `git diff main middleware.ts` で確認可能（数行）。
- E2E spec の追加先は `tests/e2e/middleware-next.spec.ts`（新規）または既存の `auth-login.spec.ts` への追加のどちらでもよい。
