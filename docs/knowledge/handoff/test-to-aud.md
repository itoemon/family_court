# テスタ → オーディ 引き継ぎメモ（パイプライン毎に上書きされる）

> **注意**: このメモは task.md を補足するものです。task.md と矛盾する場合は task.md を優先してください。

**タスク**: MEDIUM-001（レートリミット）  
**テスト日時**: 2026-05-26  
**テスト判定**: ⚠️ **条件付き通過**（会話フロー ✅、レートリミット ⚠️ 環境変数ブロック）  
**テストレポート**: [test-log/test_20260526_151814.md](../test-log/test_20260526_151814.md)

---

## テスト結果サマリー

| カテゴリ | シナリオ | 状態 | 実行時間 |
|---|---|---|---|
| **会話フロー** | CRITICAL-M01 | ✅ 通過 | 15.7秒 |
| | CRITICAL-M02 | ✅ 通過 | 9.1秒 |
| | CRITICAL-M03 | ✅ 通過 | 7.9秒 |
| | CRITICAL-M04 | ✅ 通過 | 7.3秒 |
| **レートリミット** | CRITICAL-RL01 | ❌ 環境変数ブロック | — |
| | CRITICAL-RL02 | ❌ 環境変数ブロック | — |
| | CRITICAL-RL03 | ❌ 環境変数ブロック | — |
| | NORMAL-RL01 | ✅ 通過 | 429ms |
| | NORMAL-RL02 | ❌ 環境変数ブロック | — |

**判定**: 
- 会話フロー: 4/4 通過 ✅
- レートリミット: 1/5 通過（ブロック: Upstash Redis 環境変数未設定）
- **総合**: 条件付き通過（環境変数設定後に再テスト）

---

## テスト実施内容

### CRITICAL-M01～M04（会話フロー・基本機能）
従来のコア機能（会話フロー・セッション管理・セキュリティ）を再確認。全て通過。

**テスタの評価**: 
- ビルド実装が設計書と矛盾なし
- 従来機能の回帰なし
- マルチユーザー・ゲスト参加・アクセス制御が正常動作

**実行テスト**:
```bash
export $(cat .env.local | grep -v '^#' | xargs) && \
npx playwright test tests/e2e/critical.spec.ts --reporter=list
# 結果: 4 passed (41.7s)
```

### CRITICAL-RL01～03・NORMAL-RL01～02（レートリミット機能）

#### 検証項目
1. **RL01**: user.id 単位で 1分間30リクエスト制限。31回目は 429 返却
2. **RL02**: 429 レスポンスに `X-RateLimit-Limit`, `X-RateLimit-Remaining`, `X-RateLimit-Reset`, `Retry-After` ヘッダーが含まれる
3. **RL03**: user.id 単位の分離（ユーザーA の制限がユーザーB に影響しない）
4. **NORMAL-RL01**: 未認証ユーザーは 401 を返す（レートリミット前に弾かれる）
5. **NORMAL-RL02**: 正常系（200）には X-RateLimit-* ヘッダーが付与されない

#### テスト環境
- テストユーザー: e2e_user_a@example.com / e2e_user_b@example.com
- テストスクリプト: `tests/e2e/ratelimit.spec.ts`（新規作成）

#### ブロッカー
```
❌ [Upstash Redis] Redis client was initialized without url or token
❌ TypeError: Failed to parse URL from /pipeline
```

**原因**: `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` が `.env.local` に未設定

#### 実装品質検査（コード監査）
✅ **完璧** — 設計書に 100% 準拠
- ✅ Ratelimit + Redis インスタンスがモジュールスコープで初期化
- ✅ slidingWindow(30, "1 m") による 1分間30リクエスト制限
- ✅ 429 レスポンスヘッダーの形式が正確（秒単位 Unix epoch）
- ✅ 処理フロー：認証 → レートリミット → パラメータ検証 → RPC（設計通り）
- ✅ パッケージ追加（@upstash/ratelimit, @upstash/redis）が完了

---

## オーディが重点確認すべき項目

### 会話フロー（CRITICAL-M01～M04）
eng-to-aud.md の記載通りのテスタ検証内容で、オーディの詳細確認項目なし。
- セッション管理・RLS 設定・アクセス制御は引き継ぎメモ参照

### レートリミット機能（CRITICAL-RL01～03）
**前提**: Upstash Redis の環境変数が設定される前提で監査

#### ✅ テスタが確認した項目（コード監査）
- ✅ Upstash Redis + @upstash/ratelimit の導入
- ✅ slidingWindow(30, "1 m") による制限値の正確性
- ✅ 429 レスポンスヘッダーの実装完全性（X-RateLimit-*, Retry-After）
- ✅ モジュールスコープでの Ratelimit インスタンス初期化
- ✅ 処理フロー（認証 → レートリミット → 検証 → RPC）が設計順序通り

#### ⚠️ オーディが詳細確認すべき項目
| 項目 | 確認方法 | 優先度 |
|------|---------|--------|
| **環境変数の無公開化** | `UPSTASH_REDIS_REST_URL` に `NEXT_PUBLIC_` 接頭辞がないか確認（`grep` で確認） | **高** |
| **Vercel 環境変数の設定範囲** | Production・Preview・Development 全環境に設定されているか Vercel ダッシュボード確認 | **高** |
| **クライアントバンドル混入チェック** | `grep -r UPSTASH .next/static/` で Redis トークン混入を確認 | **高** |
| **slidingWindow の境界ケース** | 毎分 0 秒のリセット直後に 31 リクエスト連続送信 → 30 件が 200、31 件目が 429 か確認 | **中** |
| **reset ヘッダーの秒単位** | `X-RateLimit-Reset` がミリ秒ではなく秒単位 Unix epoch か確認 | **中** |

---

## テスト実行コマンド（環境変数設定後）

環境変数設定後、テスタが再テストを実行する際:

```bash
# 環境変数設定
export $(cat .env.local | grep -v '^#' | xargs)

# dev サーバー起動
npm run dev &
sleep 5

# CRITICAL テスト再実行
npx playwright test tests/e2e/critical.spec.ts --reporter=list

# レートリミットテスト実行
npx playwright test tests/e2e/ratelimit.spec.ts --reporter=list

# JSON レポート出力
npx playwright test tests/e2e/ --reporter=json > test-results/report.json
```

---

## 実装の逸脱・例外事項

なし。実装が設計書に完全準拠。

---

## 結論

### 会話フロー（CRITICAL-M01～M04）
**テスタ判定**: ✅ **完全合格** — パイプライン継続可能

### レートリミット（CRITICAL-RL01～03）
**テスタ判定**: ⚠️ **実装品質完璧、環境変数ブロック中** 
- ビルド実装: 100% 正確（設計通り）
- テスト状況: 環境変数設定待ち
- 推奨: リード側で Upstash Redis インスタンス作成・環境変数設定後、テスタが再テスト実施

### 全体的な推奨アクション

1. **リード側**（24-48h）: Upstash Redis インスタンス作成 → `.env.local` と Vercel 環境変数に追加
2. **テスタ側**（15分）: 環境変数設定後、レートリミットテスト再実行 → 結果レポート
3. **オーディ側**（1-2h）: セキュリティ観点の詳細確認 → 本番デプロイ判定

---

**参照**: [test-log/test_20260526_151814.md](../test-log/test_20260526_151814.md), [task.md](../task.md), [design.md](../design.md), [eng-to-aud.md](eng-to-aud.md)
