# タスク指示（パイプライン実行前にリード/ダイチが更新する）

> **優先順位**: このファイルの内容は最優先。設計書・handoff メモと矛盾する場合は必ずこちらを優先すること。

## 今回のタスク

FEAT-002 Phase 2（フレンド機能）と LOW-001/002（技術負債）を同一 PR で実装する。

---

## H-1〜H-4. フレンド機能（FEAT-002 Phase 2）

### 背景・目的

FEAT-003（法律作成機能）の前提となるユーザー間のつながりを管理する仕組みを追加する。
フレンドが存在することで、法律への招待対象をフレンドに限定できる。

### 要件

#### H-1. フレンドリクエスト送信

- プロフィール画面（`/profile`）またはフレンド専用画面に検索フォームを設ける
- メールアドレスまたは表示名（display_name）でユーザーを検索できる
- 検索結果のユーザーに対してリクエストを送信できる
- 自分自身・既存フレンド・送信済みリクエスト相手への送信は不可

#### H-2. リクエスト承認 / 拒否

- 受信したリクエストを一覧表示する
- 承認: `friend_requests.status` を `accepted` に更新する
- 拒否: `friend_requests.status` を `rejected` に更新する（または削除）

#### H-3. フレンド一覧表示

- 承認済みのフレンドを一覧表示する（display_name + アイコン）
- フレンドのプロフィールは表示しない（名前とアイコンのみ）

#### H-4. フレンド削除

- フレンド一覧からフレンドを削除できる
- 削除すると双方のフレンド関係が解除される（`friend_requests` レコードを削除）

### DB 変更

- `friend_requests` テーブルを新規作成
  - `id` uuid PK
  - `sender_id` uuid（`profiles.id` 参照）
  - `receiver_id` uuid（`profiles.id` 参照）
  - `status` text（`pending` / `accepted` / `rejected`）
  - `created_at` timestamptz

### 画面

| 画面 | パス | 認証 |
|------|------|------|
| フレンド管理 | `/friends` | 必須 |

- `/friends` にフレンド一覧・リクエスト受信一覧・検索フォームをまとめる
- ヘッダーナビに「フレンド」リンクを追加する

### スコープ外

- フレンドのプロフィール詳細表示
- フレンドとのダイレクトメッセージ
- フレンド数の上限制御
- フォロー型（非対称）の関係

---

## LOW-001. Magic bytes 検証（app/api/profile/avatar/route.ts）

- ファイル先頭 12 バイトを読んで JPEG / PNG / WebP のシグネチャを照合する
- 不一致なら 400 を返す
- シグネチャ:
  - JPEG: `FF D8 FF`
  - PNG: `89 50 4E 47 0D 0A 1A 0A`
  - WebP: `52 49 46 46 ?? ?? ?? ?? 57 45 42 50`（バイト 8〜11 が `WEBP`）

---

## LOW-002. `defenseCustomInstruction` 型検証（app/api/profile/route.ts）

- `defenseCustomInstruction !== undefined` の分岐内先頭で型チェックを追加する
- `typeof defenseCustomInstruction !== "string" && defenseCustomInstruction !== null` なら 400 を返す

---

## スコープ外（共通）

- メール通知（フレンドリクエスト受信時）
- リアルタイム通知
- フレンドのケース履歴閲覧
