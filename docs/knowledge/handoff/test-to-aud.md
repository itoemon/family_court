# テスタ → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: セキュリティ MEDIUM 2件（B-1: UUID 露出防止・B-2: ログアウトエラー通知）の修正  
**日時**: 2026-05-25 14:00  
**パイプラインステップ**: テスト完了（静的検証）→ オーディへ引き継ぎ

---

## テスト結果サマリー

| 結果 | 内容 |
|---|---|
| **判定** | ✅ **静的検証全件通過** |
| B-1 静的検証（defendantId 除去） | ✅ 3/3 ファイル通過 + クライアント側 grep 確認 |
| B-2 静的検証（ログアウトエラー通知） | ✅ 4/4 ファイル通過 |
| **E2E テスト** | 作成済み（`tests/e2e/b1-b2-fixes.spec.ts`）・未実行 |

**詳細レポート**: [test-log/test_20260525_140000.md](../test-log/test_20260525_140000.md)

---

## オーディへの確認依頼（重点項目）

### 1. B-1: API レスポンスから UUID が本当に消えているか（認証なしでアクセスして確認）

**テスタ確認（静的）**: ✅ コード上は `defendantId` の記述がすべて削除されていることを確認

**オーディへの確認依頼**:
- [ ] `GET /api/cases/[id]` に**認証なし**（Cookie・Authorization ヘッダーなし）でアクセスし、レスポンス JSON に `defendantId` フィールドが存在しないことを確認
  - `curl -s http://localhost:3000/api/cases/{id} | jq 'keys'` で確認推奨
  - `lib/case-response.ts` は `buildCaseResponse` の返却オブジェクトから `defendantId` を削除しているが、ランタイムでの実際のレスポンスを確認すること
- [ ] `defendant` オブジェクト（`{ name, joinedAt }`）は残存しているか確認（UUID だけが消えているか）
- [ ] `lib/types.ts` の `Case` インターフェースに `defendantId` が存在しないことを確認（TypeScript のコンパイルが通ることで型整合性も保証される）

**セキュリティ意義**: `GET /api/cases/[id]` は認証不要のエンドポイント。被告の Supabase ユーザー UUID がこのエンドポイント経由で公開されると、第三者が UUID を利用したプローブ攻撃を試みる可能性がある。

---

### 2. B-2: フラッシュ Cookie が `httpOnly: true` で設定されているか（XSS 対策）

**テスタ確認（静的）**: ✅ `app/actions/auth.ts` で `httpOnly: true` が指定されていることをコード上で確認

**オーディへの確認依頼**:
- [ ] `app/actions/auth.ts` の `cookieStore.set('flash_error', 'logout_failed', { ..., httpOnly: true, ... })` の実装を確認
- [ ] ブラウザの DevTools で `document.cookie` を確認し、`flash_error` Cookie が JavaScript から読み取れないこと（`httpOnly` 有効）を確認
  - 確認方法: ログアウトエラーを意図的に発生させて、ブラウザの Application タブで Cookie の HttpOnly チェックが入っていることを確認
- [ ] `maxAge: 30`（秒）という短命な Cookie 設定であることを確認（長時間残存しない設計）

**セキュリティ意義**: `httpOnly: true` により XSS スクリプトが `flash_error` Cookie の値を読み取れない。フラッシュメッセージのコードが漏洩してもリスクは低いが、多層防御として重要。

---

### 3. B-2: `/api/clear-flash` が GET 以外のメソッドを拒否しているか（POST 等）

**テスタ確認（静的）**: ✅ `app/api/clear-flash/route.ts` に `export async function GET()` のみ定義されていることを確認

**オーディへの確認依頼**:
- [ ] `POST /api/clear-flash`・`DELETE /api/clear-flash` 等に対して Next.js が 405 Method Not Allowed を返すことを確認
  - `curl -X POST http://localhost:3000/api/clear-flash` で 405 が返るか確認
