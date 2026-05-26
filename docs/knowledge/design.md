# 詳細設計書

## 概要（変更の目的・背景）

`GET /api/users/search` は認証済みユーザーなら無制限に呼び出せる。`display_name ILIKE 'q%'` の前方一致検索を `q=a`, `q=b`, ..., `q=aa` と網羅的に実行することで、全登録ユーザーの `display_name`・`id`・`avatar_url` を体系的に列挙できる（MEDIUM-001）。

本設計では Upstash Redis + `@upstash/ratelimit` を用いて `user.id` 単位のレートリミットを実装し、プライバシーリスクを低減する。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### GET /api/users/search（変更）

- 認証: 必須（セッション）
- クエリパラメータ: `q`（1〜100 文字の文字列、必須）
- **レートリミット: `user.id` 単位で 1 分間に最大 30 リクエストまで**
- Response 200:
  ```json
  [
    { "id": "uuid", "display_name": "string", "avatar_url": "string | null" }
  ]
  ```
- Error レスポンス:

| ステータス | 条件 | レスポンスボディ |
|---|---|---|
| 400 | `q` 欠如または不正 | `{ "error": "..." }` |
| 401 | 未認証 | `{ "error": "Unauthorized" }` |
| 429 | レートリミット超過 | `{ "error": "Too Many Requests" }` |

- **429 レスポンスヘッダー**:
  ```
  X-RateLimit-Limit:     30
  X-RateLimit-Remaining: 0
  X-RateLimit-Reset:     <Unix epoch seconds>
  Retry-After:           <残り秒数>
  ```

既存の 200/400/401 の挙動は変更しない。変更箇所は認証確認直後にレートリミットチェックを挿入する一点のみ。

---

## データモデル（DB スキーマ・型定義の変更）

DB スキーマの変更なし。

### 環境変数の追加

| 変数名 | 必須 | 用途 |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | ✅ | Upstash Redis の REST エンドポイント |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ | Upstash Redis の認証トークン |

`NEXT_PUBLIC_` 接頭辞なし（サーバー専用）。Vercel のプロジェクト設定にも同様に登録が必要（ダイチ側作業）。

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### 変更ファイル

```
app/
  api/
    users/
      search/
        route.ts   ← レートリミット処理を追加（変更）
```

新設ファイルなし。

### app/api/users/search/route.ts の変更仕様

**処理フロー（変更後）**:

```
1. セッション確認（createSessionClient）
   → 未認証なら 401

2. レートリミットチェック（Upstash Redis）
   → 制限超過なら 429（X-RateLimit-* ヘッダー付き）

3. クエリパラメータ検証（q の存在・長さ）
   → 不正なら 400

4. search_users RPC 呼び出し
   → 結果を 200 で返す
```

**レートリミッターの初期化**（モジュールスコープで 1 度だけ生成）:

```typescript
// アルゴリズム: slidingWindow（固定窓と比べてリセット直後の急増を防ぐ）
// 識別子: user.id（IP は NAT・プロキシで共有されるため不適切）
const ratelimit = new Ratelimit({
  redis: Redis.fromEnv(),
  limiter: Ratelimit.slidingWindow(30, "1 m"),
  analytics: false,  // Upstash の使用量分析は不要
});
```

**429 返却時のヘッダー生成**:

`@upstash/ratelimit` の `limit()` は `{ success, limit, remaining, reset }` を返す。`reset` は Unix epoch milliseconds であるため、秒換算して `X-RateLimit-Reset` と `Retry-After` に使用する。

```typescript
const { success, limit, remaining, reset } = await ratelimit.limit(userId);
if (!success) {
  const resetSec = Math.ceil(reset / 1000);
  const retryAfter = Math.max(0, resetSec - Math.floor(Date.now() / 1000));
  return NextResponse.json(
    { error: "Too Many Requests" },
    {
      status: 429,
      headers: {
        "X-RateLimit-Limit":     String(limit),
        "X-RateLimit-Remaining": String(remaining),
        "X-RateLimit-Reset":     String(resetSec),
        "Retry-After":           String(retryAfter),
      },
    }
  );
}
```

### パッケージ追加

```
@upstash/ratelimit   # レートリミット実装
@upstash/redis       # Upstash Redis REST クライアント（@upstash/ratelimit の peer dependency）
```

---

## セキュリティ設計（認証・認可・入力検証の方針）

### レートリミット識別子の選定

| 識別子 | メリット | デメリット |
|---|---|---|
| `user.id`（採用） | 認証済みユーザーを正確に識別できる。NAT・VPN・プロキシの影響を受けない | 複数デバイスで共有される（意図通り） |
| IP アドレス | 実装が簡単 | NAT 環境で複数ユーザーが同一 IP を共有し、無関係ユーザーに影響が出る |

本エンドポイントは認証必須のため `user.id` が適切。task.md 記載の通り。

### Redis キーの構造

`@upstash/ratelimit` がデフォルトで `{prefix}:{identifier}` 形式でキーを管理する。デフォルトプレフィックスは `@upstash/ratelimit`。明示的な名前空間設定は不要（エンドポイントが 1 つのため）。

### 環境変数未設定時の挙動

`Redis.fromEnv()` は `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` が未設定の場合にエラーをスローする。これは本番環境での設定漏れを早期検出するため**意図した挙動**とし、フォールバック（レートリミットなしで通過）は設けない。開発環境では `.env.local` に設定すること。

---

## 制約・前提条件

1. **Upstash Redis インスタンスの事前作成**: Upstash コンソールでデータベースを作成し、REST URL とトークンを取得する作業はダイチ側の作業。ビルドは環境変数が設定された状態を前提に実装する。

2. **Vercel 環境変数の設定**: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` を Vercel プロジェクトの Environment Variables に追加する必要がある。Production・Preview・Development の全環境に設定すること（ダイチ側作業）。

3. **既存テストへの影響**: レートリミットチェックは `user.id` を Redis に送信するため、テスト環境で Upstash Redis に接続できない場合はテストが失敗する。テストでは環境変数をスタブするか、テスト専用の Upstash 無料インスタンスを使用すること。

4. **スコープ外**: 他エンドポイントへのレートリミット適用・IP 単位レートリミット・Upstash Redis 以外の実装は今回対象外（task.md 記載の通り）。
