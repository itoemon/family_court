# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

MEDIUM-001（レートリミット）を実装する。

---

## M-1. `/api/users/search` にレートリミットを追加

### 背景・目的

`GET /api/users/search` は認証済みユーザーなら制限なく呼び出せる。`display_name ILIKE 'q%'` の前方一致検索を連続実行することで全ユーザーを列挙できるため、プライバシーリスクがある。

### 要件

- `user.id` 単位で 1分間に最大 30 リクエストまで
- 超過時は 429（Too Many Requests）を返す
- レートリミットの実装方法: **Upstash Redis + `@upstash/ratelimit`**（Vercel Edge 環境で動作する定番実装）

### 実装方針

- `app/api/users/search/route.ts` 内でレートリミットを適用する
- Upstash Redis の接続情報は環境変数（`UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN`）で管理する
- Vercel にも同じ環境変数を設定する必要がある（ダイチ側作業）

### スコープ外

- 他のエンドポイントへのレートリミット適用（今回は search のみ）
- IP 単位のレートリミット（user.id 単位のみ）
- Upstash Redis 以外の実装

---

## スコープ外（共通）

- フレンド機能の変更
- UI の変更