- [ ] GET ハンドラが `res.cookies.set('flash_error', '', { path: '/', maxAge: 0 })` で Cookie を削除していることを確認
- [ ] `/api/clear-flash` に認証が不要な設計（`ErrorBanner` の `useEffect` からログインなしで呼ばれる）であることが意図的な設計かを確認
  - 悪用シナリオ: 第三者が `/api/clear-flash` を呼び出しても、削除されるのは呼び出し元の `flash_error` Cookie のみであり、他ユーザーへの影響はない（Cookie は per-user）

---

### 4. B-2: `ErrorBanner.tsx` の実装確認（Client Component の境界）

**テスタ確認（静的）**: ✅ `'use client'` ディレクティブ・`useEffect` による fetch・× ボタンの実装を確認

**オーディへの確認依頼**:
- [ ] `app/layout.tsx` が Server Component のままであることを確認（`'use client'` がないこと）
- [ ] `ErrorBanner` が `errorCode` を props で受け取る形式のため、`Suspense` でのラップが不要であることを確認
- [ ] `ERROR_MESSAGES` に未知のコードが来た場合のフォールバックメッセージ（`'エラーが発生しました。'`）が設定されていることを確認

---

## 実装検証の結果一覧

### B-1

| ファイル | 変更内容 | 確認結果 |
|---|---|---|
| `lib/types.ts` | `defendantId: string \| null` 削除 | ✅ 削除確認済み |
| `lib/case-response.ts` | `defendantId: c.defendant_id ?? null,` 削除 | ✅ 削除確認済み |
| `app/api/cases/[id]/verdict/route.ts` | `defendantId: c.defendant_id ?? null,` 削除 | ✅ 削除確認済み |
| `app/`（クライアント全体） | `defendantId` 参照なし | ✅ grep で確認済み（0件） |

### B-2

| ファイル | 変更内容 | 確認結果 |
|---|---|---|
| `app/actions/auth.ts` | `cookies` import・エラー時 `flash_error` Cookie セット（`httpOnly: true`） | ✅ 実装確認済み |
| `app/layout.tsx` | `flash_error` Cookie 読み取り・`<ErrorBanner>` 条件付き差し込み | ✅ 実装確認済み |
| `app/components/ErrorBanner.tsx` | 新規作成（Client Component・`/api/clear-flash` fetch・× ボタン） | ✅ 作成確認済み |
| `app/api/clear-flash/route.ts` | 新規作成（GET のみ・`maxAge: 0` で Cookie 削除） | ✅ 作成確認済み |

---

## テストスペック・今後の実行

### 新規スペック
- **`tests/e2e/b1-b2-fixes.spec.ts`** — B-1・B-2 専用（6 ケース）【未実行】
  - B-1: 認証ユーザー・ゲストからの `GET /api/cases/[id]` に `defendantId` が含まれないことを確認（2 ケース）
  - B-2: 正常系ログアウトでバナーなし・Cookie 手動セットでバナー表示・× ボタンで非表示・リロード後消去（4 ケース）

### 既存スペック
- **`tests/e2e/critical.spec.ts`** — CRITICAL-M01〜M04（毎回実行される固定セット）
- **`tests/e2e/security-fixes.spec.ts`** — A-1・A-2・A-3（セキュリティ修正テスト）

---

## オーディの最終チェックリスト

### B-1
- [ ] 認証なしで `GET /api/cases/[id]` にアクセスし、レスポンスに `defendantId` が存在しないことを実際のランタイムで確認
- [ ] `defendant` オブジェクト（UUID 以外の情報）が残存していることを確認

### B-2
- [ ] `flash_error` Cookie が `httpOnly: true` で設定されていることを確認（DevTools の Application タブ）
- [ ] `/api/clear-flash` が GET 以外のメソッドを 405 で拒否することを確認
- [ ] `app/layout.tsx` が Server Component のまま維持されていることを確認

---

**参照**: [test-log/test_20260525_140000.md](../test-log/test_20260525_140000.md), [design.md](../design.md), [arch-to-eng.md](arch-to-eng.md)
