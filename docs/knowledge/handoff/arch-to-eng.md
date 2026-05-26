# アーキ → ビルド 引き継ぎメモ

## タスク概要

FEAT-003「法律作成機能」を実装する。詳細は `docs/knowledge/design.md` を参照すること。

---

## 実装順序

以下の順序で進めること。後続ステップは前のステップが完了していないと動作確認ができない。

### Step 1: DB マイグレーション

`supabase/migrations/` に新しいマイグレーションファイルを作成し、5テーブルを追加する。

作成するテーブル（設計書のスキーマを参照）:
1. `public.laws`
2. `public.law_members`
3. `public.law_invitations`
4. `public.law_proposals`
5. `public.law_proposal_votes`

合わせて RLS 有効化と SELECT ポリシーを同じファイルに含めること。インデックスも忘れずに追加する。

### Step 2: 型定義の追加

`lib/types.ts` に `Law`, `LawMember`, `LawInvitation`, `LawProposal`, `LawProposalVote` 型と `ProposalType`, `InvitationStatus` を追加する（設計書の型定義セクションを参照）。

### Step 3: API Routes の実装

設計書の API 仕様に従い、以下の順で実装する。

1. `GET /api/laws` + `POST /api/laws`（基本 CRUD）
2. `GET /api/laws/[id]`（詳細取得、メンバーチェック含む）
3. 招待系: `POST /api/laws/[id]/invitations`, `PATCH /api/laws/[id]/invitations/[invId]`
4. 退会: `DELETE /api/laws/[id]/members/me`
5. オーナー移譲: `PATCH /api/laws/[id]/owner`
6. 提案: `POST /api/laws/[id]/proposals`, `DELETE /api/laws/[id]/proposals/[propId]`
7. 投票（合意チェック含む）: `POST /api/laws/[id]/proposals/[propId]/votes`

### Step 4: middleware.ts への追加

`/laws` と `/laws/**` を認証保護対象パスに追加する。現在の保護パスリストを確認し、プレフィックスマッチの書き方に合わせること（PR #15 で整備済みの書き方を踏襲する）。

### Step 5: ページ・コンポーネントの実装

1. `/laws/page.tsx`（Server Component: 一覧）
2. `/laws/new/page.tsx` + `LawForm.tsx`（作成フォーム）
3. `/laws/[id]/page.tsx` + 各 Client Component（詳細）

---

## 設計判断の理由

### 改定案と削除提案を同一テーブル（`law_proposals`）に統合した理由

改定案と削除提案は「全メンバーの合意で実行される」「1法律につき1件のみ」「オーナーが取り下げられる」という点で同じメカニズムを持つ。テーブルを分けると `law_proposal_votes` に相当するテーブルが2本必要になり、合意チェックのロジックも重複する。`proposal_type` フィールドで区別することで、テーブル数と実装量を削減できる。

### `proposed_by` を `ON DELETE RESTRICT` にした理由

提案者がアカウント削除された場合に提案レコードを CASCADE 削除すると、他のメンバーが合意していた提案が消える。アカウント削除は現状スコープ外だが、将来追加された際に予期しないデータ消失が起きないよう RESTRICT を選択した。

### 合意チェックをアプリ層で行う理由

DB トリガーや PostgreSQL 関数でも実装できるが、デバッグが困難になる。家族・カップルという少人数ユースケースでは競合が現実的に発生しないため、可読性を優先してアプリ層で行う。競合リスクについては制約・前提条件セクションに記載している。

### RLS は READ のみ定義し、WRITE はアプリ層で制御する理由

environment.md の設計方針「API Routes での書き込みは必ず `createAdminClient()` を使い、サーバー側コードで本人確認を行う。RLS に認可を委ねない」に準拠する。既存コードとの一貫性を保つため、この方針を FEAT-003 でも踏襲する。

---

## 実装上の注意事項

### 合意チェック後の処理

投票 API（`POST /api/laws/[id]/proposals/[propId]/votes`）の中で合意チェックを行い、成立したら副作用を実行する。

```
合意チェック:
  SELECT COUNT(*) FROM law_members WHERE law_id = $lawId  → totalCount
  SELECT COUNT(*) FROM law_proposal_votes
    WHERE proposal_id = $propId AND approved = true        → approvedCount
  合意 = (totalCount > 0 AND totalCount === approvedCount)
```

合意時の処理:
- `amendment`: `UPDATE laws SET article = $proposedArticle, updated_at = now() WHERE id = $lawId` → `DELETE FROM law_proposals WHERE id = $propId`（CASCADE で votes も消える）
- `deletion`: `DELETE FROM laws WHERE id = $lawId`（CASCADE で members / invitations / proposals / votes が全消去）

### 退会時の合意チェック

`DELETE /api/laws/[id]/members/me` の実装:
1. 進行中の提案があるか確認（`law_proposals WHERE law_id = $lawId`）
2. あれば `DELETE FROM law_proposal_votes WHERE proposal_id = $propId AND user_id = $userId`
3. `DELETE FROM law_members WHERE law_id = $lawId AND user_id = $userId`
4. 提案があった場合は合意チェック → 成立なら適用

Step 2と3の順序を守ること。先にメンバーを削除してから投票を削除すると、合意チェックの分母（メンバー数）が先に変わる。

### 招待のフレンドチェック

`friend_requests` テーブルの `status` カラムに `'accepted'` の値が格納されている前提で実装する（FEAT-002 Phase 2 の実装に依存）。実装前に `friend_requests` テーブルの実際のスキーマを `supabase/` で確認すること。

### 法律一覧取得のクエリ

`law_members` JOIN `laws` JOIN `profiles` で取得し、さらに各法律の `law_proposals` の存在有無（`has_active_proposal`）をサブクエリかカウントで付加する。Supabase クライアントの `select` で複雑なネストが必要になる場合は SQL を直書きすることも検討する。

### 409 エラーの使い分け

| 状況 | エラー内容 |
|------|-----------|
| 提案がすでにある（UNIQUE 違反 23505） | 409: 既に進行中の提案があります |
| フレンドでない | 409: フレンドではありません |
| すでにメンバー | 409: 既にメンバーです |
| 招待済み（pending） | 409: 既に招待済みです |
| 移譲先がメンバーでない | 409: メンバーではありません |

### InvitePanel の検索フィルタリング

既存の `/api/users/search` を流用するが、レスポンスに含まれるユーザーのうち「すでにメンバー」「pending 招待済み」のものは UI 側でフィルタまたは disabled 表示する。フィルタリングは InvitePanel の Client Component 内で行う（検索 API を変更しない）。

---

## 未解決事項・要確認

1. **バックログの `friend_requests` スキーマ**: 実装前に `supabase/migrations/` で `friend_requests` テーブルのカラム名と `status` の値を確認すること。設計書は `status = 'accepted'` と仮定している。

2. **middleware.ts の保護パス書き方**: PR #15 で整備した方式を確認し、それに合わせて `/laws` と `/laws/**` を追加すること。誤った追加は既存の認証フローを壊す可能性がある。

3. **`law_proposals` の `proposed_article` は amendment 時の CHECK**: DB 側の CHECK 制約 `law_proposals_article_required` で保証しているが、アプリ層でも先にバリデーションして 400 を返すこと。DB エラーをそのままユーザーに返さない。

4. **`anon` への GRANT**: マイグレーションに `GRANT SELECT ON public.law_* TO anon;` を書かないこと（backlog LOW-001 の教訓）。`authenticated` ロールのみが必要。
