# 詳細設計書

## 概要（変更の目的・背景）

現行の `lib/guest-token.ts` における `computeToken` は、HMAC の入力が `"${caseId}:defendant"` のみで決定論的である。ランダム要素・タイムスタンプを持たないため、Cookie をキャプチャされると 7 日間有効なトークンが再利用可能となり、個別セッションの取り消しができない（バックログ MEDIUM 指摘）。

本変更では、トークン発行ごとにランダムな nonce（32 バイト）を生成し、その HMAC を DB テーブル `guest_tokens` に保存する方式に刷新する。Cookie に持つのは nonce の平文のみとし、HMAC（`token_hash`）は DB にのみ保管する。これにより、Cookie 単体からトークンを偽造・延命することが不可能になる。また、DB レコードに `revoked_at` カラムを設けることで、将来の個別セッション取り消し機能の基盤を整える。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### 変更: `lib/guest-token.ts`（内部ライブラリ。HTTP エンドポイントではない）

```typescript
// 変更前（同期）
export function generateGuestToken(caseId: string): string
export function verifyGuestToken(caseId: string, token: string): boolean

// 変更後（非同期）
export async function generateGuestToken(caseId: string): Promise<string>
export async function verifyGuestToken(caseId: string, token: string): Promise<boolean>
```

両関数が非同期になるため、呼び出し元の全 API Route で `await` が必要になる。

#### `generateGuestToken` の処理フロー

| ステップ | 処理 |
|---------|------|
| 1 | `crypto.randomBytes(32)` で nonce を生成し、64 桁 hex 文字列に変換する |
| 2 | `HMAC-SHA256(nonce_hex, GUEST_TOKEN_SECRET)` を計算し、`token_hash`（hex 文字列）とする |
| 3 | `createAdminClient()` 経由で `guest_tokens` テーブルに `(case_id, token_hash, expires_at = now() + 7 days)` を INSERT する |
| 4 | `nonce_hex` のみを返す（Cookie にセットされる値。`token_hash` は返さない） |

INSERT 失敗時はエラーをスローする。呼び出し元 API Route が try-catch でキャッチして 500 を返すこと。

#### `verifyGuestToken` の処理フロー

| ステップ | 処理 |
|---------|------|
| 1 | Cookie から受け取った `nonce_hex` で `HMAC-SHA256(nonce_hex, GUEST_TOKEN_SECRET)` を再計算する |
| 2 | `createAdminClient()` 経由で `guest_tokens` テーブルを検索する: `token_hash = <計算値> AND case_id = <引数> AND expires_at > now() AND revoked_at IS NULL` |
| 3 | 1 件以上ヒットすれば `true`、0 件なら `false` を返す |

DB エラー時は例外をスローする。呼び出し元で catch して `false` 扱いにするか 500 を返すかは、既存の各 API Route の try-catch パターンに従う（PR #14 C-1 で実装済みの構造を維持する）。

> **なぜ `case_id` でも絞るか**: `token_hash` のみでも nonce 衝突確率は無視できるが、`case_id` インデックスを活用することで検索効率を上げつつ、異なるケースへのクロス検証を構造的に防ぐ（Defense-in-Depth）。

### 影響する API Route（呼び出し変更のみ）

| ファイル | 変更内容 |
|---------|---------|
| `app/api/cases/[id]/join/route.ts` | `generateGuestToken(caseId)` を `await` に変更 |
| `app/api/cases/[id]/argument/route.ts` | `verifyGuestToken(caseId, token)` を `await` に変更 |
| `app/api/cases/[id]/defense/route.ts` | `verifyGuestToken(caseId, token)` を `await` に変更 |
| `app/api/cases/[id]/route.ts` | `verifyGuestToken(caseId, token)` を `await` に変更（PATCH asGuest パス） |

これら 4 ファイルはロジックの変更は不要。`await` の追加のみ。

---

## データモデル（DB スキーマ・型定義の変更）

### 新設テーブル: `guest_tokens`

```sql
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
-- ポリシーを一切 CREATE しないことで Service Role のみアクセス可能になる
```

| カラム | 型 | 説明 |
|---|---|---|
| `id` | uuid | PK。外部公開しない |
| `case_id` | uuid | ケース外部キー。ケース削除時に CASCADE 削除 |
| `token_hash` | text | `HMAC-SHA256(nonce, SECRET)` の hex 文字列。nonce 平文は保存しない |
| `created_at` | timestamptz | 発行日時 |
| `expires_at` | timestamptz | 有効期限（`created_at + INTERVAL '7 days'`） |
| `revoked_at` | timestamptz | NULL = 有効。値があれば個別取り消し済み |

