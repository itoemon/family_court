# アーキ → ビルド 引き継ぎメモ

## タスク概要

FEAT-002 Phase 2（フレンド機能）と LOW-001/002（入力検証補強）を同一 PR で実装する。

- FEAT-002 Phase 2: DB テーブル新設・API Routes 5 本・`/friends` ページ新設・ヘッダーナビ修正
- LOW-001: `app/api/profile/avatar/route.ts` に magic bytes 検証を追加
- LOW-002: `app/api/profile/route.ts` の `defenseCustomInstruction` に型チェックを追加

LOW-001/002 は FEAT-002 と独立しており、先行して実装・確認できる。

---

## 実装順序

### Phase A: LOW（先行推奨・独立タスク）

1. **LOW-001**: `app/api/profile/avatar/route.ts` の MIME 検証直後（またはその前）に magic bytes チェックを挿入
2. **LOW-002**: `app/api/profile/route.ts` の `defenseCustomInstruction !== undefined` 分岐先頭に型チェックを追加

### Phase B: FEAT-002 Phase 2

3. **DB migration**: `friend_requests` テーブル作成（`supabase/migrations/` に追加）
4. **DB migration**: `search_users` PostgreSQL 関数を同じまたは別 migration ファイルで作成
5. **lib/types.ts**: `FriendRequest`・`FriendProfile`・`FriendListItem`・`IncomingRequest` 型を追加
6. **API Routes**: 以下の順で実装する（依存なし、並行可）
   - `app/api/users/search/route.ts`（GET）
   - `app/api/friends/route.ts`（GET）
   - `app/api/friends/[id]/route.ts`（DELETE）
   - `app/api/friends/requests/route.ts`（GET, POST）
   - `app/api/friends/requests/[id]/route.ts`（PATCH）
7. **`/friends` ページ**: `app/friends/page.tsx` と `_components/` 3 ファイルを作成
8. **ヘッダー修正**: 既存の Header コンポーネントに「フレンド」リンクを追加

**順序の根拠**: 型定義（5）が固まってから API（6）とページ（7）を実装することで型エラーの連鎖を防ぐ。DB migration（3・4）は API テスト前に適用が必要なので最優先。

---

## 判断根拠

### なぜ拒否時にレコードを削除するか（更新ではなく）

task.md に「`rejected` に更新する（または削除）」と両案が示されているが、削除を採用した。理由: UNIQUE INDEX が `(LEAST, GREATEST)` で張られているため、`rejected` レコードを残すと同一ペアからの再送が 409 で永続的にブロックされる。拒否 = 縁切りではなく「今回は断る」という文脈で再送を許容するのが UX 上自然なため削除を選んだ。

### なぜ UNIQUE INDEX を `LEAST/GREATEST` で構成するか

フレンド関係は双方向（A→B と B→A は同じ関係）。通常の `(sender_id, receiver_id)` UNIQUE では A が B にリクエストを送っている最中に B が A にリクエストを送れてしまう。`LEAST(a, b), GREATEST(a, b)` でペアをソートすることで両方向を同一キーとして扱い、重複を DB レベルで防ぐ。

### なぜユーザー検索に SECURITY DEFINER 関数を使うか

`auth.users` テーブルはデフォルト SQL クエリから参照できない。`supabase.auth.admin.getUserByEmail()` で 1 件ずつ検索する方法もあるが、display_name との複合検索・除外フィルタ・LIMIT を一度の DB ラウンドトリップで済ませるには SQL 関数が適切。`SECURITY DEFINER` で `auth.users` にアクセスしつつ、`SET search_path = public` で検索パスを固定することでスキーマ漏洩リスクを抑える。

### なぜ検索方式を debounce でなく送信ボタンにするか

debounce は UI の応答性を高めるが、IME 変換中に意図しない検索が走りやすく、日本語入力環境（ターゲットユーザー）では誤検索が多くなる。送信ボタン方式は実装がシンプルで、「検索した」というユーザーの意図が明確。

### なぜ DELETE /api/friends/[id] の `[id]` をフレンドの profile id ではなく request_id にするか

フレンド一覧取得（GET /api/friends）時に `request_id` を返すため、クライアントは削除操作に別途 request_id を検索する必要がない。また、request_id は一意なので「自分が関与しているか」の認可チェックが 1 クエリで完結する（`sender_id = me OR receiver_id = me` の確認）。

---

## 注意事項（実装前に必ず確認）

### Next.js App Router の動作確認

AGENTS.md の指示通り、Route Handler・Server Component の API は `node_modules/next/dist/docs/` で確認すること。特に動的ルート `[id]` の params 取得方法はバージョンによって異なる可能性がある。

### profiles.avatar_url の存在確認

`search_users` 関数・`FriendProfile` 型・各 API レスポンスが `avatar_url` を参照する。`profiles.avatar_url` が FEAT-002 Phase 1（PR #19）で追加済みであることをスキーマ（`supabase/schema.sql` または migration 履歴）で確認してから実装すること。

### `/friends` ページの middleware 除外確認

`middleware.ts` が未認証ユーザーを `/auth/login` にリダイレクトする保護パスの設定を確認する。`/friends` が保護対象に含まれていない場合は追加が必要。Server Component 内の `createSessionClient()` 確認と二重になるが、environment.md の保護方針に揃えること。

### フレンド一覧取得クエリの実装

`friend_requests` テーブルから「自分が sender または receiver で status = accepted」のレコードを取得し、相手側のプロフィールを JOIN して返す。クエリ例:

```sql
SELECT
  fr.id AS request_id,
  p.id, p.display_name, p.avatar_url
FROM friend_requests fr
JOIN profiles p ON p.id = CASE
  WHEN fr.sender_id = {me} THEN fr.receiver_id
  ELSE fr.sender_id
END
WHERE (fr.sender_id = {me} OR fr.receiver_id = {me})
  AND fr.status = 'accepted';
```

Supabase JS クライアントでの JOIN 記法は複雑なため、`supabase.rpc()` で SQL 関数化することも検討する。

### PATCH /api/friends/requests/[id] の認可チェック

`accept` 操作は必ず「自分が `receiver_id`」のリクエストのみ許可する。`sender_id` 側が自分のリクエストを強制承認できないよう、UPDATE 前に `receiver_id = me` を検証する。`createAdminClient()` は RLS をバイパスするため、このチェックをコードで忘れると誰でも任意のリクエストを承認できる穴になる。

---

## 未解決事項（実装時に判断が必要）

### 1. ヘッダーコンポーネントのパス

`app/_components/Header.tsx` が実際のパスかどうか確認すること。プロジェクト内のヘッダーコンポーネントを grep して特定してから修正する。

### 2. search_users 関数の migration ファイル分割

`friend_requests` テーブル作成と `search_users` 関数作成は同一 migration ファイルか別ファイルか、プロジェクトの migration 命名規則に従って判断する。

### 3. フレンド一覧の空状態 UI

フレンドがゼロ件のとき・受信リクエストがゼロ件のとき・検索結果がゼロ件のとき、それぞれの空状態メッセージを設ける。task.md に文言指定はないため実装者が決定してよい。既存の空状態パターン（他ページ）があれば揃えること。
