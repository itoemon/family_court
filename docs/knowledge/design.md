# 詳細設計書

## 概要（変更の目的・背景）

FEAT-002 Phase 2（フレンド機能）と LOW-001/002（技術負債）を同一 PR で実装する。

**FEAT-002 Phase 2** は FEAT-003（法律作成機能）の前提となるユーザー間のつながり管理を追加する。`friend_requests` テーブル 1 枚で双方向フレンド関係を表現し、`/friends` ページに検索・リクエスト管理・フレンド一覧をまとめる。

**LOW-001/002** は既存 API Route の入力検証補強であり、FEAT-002 と独立して実装できる。

---

## API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

### GET /api/users/search

ユーザーを display_name（前方一致）またはメールアドレス（完全一致）で検索する。

- 認証: 必須（セッション）
- クエリパラメータ: `q`（1〜100 文字の文字列、必須）
- 除外対象: 自分自身・既存フレンド（status = accepted）・送信済みリクエスト相手（status = pending）
- Response 200:
  ```json
  [
    { "id": "uuid", "display_name": "string", "avatar_url": "string | null" }
  ]
  ```
- Error: 400（`q` 欠如または不正）、401（未認証）
- 上限: 1 クエリあたり最大 20 件

**実装方式**: `auth.users` への直接 SQL クエリは制限されるため、`SECURITY DEFINER` PostgreSQL 関数 `search_users` を定義し API Route から `supabase.rpc()` で呼び出す（詳細はデータモデル参照）。

---

### GET /api/friends

自分のフレンド一覧（status = accepted）を返す。

- 認証: 必須
- Response 200:
  ```json
  [
    {
      "request_id": "uuid",
      "friend": { "id": "uuid", "display_name": "string", "avatar_url": "string | null" }
    }
  ]
  ```
  `request_id` は削除操作（DELETE /api/friends/[id]）に使用する。

---

### POST /api/friends/requests

フレンドリクエストを送信する。

- 認証: 必須
- Request body:
  ```json
  { "receiver_id": "uuid" }
  ```
- サーバー側検証: 自分自身・既存フレンド・送信済み相手への送信は 409（DB の UNIQUE 制約との二重防衛）
- Response 201: `{ "id": "uuid" }`
- Error: 400（`receiver_id` 形式不正）、401、409（重複・自己送信）

---

### GET /api/friends/requests

自分宛ての未処理リクエスト（status = pending）一覧を返す。

- 認証: 必須
- Response 200:
  ```json
  [
    {
      "id": "uuid",
      "sender": { "id": "uuid", "display_name": "string", "avatar_url": "string | null" },
      "created_at": "timestamptz"
    }
  ]
  ```

---

### PATCH /api/friends/requests/[id]

リクエストを承認または拒否する。`[id]` は `friend_requests.id`。

- 認証: 必須（自分が `receiver_id` のリクエストのみ操作可）
- Request body: `{ "action": "accept" | "reject" }`
- `accept`: `status` を `accepted` に更新
- `reject`: レコードを削除（再送を許容するため更新ではなく削除）
- Response 200: `{ "ok": true }`
- Error: 400（`action` 不正）、401、403（自分が受信者でない）、404（存在しない）

---

### DELETE /api/friends/[id]

フレンド関係を削除する。`[id]` は `friend_requests.id`。

- 認証: 必須（自分が `sender_id` または `receiver_id` のレコードのみ削除可）
- Response 200: `{ "ok": true }`
- Error: 401、403（自分が関与していない）、404（存在しない）

---

### 既存 API Route の修正

#### LOW-001: supabase/migrations/20260526000002_feat002_phase2_friends.sql

`search_users` 関数はデフォルトで PUBLIC に EXECUTE が付与される。`REVOKE ALL ON FUNCTION search_users(text, uuid) FROM PUBLIC` を追加し、service_role のみが RPC 実行できるよう制限する。また `anon` への `GRANT SELECT ON friend_requests` を削除し最小権限を徹底する。

#### LOW-002: app/api/friends/requests/route.ts

