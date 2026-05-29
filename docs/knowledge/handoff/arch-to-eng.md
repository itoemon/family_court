# アーキ → ビルド 引き継ぎメモ

## タスク概要

MEDIUM-001（FEAT-003 監査由来）対応。`app/laws/page.tsx` と `app/laws/[id]/page.tsx` の Server Component を `createAdminClient()` から `createSessionClient()` へ切り替え、RLS による二重防御を有効化する。詳細設計は `docs/knowledge/design.md` の **「MEDIUM-001 対応: Server Component の RLS 経由化（FEAT-003 補強）」** セクションを参照すること。

**最重要事項**: `profiles` テーブルは本 PR で **一切触らない**。`law_*` テーブルの読み取りのみ session client に切り替える。理由は設計書の「`profiles` テーブルは本 PR では触らない」節を参照。

---

## 実装順序

後続ステップは前のステップが完了していないと動作確認できない。順序は厳守すること。

### Step 1: 新規マイグレーション 1 枚を追加

ファイル：`supabase/migrations/<新タイムスタンプ>_medium001_laws_select_invitee.sql`

中身は design.md の「migration 設計」セクションのコードブロックをそのまま使用する。重要点：

- 既存マイグレーション `20260526000003_feat003_laws.sql` は **編集しない**。
- `BEGIN` / `COMMIT` で囲む。
- 新旧両ポリシーに `DROP POLICY IF EXISTS` を付けて冪等にする。
- `GRANT` は触らない。
- 末尾コメントにロールバック SQL を残す。

適用後、Supabase の `pg_policies` ビューで `laws_select_member` が消え、`laws_select_member_or_invitee` が現れることを確認すること。

### Step 2: `app/laws/page.tsx` の書き換え

切り替え方針：

- `law_*` テーブル参照の `createAdminClient()` 呼び出しを `createSessionClient()` に置き換える。
- `auth.getUser()` の null チェックは先頭で維持。
- `law_members` / `laws` / `law_invitations` / `law_proposals`（バッジ判定）の SELECT は session client。
- `profiles` 参照だけは `createAdminClient()` を残す。
- アプリ層フィルタ（`.eq("invitee_id", user.id)` 等）は **削除せず温存**。

### Step 3: `app/laws/[id]/page.tsx` の書き換え

メンバー分岐と非メンバー（pending invitee）分岐の両方で session client を使う：

- メンバー判定：`law_members` を `.eq("law_id", id).eq("user_id", user.id)` で取得（session client）。
- メンバー分岐：`laws` / `law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` を session client で取得、`profiles` のみ admin。
- 非メンバー分岐：`law_invitations` を `.eq("invitee_id", user.id).eq("status", "pending")` で取得 → pending あれば `laws.name` / `laws.article` を session client で取得して招待受諾画面を表示。
- 非メンバーかつ pending 招待なしの場合は 404 相当の redirect。

`profiles` 参照は分岐に関わらず admin のまま据え置き。

### Step 4: grep による取り残し確認

以下のコマンドで漏れがないかを確認する：

```
rg "createAdminClient" app/laws/page.tsx app/laws/\[id\]/page.tsx
```

`profiles` 参照箇所のみで使われている状態が期待値。`law_*` テーブルへのクエリで admin が残っていたら修正すること。

---

## 設計判断の理由

### 新 `laws` SELECT ポリシーにオーナー条件を独立して入れた理由

通常運用ではオーナーは必ず `law_members` に登録されているため、メンバー条件で通る。しかし `law_members` レコードが障害（手動削除・移行ミス）で失われた場合でもオーナーが自分の法律本体を閲覧して状態を確認できる必要がある。コストは EXISTS 1 件追加分のみで、防御の冗長性とのトレードオフでは保険を選ぶ。

### `status = 'pending'` でフィルタする理由

`accepted` の invitee は既にメンバー条件で通る。`rejected` の invitee には閲覧権を失わせるべきなので明示的に除外する。これは「招待を断った相手に法律内容を見続けられない」という妥当な振る舞いをポリシー側で保証する設計判断。

### `profiles` を触らない理由

列レベル GRANT は role 単位でしか効かず、「本人なら全列、他人なら一部列」を表現できない。`app/page.tsx` および `app/profile/page.tsx` が `api_key_encrypted` 等を直接読んでいるため、機微列を GRANT で絞ると本人取得経路が壊れる。`profiles` の RLS 整備は別 backlog 項目で後日扱う。

### アプリ層フィルタを削除しない理由

RLS による絞り込みと同じ集合になるため一見冗長だが、将来 RLS ポリシーが誤って緩められた場合（バグ migration、検証不足の差し替え等）に即時のデータ露出を防ぐ二層目の防御として機能する。MEDIUM-001 指摘の本質は「単一防御の脆弱性」なので、片方だけでなく両方を厚くする。

### 他テーブル（`law_members` 等）のポリシーを変更しない理由

設計書の「他テーブルの既存ポリシー検証結果」表で示した通り、Server Component が必要とする行はすべて既存ポリシーで返る。不要な変更は監査コストを上げ、デグレ余地を増やすため最小差分にとどめる。

---

## 実装上の注意事項

### Supabase クライアントの import

