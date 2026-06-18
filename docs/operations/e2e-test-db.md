# E2E テスト用 Supabase プロジェクトのセットアップ

OPS-001 Part 2 で導入した「E2E テストを本番 Supabase ではなくテスト用 Supabase プロジェクトに向ける」運用の手順書。

## 全体像

- **`.env.local`**: 通常開発（`npm run dev`）で使う本番 Supabase の接続情報
- **`.env.test`**: E2E 実行（`npm run dev:test` / Playwright）で使うテスト用 Supabase の接続情報
- どちらも `.gitignore` 済み（`.env*` 除外、`.env*.example` のみコミット）

E2E パイプライン（`scripts/agents.sh tester` サブコマンド）の内部では、`run_tester` 関数が `TEST_MODE=1` を export してから `start_dev_server` を呼ぶ。`start_dev_server` は `TEST_MODE=1` のとき `npm run dev:test`（= `NODE_ENV=test next dev`）を使い、Next の env ローダが `.env.test` を読んで `.env.local` をスキップする。Playwright 側は `playwright.config.ts` の `loadEnvConfig` で同じく `.env.test` を読み、`process.env.E2E_TEST_*` を spec に渡す。

## 初期セットアップ（一度だけ）

### 1. テスト用 Supabase プロジェクトを作成

1. <https://supabase.com/dashboard> にログイン
2. **New Project**（無料 tier で OK・本番と同一の組織配下が便利）
3. プロジェクト名は `igiari-e2e` 等で識別しやすく
4. リージョンは本番と同じ（latency の挙動を本番に近づける）
5. DB パスワードは強めの値を保管しておく（後で migration 適用に使う可能性）

### 2. スキーマを適用

#### 推奨: `scripts/setup-test-db.sh` で一括適用

空のテストプロジェクトに対しては、`schema.sql` → `migrations/*.sql`（ファイル名昇順）を一括適用するスクリプトを使う。前提コマンド: `curl` と `jq`（未導入なら `apt install jq` 等で入れる）。

```bash
set -a && source .env.test && set +a
./scripts/setup-test-db.sh --dry-run   # 適用順と対象 ref を確認（実行しない）
./scripts/setup-test-db.sh             # 実際に適用
```

- 対象 ref は `.env.test` の `SUPABASE_PROJECT_REF` から読む。Supabase Management API（`POST /v1/projects/{ref}/database/query`）経由で適用する
- **安全装置**: 本番プロジェクト ref に対しては実行を拒否する。また `public.profiles` が既に存在する DB（初期化済み）には `schema.sql` の `CREATE TABLE` が衝突するため preflight で拒否する。空プロジェクト専用と考える
- `applied.txt` はテスト DB では使わない（本番運用用の管理ファイル）

#### 手動: Supabase SQL Editor

スクリプトが使えない場合は、ダッシュボード → **SQL Editor** に以下の順で流す:

1. `supabase/schema.sql` を全コピペして実行
2. `supabase/migrations/` 配下の SQL を**ファイル名昇順**で全て実行
   - 開発の進捗で増えているので、ローカルで `ls -1 supabase/migrations/*.sql | sort` して順序を確認
   - applied.txt は本番運用用の管理ファイル。テスト DB では使わない（毎回スキーマを最新に揃え直す前提）

`schema.sql` は本番の現スナップショットであり、`judge_messages`・`profiles` の追加列（`avatar_url` / `defense_custom_instruction` / `opening_greeting` / `closing_greeting`）・`cases` の FEAT-006 列・`arguments.is_greeting` を既に含む。一方これらを作る migration（`20260524000000` / `20260526000001` / `20260612164035`）も同じオブジェクトを定義するため、両者を素直に流すと二重定義になる。これを避けるため当該 migration は冪等化済み（policy は `DROP POLICY IF EXISTS` 前置、列追加は `ADD COLUMN IF NOT EXISTS`）であり、`schema.sql` → migrations 全実行はエラーなく完走する。手動スキップは不要（OPS-002 で対応）。

### 3. Storage バケットを確認

`feat002_phase1_profiles` の migration で `avatars` バケットが自動作成されるはず。**Storage → Buckets** で `avatars` の存在を確認。

### 4. SMTP 設定

E2E のサインアップ系 spec が確認メール経由のフローを通る場合のみ必要。**Authentication → Providers → Email** で SMTP を設定するか、テスト DB では **Confirm email** を**OFF** にして即時有効化させる方がテストが安定する（推奨）。

### 5. E2E テスト用ユーザーを作成

**Authentication → Users → Add user → Create new user** で 2 名作成:

| Email | Password | 用途 |
|---|---|---|
| `e2e_user_a@example.com` | `E2eTest123!` | spec の主操作者 A |
| `e2e_user_b@example.com` | `E2eTest123!` | spec の対向操作者 B（friends/laws 系で使用） |

