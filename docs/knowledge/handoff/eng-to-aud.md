# ビルド → テスタ・オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: FEAT-MIDDLEWARE-NEXT — middleware の保護パスリダイレクトに `?next=` を付与
**日時**: 2026-06-15
**ブランチ**: feat/middleware-next-param
**特記**: 本タスクはリードが先行実装を済ませた状態でテスタ・オーディに渡している。アーキ・ビルドは省略。リードが実装した差分の妥当性検証と E2E spec 追加が本パイプラインの主目的。

由来: BUG-007（PR #44）のフォローアップ。`docs/knowledge/design.md ## FEAT-MIDDLEWARE-NEXT 対応`。

---

## 変更ファイル一覧

| ファイル | 種別 | 内容 |
|---|---|---|
| `middleware.ts` | 変更 | 保護パス → `/auth/login` リダイレクト時に `?next=pathname+search` を付与 |

差分: 数行（`+6 / -1`）。

---

## 設計判断と注意事項

### `pathname + request.nextUrl.search` を採用した理由

`pathname` だけだと元のクエリ（例: `?filter=verdict`）が失われる。`request.nextUrl.search` を結合することでクエリも保持し、ログイン後の復帰先が「ユーザーが見ていた状態に完全に戻る」ようにする。

### `searchParams.set` による自動エンコード

`URL` API の `searchParams.set("next", value)` は値を自動的に URLEncode する。手動で `encodeURIComponent` する必要はなく、エンコード漏れや二重エンコードのリスクがない。

### login ページ側との連携

`app/auth/login/page.tsx` は BUG-007 修正で既に `useSearchParams().get("next") || "/"` を解釈し、`new URL(rawNext, window.location.origin)` で origin 一致を確認した上で pathname+search+hash を採用する形になっている。本タスクで middleware から `next` を付与した瞬間に「保護パス → ログイン → 元のページに戻る」フローが完成する。

### 無限ループの非発生

`middleware.ts` の `config.matcher` は `/auth/login` を明示的に除外している。よって `/auth/login` 自体がリダイレクト対象になることはなく、無限ループは発生しない。

### セキュリティ

`pathname + request.nextUrl.search` は `request.nextUrl` 由来で、サーバ側が認識した相対パスのみ。外部 URL の混入余地はない。さらに login ページ側の open redirect ガードが二重防御として機能する。

---

## テスト観点（テスタへの引き継ぎ）

1. **基本動作**: 未認証で `/history` にアクセス → `/auth/login?next=...` に変わり、`next` の値が `/history` を指していること（URLEncode 込みでも OK）
2. **クエリ保持**: 未認証で `/history?filter=verdict` 等にアクセス → `next` に元クエリも含まれること
3. **ログイン後復帰**: 上記の状態でログイン → 元の保護パスに戻ること
4. **リグレッション**: BUG-007 で書いた `tests/e2e/auth-login.spec.ts` の BUG-007-1（`/auth/login` を直接開いてログイン → `/` 遷移）が引き続き通過すること

E2E 実行環境: `TEST_MODE=1` 経由で `.env.test` を読み、テスト Supabase（`eckrccrfnblzdbflnssf`）に対して動作する。

---

## 監査観点（オーディへの引き継ぎ）

design.md `## FEAT-MIDDLEWARE-NEXT 対応 → 監査観点` セクションに記載した 3 点:

1. `pathname + request.nextUrl.search` の値が内部パス由来である保証
2. 無限リダイレクトループの非発生（`/auth/login` が matcher で除外されている事実）
3. `searchParams.set` の URLEncode の正しさ
