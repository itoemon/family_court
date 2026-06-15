# テスタ → オーディ 引き継ぎメモ（FEAT-MIDDLEWARE-NEXT）

**実行日**: 2026-06-15  
**テスタ**: Claude QA Engineer  
**対象**: FEAT-MIDDLEWARE-NEXT — middleware の保護パスリダイレクトに ?next= を付与  
**テスト判定**: ✅ **通過** — CRITICAL 4/4 + FEAT-MIDDLEWARE-NEXT 5/5 全件通過
**実行タイムスタンプ**: 2026-06-15T03:28:04Z

---

## テスト実行結果サマリー

| 項目 | 結果 |
|------|------|
| **実行テスト数** | 9 件 |
| **成功** | 9 件（100%）✅ |
| **失敗** | 0 件（0%） |
| **CRITICAL-M01～M04** | 4/4 通過 ✅ |
| **FEAT-MIDDLEWARE-NEXT-1～5** | 5/5 通過 ✅ |
| **実行時間** | 45.2 秒 |
| **判定** | ✅ **通過** — パイプライン承認可 |

---

## テスト内容

### CRITICAL-M（アプリケーション主要フロー）— 4 件全て通過

- **M01**: 2ユーザー間の会話フロー（両者認証済み）✅ (14.190s)
  - 原告ケース作成 → 被告がアカウントで参加 → ターン交代 → 発言同期確認
  
- **M02**: セッション復元 ✅ (8.945s)
  - ページリロード後の セッション・ロール・フォーム表示維持を確認
  
- **M03**: 第三者の割り込み拒否 ✅ (6.494s)
  - 無関係の第三者が observer 扱いになることを確認
  
- **M04**: ゲスト被告フロー ✅ (9.336s)
  - Cookie トークン経由での未認証ユーザーの発言権を確認

### FEAT-MIDDLEWARE-NEXT 検証テスト — 5 件全て通過

- **FEAT-MIDDLEWARE-NEXT-1**: 基本動作 — 未認証で保護パス → middleware リダイレクト ✅ (684ms)
  - 未認証ユーザーが `/history` にアクセス → `/auth/login?next=%2Fhistory` にリダイレクト
  - next パラメータに保護パスが含まれている

- **FEAT-MIDDLEWARE-NEXT-2**: クエリ保持 — next パラメータに元クエリも含まれる ✅ (671ms)
  - 未認証ユーザーが `/history?filter=verdict` にアクセス
  - リダイレクト先の `next` に `%2Fhistory%3Ffilter%3Dverdict` が含まれている（URLEncode 済み）

- **FEAT-MIDDLEWARE-NEXT-3**: ログイン後復帰 — 元の保護パスに正しく戻る ✅ (1.801s)
  - `/history` → 自動リダイレクト → `/auth/login?next=...` → ログイン → `/history` に遷移

- **FEAT-MIDDLEWARE-NEXT-4**: クエリ付き復帰 — 元のクエリも保持して復帰 ✅ (1.655s)
  - `/history?filter=verdict` → リダイレクト → ログイン → `/history?filter=verdict` に遷移

- **FEAT-MIDDLEWARE-NEXT-5**: リグレッション — BUG-007-1 の既存動作確認 ✅ (950ms)
  - `/auth/login` を直接開いてログイン（next パラメータなし）→ `/` に遷移
  - BUG-007 修正の既存機能が引き続き動作

---

## 実装内容確認（オーディ向け）

### 修正ファイル

**middleware.ts のみ** — 変更数行（`+6 / -1`）

### 修正内容

```typescript
// 修正前（L37-39）
if (!user && isProtected) {
  return NextResponse.redirect(new URL("/auth/login", request.url));
}

// 修正後（L37-42）
if (!user && isProtected) {
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}
```

**key point**:
- `pathname + request.nextUrl.search`: パス＋クエリ文字列を結合
- `searchParams.set()`: URL クエリとして追加（自動 URLEncode）
- リダイレクト先: `/auth/login?next=%2Fhistory` または `/auth/login?next=%2Fhistory%3Ffilter%3Dverdict`

### 既存との連携

**app/auth/login/page.tsx**（BUG-007 修正済み）:
```typescript
const rawNext = useSearchParams().get("next") || "/";
const nextUrl = new URL(rawNext, window.location.origin);
// origin チェック + hash 保持でログイン後の遷移先を決定
```

---

## design.md 監査観点の確認結果

### ✅ 1. pathname + request.nextUrl.search が内部パス由来であることの確認

**テストでの検証**:
- FEAT-MIDDLEWARE-NEXT-1～4 で、保護パス (`/history`, `/history?filter=verdict`) がリダイレクト時に正しく `next` パラメータに含まれていることを確認
- 外部ドメインが混入した痕跡なし

**コード観点**:
- `request.nextUrl`: サーバー側で認識した URL オブジェクト
- `pathname`: 相対パスコンポーネント
- `request.nextUrl.search`: クエリ文字列（protocol・host・pathname 不含）
- 結論: 内部パス由来のみ → ✅ **安全**

### ✅ 2. /auth/login 自体が matcher で除外されているため無限ループが発生しないこと

**テストでの検証**:
- FEAT-MIDDLEWARE-NEXT-5 で `/auth/login` を直接開いても middleware リダイレクトが発生せず、ページが表示される
- 無限ループなし → ✅ **確認**

**コード観点**:
- middleware.ts の `config.matcher` で `/auth/login` および `/auth/signup` が除外されている
- 結論: 無限ループなし → ✅ **安全**