`POST /api/friends/requests` で存在しない `receiver_id` を送った場合、FK 違反（PostgreSQL エラーコード `23503`）が発生するが、汎用 500 に落ちていた。`23503` を個別ハンドルして 400 を返すことでクライアントエラーを正しく区別する。

---

## データモデル（DB スキーマ・型定義の変更）

### friend_requests テーブル（新規）

```sql
CREATE TABLE friend_requests (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT no_self_request CHECK (sender_id <> receiver_id)
);

-- 同一ペアの重複を方向を問わず防止する（A→B と B→A が同一キーになる）
CREATE UNIQUE INDEX friend_requests_pair_idx
  ON friend_requests (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id));

CREATE INDEX friend_requests_sender_idx   ON friend_requests (sender_id);
CREATE INDEX friend_requests_receiver_idx ON friend_requests (receiver_id);
```

**UNIQUE INDEX の意図**: `LEAST/GREATEST` でペアをソートすることで双方向の重複を DB レベルで阻止する。アプリ側の 409 チェックと合わせた二重防衛になる。

### ユーザー検索関数（新規）

`auth.users` は通常 SQL から参照不可のため、`SECURITY DEFINER` 関数で境界を作る。

```sql
CREATE OR REPLACE FUNCTION search_users(
  query       text,
  current_uid uuid
)
RETURNS TABLE (id uuid, display_name text, avatar_url text)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
  SELECT p.id, p.display_name, p.avatar_url
  FROM profiles p
  JOIN auth.users u ON u.id = p.id
  WHERE
    p.id <> current_uid
    AND (
      p.display_name ILIKE query || '%'   -- 前方一致
      OR u.email = query                  -- 完全一致のみ
    )
    AND NOT EXISTS (
      SELECT 1 FROM friend_requests fr
      WHERE fr.status IN ('pending', 'accepted')
        AND (
          (fr.sender_id = current_uid AND fr.receiver_id = p.id)
          OR
          (fr.receiver_id = current_uid AND fr.sender_id = p.id)
        )
    )
  LIMIT 20;
END;
$$;
```

### RLS ポリシー

environment.md の方針「API Routes では `createAdminClient()` を使用、RLS に認可を委ねない」に従い、API Routes はサービスロールキーで操作する。RLS は多重防衛として有効化する。

```sql
ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

-- 直接クライアントアクセス対策: 自分が関与するレコードのみ参照可
CREATE POLICY "friend_requests_select_own"
  ON friend_requests FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

-- INSERT / UPDATE / DELETE はサービスロール（API Routes）のみ
-- → ユーザー向け書き込みポリシーは設定しない
```

### TypeScript 型定義の追加（lib/types.ts）

```typescript
export type FriendRequest = {
  id: string;
  sender_id: string;
  receiver_id: string;
  status: 'pending' | 'accepted' | 'rejected';
  created_at: string;
};

export type FriendProfile = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type FriendListItem = {
  request_id: string;
  friend: FriendProfile;
};

export type IncomingRequest = {
  id: string;
  sender: FriendProfile;
  created_at: string;
};
```

---

## コンポーネント設計（新設・変更するファイルの責務と仕様）

### ディレクトリ構成（新規・変更ファイル）

```
app/
  friends/
    page.tsx                        # Server Component: 認証チェック + 初期データ取得
    _components/
      FriendList.tsx                # Client Component: フレンド一覧 + 削除ボタン
      RequestList.tsx               # Client Component: 受信リクエスト一覧 + 承認/拒否ボタン
      SearchSection.tsx             # Client Component: 検索フォーム + 送信ボタン
  api/
    friends/
      route.ts                      # GET /api/friends
      [id]/
        route.ts                    # DELETE /api/friends/[id]
      requests/
        route.ts                    # GET, POST /api/friends/requests
        [id]/
          route.ts                  # PATCH /api/friends/requests/[id]
    users/
      search/
        route.ts                    # GET /api/users/search
  _components/
    Header.tsx（変更）              # 認証済みナビに「フレンド」リンクを追加
```

### app/friends/page.tsx

