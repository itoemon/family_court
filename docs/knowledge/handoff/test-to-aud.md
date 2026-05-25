# テスタ → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

---

## 直近テスト結果サマリー（2026-05-25 17:02 / E-1・E-2・E-4・E-6）

**テストログ**: [test_20260525_170220.md](../test-log/test_20260525_170220.md)

| 修正 | 判定 | 備考 |
|------|------|------|
| E-1  | PASS | L79 で `escapeXml(truncate(m.content, 500))` — truncate → escapeXml の順序正しい |
| E-2  | PASS | L74〜83 に try-catch あり。catch で console.error + 500。スタックトレース漏洩なし |
| E-4  | PASS | `AuthenticationError` のみ false を返し、他は再 throw。import 確認済み |
| E-6  | PASS | `PROTECTED_PATH_PREFIXES` 実装済み。`/` 完全一致・サブルートも保護 |

**tsc**: エラーゼロ

**総合判定: PASS** — ビルドエージェントの実装は設計書と完全一致

---

## オーディへの確認依頼（E タスク）

### 1. E-1: `lib/defense.ts` — `defenseHistory` の truncate 適用確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] `lib/defense.ts` L79 で `escapeXml(truncate(m.content, 500))` — truncate が escapeXml の内側に渡されていること（truncate → escapeXml の順序）
- [ ] `import { truncate, escapeXml } from "@/lib/text-utils"` が L2 に存在すること
- [ ] `generateDefenseResponse` 内の `dialogHistory.map`（L39）・`generateDraft` 内の `dialogHistory.map`（L73）はすでに `truncate` 適用済みで変更なしであること（今回の E-1 は `defenseHistory` のみが対象）

### 2. E-2: `app/api/cases/[id]/route.ts` — PATCH 非 asGuest パスの try-catch 確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] L74〜83 の try ブロック内に `createSessionClient()` と `getUser()` の両呼び出しが含まれていること
- [ ] catch ブロックが `console.error("createSessionClient failed:", err)` のみでスタックトレースをレスポンスに含めていないこと
- [ ] エラーメッセージが `"サーバー設定エラーが発生しました。管理者に連絡してください。"` という汎用表現であること
- [ ] try-catch の後に `if (!user)` チェックが続いており、スコープが適切であること

### 3. E-4: `lib/claude.ts` — `validateApiKey` のエラー種別区別確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] catch ブロックが `} catch (error) {` として変数をバインドしていること（旧: `} catch {`）
- [ ] `if (error instanceof Anthropic.AuthenticationError) return false;` が存在すること
- [ ] `throw error;` で AuthenticationError 以外を再 throw していること
- [ ] `Anthropic` が L1 で `import Anthropic from "@anthropic-ai/sdk"` として import されていること（追加 import なし）

### 4. E-6: `middleware.ts` — 保護パス判定の確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] `PROTECTED_PATH_PREFIXES = ["/history", "/profile", "/case"]` が存在すること
- [ ] `pathname === "/"` の完全一致が維持されており、`startsWith("/")` が使われていないこと
- [ ] `pathname.startsWith(p + "/")` でサブルート（例: `/history/sub`・`/case/123`）が保護されること
- [ ] `config.matcher` の正規表現が `api` を除外していること（`/api/...` への誤保護リスクが排除されていること）

---

## 前回監査結果サマリー（2026-05-25 17:44 / E-1・E-2・E-4・E-6）

**監査ログ**: [audit_20260525_174421.md](../audit-log/audit_20260525_174421.md)

| 重要度 | 件数 |
|--------|------|
| HIGH   | 0    |
| MEDIUM | 0    |
| LOW    | 0    |
| 合格   | 10   |

**総合判定: PASS**

### E-1〜E-6 監査結果

| タスク | 内容 | 判定 |
|--------|------|------|
| E-1 | `lib/defense.ts` の `generateDraft` 内 `defenseHistory` ループ（L79）で `escapeXml(truncate(m.content, 500))` — truncate → escapeXml 順序正しい。D-1 LOW-1 解消。 | 合格 |
| E-2 | `route.ts` PATCH 非 asGuest パス（L74-83）で `createSessionClient` と `getUser` の両呼び出しが try-catch 内。スタックトレース漏洩なし。D-1 LOW-2 解消。 | 合格 |
| E-4 | `lib/claude.ts` の `validateApiKey` で `Anthropic.AuthenticationError` のみ `false`、それ以外は再 throw。インポート不要・上位委譲設計は正しい。 | 合格 |
| E-6 | `middleware.ts` の `PROTECTED_PATH_PREFIXES` 実装。`/` 完全一致維持・`startsWith(p + "/")` でサブルート保護・`config.matcher` で `/api` 除外。 | 合格 |

### 新規指摘事項

なし。前回 LOW-1・LOW-2 は E-1・E-2 で完全解消。

---

## 前回監査結果サマリー（2026-05-25 17:30 / D-1・D-2・D-5）

**監査ログ**: [audit_20260525_173000.md](../audit-log/audit_20260525_173000.md)

| 重要度 | 件数 |
|--------|------|
| HIGH   | 0    |
| MEDIUM | 0    |
| LOW    | 2    |
| 合格   | 8    |