### ✅ 3. searchParams.set("next", value) の URLEncode が正しく機能していること

**テストでの検証**:
- FEAT-MIDDLEWARE-NEXT-2 / 4 で、クエリ付きパス (`/history?filter=verdict`) がリダイレクト時に URLEncode されていることを確認
  - URL 上: `next=%2Fhistory%3Ffilter%3Dverdict` 形式（`/` → `%2F`, `?` → `%3F`, `=` → `%3D`）
  - ブラウザの自動デコード + ログイン処理で正しく復元
- 結論: URLEncode 正常 → ✅ **確認**

**コード観点**:
- `searchParams.set()` は自動 URLEncode（`encodeURIComponent` 不要）
- ブラウザ：`useSearchParams().get()` により自動デコード
- 結論: エンコード二重化なし → ✅ **安全**

---

## セキュリティ二重防御の確認

| 防御層 | 内容 | テスト結果 |
|--------|------|----------|
| **middleware** | pathname + request.nextUrl.search（内部パス由来） | ✅ 確認 |
| **ログイン後** | app/auth/login/page.tsx の origin チェック | ✅ BUG-007 修正済み |
| **URLEncoding** | searchParams.set() 自動エンコード | ✅ 二重化なし |

結論: **open redirect ガードが機能している** → ✅ **安全**

---

## リグレッション検証

### CRITICAL テスト全通過 ✅

- M01 (14.190s), M02 (8.945s), M03 (6.494s), M04 (9.336s): 全て通過
- 会話フロー・セッション管理・権限制御が不変
- 修正による副作用なし

### BUG-007 既存動作維持 ✅

- FEAT-MIDDLEWARE-NEXT-5: `/auth/login` 直接 → `/` 遷移が引き続き動作
- BUG-007 修正の「next パラメータなし時のデフォルト `/` 遷移」が正常

---

## オーディ監査チェックリスト

### 必須確認項目

- [ ] middleware.ts L37-42 を確認し、`pathname + request.nextUrl.search` が正確に付与されていることを確認
- [ ] `searchParams.set("next", value)` による自動 URLEncode が機能していることを確認
- [ ] middleware.config.matcher で `/auth/login` が除外されていることを確認（無限ループ防止）
- [ ] 差分サマリー `+6 / -1` が task.md と一致することを確認

### 設計観点確認

- [ ] **pathname + request.nextUrl.search**: 内部パス由来のみ（外部 URL 混入なし）
- [ ] **無限ループ防止**: `/auth/login` が matcher 除外の事実確認
- [ ] **URLEncoding**: searchParams.set() 自動処理で二重エンコード回避

### セキュリティ確認

- [ ] ログイン後の origin チェック（app/auth/login/page.tsx）が有効であることを確認
- [ ] open redirect ガードが middleware + ログイン後で二重に機能していることを確認

### リグレッション確認

- [ ] CRITICAL-M01～M04 全テストが通過（本実施で確認済み ✅）
- [ ] BUG-007-1（/auth/login 直接 → / 遷移）が引き続き動作（確認済み ✅）

---

## テスト実行方法（オーディが再実行する場合）

### 環境変数設定

`.env.test` ファイルに以下が設定されていることを確認：
```env
E2E_TEST_EMAIL_A=e2e_user_a@example.com
E2E_TEST_EMAIL_B=e2e_user_b@example.com
E2E_TEST_PASSWORD_A=E2eTest123!
E2E_TEST_PASSWORD_B=E2eTest123!
TEST_MODE=1
```

### dev サーバー起動確認

```bash
# scripts/agents.sh が既に起動済みの場合は不要
curl http://localhost:3000
```

### テスト実行（テスタと同一手順）

```bash
set -a && source .env.test && set +a
npx playwright test tests/e2e/critical.spec.ts tests/e2e/middleware-next.spec.ts --reporter=html
```

### テスト結果確認

```bash
npx playwright show-report
```

---

## テスト成果物

- **テストレポート**: docs/knowledge/test-log/test_20260615_122712.md
- **テストスペック（既存）**: tests/e2e/critical.spec.ts
- **テストスペック（新規）**: tests/e2e/middleware-next.spec.ts
- **実行環境**: TEST_MODE=1 経由でテスト Supabase に接続

---

## 推奨事項

### Approve の条件

- [ ] middleware.ts の修正内容（pathname + request.nextUrl.search 付与）を確認
- [ ] searchParams.set() による URLEncode が正しく機能していることを確認
- [ ] /auth/login が matcher で除外されていることを確認（無限ループ防止）
- [ ] テスト結果 9/9 通過を確認した
- [ ] 修正コード`+6 / -1`を確認した
- [ ] design.md の監査観点 3 点が全て確認できた

→ **これらを満たせば approve 可能**

### 懸念される指摘の可能性

**なし** — 実装は設計通り、テストは全通過、セキュリティ二重防御も有効。

---

## 次のステップ（オーディ後）

1. **オーディの承認**: チェックリスト記入
2. **マージ**: main にマージ
3. **本番適用**: Preview → Production へのロールアウト

---

**テスタ署名**: Claude QA Engineer  
**実行日時**: 2026-06-15 03:28:04Z  
**レビュー対象**: オーディエンジニア  
**推進判定**: → **オーディ監査へ引き継ぎ可（FEAT-MIDDLEWARE-NEXT 実装の妥当性確認完了、全テスト通過）**