「Auto Confirm User」を **ON** にして即時ログイン可能に。Email Confirmation を Off にしている場合は不要。

#### A-B のフレンド関係（laws 系 spec の前提）

`tests/e2e/laws.spec.ts` の CRITICAL-L02〜L04（招待・改定合意・オーナー移譲）は、A の InvitePanel に B が表示されること、すなわち **A と B が accepted のフレンド**であることを前提とする。テスト DB に未設定だと招待ボタンが出ず失敗するため、1 行投入しておく（SQL Editor もしくは Management API）:

```sql
insert into public.friend_requests (sender_id, receiver_id, status)
values ('<A の user id>', '<B の user id>', 'accepted')
on conflict do nothing;
```

### 6. テスト用シークレットを生成

本番と同じ値を使うと、テスト中の暗号化済みデータが本番側の鍵で復号できてしまう可能性があるため、別の値を生成:

```bash
# ENCRYPTION_KEY
openssl rand -hex 32

# GUEST_TOKEN_SECRET
openssl rand -hex 32
```

### 7. （任意）テスト用 Upstash Redis インスタンスを作成

`ratelimit.spec.ts` が Redis を叩く。本番 Redis と共有しても実害は小さい（ratelimit はキーごとに独立、テスト用キーは破棄可能）が、分離するなら Upstash で別 DB を作って URL/TOKEN を新規発行。

### 8. `.env.test` を作成

`.env.test.example` をコピーして実値を埋める:

```bash
cp .env.test.example .env.test
$EDITOR .env.test
```

埋める値:
- `NEXT_PUBLIC_SUPABASE_URL`: ステップ 1 で作ったプロジェクトの URL
- `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`: Settings → API → Publishable key
- `SUPABASE_SECRET_KEY`: Settings → API → Secret key
- `SUPABASE_ACCESS_TOKEN`: <https://supabase.com/dashboard/account/tokens> で新規発行（テスト DB のマイグレーション適用用）
- `SUPABASE_PROJECT_REF`: URL のサブドメイン部分（例: `abcdefgh`）
- `ENCRYPTION_KEY` / `GUEST_TOKEN_SECRET`: ステップ 6 で生成した値
- `E2E_TEST_EMAIL_A/B` / `E2E_TEST_PASSWORD_A/B`: ステップ 5 で作ったユーザー
- `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`: 本番と共有 or ステップ 7 で発行

### 9. 動作確認

```bash
# テスト DB ターゲットで dev サーバー起動
npm run dev:test

# 別シェルでブラウザ確認: http://localhost:3000
# /auth/login に e2e_user_a@example.com / E2eTest123! でログインできれば成功
```

Playwright を直接回す場合:

```bash
set -a && source .env.test && set +a
npx playwright test tests/e2e/
```

`scripts/agents.sh tester` から起動すると上記が自動で行われる。

## トラブルシューティング

### `NEXT_PUBLIC_SUPABASE_URL` が `.env.local` の値で表示される

`.env.local` が読まれている = `NODE_ENV=test` が効いていない。`npm run dev:test` で起動しているか確認。直接 `next dev` を叩いていないか確認。

### マイグレーションがテスト DB に反映されない

`SUPABASE_PROJECT_REF` がテスト用プロジェクトを指しているか `.env.test` を再確認。`scripts/agents.sh` の `run_migrations` は環境変数を読むだけなので、シェル側で `.env.test` を source した状態で実行する必要がある:

```bash
set -a && source .env.test && set +a
# その後 engineer / migration 系の操作を実行
```

### E2E ユーザーでログインできない

- メール認証 ON のままユーザーを作っている可能性 → ダッシュボードで「Auto Confirm User」相当の状態にする
- パスワードに記号が含まれて bash 展開を受けている可能性 → `.env.test` 上ではダブルクォートで囲む

## マイグレーション同期の運用

スキーマ変更を本番 DB に適用したら、テスト DB にも同じ migration を適用すること。**運用ルール**:

- **engineer / マイグレーション系 PR を作るとき**: 本番適用後に「テスト DB にも同じ SQL を SQL Editor で実行する」を PR チェックリストに追加（または手元で `set -a && source .env.test && set +a && scripts/...` 経由で当てる）
- スキーマがズレるとテストが意味をなさなくなるので、ズレを感じたら `supabase/schema.sql` を SQL Editor で再実行してテスト DB を初期化する手も

## 残課題

- ~~マイグレーション適用の半自動化~~ → `scripts/setup-test-db.sh` で対応済み（空プロジェクトへの `schema.sql` → migrations 一括適用。OPS-002 の冪等化が前提）
- ratelimit spec のためのテスト用 Redis 切り替え（現状 `.env.test` の `UPSTASH_REDIS_*` が本番と共有なら衝突しないが、別インスタンスがあるほうがクリーン）
- テスト DB の定期リセット（テストが書き残したデータの蓄積防止）
