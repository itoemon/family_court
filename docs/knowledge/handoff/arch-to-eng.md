# アーキ → ビルド 引き継ぎメモ

## タスク概要

MEDIUM-001: `GET /api/users/search` に Upstash Redis + `@upstash/ratelimit` を用いて `user.id` 単位のレートリミット（1分間30リクエスト）を追加する。

変更ファイルは `app/api/users/search/route.ts` 1 ファイルのみ。DB 変更・新規ファイル作成なし。

---

## 実装順序

1. パッケージインストール: `npm install @upstash/ratelimit @upstash/redis`
2. `.env.local` に `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` を追加（ダイチから値を受け取ること）
3. `app/api/users/search/route.ts` を修正:
   - モジュールスコープで `Ratelimit` インスタンスを初期化
   - セッション確認直後・クエリパラメータ検証の前にレートリミットチェックを挿入
   - 制限超過時に `X-RateLimit-*` ヘッダー付きで 429 を返す

実装量が少ないため並行タスクなし。上から順に進める。

---

## 判断根拠

### なぜ Route Handler 内で実装するか（Middleware でなく）

task.md に「`app/api/users/search/route.ts` 内で適用する」と明記されているため。

Middleware でのレートリミットも選択肢としてはありうる（全エッジで動くため低レイテンシ）が、今回は対象エンドポイントが 1 つのみで、将来的に他エンドポイントへの拡張がスコープ外のため、Route Handler 内の局所実装が保守性の観点で適切。

### なぜ slidingWindow アルゴリズムか（fixedWindow でなく）

`fixedWindow` は窓の境界（毎分0秒）でリセットが走るため、境界前後に連続リクエストを集中させると事実上2倍のリクエストを短時間に通せる。`slidingWindow` は常に「直近1分間」で計算するためこの問題がない。ユーザー列挙攻撃の抑制が目的なので、突発的な急増を防ぐ slidingWindow が適切。

### なぜ `user.id` を識別子にするか（IP でなく）

このエンドポイントは認証必須のため、認証後に確定する `user.id` で識別するのが正確。IP は NAT・プロキシ・VPN で複数ユーザーが共有するため、無関係なユーザーを誤ってブロックするリスクがある。task.md 記載の方針と一致。

### なぜ環境変数未設定時のフォールバックを設けないか

`Redis.fromEnv()` が環境変数未設定でエラーをスローするのは本番設定漏れの早期検出に有用。「設定なしでも動く」フォールバックはレートリミットを無効化する抜け穴になるため採用しない。開発環境では `.env.local` への設定を必須とする。

---

## 注意事項（実装前に必ず確認）

### `@upstash/ratelimit` の `reset` 値の単位

`limit()` の戻り値 `reset` は **Unix epoch milliseconds**（ミリ秒）。
`X-RateLimit-Reset` ヘッダーの慣例は**秒**のため、必ず `Math.ceil(reset / 1000)` で変換すること。ミリ秒のまま返すとクライアントが誤ったタイムスタンプを受け取る。

### Ratelimit インスタンスのスコープ

`new Ratelimit(...)` と `Redis.fromEnv()` はモジュールスコープ（関数外）で初期化すること。Route Handler 関数内で毎リクエスト生成するとコネクション確立コストが発生し、性能劣化とリソースリークの原因になる。

### AGENTS.md の確認

Route Handler の実装前に AGENTS.md の指示通り `node_modules/next/dist/docs/` を確認し、`NextResponse.json()` のシグネチャが想定通りかを確認すること。特にヘッダーの渡し方（第2引数の `headers` オブジェクト）はバージョン依存の可能性がある。

### テスト環境

既存の E2E テスト（`test/` 配下）でこのエンドポイントを叩いているものがある場合、Upstash Redis の接続が必要になる。テスト実行前に環境変数が設定されているか確認すること。設定がない場合は Redis クライアントの初期化でエラーになる。

---

## 未解決事項

### Upstash Redis インスタンスの用意

Upstash のアカウント作成とデータベース作成はダイチ側の作業。`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` の値が揃い次第、`.env.local` と Vercel 環境変数に設定して実装を進める。値が揃う前でも実装自体は進められる（接続テストのみ後回し）。
