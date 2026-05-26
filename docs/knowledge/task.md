# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

HMAC ゲストトークンを nonce ベースに刷新する（MEDIUM 1件）。
DB スキーマ変更あり。

## 背景・目的

現在の `lib/guest-token.ts` の `computeToken` は入力が `"${caseId}:defendant"` のみで決定論的。
Cookie をキャプチャされると 7 日間再利用可能で、個別セッション取り消しが不可。
DB にトークンテーブルを追加し、nonce（ランダム値）を発行することでセキュリティを改善する。

## 修正対象

### F-1. `guest_tokens` テーブルを新設し、nonce ベースのトークンに刷新

- **影響ファイル**:
  - `supabase/migrations/` — 新規マイグレーション SQL
  - `lib/guest-token.ts` — `generateGuestToken` / `verifyGuestToken` を刷新
  - `app/api/cases/[id]/join/route.ts` — トークン発行側
  - `app/api/cases/[id]/argument/route.ts` — トークン検証側
  - `app/api/cases/[id]/defense/route.ts` — トークン検証側
  - `app/api/cases/[id]/route.ts` — トークン検証側（PATCH asGuest パス）

#### DB スキーマ

```sql
CREATE TABLE guest_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  token_hash  text NOT NULL,           -- HMAC-SHA256(nonce, SECRET) の hex
  created_at  timestamptz DEFAULT now(),
  expires_at  timestamptz NOT NULL,    -- created_at + 7 days
  revoked_at  timestamptz              -- NULL = 有効
);
CREATE INDEX ON guest_tokens(case_id);
```

RLS: 全操作を Service Role のみ許可（Row Level Security で anon/authenticated をブロック）。

#### トークン発行フロー（`generateGuestToken`）

1. `crypto.randomBytes(32)` で nonce を生成
2. `HMAC-SHA256(nonce, GUEST_TOKEN_SECRET)` でハッシュを計算
3. `guest_tokens` テーブルに `(case_id, token_hash, expires_at)` を INSERT（Admin Client 使用）
4. Cookie に渡すトークン値は `${nonce_hex}` のみ（ハッシュは DB にのみ保存）

#### トークン検証フロー（`verifyGuestToken`）

1. Cookie のトークン値（nonce_hex）を受け取る
2. `HMAC-SHA256(nonce, GUEST_TOKEN_SECRET)` を再計算
3. `guest_tokens` テーブルで `token_hash` が一致し、`expires_at > now()` かつ `revoked_at IS NULL` のレコードを検索
4. 見つかれば `true`、なければ `false`

#### API シグネチャ変更

```typescript
// 変更前
export function generateGuestToken(caseId: string): string
export function verifyGuestToken(caseId: string, token: string): boolean

// 変更後（非同期化）
export async function generateGuestToken(caseId: string): Promise<string>
export async function verifyGuestToken(caseId: string, token: string): Promise<boolean>
```

## スコープ外

- ゲストトークンの手動取り消し UI
- トークン一覧管理画面
- 他のトークン種別への応用