**総合判定: PASS**

### D-1〜D-5 監査結果

| タスク | 内容 | 判定 |
|--------|------|------|
| D-1 | `lib/defense.ts` truncate → escapeXml 順序（48・82行目）、`generateDefenseResponse`・`generateDraft` 両方に適用 | 合格 |
| D-2 | `defense/route.ts` `resolveAuth` 認証ユーザーパスを try-catch でカバー、スタックトレース漏洩なし、ゲストパスと一貫 | 合格 |
| D-5 | `route.ts` 2箇所・`argument/route.ts` 1箇所すべてに `if (content)` チェック済み、空文字列・null・undefined を正しくガード | 合格 |

### 新規指摘事項（次回パイプラインで対応推奨）

| ID | 重要度 | 対象 | 内容 |
|----|--------|------|------|
| LOW-1 | LOW | `lib/defense.ts` | `generateDraft` 内の `defenseHistory` ループ（88行目）で `escapeXml(m.content)` に `truncate` 未適用。AI 応答は max_tokens:512 で実害は低い。 |
| LOW-2 | LOW | `app/api/cases/[id]/route.ts` | PATCH ハンドラの非 asGuest パスで `createSessionClient()` が try-catch 外（72行目）。直接的なセキュリティリスクは低いが C-1 修正済みパターンと非一貫。 |

---

## 直近テスト結果サマリー（2026-05-25 15:45 / D-1・D-2・D-5）

**テストログ**: [test_20260525_154500.md](../test-log/test_20260525_154500.md)

| 修正 | 判定 | 備考 |
|------|------|------|
| D-1  | PASS | truncate → escapeXml の順序正しく、2箇所とも実装済み |
| D-2  | PASS | 認証ユーザーパス全体が try-catch で囲まれ、スタックトレース漏洩なし |
| D-5  | PASS | route.ts 2箇所・argument/route.ts 1箇所すべてに `if (content)` チェック済み |

**tsc**: エラーゼロ

**総合判定: PASS** — ビルドエージェントの実装は設計書と完全一致

---

## オーディへの確認依頼（D タスク）

### 1. D-1: `lib/defense.ts` — truncate の適用確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] `lib/defense.ts` の 48 行目・82 行目で `truncate(a.content, 500)` が `escapeXml` の引数に渡されていること
- [ ] `lib/judge.ts` の `truncate` 関数（4 行目）が `export function` として named export になっていること
- [ ] `defenseHistory` の `content` は変更されていないこと（route.ts で 1000 文字バリデーション済みのため対象外）

### 2. D-2: `defense/route.ts` — try-catch の範囲確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] `resolveAuth` 関数内（15〜30 行目）で `createSessionClient()` の呼び出しから `user` 判定のブロック末尾まで try-catch で囲まれていること
- [ ] catch ブロックが `console.error("createSessionClient failed:", err)` のみでスタックトレースをレスポンスに含めていないこと
- [ ] エラーメッセージが `"サーバー設定エラーが発生しました。管理者に連絡してください。"` という汎用表現であること

### 3. D-5: `judge_messages` 空文字列挿入防止確認

**テスタ確認（静的）**: ✅ 設計書通り実装済み

**オーディへの確認依頼**:
- [ ] `app/api/cases/[id]/route.ts` の 96〜98 行目（アカウント参加時 opening）に `if (content)` チェックがあること
- [ ] `app/api/cases/[id]/route.ts` の 132〜134 行目（ゲスト参加時 opening）に `if (content)` チェックがあること
- [ ] `app/api/cases/[id]/argument/route.ts` の 143〜145 行目（turn/closing）に `if (content)` チェックがあること

---

## 前回監査結果サマリー（2026-05-25 16:17 / C-1〜C-4）

**監査ログ**: [audit_20260525_161728.md](../audit-log/audit_20260525_161728.md)

| 重要度 | 件数 |
|--------|------|
| HIGH   | 0    |
| MEDIUM | 2    |
| LOW    | 1    |
| 合格   | 9    |

**総合判定: PASS**

### C-1〜C-4 確認結果

| タスク | 内容 | 判定 |
|--------|------|------|
| C-1 | verifyGuestToken try-catch（3ファイル） | 合格（defense/route.ts の認証ユーザーパスに軽微な観察あり） |
| C-2 | GUEST_TOKEN_SECRET フェイルファスト | 合格（IIFE でモジュールロード時に検証、`!` アサーション除去済み） |
| C-3 | プロンプトインジェクション対策（judge.ts / defense.ts） | 合格（escapeXml・XML タグ分離・無効化注記すべて実装済み） |
| C-4 | profiles クエリ重複排除・.limit(100) | 合格 |

### 新規指摘事項（次回パイプラインで対応推奨）

| ID | 重要度 | 対象 | 内容 |
|----|--------|------|------|
| MEDIUM-NEW-1 | MEDIUM | `lib/defense.ts` | `dialogHistory` の content に `truncate` 未適用 |
| MEDIUM-NEW-2 | MEDIUM | `defense/route.ts` | 認証ユーザーパスが try-catch 外 |
| LOW-NEW-1 | LOW | `judge.ts` / `defense.ts` | `topic` に `truncate` 未適用（防御的観点） |

---

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