> **なぜ RLS でポリシーなしにするか**: `guest_tokens` の全操作は `createAdminClient()`（Service Role）経由のみで行う。anon・authenticated ロールから直接参照を許可する理由がなく、誤ったクライアント経由アクセスを構造的に防ぐ。ADR-003 の「API Routes はサービスロールキーで RLS をバイパスし、信頼済み操作を行う」方針と一致する。

#### マイグレーションファイル

`supabase/migrations/` 配下に新規 SQL ファイルを作成する。ファイル名は Supabase CLI の命名規則（`YYYYMMDDHHMMSS_add_guest_tokens.sql`）に従う。内容は上記 DDL 一式。

#### 既存テーブルへの影響

`cases`・`arguments`・`verdicts`・`profiles` への変更はなし。`guest_tokens` は `cases(id)` を外部キーで参照するため、`cases` テーブルが先に存在していること。

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### `supabase/migrations/YYYYMMDDHHMMSS_add_guest_tokens.sql`（新設）

`guest_tokens` テーブルの DDL のみを含む。ロールバック手順（`DROP TABLE guest_tokens;`）を SQL コメントで記載する。

### `lib/guest-token.ts`（変更）

既存の同期関数を非同期に刷新する。このファイルの責務は以下に限定する:

- nonce 生成（`crypto.randomBytes`。Node.js 組み込み API、追加依存なし）
- HMAC 計算（`node:crypto` の `createHmac`。既存の実装を継続）
- `guest_tokens` テーブルへの INSERT / SELECT（`createAdminClient()` 使用）
- `GUEST_TOKEN_SECRET` 未設定時の起動時フェイルファスト（既存の IIFE 実装を継続）

**このファイルに含めないもの**: Cookie への読み書き、HTTP レスポンスの組み立て、ケースのフェーズ検証。それらは各 API Route の責務とする。

### `app/api/cases/[id]/join/route.ts`（変更）

`generateGuestToken(caseId)` の呼び出しに `await` を追加する。既存の try-catch 構造の中に収まっているか確認し、なければ追加する。

### `app/api/cases/[id]/argument/route.ts`（変更）

`verifyGuestToken(caseId, token)` の呼び出しに `await` を追加する。PR #14 C-1 で既存の try-catch が実装済みのため、構造変更は不要。

### `app/api/cases/[id]/defense/route.ts`（変更）

`verifyGuestToken(caseId, token)` の呼び出しに `await` を追加する。PR #14 C-1 で既存の try-catch が実装済みのため、構造変更は不要。

### `app/api/cases/[id]/route.ts`（変更）

PATCH asGuest パスの `verifyGuestToken(caseId, token)` 呼び出しに `await` を追加する。

---

## セキュリティ設計（認証・認可・入力検証の方針）

### トークン分離の原則

| データ | 保存場所 | アクセス可能な主体 |
|---|---|---|
| nonce（平文） | httpOnly Cookie のみ | サーバーサイドのみ（JS・外部からアクセス不可） |
| token_hash | DB `guest_tokens` テーブル | Service Role（Admin Client）のみ |

Cookie に nonce のみを持ち、HMAC を DB に分離することで、Cookie 単体・DB 単体のいずれが漏洩しても攻撃者はトークンを偽造できない。

### 検証条件の多重チェック

`verifyGuestToken` の SELECT クエリは以下 4 条件の AND で構成する:

1. `token_hash = <再計算値>`（HMAC 一致）
2. `case_id = <引数の caseId>`（ケース限定、クロス利用防止）
3. `expires_at > now()`（有効期限内）
4. `revoked_at IS NULL`（取り消しなし）

いずれか不一致の場合 `false` を返す（fail-closed）。

### 移行時の既存セッションへの影響

マイグレーション適用後、旧方式で発行された Cookie には DB レコードが存在しないため、全て無効と判定される。進行中のゲストセッションはリジョイン（再参加）が必要になる。一時的な UX 低下は許容すべきトレードオフである。本番適用はトラフィックが少ない時間帯に行うことを推奨する。

---

## 制約・前提条件

- `GUEST_TOKEN_SECRET` 環境変数は設定済みであること（`environment.md` 記載、PR #14 C-2 でフェイルファスト実装済み）
- `createAdminClient()` が `lib/supabase/server.ts` に実装済みであること（`environment.md` 記載）
- `supabase/schema.sql` の `cases` テーブルが存在していること（`guest_tokens` が `cases(id)` を外部参照するため）
- マイグレーションは Supabase CLI（`supabase db push` または `supabase migration apply`）で適用すること
- `expires_at` は SQL の `DEFAULT now() + INTERVAL '7 days'` で DB 側が計算する（アプリ側での日付計算は行わない）
- スコープ外: ゲストトークンの手動取り消し UI・トークン一覧管理画面・定期クリーンアップジョブ（`revoked_at` カラムは将来のための基盤）