`lib/supabase/server.ts` の `createSessionClient()` / `createAdminClient()` の両方を import する。`createAdminClient()` を完全に消さないこと（`profiles` 参照で必要）。

### 並列クエリと依存関係

セッションクライアントで複数テーブルを `Promise.all` で並列取得する場合、各クエリが独立した RLS 評価を受ける。`law_members` の取得結果を `.in("id", lawIds)` で `laws` 取得に渡している経路では、依存関係上 await を挟む必要がある。並列化と依存関係を整理してから書き換えること。

### `law_proposals` の「有効な提案あり」バッジ

一覧画面でバッジ表示に使っている `law_proposals` のカウントクエリは、既存の `law_proposals_select`（メンバーのみ）でカバーされる。session client で `.select("id", { count: "exact", head: true })` するだけで RLS により自分が属する法律分のみ返る。

### 非メンバー分岐の挙動確認

`/laws/[id]` を「招待されていない非メンバー」で開いた場合：

- 新 RLS では `laws` の SELECT は空集合（オーナーでもメンバーでも pending invitee でもない）
- 既存の `law_members` クエリも空集合
- `law_invitations` の `eq("invitee_id", user.id).eq("status", "pending")` も空集合
- 結果として 404 相当の redirect に到達する

これは仕様通り。意図せず admin に切り替えてしまうと、見えてはいけない URL 直打ちアクセスが通る危険があるため、Step 4 の grep 確認を必ず行うこと。

### マイグレーションの本番適用順

PR レビュー後、本番（Supabase Production）への適用順序：

1. マイグレーション適用
2. Vercel デプロイ（Server Component の書き換え）

マイグレーションを先に当てると、Server Component が旧コード（admin 経由）でも新 RLS でも動作するため、デプロイ順による短時間の不整合が起きない。逆順（コード先・migration 後）は invitee 画面が短時間壊れる（新コードが旧 RLS に当たって `laws` を見られない）。

### `anon` への GRANT は付けない

新マイグレーションに `GRANT SELECT ON public.laws TO anon;` 等を書かないこと（backlog LOW-001 と同じ教訓）。`authenticated` ロールへの既存 GRANT は別マイグレーションで既に付与済みなので、新ポリシーは追加 GRANT なしで評価される。

---

## 動作確認シナリオ

実装後、以下を順に手動で確認する。

### S1: メンバーとして `/laws` を表示
- 自分が所属する法律一覧が表示される
- 進行中の提案がある法律にバッジが付く
- 表示内容が書き換え前と同等であること（メンバー視点の UX 不変を確認）

### S2: pending invitee として `/laws` を表示
- 「届いた招待」セクションに自分宛 pending 招待の法律名が表示される
- 法律名取得が新 RLS により成功していること

### S3: メンバーとして `/laws/[id]` を表示
- 法律本体・メンバー一覧・pending 招待（オーナー時）・進行中提案・投票状況がすべて表示される
- session client 切り替え後も書き換え前と同等の情報量

### S4: pending invitee として `/laws/[id]` を表示
- 招待受諾画面が表示される（法律名・条文が見える）
- 承認・拒否ボタンが動作する（API 経由なので本 PR では変更なしのはず）

### S5: 招待を rejected した後に `/laws/[id]` を再度開く
- 法律本体が見えなくなる（404 相当の redirect）
- 新 RLS が `status = 'pending'` でフィルタしていることの確認

### S6: 非メンバー・非 invitee として `/laws/[id]` を URL 直打ち
- 404 相当の redirect になる
- admin クライアント切り替え忘れがないことの確認

### S7: メンバーが退会した後の閲覧
- メンバーリストから消え、自身も法律詳細にアクセスできなくなる
- RLS のメンバー条件が通らなくなることの確認

---

## 未解決事項・要確認

1. **`/laws/[id]` の非メンバー分岐の現状実装**: 設計書では「非メンバー（pending invitee）の場合は招待受諾画面を表示」としているが、現状の `app/laws/[id]/page.tsx` がこの分岐をどのように実装しているか（あるいは未実装か）は Read で確認すること。設計書通りの分岐が存在しなければ、本 PR スコープに含めるべきかどうか task.md / リードへ確認する（独断で分岐を新規追加しないこと）。

2. **`law_proposals` のバッジクエリの形**: `app/laws/page.tsx` でバッジに使っているクエリを確認し、`law_proposals_select`（メンバーのみ）の RLS で必要行が返ることを実機で検証すること。

3. **`profiles` 参照箇所の網羅**: `app/laws/page.tsx` と `app/laws/[id]/page.tsx` のすべての `profiles` SELECT を grep で抽出し、各箇所が admin に残っていることを最終確認する。誤って session client に巻き込むと、機微列（`api_key_encrypted` 等）が含まれるクエリで予期しない読み取り失敗が発生する可能性がある。

4. **`PendingInvitations.tsx` は本 PR で触らない**: backlog LOW-002（fetch ステータス検査）の指摘対象だが、本 PR スコープ外。実装中に同ファイルが目に入っても変更しないこと。

5. **`anon` GRANT・UUID バリデーション・FK 23503 ハンドル等**: backlog の他の LOW 項目はすべて本 PR スコープ外。混入させないこと。