Server Component。`createSessionClient()` でセッション確認し、未認証なら `/auth/login` へリダイレクト。`createAdminClient()` でフレンド一覧と受信リクエストを `Promise.all` で並列取得し、各 Client Component に Props として渡す。

### FriendList.tsx（Client Component）

- Props: `initialFriends: FriendListItem[]`
- ローカル state でリストを管理し、削除後は楽観的更新（失敗時はロールバック）
- `DELETE /api/friends/{request_id}` を fetch する

### RequestList.tsx（Client Component）

- Props: `initialRequests: IncomingRequest[]`
- 承認・拒否ボタン → `PATCH /api/friends/requests/{id}` → state から除去
- 承認後は `router.refresh()` でページ全体を再検証し、フレンド一覧に反映する

### SearchSection.tsx（Client Component）

- **検索方式: 送信ボタン方式（debounce なし）**。debounce はリクエスト抑制に有効だが実装が複雑になるため、明示的な「検索」ボタン押下で `GET /api/users/search?q=...` を呼ぶ。
- 検索結果の各ユーザーに「リクエストを送る」ボタンを表示。送信成功後、そのユーザーを結果リストから除外する。

### Header.tsx（変更）

認証済みナビゲーション部分に `<Link href="/friends">フレンド</Link>` を追加する。既存リンクのスタイルクラスに揃える。

---

## セキュリティ設計（認証・認可・入力検証の方針）

### 認証・認可

| エンドポイント | 認証 | 追加の認可チェック（サーバー側） |
|---|---|---|
| GET /api/users/search | セッション必須（401） | — |
| GET /api/friends | セッション必須 | — |
| POST /api/friends/requests | セッション必須 | `receiver_id ≠ 自分` のチェック |
| GET /api/friends/requests | セッション必須 | — |
| PATCH /api/friends/requests/[id] | セッション必須 | `receiver_id = 自分` の確認 |
| DELETE /api/friends/[id] | セッション必須 | `sender_id = 自分 OR receiver_id = 自分` の確認 |

全エンドポイントで `createSessionClient()` によるセッション確認を実施する。認可チェックはサーバー側（API Route）で行い、RLS に依存しない（environment.md の方針に準拠）。

### 入力検証

- 検索クエリ `q`: 1 文字以上 100 文字以下の文字列
- `receiver_id`: UUID v4 形式チェック
- `action`: `"accept"` または `"reject"` のみ許可（それ以外は 400）

### ユーザー検索のプライバシー方針

- メールアドレスは**完全一致のみ**（前方一致・部分一致は不可）
- display_name は**前方一致**（`ILIKE 'query%'`）。部分一致は不可
- 返却フィールドは `id`・`display_name`・`avatar_url` のみ（メールアドレスは返さない）
- 返却上限は 20 件

---

## 制約・前提条件

1. **`profiles.avatar_url`**: FEAT-002 Phase 1（PR #19）で追加済みを前提とする。未追加の場合は検索関数・型定義の修正が必要。

2. **メールアドレス検索と auth.users**: `profiles` テーブルにメールカラムはない。`search_users` 関数内で `auth.users` を JOIN することで解決する。この関数は `SECURITY DEFINER` で定義するため、Supabase migration ファイル（`supabase/migrations/`）に追加する。

3. **拒否レコードの削除方針**: task.md の「`rejected` に更新する（または削除）」に対し、本設計では**削除を採用**する。削除により同一ペア間の再送が可能になり、UNIQUE INDEX との整合性も保てる。`rejected` レコードを残す場合は再送時に 409 が恒久的に発生するため採用しない。

4. **フレンドのプロフィール詳細表示はスコープ外**: フレンド一覧に表示するのは display_name とアバターアイコンのみ。フレンドの `/profile` への導線は設けない。

5. **リアルタイム通知はスコープ外**: リクエスト受信の確認はページリロードのみ。ポーリングも本フェーズでは不要。

6. **フレンド数上限なし**: task.md の「フレンド数の上限制御」がスコープ外のため、DB・API 両面で上限を設けない。FEAT-003 設計時に必要に応じて検討する。
