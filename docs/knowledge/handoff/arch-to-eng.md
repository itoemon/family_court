# アーキ → ビルド handoff

## タスク概要

F-1: HMAC ゲストトークンを nonce ベースに刷新する（MEDIUM 1 件）。DB スキーマ変更あり。

---

## 実装チェックリスト

### 1. マイグレーション SQL を作成する

`supabase/migrations/` 配下に新規ファイルを作成する。ファイル名は Supabase CLI の規則（`YYYYMMDDHHMMSS_add_guest_tokens.sql`）に従うこと。

```sql
-- supabase/migrations/YYYYMMDDHHMMSS_add_guest_tokens.sql

-- Rollback: DROP TABLE IF EXISTS guest_tokens;

CREATE TABLE guest_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

CREATE INDEX ON guest_tokens(case_id);

ALTER TABLE guest_tokens ENABLE ROW LEVEL SECURITY;
-- ポリシーを CREATE しないことで Service Role のみアクセス可能
```

`supabase db push`（または `supabase migration apply`）で適用すること。

---

### 2. `lib/guest-token.ts` を刷新する

既存の同期関数 2 つを非同期に変更する。以下に変更後の実装仕様を示す。

#### `generateGuestToken`

```typescript
import crypto from "node:crypto"
import { createAdminClient } from "@/lib/supabase/server"

export async function generateGuestToken(caseId: string): Promise<string> {
  const nonce = crypto.randomBytes(32).toString("hex")             // 64桁 hex
  const tokenHash = crypto
    .createHmac("sha256", GUEST_TOKEN_SECRET)
    .update(nonce)
    .digest("hex")

  const admin = createAdminClient()
  const { error } = await admin.from("guest_tokens").insert({
    case_id: caseId,
    token_hash: tokenHash,
    expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  })
  if (error) throw new Error(`guest_tokens INSERT failed: ${error.message}`)

  return nonce  // Cookie に渡す値（token_hash は返さない）
}
```

> `expires_at` の計算: SQL の `now() + INTERVAL '7 days'` を使う方法もあるが、Supabase JS Client では INSERT 時に SQL 式を直接渡せないため、アプリ側で ISO 文字列として計算する。

#### `verifyGuestToken`

```typescript
export async function verifyGuestToken(caseId: string, token: string): Promise<boolean> {
  const tokenHash = crypto
    .createHmac("sha256", GUEST_TOKEN_SECRET)
    .update(token)
    .digest("hex")

  const admin = createAdminClient()
  const { data, error } = await admin
    .from("guest_tokens")
    .select("id")
    .eq("case_id", caseId)
    .eq("token_hash", tokenHash)
    .gt("expires_at", new Date().toISOString())
    .is("revoked_at", null)
    .limit(1)

  if (error) throw new Error(`guest_tokens SELECT failed: ${error.message}`)
  return (data?.length ?? 0) > 0
}
```

**`GUEST_TOKEN_SECRET` の IIFE フェイルファスト**は既存実装を維持すること（PR #14 C-2 で実装済み）。

---

### 3. 呼び出し元 API Route 4 ファイルを `await` に変更する

各ファイルで `generateGuestToken` / `verifyGuestToken` の呼び出しに `await` を追加するのみ。ロジック変更は不要。

| ファイル | 変更箇所 |
|---------|---------|
| `app/api/cases/[id]/join/route.ts` | `generateGuestToken(caseId)` → `await generateGuestToken(caseId)` |
| `app/api/cases/[id]/argument/route.ts` | `verifyGuestToken(caseId, token)` → `await verifyGuestToken(caseId, token)` |
| `app/api/cases/[id]/defense/route.ts` | `verifyGuestToken(caseId, token)` → `await verifyGuestToken(caseId, token)` |
| `app/api/cases/[id]/route.ts` | `verifyGuestToken(caseId, token)` → `await verifyGuestToken(caseId, token)`（PATCH asGuest パス） |

PR #14 C-1 で各ファイルに try-catch が実装済みのため、追加の例外処理は不要。`join/route.ts` のみ try-catch の有無を確認すること（C-1 の対象外だった可能性あり）。

---

## 実装順序の推奨

1. **マイグレーション SQL 作成・適用**（DB が先に存在しないと手順 2 の動作確認ができない）
2. **`lib/guest-token.ts` 刷新**（コアロジックの変更）
3. **API Route 4 ファイルへの `await` 追加**
4. **`tsc --noEmit` で型チェック**
5. **動作確認**（下記参照）

---

## 確認項目

- [ ] マイグレーション適用後、`guest_tokens` テーブルが存在する
- [ ] `guest_tokens` テーブルに RLS が有効になっており、anon・authenticated ロールから直接 SELECT できない
- [ ] ゲストとして参加すると `guest_tokens` テーブルにレコードが INSERT される（`token_hash` が格納され、`nonce` は格納されない）
- [ ] 同じゲストが次のターンで発言・閲覧できる（`verifyGuestToken` が `true` を返す）
- [ ] 7 日後に `expires_at` が過ぎたレコードで `verifyGuestToken` が `false` を返す（手動で `expires_at` を過去日時に書き換えて確認）
- [ ] `tsc --noEmit` がエラーなしで通る

---

## 注意事項

### DB 適用タイミング

マイグレーション適用後、旧方式の Cookie を持つ既存ゲストセッションは全て無効になる（DB にレコードが存在しないため `verifyGuestToken` が `false` を返す）。本番への適用はトラフィックが少ない時間帯に行うこと。

### `join/route.ts` の try-catch 確認

PR #14 C-1 の try-catch 対象は `argument`・`defense`・`defense/draft` の 3 ファイル。`join/route.ts` が対象外だった場合、`generateGuestToken` の呼び出しを try-catch で囲み、失敗時は 500 を返すこと。

### `createAdminClient()` の呼び出し

`lib/guest-token.ts` 内で `createAdminClient()` を呼び出す。これは環境定義書の「API Routes での書き込みは必ず `createAdminClient()` を使う」規則と一致する。`lib/guest-token.ts` は API Route から呼ばれるサーバーサイド専用コードのため、この規則の適用は妥当である。

### `token_hash` の一意制約について

`token_hash` に UNIQUE 制約は設けない。nonce が 32 バイトランダムのため衝突確率は天文学的に低く、UNIQUE 制約による INSERT 失敗のリスクより、制約なしの方が運用上安全である。

---

## 未解決事項（スコープ外・ビルドの判断不要）

- 期限切れレコードの定期クリーンアップ（`guest_tokens` は削除されず蓄積し続ける。Supabase の pg_cron 等での定期削除は今回スコープ外）
- `revoked_at` を使った個別取り消し UI（カラムは設けたが、操作 API・画面は今回スコープ外）
- 他のトークン種別（present token 等）への同方式の応用（スコープ外）
