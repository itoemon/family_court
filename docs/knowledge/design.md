# 詳細設計書

## 概要（変更の目的・背景）

FEAT-003「法律作成機能」を実装する。ユーザーが独自のルールセット（法律）を作成し、フレンド間で施行・改定できる仕組みを提供する。法律の改定・削除は全メンバーの合意制とすることで、一方的なルール変更を防ぎ、関係者全員の合意形成を促す。

FEAT-002 Phase 2（フレンド機能）が前提となるが、PR #20 でマージ済みであることを git 履歴から確認している。

---

## API 仕様

### 基本方針

- 全エンドポイントで認証必須（`createSessionClient()` でユーザー確認）
- 書き込みはすべて `createAdminClient()` を使用（environment.md の規則に従う）
- 認可はアプリケーション層で行う（RLS に委ねない）

---

### GET /api/laws

自分がメンバーの法律一覧を返す。

**レスポンス**
```json
[
  {
    "id": "uuid",
    "name": "法律名",
    "article": "条文テキスト",
    "owner_id": "uuid",
    "owner_name": "表示名",
    "member_count": 3,
    "has_active_proposal": true,
    "created_at": "ISO8601"
  }
]
```

---

### POST /api/laws

法律を新規作成する。作成者がオーナー兼メンバーになる。

**リクエスト**
```json
{
  "name": "法律名（必須・最大100文字）",
  "article": "条文（必須・最大2000文字）"
}
```

**レスポンス**
```json
{ "id": "uuid" }
```

**エラー**
| ステータス | 条件 |
|-----------|------|
| 400 | name または article が空、文字数超過 |
| 401 | 未認証 |

---

### GET /api/laws/[id]

法律の詳細を返す。メンバーのみアクセス可。

**レスポンス**
```json
{
  "id": "uuid",
  "name": "法律名",
  "article": "条文",
  "owner_id": "uuid",
  "members": [
    { "user_id": "uuid", "display_name": "名前", "avatar_url": "url", "joined_at": "ISO8601" }
  ],
  "pending_invitations": [
    { "id": "uuid", "invitee_id": "uuid", "invitee_name": "名前" }
  ],
  "active_proposal": {
    "id": "uuid",
    "proposal_type": "amendment | deletion",
    "proposed_by": "uuid",
    "proposed_article": "文字列 | null",
    "created_at": "ISO8601",
    "votes": [
      { "user_id": "uuid", "approved": true, "voted_at": "ISO8601" }
    ]
  }
}
```

`active_proposal` は提案がない場合 `null`。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 401 | 未認証 |
| 403 | メンバーでない |
| 404 | 法律が存在しない |

---

### POST /api/laws/[id]/invitations

フレンドをメンバーに招待する（オーナーのみ）。

**リクエスト**
```json
{ "invitee_id": "uuid" }
```

**レスポンス**
```json
{ "id": "uuid" }
```

**エラー**
| ステータス | 条件 |
|-----------|------|
| 400 | invitee_id が UUID 形式でない |
| 403 | 呼び出し元がオーナーでない |
| 404 | invitee_id のユーザーが存在しない |
| 409 | フレンドでない / すでにメンバー / 招待済み（pending） |

---

### PATCH /api/laws/[id]/invitations/[invId]

招待を承認または拒否する（招待対象本人のみ）。

**リクエスト**
```json
{ "status": "accepted | rejected" }
```

承認時は `law_members` にレコードを追加する。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 400 | status が不正値 |
| 403 | 招待の invitee_id が自分でない |
| 404 | 招待が存在しない |
| 409 | すでに処理済みの招待 |

---

### DELETE /api/laws/[id]/members/me

自分が退会する（オーナー以外のメンバーのみ）。

退会処理の順序：
1. `law_proposal_votes` から自分の投票を削除（進行中の提案がある場合）
2. `law_members` からレコードを削除
3. 進行中の提案があれば合意チェック → 合意達成時は提案を実行

**エラー**
| ステータス | 条件 |
|-----------|------|
| 403 | オーナーが退会しようとしている（先に移譲が必要） |
| 404 | メンバーでない |

---

### PATCH /api/laws/[id]/owner

オーナー権を移譲する（現オーナーのみ）。

**リクエスト**
```json
{ "new_owner_id": "uuid" }
```

new_owner_id は現在のメンバーである必要がある。移譲後、前オーナーは一般メンバーになる（`law_members` のレコードは保持）。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 403 | 呼び出し元がオーナーでない |
| 409 | new_owner_id がメンバーでない |

---

### POST /api/laws/[id]/proposals

改定案または削除提案を作成する。

**リクエスト**
```json
{
  "proposal_type": "amendment | deletion",
  "proposed_article": "改定後条文（amendment 時は必須・最大2000文字）"
}
```

**認可**
- `amendment`: メンバーなら誰でも可
- `deletion`: オーナーのみ

**エラー**
| ステータス | 条件 |
|-----------|------|
| 400 | proposal_type が不正 / amendment 時に proposed_article が空または超過 |
| 403 | メンバーでない / deletion なのに非オーナー |
| 409 | 既に進行中の提案が存在する |

---

### DELETE /api/laws/[id]/proposals/[propId]

提案を取り下げる（オーナーのみ）。関連する `law_proposal_votes` は CASCADE 削除。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 403 | オーナーでない |
| 404 | 提案が存在しない |

---

### POST /api/laws/[id]/proposals/[propId]/votes

提案に投票する（メンバーのみ）。同一メンバーが再投票した場合は上書きする（UPSERT）。

**リクエスト**
```json
{ "approved": true }
```

**合意チェックロジック（投票後に毎回実行）**

```
全メンバーの承認票数 = 全メンバー数 → 合意成立
  amendment の場合: laws.article = proposed_article, laws.updated_at = now(), 提案を削除
  deletion  の場合: laws レコードを削除（CASCADE で全関連テーブル削除）
```

**エラー**
| ステータス | 条件 |
|-----------|------|
| 403 | メンバーでない |
| 404 | 提案が存在しない |

---

## データモデル

### 新設テーブル

```sql
-- 法律本体
CREATE TABLE public.laws (
  id          uuid         DEFAULT gen_random_uuid() PRIMARY KEY,
  name        varchar(100) NOT NULL,
  article     text         NOT NULL,
  owner_id    uuid         NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  created_at  timestamptz  DEFAULT now() NOT NULL,
  updated_at  timestamptz  DEFAULT now() NOT NULL,
  CONSTRAINT laws_name_not_empty    CHECK (char_length(name) >= 1),
  CONSTRAINT laws_article_max_len   CHECK (char_length(article) <= 2000)
);

-- メンバー（オーナーを含む全参加者）
CREATE TABLE public.law_members (
  id        uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  law_id    uuid        NOT NULL REFERENCES public.laws(id)    ON DELETE CASCADE,
  user_id   uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  joined_at timestamptz DEFAULT now() NOT NULL,
  UNIQUE(law_id, user_id)
);

-- 招待（pending / accepted / rejected）
CREATE TABLE public.law_invitations (
  id         uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  law_id     uuid        NOT NULL REFERENCES public.laws(id)    ON DELETE CASCADE,
  invitee_id uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  status     varchar(10) NOT NULL DEFAULT 'pending',
  invited_at timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT law_invitations_status CHECK (status IN ('pending', 'accepted', 'rejected')),
  UNIQUE(law_id, invitee_id)
);

-- 提案（改定案 / 削除提案。1法律につき同時に1件のみ）
CREATE TABLE public.law_proposals (
  id               uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  law_id           uuid        NOT NULL REFERENCES public.laws(id)    ON DELETE CASCADE,
  proposal_type    varchar(10) NOT NULL,
  proposed_by      uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
  proposed_article text,                    -- deletion 時は NULL
  created_at       timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT law_proposals_type CHECK (proposal_type IN ('amendment', 'deletion')),
  CONSTRAINT law_proposals_article_required
    CHECK (proposal_type != 'amendment' OR (proposed_article IS NOT NULL AND char_length(proposed_article) <= 2000)),
  UNIQUE(law_id)   -- 同時に1件の提案のみ許可
);

-- 提案への投票
CREATE TABLE public.law_proposal_votes (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  proposal_id uuid        NOT NULL REFERENCES public.law_proposals(id) ON DELETE CASCADE,
  user_id     uuid        NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  approved    boolean     NOT NULL,
  voted_at    timestamptz DEFAULT now() NOT NULL,
  UNIQUE(proposal_id, user_id)
);
```

### インデックス

```sql
CREATE INDEX ON public.law_members(user_id);           -- /api/laws 一覧取得
CREATE INDEX ON public.law_invitations(invitee_id);    -- 招待通知取得
CREATE INDEX ON public.law_proposal_votes(proposal_id); -- 合意チェック
```

### 既存テーブルへの影響

変更なし。`friend_requests` テーブル（FEAT-002）は招待時のフレンド確認にのみ参照する（JOIN のみ、書き込みなし）。

### 型定義（TypeScript）

`lib/types.ts` に以下を追加する。

```typescript
export type ProposalType = 'amendment' | 'deletion';
export type InvitationStatus = 'pending' | 'accepted' | 'rejected';

export interface Law {
  id: string;
  name: string;
  article: string;
  owner_id: string;
  created_at: string;
  updated_at: string;
}

export interface LawMember {
  id: string;
  law_id: string;
  user_id: string;
  joined_at: string;
}

export interface LawInvitation {
  id: string;
  law_id: string;
  invitee_id: string;
  status: InvitationStatus;
  invited_at: string;
}

export interface LawProposal {
  id: string;
  law_id: string;
  proposal_type: ProposalType;
  proposed_by: string;
  proposed_article: string | null;
  created_at: string;
}

export interface LawProposalVote {
  id: string;
  proposal_id: string;
  user_id: string;
  approved: boolean;
  voted_at: string;
}
```

---

## コンポーネント設計

### ファイル構成

```
app/
  laws/
    page.tsx                      # Server Component: 法律一覧
    new/
      page.tsx                    # Server Component: フォームページ
      _components/
        LawForm.tsx               # Client Component: 作成フォーム
    [id]/
      page.tsx                    # Server Component: 法律詳細
      _components/
        ArticleSection.tsx        # 条文・メタ情報表示
        MemberList.tsx            # メンバー一覧・退会・移譲ボタン (Client)
        InvitePanel.tsx           # フレンド検索・招待 (Client, オーナーのみ表示)
        ProposalPanel.tsx         # 提案表示・投票・取り下げ (Client)
        OwnerTransferModal.tsx    # オーナー移譲選択モーダル (Client)

api/
  laws/
    route.ts                      # GET, POST
    [id]/
      route.ts                    # GET
      invitations/
        route.ts                  # POST
        [invId]/
          route.ts                # PATCH
      members/
        me/
          route.ts                # DELETE
      owner/
        route.ts                  # PATCH
      proposals/
        route.ts                  # POST
        [propId]/
          route.ts                # DELETE
          votes/
            route.ts              # POST
```

### 各コンポーネントの責務

**`app/laws/page.tsx`（Server Component）**
- `createSessionClient()` でセッション取得 → 未認証時は redirect
- `law_members` JOIN `laws` JOIN `profiles（owner）` で一覧取得
- 有効な提案の有無をバッジ表示
- 作成ボタンを `/laws/new` へリンク

**`app/laws/new/_components/LawForm.tsx`（Client Component）**
- name（max 100）・article（max 2000）の controlled input
- 文字数カウンター表示
- POST /api/laws → 成功時 `router.push('/laws/[id]')`
- クライアント側でも文字数チェック（UX 向上のため）

**`app/laws/[id]/page.tsx`（Server Component）**
- `createSessionClient()` で認証確認
- `law_members` でメンバー確認 → 非メンバーは 403 相当にリダイレクト
- 法律詳細・メンバー・招待・提案・投票をまとめて取得
- ArticleSection, MemberList, InvitePanel（オーナーのみ）, ProposalPanel をレンダリング

**`InvitePanel.tsx`（Client Component）**
- 既存の `/api/users/search` を使ったフレンド検索 UI（`q` 入力）
- 検索結果のうち、既存メンバー・招待済みを除外する（API 側でフィルタ）
- POST /api/laws/[id]/invitations

**`ProposalPanel.tsx`（Client Component）**
- 現在の提案（amendment / deletion）と投票状況を表示
- 「賛成」ボタン → POST /api/laws/[id]/proposals/[propId]/votes `{ approved: true }`
- オーナーの「取り下げ」ボタン → DELETE /api/laws/[id]/proposals/[propId]
- 合意成立時のレスポンスを受け取ったら `router.refresh()` で画面更新
- 提案なし + メンバーの場合: 「改定案を提出する」ボタン
- 提案なし + オーナーの場合: 上記に加え「削除を提案する」ボタン

**`MemberList.tsx`（Client Component）**
- メンバー一覧（アバター・表示名・参加日時）
- 自分の行（非オーナー）に「退会する」ボタン → DELETE /api/laws/[id]/members/me
- オーナーの行（自分がオーナー時）に「オーナー権を移譲」ボタン → `OwnerTransferModal` を開く

**`OwnerTransferModal.tsx`（Client Component）**
- 現メンバー一覧から移譲先を選択
- PATCH /api/laws/[id]/owner → 成功時に `router.refresh()`

### middleware.ts 変更

`/laws` および `/laws/**` を認証保護対象パスに追加する（現状の保護パスリストを確認の上追記）。

---

## セキュリティ設計

### 認証・認可

| 操作 | 認可条件 |
|------|---------|
| 法律一覧取得 | 認証済み（自分がメンバーの法律のみ返す） |
| 法律作成 | 認証済み |
| 法律詳細取得 | 認証済み + メンバー |
| 招待作成 | 認証済み + オーナー + 対象がフレンド |
| 招待承認/拒否 | 認証済み + invitee_id が自分 |
| 退会 | 認証済み + メンバー + オーナーでない |
| オーナー移譲 | 認証済み + 現オーナー + 移譲先がメンバー |
| 改定案作成 | 認証済み + メンバー |
| 削除提案作成 | 認証済み + オーナー |
| 提案取り下げ | 認証済み + オーナー |
| 投票 | 認証済み + メンバー |

### 入力検証

- name: 空文字禁止、最大 100 文字（アプリ層 + DB CHECK 制約）
- article / proposed_article: 空文字禁止、最大 2000 文字（アプリ層 + DB CHECK 制約）
- proposal_type: `'amendment' | 'deletion'` の列挙チェック（アプリ層 + DB CHECK 制約）
- invitee_id / new_owner_id: UUID v4 形式を正規表現でチェック

### RLS ポリシー

全テーブルで RLS 有効。書き込みは API Route の `createAdminClient()` 経由で行い、RLS をバイパスする。Server Component からの読み取りは `createSessionClient()` を使用し、以下のポリシーで保護する。

```sql
ALTER TABLE public.laws             ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_members      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_invitations  ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_proposals    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_proposal_votes ENABLE ROW LEVEL SECURITY;

-- laws: 自分がメンバーの法律のみ
CREATE POLICY laws_select_member ON public.laws FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.law_members
      WHERE law_id = laws.id AND user_id = auth.uid()
    )
  );

-- law_members: 同じ法律のメンバーなら閲覧可
CREATE POLICY law_members_select ON public.law_members FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.law_members lm2
      WHERE lm2.law_id = law_members.law_id AND lm2.user_id = auth.uid()
    )
  );

-- law_invitations: 招待対象本人またはオーナーのみ
CREATE POLICY law_invitations_select ON public.law_invitations FOR SELECT
  USING (
    invitee_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.laws
      WHERE laws.id = law_invitations.law_id AND laws.owner_id = auth.uid()
    )
  );

-- law_proposals: メンバーのみ
CREATE POLICY law_proposals_select ON public.law_proposals FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.law_members
      WHERE law_id = law_proposals.law_id AND user_id = auth.uid()
    )
  );

-- law_proposal_votes: メンバーのみ
CREATE POLICY law_proposal_votes_select ON public.law_proposal_votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.law_proposals lp
      JOIN public.law_members lm ON lm.law_id = lp.law_id
      WHERE lp.id = law_proposal_votes.proposal_id AND lm.user_id = auth.uid()
    )
  );
```

`anon` ロールへの GRANT は付与しない（LOW-001 の教訓を踏まえ、最小権限の原則を徹底）。

### フレンド確認ロジック（招待時）

```typescript
// friend_requests テーブルを参照（FEAT-002 の成果物）
const { data: friendship } = await adminClient
  .from('friend_requests')
  .select('id')
  .or(
    `and(sender_id.eq.${ownerId},receiver_id.eq.${inviteeId}),` +
    `and(sender_id.eq.${inviteeId},receiver_id.eq.${ownerId})`
  )
  .eq('status', 'accepted')
  .maybeSingle();

if (!friendship) {
  return Response.json({ error: 'フレンドではありません' }, { status: 409 });
}
```

---

## 制約・前提条件

### 機能上の制約

**オーナーは退会不可**
アプリ層で `owner_id = user_id` の場合に DELETE /api/laws/[id]/members/me を 403 で弾く。UI でも退会ボタンをオーナーには表示しない。オーナー権の移譲後に退会できる旨をメッセージで案内する。

**同時提案の排他制御**
`law_proposals` の `UNIQUE(law_id)` 制約で DB レベルで保証する。アプリ層では PostgreSQL エラーコード `23505`（unique violation）を 409 でハンドルする。

**合意チェックの競合リスク**
複数メンバーが同時に最後の承認票を投じた場合、両リクエストで合意チェックが実行される。家族・カップルという少人数・低頻度の利用を前提とし、現時点はアプリ層チェックで対応する。将来的にユーザー数が増える場合は PostgreSQL 関数（`FOR UPDATE` ロック付き）による原子的チェックへの移行を検討すること。

**退会後の合意自動チェック**
メンバーが退会すると、残存メンバーだけで全員承認済みになるケースがある（例: 3人中2人承認済みの状態で1人退会）。退会処理の中で合意チェックを実行し、成立していれば提案を実行する。

**提案者退会後の扱い**
`law_proposals.proposed_by` は `ON DELETE RESTRICT` とする。プロフィール削除は制限されるが、法律からの退会（`law_members` からの削除）は可能なため、提案者が退会した場合でも提案は残存する。オーナーが取り下げられる。

**deletion 時の proposed_article**
`proposal_type = 'deletion'` のとき `proposed_article` は NULL を許容する。DB の CHECK 制約で `amendment` 時のみ必須とする。

### 前提条件

- FEAT-002 Phase 2（`friend_requests` テーブル、フレンド機能）が稼働済みであること
- `profiles` テーブルに `display_name`・`avatar_url` カラムが存在すること
- `middleware.ts` に `/laws` および `/laws/**` の保護が追加されること
- Supabase Storage は使用しない（法律はテキストデータのみ）

### スコープ外（今回実装しない）

- 改定案の複数同時提出
- メール通知（招待・合意成立の通知）
- 部分改定 UI（条文の一部のみ変更するインターフェース）
- 法律の公開 Hub（FEAT-004）
- 法律コメント・チャット機能

---

## MEDIUM-001 対応: Server Component の RLS 経由化（FEAT-003 補強）

### 概要

`app/laws/page.tsx` と `app/laws/[id]/page.tsx` の Server Component は、認証確認後の DB 読み取りすべてに `createAdminClient()` を使用しており、RLS をバイパスしている。本 PR では法律関連テーブル（`laws`, `law_members`, `law_invitations`, `law_proposals`, `law_proposal_votes`）の読み取りを `createSessionClient()` 経由に切り替え、RLS による二重防御を有効にする。

現状の各クエリにはアプリ層フィルタ（`.eq("invitee_id", user.id)`、メンバーシップ確認後の `.in("id", lawIds)` 等）が正しく付与されているため、データ漏洩は発生していない。しかし RLS が機能していないことで、将来の改修でアプリ層フィルタが誤って削除・省略された場合に即座にデータが露出するリスクがある。本 PR の目的は「アプリ層フィルタが万一壊れても、RLS が二重防御として機能する」状態を作ることである。

FEAT-003 セクションで定めた方針「Server Component からの読み取りは `createSessionClient()` を使用し、以下のポリシーで保護する」を実装に反映する変更でもある。

### 影響範囲

- `app/laws/page.tsx`（Server Component。`law_*` テーブル読み取りを `createSessionClient()` に切り替え。`profiles` 参照のみ admin を維持）
- `app/laws/[id]/page.tsx`（同上）
- `supabase/migrations/<新規 1 枚>`（`laws` SELECT ポリシーの差し替え）

**スコープ外（本 PR で触らないもの）**:

- `profiles` テーブルの RLS / 列 GRANT（理由は後述）
- `app/laws/_components/PendingInvitations.tsx`（backlog の別項目で扱う）
- `app/api/laws/**` 配下の API Route（書き込みは引き続き `createAdminClient()` 経由・既存方針踏襲）
- `search_users` 関数

### RLS 設計

#### `laws` SELECT ポリシーの差し替え

##### 現状の課題

既存の `laws_select_member` ポリシー（`supabase/migrations/20260526000003_feat003_laws.sql` で導入）は「メンバーのみ閲覧可」を表現する：

```sql
CREATE POLICY laws_select_member ON public.laws FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.law_members
      WHERE law_id = laws.id AND user_id = auth.uid()
    )
  );
```

しかし、`/laws` の「届いた招待」セクションでは、非メンバーである invitee が `laws.name` を読む必要がある。同様に `/laws/[id]` の非メンバー分岐（招待受諾画面）でも `laws.name` と `laws.article` を読みたい。現状は `createAdminClient()` で RLS をバイパスして実現しているため動作しているが、`createSessionClient()` に切り替えた瞬間、invitee からは `laws` レコードが見えなくなり画面が壊れる。

##### 新ポリシー

`laws_select_member` を DROP し、以下の 3 条件のいずれかを満たす場合に SELECT を許可する新ポリシーを CREATE する：

1. **オーナー本人**（`laws.owner_id = auth.uid()`）
2. **メンバー**（`law_members` に当該 user_id が存在）
3. **pending な invitee 本人**（`law_invitations` に `invitee_id = auth.uid() AND status = 'pending'` が存在）

```sql
DROP POLICY IF EXISTS laws_select_member ON public.laws;

CREATE POLICY laws_select_member_or_invitee ON public.laws FOR SELECT
  USING (
    laws.owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.law_members
      WHERE law_members.law_id = laws.id
        AND law_members.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.law_invitations
      WHERE law_invitations.law_id = laws.id
        AND law_invitations.invitee_id = auth.uid()
        AND law_invitations.status = 'pending'
    )
  );
```

##### 設計判断の理由

- **オーナー条件を独立して列挙する理由**: FEAT-003 設計上、オーナーは作成時に必ず `law_members` に登録されるため、オーナー条件はメンバー条件で通常はカバーされる。しかし `law_members` レコードが障害（手動削除・移行ミス）で失われた場合でもオーナーが自分の法律本体を閲覧できる保険として、独立して残す。コストは EXISTS 1 件追加のみで、安全性とのトレードオフでは保険を取る判断。
- **`status = 'pending'` のフィルタ**: `accepted` の場合はメンバー条件で既に通る。`rejected` の場合は閲覧権を失うべきなので明示的に除外する。これは「招待を断った相手に法律内容を覗き続けられない」という妥当な振る舞いを RLS 側で保証する判断。
- **`anon` ロールへの GRANT は付与しない**: 既存方針（FEAT-002 LOW-001 の教訓）を踏襲。新ポリシーは `authenticated` ロールのみ評価される前提。

#### 他テーブルの既存ポリシー検証結果

`supabase/migrations/20260526000003_feat003_laws.sql` で導入済みの SELECT ポリシーが、`createSessionClient()` 切り替え後の Server Component から必要な行を返せるかを検証する。

| テーブル | 既存ポリシー | Server Component での読み手 | 結果 |
|----------|------------|----------------------------|------|
| `law_members` | 同じ法律のメンバーのみ | `/laws` で自分の所属一覧、`/laws/[id]` でメンバー一覧 | **十分**（読み手は常にメンバー） |
| `law_invitations` | invitee 本人 OR オーナー | `/laws` で届いた招待（invitee 視点）、`/laws/[id]` で pending 招待一覧（オーナー視点） | **十分**（両方向カバー済） |
| `law_proposals` | メンバーのみ | `/laws/[id]` のメンバー分岐でのみ読む | **十分** |
| `law_proposal_votes` | メンバーのみ | `/laws/[id]` のメンバー分岐でのみ読む | **十分** |

検証ポイント：

- `/laws/[id]` の **非メンバー分岐**（pending invitee による招待受諾画面）では、`law_members` / `law_proposals` / `law_proposal_votes` を読む必要はない。`laws.name` / `laws.article` の表示と「承認・拒否ボタン」のみで完結するため、上記ポリシーが「メンバーのみ」のままでも問題ない。
- `/laws` の「届いた招待」セクションでは、`law_invitations` の自分宛 pending 行と、その `law_id` に対応する `laws.name` を読む。既存の `law_invitations_select` ポリシー（invitee 本人を許可）と、新ポリシー `laws_select_member_or_invitee` のどちらでも通る。

結論：他テーブルへの追加修正は **不要**。`laws` SELECT ポリシーの差し替え 1 件のみで足りる。

#### `profiles` テーブルは本 PR では触らない

理由：

- 列レベル GRANT は role 単位（`authenticated` / `anon` / `service_role`）であり、「本人なら全列 SELECT、他人なら一部列のみ SELECT」を表現できない。
- `app/page.tsx` および `app/profile/page.tsx`（Client Component）が `api_key_encrypted` や `defense_custom_instruction` を直接読んでおり、列 GRANT で機微情報を絞ると本人取得経路が壊れる。
- 本 PR では `app/laws/page.tsx` と `app/laws/[id]/page.tsx` 内で `profiles` を読む箇所だけ `createAdminClient()` のまま残し、`law_*` テーブルの読み取りだけを `createSessionClient()` に切り替える。
- `profiles` の RLS 整備自体は別 backlog 項目として後日扱う。

### コンポーネント設計

#### `app/laws/page.tsx` のクエリ書き換え方針

責務：認証済みユーザーに対し、所属する法律一覧と届いた pending 招待を表示する Server Component。

セッションクライアントと admin クライアントの使い分け：

| 用途 | クライアント | 理由 |
|------|------------|------|
| `auth.getUser()`（認証確認） | `createSessionClient()` | 既存通り。先頭で null チェックして未認証は redirect |
| `law_members`（自分の所属取得） | `createSessionClient()` | RLS により自分が属する行のみ可視 |
| `laws`（法律本体取得） | `createSessionClient()` | 新 RLS によりオーナー / メンバー / pending invitee のみ可視 |
| `law_invitations`（届いた招待） | `createSessionClient()` | 既存 RLS により invitee 本人の行のみ可視 |
| `law_proposals` の存在チェック（バッジ用） | `createSessionClient()` | 既存 RLS によりメンバーのみ可視 |
| `profiles`（オーナー名・自分の表示名等） | `createAdminClient()` | スコープ外（理由は前節） |

二重防御：既存のアプリ層フィルタ（`.eq("invitee_id", user.id)` 等）はすべて維持する。RLS が誤って緩められた場合の保険として機能させる。

#### `app/laws/[id]/page.tsx` のクエリ書き換え方針

責務：法律詳細の表示。メンバーには本体・メンバー一覧・招待・提案・投票を表示し、pending invitee には招待受諾画面を表示する Server Component。

クエリ順序と分岐：

1. `createSessionClient()` で `auth.getUser()` → null なら redirect
2. `createSessionClient()` で `law_members` を `.eq("law_id", id).eq("user_id", user.id)` で取得し、メンバーかどうか判定
3. **メンバー分岐**：
   - `laws` / `law_members` / `law_invitations`（pending のみ）/ `law_proposals` / `law_proposal_votes` を `createSessionClient()` で取得
   - メンバー名・オーナー名・invitee 名等の `profiles` 参照のみ `createAdminClient()` で取得
4. **非メンバー分岐**：
   - `createSessionClient()` で `law_invitations` を `.eq("law_id", id).eq("invitee_id", user.id).eq("status", "pending")` で取得し、pending 招待があるか判定
   - 招待あり：`createSessionClient()` で `laws.name` / `laws.article` を取得（新 RLS の pending invitee 条件で通る）→ 招待受諾画面をレンダリング
   - 招待なし：404 相当の redirect

二重防御：メンバー分岐内のアプリ層フィルタ（`.eq("law_id", id)` 等）はすべて維持する。

### migration 設計

新規 migration を 1 枚追加する。既存の `20260526000003_feat003_laws.sql` は applied 済みのため、上書きや書き換えは行わない。

ファイル例：`supabase/migrations/<新タイムスタンプ>_medium001_laws_select_invitee.sql`

```sql
-- MEDIUM-001: laws SELECT ポリシーを「メンバーのみ」から
-- 「オーナー OR メンバー OR pending invitee」に拡張する。
-- 由来: docs/knowledge/archive/audit-log/audit_20260526_200752.md MEDIUM-001
-- 目的: Server Component (app/laws/page.tsx, app/laws/[id]/page.tsx) を
--       createSessionClient() 経由に切り替えるため、invitee から
--       laws.name / laws.article が見えるようにする。

BEGIN;

-- 冪等性のため DROP POLICY IF EXISTS で前ポリシーを除去
DROP POLICY IF EXISTS laws_select_member ON public.laws;

-- 新ポリシー側も冪等にする（再適用耐性）
DROP POLICY IF EXISTS laws_select_member_or_invitee ON public.laws;

CREATE POLICY laws_select_member_or_invitee ON public.laws FOR SELECT
  USING (
    laws.owner_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.law_members
      WHERE law_members.law_id = laws.id
        AND law_members.user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM public.law_invitations
      WHERE law_invitations.law_id = laws.id
        AND law_invitations.invitee_id = auth.uid()
        AND law_invitations.status = 'pending'
    )
  );

COMMIT;

-- ロールバック手順（必要時に手動で実行）:
-- BEGIN;
--   DROP POLICY IF EXISTS laws_select_member_or_invitee ON public.laws;
--   CREATE POLICY laws_select_member ON public.laws FOR SELECT
--     USING (
--       EXISTS (
--         SELECT 1 FROM public.law_members
--         WHERE law_id = laws.id AND user_id = auth.uid()
--       )
--     );
-- COMMIT;
```

設計上の注意：

- `BEGIN` / `COMMIT` で囲み、ポリシー入れ替え中の途中状態（ノーポリシー時の RLS による全行不可視）が外から見えないようにする。
- DROP は `IF EXISTS` 付きで冪等にし、同じマイグレーションを誤って再適用しても失敗しない。
- 新ポリシー側も `DROP POLICY IF EXISTS` を先に実行し、再適用耐性を確保する。
- 既存マイグレーションの編集は行わない。
- `GRANT` は触らない。`authenticated` ロールへの既存 GRANT がそのまま新ポリシーで評価される。

### セキュリティ設計

- **アプリ層フィルタは二重防御として保持する**: Server Component の各 SELECT に付いている `.eq("invitee_id", user.id)` / `.in("id", lawIds)` / `.eq("law_id", id)` 等は引き続き残す。新 RLS と同じ集合に絞られるが、RLS が将来誤って緩められた場合に備えた多層防御として機能する。
- **API Routes の書き込みは引き続き service_role 経由**: environment.md および FEAT-003 設計の方針「API Routes での書き込みは必ず `createAdminClient()` を使い、サーバー側コードで本人確認を行う」を踏襲する。本 PR では書き込み経路には一切手を加えない。
- **`auth.getUser()` の null チェックは Server Component 先頭で維持**: 未認証ユーザーが Server Component に到達した場合の即時 redirect は既存の防御であり、変更しない。これにより RLS による空集合返却に頼らず、認可境界をコード上で明示する。
- **`profiles` の機微列保護は本 PR スコープ外**: `api_key_encrypted` 等の機微列は引き続き `createAdminClient()` 経由で読まれる。本 PR の防御強化は `law_*` テーブルに限定されることを明記する。`profiles` 列の保護は別 backlog 項目で扱う。
- **新 RLS による情報露出範囲の確認**: 新ポリシーで invitee に追加で見えるのは `laws.name` と `laws.article` のみ。`law_members` / `law_proposals` / `law_proposal_votes` のポリシーは「メンバーのみ」のままなので、invitee はメンバー構成や進行中の提案を観測できない。これは設計意図通り。
- **`status = 'rejected'` 後の閲覧不可**: 新ポリシーは `status = 'pending'` で限定しているため、招待を拒否した invitee は `laws` を見られなくなる。これは「招待を断った相手に法律内容を覗き続けられない」という妥当な振る舞いを保証する。

### 制約・前提条件

- **過去 migration は applied 済み**: `20260526000003_feat003_laws.sql` を含む既存マイグレーションはすべて適用済みとする。本 PR は新規 1 枚を追加する形で対応し、既存マイグレーションの編集は行わない。
- **既存メンバー閲覧 UX を一切壊さない**: 新 RLS の「オーナー OR メンバー OR pending invitee」はメンバーを必ず含むため、メンバーから見える行集合は従来と同一以上となる。メンバー視点での画面表示は完全に同等。
- **`profiles` の RLS 整備は本 PR スコープ外**: `profiles` を読む箇所は `createAdminClient()` のまま残す。`profiles` の RLS / 列 GRANT 整備は別 backlog 項目（後日）で扱う。
- **`search_users` 関数の挙動は維持**: フレンド検索の RPC は本 PR で変更しない。`InvitePanel.tsx` の動作は据え置き。
- **アプリ層フィルタは温存**: `.eq(...)` / `.in(...)` 等の既存フィルタは削除しない。RLS と二重に絞ることで多層防御を実現する。
- **書き込み API は不変**: `app/api/laws/**` 配下の Route Handler はすべて `createAdminClient()` 経由のまま据え置く。本 PR で書き込み経路は触らない。
- **デプロイ順序の前提**: 本番適用は「マイグレーション先・コード後」とする。逆順では invitee 画面が短時間壊れる（新コードが旧 RLS に当たり `laws` が見えない）。詳細は引き継ぎメモを参照。

---

## LOW バッチ対応: UUID バリデーション共通化 + fetch ステータス検査

由来: `docs/knowledge/archive/audit-log/audit_20260526_200752.md` の LOW-001 / LOW-002

### 概要

監査由来の LOW 指摘 2 件を 1 PR でまとめて対応する、アプリケーションコードのみの品質改善である。**RLS / migration / DB スキーマには一切手を加えない。**

- **LOW-001（UUID バリデーション）**: API ルートの動的セグメント（`lawId` / `invId` / `propId` 等）が、リクエスト URL から取得した生の文字列のまま Supabase クエリの `.eq("id", ...)` 等に渡されている。UUID 型カラムへの非 UUID 値は PostgreSQL がエラーを返すため実データ操作は発生しないが、PostgreSQL エラーが 500 として漏洩しうる（エラーレスポンス形式の不統一）。リクエストボディ側の UUID（`invitee_id` / `new_owner_id` / `receiver_id`）は既に `UUID_REGEX` で検証済みだが、その `UUID_REGEX` が 3 ファイルに重複定義されている。本対応では (1) `UUID_REGEX` を共通ユーティリティへ集約し、(2) UUID 型カラムを参照する全動的セグメントに対し各メソッドハンドラ先頭で形式チェックを行い、不正なら 400 を返す。

- **LOW-002（fetch ステータス検査）**: `app/laws/_components/PendingInvitations.tsx` の `respond()` が `fetch(...)` の戻り値（`Response`）を検査せず、常に `router.refresh()` を実行している。API が 403 / 404 / 500 を返してもリフレッシュが走り、ユーザーはエラーを受け取れない。招待が残ったまま表示され「なぜ消えないのか」が伝わらず連打を誘発する。本対応では `res.ok` を検査し、失敗時はエラーを表示してリフレッシュを抑止する。

いずれも**正常系（正しい UUID・成功レスポンス）の挙動は一切変えない**ことを設計の絶対条件とする。

### 影響範囲

| 対象 | 種別 | 変更内容 |
|------|------|---------|
| `lib/text-utils.ts` | 共通化（新規 export 追加） | `UUID_REGEX` と `isUuid()` を集約。配置理由は LOW-001 設計を参照 |
| `app/api/laws/[id]/invitations/route.ts` | 重複解消 + ガード | ローカル `UUID_REGEX` 定義を削除し共通 import に置換。`[id]` のガード追加 |
| `app/api/friends/requests/route.ts` | 重複解消 | ローカル `UUID_REGEX` 定義を削除し共通 import に置換（ボディ検証の挙動は不変。このルートは動的セグメントを持たないためパスガードは追加しない） |
| `app/api/laws/[id]/owner/route.ts` | 重複解消 + ガード | ローカル `UUID_REGEX` 定義を削除し共通 import に置換。`[id]` のガード追加 |
| `app/api/laws/**/route.ts`（下表） | ガード追加 | UUID 型カラムを参照する動的セグメントを持つルートの各メソッド先頭にガード追加 |
| `app/api/**/route.ts`（cases 系・friends 系等の候補） | ガード追加（要 grep 確定） | 同上。最終的な対象集合はビルドが grep で全数確認する（引き継ぎメモ参照） |
| `app/laws/_components/PendingInvitations.tsx` | fetch ステータス検査 | `respond()` に `res.ok` 検査とエラー表示を追加 |

**スコープ外（本 PR で触らないもの）**:

- RLS / migration / DB スキーマ（`laws_*` ポリシー、`supabase/` 配下すべて）
- `profiles` テーブル関連
- リクエストボディ側 UUID 検証の**ロジック**（共通 `UUID_REGEX` への参照差し替えのみ可。判定式・正規表現リテラルは不変）
- backlog の他 LOW 項目（`package.json` の `name` 変更ログ、`@upstash/core-analytics` 検証）
- FEAT-004 / MON-001 / MON-002

### LOW-001 設計

#### 1. `UUID_REGEX` 共通化の配置と公開 API

**配置先: `lib/text-utils.ts`（既存）に追記する。**

設計判断（トレードオフ）:

- **候補 A: 既存 `lib/text-utils.ts` に追記（採用）** — 既存の純粋な文字列ヘルパー（`truncate` / `escapeXml` 等）と同じファミリーに属する「文字列フォーマット述語」であり、新規ファイルを増やさず import 面の追加もファイル単位では発生しない。既存 lib 構成との一貫性が最も高い。
- **候補 B: 新規 `lib/utils.ts` を作成** — 意味的には汎用 util として素直だが、`utils.ts` は将来あらゆるものが流入する catch-all（雑多ファイル）化のアンチパターンを招きやすく、ファイル 1 つ・関数 1 つのために新ファイルを増やすコストに見合わない。

→ **既存構成との一貫性と最小差分を優先し、候補 A を採用**する。`isUuid` は本質的に文字列形式の述語であり `text-utils.ts` の責務範囲内と判断する。

**公開 API:**

```typescript
// lib/text-utils.ts に追加
export const UUID_REGEX = /* 既存 3 ファイルのリテラルを「そのまま」移設 */;

export function isUuid(value: unknown): value is string {
  return typeof value === "string" && UUID_REGEX.test(value);
}
```

設計上の絶対条件:

- `UUID_REGEX` のリテラルは**既存 3 ファイルに定義済みのものを一字一句そのまま移設する**こと。新しい正規表現を起こしてはならない（挙動変化＝リグレッションを禁ずるため）。3 ファイルの定義が万一相互に異なる場合は、その差異自体を報告対象とし、独断で統一しないこと（引き継ぎメモ「未解決事項」参照）。
- `isUuid` は `unknown` を受けて型ガード（`value is string`）として narrowing する。パスパラメータ（常に string）にもボディ値（`unknown`）にも安全に使える。
- 既存ボディ検証側は、**判定式を変えずに参照元だけを共通 `UUID_REGEX` に差し替える**（例: ローカル const を削除して `import { UUID_REGEX } from "@/lib/text-utils"` に置換し、`UUID_REGEX.test(...)` の呼び出しはそのまま）。`isUuid` への書き換えは任意だが、挙動が完全一致する範囲でのみ行う。

#### 2. パスパラメータ検証の適用ルート一覧と各メソッドのガード方針

**ガード判定ルール（ビルドが全数確認する際の基準）:**

> ルートの動的セグメント `[xxx]` のうち、その値が UUID 型カラム（`id` / `law_id` / `invitee_id` 等）への `.eq(...)` 等に渡るものは、当該ルートの**各 HTTP メソッドハンドラの先頭**で UUID 形式チェックを行い、不正なら 400 を返す。リテラルセグメント（`me` 等。動的セグメントではない）はガード対象外。

本コードベースでは動的セグメントは事実上すべて UUID 主キー/外部キーを指すため、運用上は「`[param]` 形式の動的セグメント値はすべて UUID ガードを通す」を既定ルールとしてよい。

**確定対象（`docs/knowledge/design.md` の FEAT-003 API ルートツリーから列挙。一次ソースとして確実）:**

| ルートファイル | メソッド | ガード対象セグメント |
|---------------|---------|---------------------|
| `app/api/laws/[id]/route.ts` | GET | `id` |
| `app/api/laws/[id]/invitations/route.ts` | POST | `id` |
| `app/api/laws/[id]/invitations/[invId]/route.ts` | PATCH | `id`, `invId` |
| `app/api/laws/[id]/members/me/route.ts` | DELETE | `id`（`me` はリテラルにつき対象外） |
| `app/api/laws/[id]/owner/route.ts` | PATCH | `id` |
| `app/api/laws/[id]/proposals/route.ts` | POST | `id` |
| `app/api/laws/[id]/proposals/[propId]/route.ts` | DELETE | `id`, `propId` |
| `app/api/laws/[id]/proposals/[propId]/votes/route.ts` | POST | `id`, `propId` |

注: `app/api/laws/route.ts`（GET/POST）と `app/api/friends/requests/route.ts`（POST）は動的セグメントを持たないため、パスガードの追加対象外（後者はボディ検証の参照差し替えのみ）。

**要 grep 確定の候補（`app/` を直接参照していないため、ビルドが grep で実在・メソッド・カラム種別を確認のうえ確定する）:**

| 候補 | 根拠 | 確認事項 |
|------|------|---------|
| `app/api/cases/[id]/**`（argument / defense / draft 等） | requirements.md の `/case/[id]`、task.md の「`cases` の `[id]`」、backlog の argument/defense/draft 言及 | 実在パス・各メソッド・`[id]` が `cases.id`（UUID）を指すか。**ゲスト経路と認証経路の双方**で先頭ガードを通すこと |
| `app/api/friends/requests/[id]/**` | PR #20「フレンド機能（承認/拒否/削除）」が path param 経由の可能性 | 動的セグメントの有無と UUID カラム参照の有無 |

ゲスト経路への適用方針: case 系ルートはゲスト/認証の分岐を内部に持つ（environment.md のゲスト HMAC/nonce トークン方式）。UUID ガードは**分岐より前（メソッドハンドラ最先頭、`params` 取得直後）**に置き、両経路に等しく適用する。これにより認証状態に関わらず不正 ID は 400 で早期遮断される。

**ガードの実装方針（疑似コード）:**

```typescript
import { isUuid } from "@/lib/text-utils";

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;                 // ※ 本バージョンの Next.js は params が Promise
  if (!isUuid(id)) {
    return Response.json({ error: /* 既存 400 と同形式のメッセージ */ }, { status: 400 });
  }
  // …以降の既存処理（DB クエリ等）は一切変更しない
}
```

- ガードは `params` を取得した**直後・あらゆる DB アクセスより前**に置く。複数セグメント（`id` と `invId` 等）を持つルートでは、全セグメントをまとめて検証する（いずれか不正なら 400）。
- 本バージョンの Next.js では Route Handler の `params` が `Promise` の可能性が高い（`AGENTS.md` の警告に従い `node_modules/next/dist/docs/` で実シグネチャを確認すること）。`await params` の後ろにガードを置く。

#### 3. 400 レスポンスの形式

既存の 400（ボディ UUID 不正時等）と**同一形状**に統一する。

- 形状: `Response.json({ error: <string> }, { status: 400 })`。既存ルートが用いている 400 のレスポンスシェイプ（キー名・JSON 構造）に厳密に合わせる。
- メッセージ: 同一ファイル内の既存 400 メッセージの言語・文体に合わせる。混在等で判断がつかない場合は短い汎用メッセージ（例: `"不正な ID 形式です"`）とする。
- **不正値そのもの（生のパスパラメータ）をレスポンスやログにエコーしない**（情報漏洩・ログ汚染の回避が本指摘の趣旨であるため）。

### LOW-002 設計

対象: `app/laws/_components/PendingInvitations.tsx` の `respond()`（Client Component）。

#### `respond()` のステータス検査フロー

```
respond(invitationId, action):
  setProcessingId(invitationId)
  setError(null)                         // 直前のエラーをクリア
  try:
    const res = await fetch(url, { method, body })
    if (!res.ok):
      setError(<失敗メッセージ>)          // ← 追加: 失敗時はエラー表示
      return                              // ← router.refresh() を呼ばない
    router.refresh()                      // ← 成功時のみ
  finally:
    setProcessingId(null)                 // ← 既存の finally リセットは維持
```

設計上の要点:

- **成功時のみ `router.refresh()`**。失敗時はリフレッシュを抑止し、招待行を残したままエラーを提示する（連打防止と原因の可視化を両立）。
- `finally` での `processingId` リセットは維持（成功・失敗いずれでもボタンの処理中状態を解除）。
- エラー state（`const [error, setError] = useState<string | null>(null)`）を 1 つ追加。`respond()` 開始時に `null` クリアし、`!res.ok` 時にセット。
- 例外（ネットワーク断等で `fetch` が reject）も拾うなら `catch` で同じ `setError` を行う。ただし**既存の例外ハンドリングの有無を確認し、なければ最小限の追加にとどめる**（挙動の不要な拡張を避ける）。

#### エラー表示方針（配色ルール厳守）

- **既存の `ErrorBanner` コンポーネント（PR #13 B-2 で実装済み）が存在し再利用可能なら、それを使う**。props 形状・配置を既存利用箇所に合わせる。
- 存在しない/形が合わない場合は最小限のインライン表示（例: `<p className="text-sm text-rose-600">{error}</p>`）を招待リスト付近に置く。
- **配色ルール厳守**: エラー/被告系は `rose-*`、プライマリは `brand-700/800`、`brand-500` は使用しない。エラー表示に `brand-*` を使わないこと。
- エラーの粒度: 招待が複数あっても、単一の `error` state（リスト上部に 1 つのバナー）で十分。新しい操作のたびに先頭で `null` クリアするため、古いエラーが残らない。

### 制約・前提条件

- **DB / RLS / migration は一切触らない**。本対応はアプリケーションコードのみ。`supabase/` 配下に変更を加えない。
- **正常系の挙動を一切変えない**: 正しい UUID のリクエスト、および成功レスポンス時の `router.refresh()` 動作は従来と完全に同一。
- **`UUID_REGEX` リテラルは既存定義を移設**: 新規の正規表現を起こさない。ボディ検証の判定ロジックは不変（参照先の差し替えのみ）。
- **配色ルール厳守**: エラーは `rose-*`、プライマリは `brand-700/800`、`brand-500` 不使用。
- **対象ルートの全数確定はビルドの grep に委ねる**: 本設計は確定対象（laws ツリー）＋候補（cases / friends）＋判定ルールを提示する。`app/` 実コードの最終的な網羅確認はビルドが grep で行う（引き継ぎメモ参照）。本設計書はドキュメント（design.md の FEAT-003 ツリー・requirements.md・backlog）を一次ソースとして列挙しており、`app/` の直接読み取りは行っていない。
- **Next.js のバージョン差異**: Route Handler の `params` 取得方法（`Promise` か否か）は `node_modules/next/dist/docs/` で確認する（`AGENTS.md` の方針）。ガードは `params` 取得直後・DB アクセス前に置く。

---

## FEAT-RESP-HEADER 対応: ヘッダーをアバター起点のドロップダウンメニュー方式に刷新

由来: `docs/backlog.md` の `[FEAT-RESP-HEADER] ヘッダーのレスポンシブ対応（スマホ最適化）`

### 概要

#### 目的
スマートフォン幅（375–390px）で発生していたヘッダーのレイアウト崩れ（横並びテキストリンクとロゴの干渉）を解消し、PC・タブレット・スマートフォンの全画面サイズで一貫したヘッダー体験を提供する。

#### 背景
- 現状の `app/components/Header.tsx` は Server Component で、認証時に「過去のケース / フレンド / プロフィール / ログアウト」を `flex gap-4` の横並びテキストリンクで配置している。
- 本プロジェクトでは Tailwind の `sm:` `md:` `lg:` ブレークポイントが現状一切使われていない（grep で 0 件）。本対応でも breakpoint を持ち込まない方針とし、全画面サイズで同一 UI とする。
- 既存導線（過去のケース / フレンド / プロフィール / ログアウト）は維持しつつ、ヘッダー上の可視要素を「ロゴ＋アバター」の 2 つに絞ることで、横幅 375px でも安定して収まるレイアウトに切り替える。

#### 全画面サイズ統一の方針
- breakpoint は使用しない。
- ヘッダーは「ロゴ（左）+ アバター（右）」の 2 要素のみで構成する。
- ナビゲーションはアバタークリック起動のドロップダウンメニューに集約する。
- 認証時 / 未認証時いずれもアバター要素を表示する（未認証時は薄いグレー背景の人型アイコン）。これにより認証状態の差をレイアウトの横幅変動として表出させない。

### 影響範囲

#### 変更ファイル
- `app/components/Header.tsx`（Server Component。リファクタ。user + profile 取得 → Props 受け渡しに責務を限定）
- `app/components/HeaderUserMenu.tsx`（**新設** Client Component。ドロップダウン状態管理・外側クリック検知・Escape ハンドリング・メニュー項目描画・logout フォーム）

#### 参照のみ（変更しない）
- `app/actions/auth.ts`（既存 `logout` Server Action を新コンポーネントから直接 import して `<form action={logout}>` で再利用）
- `lib/supabase/server.ts`（既存 `createSessionClient`）
- `lib/types.ts`（既存 `profiles` 型）
- `app/layout.tsx`（`<Header />` 呼び出し箇所。マウント方法は不変）

#### 触らないもの
- `supabase/` 配下（migration / RLS / スキーマ）
- `profiles` テーブル構造
- `middleware.ts`（認証チェック・ガード挙動を不変とする）
- `app/components/Header.tsx` 以外の既存コンポーネント・ページ
- `package.json` / `package-lock.json`（新規 npm 依存なし）
- `tailwind.config.*` 等の Tailwind 設定（カラートークン追加なし）

### 配置・命名

#### 新規 Client Component の配置
`app/components/HeaderUserMenu.tsx` に置く。

設計判断（トレードオフ）:

- **候補 A: `app/components/HeaderUserMenu.tsx`（採用）** — 既存の `Header.tsx` の隣に置くことで Header 専用の付随コンポーネントであることが import 距離から自明になる。`app/components/` 直下にトップレベル UI（Header / Footer 等）を置く既存慣習と整合する。
- **候補 B: `app/components/header/UserMenu.tsx`** — 名前空間切りとして素直だが、現状 1 ファイルのみのため過剰な構造化。将来 Header 関連 Client Component が増えた時点で再評価。
- **候補 C: `app/_components/HeaderUserMenu.tsx`** — `_components/` 規約は本プロジェクトでは `app/laws/[id]/_components/` 等、page 配下のローカル UI 限定で採用済み。グローバル UI に持ち込むのは既存方針と不整合。

→ 既存構成との一貫性を優先し候補 A を採用する。

#### 命名
- ファイル名 / コンポーネント名：`HeaderUserMenu`（PascalCase、`Header` 名前空間を接頭辞、責務を `UserMenu` で表現）。
- `app/components/Header.tsx` 内部での呼び出しは `<HeaderUserMenu ... />`。

### コンポーネント設計

#### Server Component: `app/components/Header.tsx`

責務：
- `createSessionClient()` を作成し `auth.getUser()` でユーザーを取得する（既存方針）。
- 認証済みの場合、同一の `createSessionClient` で `profiles` を `select("avatar_url, display_name").eq("id", user.id).single()` し、アバター URL と表示名を取得する。
- 取得した最小限の情報（認証状態・`avatar_url`・`display_name`）を Props として `<HeaderUserMenu />` に渡す。
- ロゴ（左）と `<HeaderUserMenu />`（右）をレンダリングする。
- ログアウト用 `<form>` の組み立て・ボタン描画は **行わない**（Client 側に移譲）。

Props 形状（Server → Client）：

```typescript
type HeaderUserMenuProps = {
  isAuthenticated: boolean;
  avatarUrl: string | null;     // profiles.avatar_url。未設定または取得失敗で null
  displayName: string | null;   // profiles.display_name。未取得時は null
};
```

設計判断：
- `user.id` 等の機微情報は Client に渡さない。表示に必要な最小集合に絞る（Server Component → Client Component の Props はシリアライズ可能な値のみ）。
- `profiles` 取得失敗（行欠落・RLS 拒否・ネットワーク等）は `avatarUrl: null` / `displayName: null` として握りつぶし、人型アイコンへフォールバックする。500 を投げない。
- 認証チェックは middleware の既存挙動に従う。Header 自体はユーザー有無を Props に反映するだけで、リダイレクト判定は行わない。

クエリ方針：
- `createSessionClient`（RLS 経由）で読む。`createAdminClient` は使用しない。これは [[design.md::MEDIUM-001 対応]] と同じ「Server Component の `profiles` / 関連テーブル読み取りは RLS 二層防御で扱う」方針に整合する。
- 取得列は `avatar_url` と `display_name` のみ。`api_key_encrypted` 等の機微列は触らない。
- 既存 FEAT-002 で確立された `profiles` の自分自身行 SELECT 権限で十分に通る（新規 RLS 不要）。

#### Client Component: `app/components/HeaderUserMenu.tsx`

責務：
- アバターボタン（トリガ）と、その下に展開するドロップダウンメニュー（ポップオーバー）を描画する。
- 開閉状態（`isOpen`）の保持と外部要因（外側クリック / Escape / 項目遷移）でのクローズ。
- 認証時 / 未認証時で項目セットを切り替える。
- ログアウトを `<form action={logout}>` 形式の Server Action として描画する。

状態管理：

```typescript
const [isOpen, setIsOpen] = useState(false);
const rootRef = useRef<HTMLDivElement>(null);      // 外側クリック判定用
const buttonRef = useRef<HTMLButtonElement>(null); // 閉じた際のフォーカス戻し用
```

開閉トリガ：
- アバターボタン `onClick` → `setIsOpen(prev => !prev)`。
- メニュー外側 `mousedown` → 閉じる（`useEffect` で `document` に登録、`isOpen === true` の間だけ購読）。
- `keydown` の `Escape` → 閉じる（同上）。閉じた直後は `buttonRef.current?.focus()` でトリガにフォーカスを戻す（フォーカス迷子防止）。
- メニュー項目（`<Link>`）クリック → 遷移前に `setIsOpen(false)`。
- ログアウト `<form>` 送信 → `onSubmit` で `setIsOpen(false)` を呼んだ後 Server Action が実行される（実行後はサーバ側で redirect される既存挙動を変更しない）。

外側クリック検知の実装方針：
- `useEffect` で `document.addEventListener('mousedown', handler)` を登録し、`handler` 内で `rootRef.current?.contains(event.target as Node)` を判定する。`false` なら `setIsOpen(false)`。
- 登録は `isOpen === true` の間だけにする（依存配列 `[isOpen]`、cleanup で `removeEventListener`）。常時購読を避けて副作用を最小化する。
- `mousedown` を使う理由：`click` だと内部要素クリック時にバブル順で先に閉じてから遷移処理が走るケースがあり、項目クリック挙動が壊れやすい。`mousedown` + `ref.contains` の組み合わせが React 系の慣用で安定し、新規 npm 依存（ヘッドレス UI ライブラリ等）も不要。

アバター表示の状態分岐：

| 状態 | 表示要素 | 配色 |
|------|----------|------|
| 認証時 + `avatarUrl !== null` | アバター画像（丸型） | `<img>` を `rounded-full` で描画。`alt` は `displayName` か空文字 |
| 認証時 + `avatarUrl === null` | 人型シルエット（丸型背景） | 背景 `bg-stone-200`、アイコン `text-stone-600` |
| 未認証時 | 人型シルエット（薄いグレー背景） | 背景 `bg-stone-100`、アイコン `text-stone-500` |

- 人型 SVG は heroicons `user` 相当のインライン SVG を本ファイル内に直書きする（新規 npm 依存禁止のため）。サイズは Tailwind ユーティリティ（例 `w-5 h-5`）。
- 重複を減らすため、`function UserSilhouette({ className }: { className?: string })` のような小さなローカル関数に切り出してよい。
- 画像は `next/image` ではなく素の `<img>` で扱う（`next.config` の `images.domains` / `remotePatterns` を変更するスコープを避けるため）。`width` / `height` 属性を明示してレイアウトシフトを抑止する。
- 画像読み込み失敗時の `onError` フォールバックは初版では未実装（実機で失効頻度が高ければ別タスクで対応）。

メニュー項目セット：

認証時（上から）：
1. 過去のケース — `<Link href="/history">`
2. フレンド — `<Link href="/friends">`
3. プロフィール — `<Link href="/profile">`
4. 区切り線（`<div role="separator" className="border-t border-stone-200" />`）
5. ログアウト — `<form action={logout}><button type="submit">ログアウト</button></form>`

未認証時（上から）：
1. ログイン — `<Link href="/auth/login">`
2. サインアップ — `<Link href="/auth/signup">`

設計上の注意：
- 各 `<Link>` の `onClick` で `setIsOpen(false)` を呼ぶ。`<Link>` の遷移自体は Next.js に委ねる。
- ログアウト `<form action={logout}>` は `app/actions/auth.ts` から `logout` を直接 import する。`logout` 関数の本体は変更しない。フォーム送信前の `onSubmit` で `setIsOpen(false)` を呼ぶ。
- メニュー項目は縦並び（`flex flex-col`）。現行 Header の横並び（`flex gap-4`）構造は廃棄する。

レイアウト：
- ヘッダー本体：`flex items-center justify-between`（左：ロゴ、右：アバター）。
- ドロップダウン：アバター直下に絶対配置（トリガを包む `relative` 要素 + 内部 `absolute right-0 mt-2`）。
- ドロップダウン本体：背景 `bg-stone-50`、境界 `border border-stone-200`、角丸 `rounded-md`、影 `shadow-md` 程度。横幅は `w-48` を推奨（実装時に微調整可）。
- 全画面サイズで同一の見た目とするため、ドロップダウンの幅・余白・配色に breakpoint 修飾子を一切付けない。

#### `app/actions/auth.ts` との連携

- 既存 `logout` 関数を Client Component から `import` し、`<form action={logout}>` で呼ぶ。
- 現行 Server Component 内に定義されている `'use server'` のローカル関数（あれば）は HeaderUserMenu への移行に伴い不要となるため、Header.tsx 側からは除去する。`app/actions/auth.ts` の `logout` 関数本体は不変。
- これにより「ログアウト挙動を変えない」という制約を満たしつつ、Client Component からのフォーム送信形態に整合させる。

### アクセシビリティ設計

#### WAI-ARIA メニューパターン
- アバターボタン（トリガ）：
  - `type="button"`
  - `aria-haspopup="menu"`
  - `aria-expanded={isOpen ? "true" : "false"}`
  - `aria-controls={menuId}`（メニュー要素の id を参照）
  - `aria-label`：認証時は `"アカウントメニューを開く"`、未認証時は `"メニューを開く"`（テキストラベルがアバター画像のみのため必須）。
- ドロップダウン本体：
  - `id={menuId}`
  - `role="menu"`
  - `aria-orientation="vertical"`
- 各メニュー項目：
  - `role="menuitem"`
  - `<Link>` 要素または `<button>` 要素に直接付与する。
- 区切り線：
  - `role="separator"`

#### キーボード操作（必須）
- アバターボタンへの Tab フォーカス到達 → `Enter` / `Space` で開閉。
- `Escape` で閉じる → アバターボタンにフォーカス戻し。
- メニュー内の `<Link>` / `<button>` は通常の Tab 移動でフォーカス可能（ブラウザ既定）。
- 矢印キーによるメニュー項目間移動は **任意**（必須は Escape のみ。本対応のスコープには含めない。完全な ARIA メニューパターン化は別タスクで実施可）。

#### フォーカスリング
- アバターボタン：`focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50` を基本とする（既存パレット内で完結）。
- 各メニュー項目：`focus-visible:outline-none focus-visible:bg-stone-100 focus-visible:text-stone-900`。リング色を使うなら `ring-brand-700`。`brand-500` は使用しない。
- リングのオフセット背景はヘッダー背景（`bg-stone-50`）に合わせる。

#### スクリーンリーダー
- 人型 SVG アイコンは `aria-hidden="true"` を付与し、ラベル情報はトリガボタンの `aria-label` で表現する。
- 未認証時およびアバター画像未設定時でも、トリガが「メニューを開くボタン」であることが SR にも伝わるようにする。

### 配色・トーン

- ヘッダー背景：`bg-stone-50`
- 境界線：`border-stone-200`
- 既定テキスト：`text-stone-600` / `text-stone-800`
- メニュー hover 背景：`bg-stone-100`
- メニュー hover テキスト：`text-stone-900`
- 区切り線：`border-stone-200`
- アクセント / フォーカスリング：`brand-700`（`brand-500` は WCAG 非対応のため不使用）
- 人型アイコン背景（認証 + `avatar_url` 未設定）：`bg-stone-200` / アイコン `text-stone-600`
- 人型アイコン背景（未認証）：`bg-stone-100` / アイコン `text-stone-500`
- ログアウト項目のアクセント色は使用しない（赤系・rose 系は不使用。ログアウトは「危険操作」ではなく日常操作のため stone トーンで統一）。

新規カラートークンは追加しない。既存パレット（stone / brand）の範囲で完結させる。

### セキュリティ設計

#### 認証・認可
- Header はユーザー状態の表示のみを担当し、認可境界は middleware と各ページ・API Routes に任せる。本対応で middleware / ガードロジックを変更しない。
- `logout` Server Action はサーバ側で実行され、セッション cookie の破棄を担う。既存実装の挙動を維持する。

#### Server / Client 間の情報受け渡し
- Server Component から Client Component に渡す Props は「表示に必要な最小集合」（`isAuthenticated` / `avatarUrl` / `displayName`）に限定する。
- `user.id`・`email`・`api_key_encrypted`・`defense_custom_instruction` 等は **渡さない**。
- Props はすべてシリアライズ可能な値（`string` / `null` / `boolean`）に限定する（Server Component → Client Component の制約に整合）。

#### profiles 取得経路
- `createSessionClient()`（RLS 経由）で `profiles.avatar_url` / `profiles.display_name` のみを SELECT する。
- `createAdminClient` は使用しない（[[design.md::MEDIUM-001 対応]] の二層防御方針に整合）。
- 行が見つからない場合や Supabase エラー時は `avatarUrl: null` / `displayName: null` として握りつぶす（500 を投げない）。

#### 入力検証
- 本対応はサーバへの新規入力経路を追加しない。`logout` Server Action 内部の入力検証は既存実装に任せる。

#### 外部リソース（アバター画像）
- `profiles.avatar_url` は FEAT-002 で確立済みの Supabase Storage URL を信頼する。本対応で URL を再検証しない（magic bytes 検証はアップロード時にすでに実施済み）。
- `<img>` を使用するが、`crossOrigin` / `referrerPolicy` 等の追加属性は既存の表示箇所（`app/profile/page.tsx` 等）の挙動に揃える。

### 制約・前提条件

#### 絶対条件（task.md 由来）
- 新規 npm 依存を追加しない（ヘッドレス UI ライブラリ等を含む）。
- breakpoint（`sm:` `md:` `lg:` `xl:`）を導入しない。
- RLS / migration / DB スキーマを一切変更しない（`supabase/` 配下に触れない）。
- 配色は既存 `stone-*` / `brand-700` / `brand-800` の範囲で完結させる。`brand-500` は使用しない。
- ログアウト挙動（`app/actions/auth.ts` の `logout`）を不変とする。
- 認証チェック・ガード（`middleware.ts` 含む）の挙動を変更しない。
- `profiles` テーブル構造を変更しない。

#### 前提条件
- FEAT-002 で `profiles.avatar_url` / `profiles.display_name` カラムが利用可能であること。
- `app/actions/auth.ts` に `logout` Server Action が存在すること（既存）。
- `lib/supabase/server.ts` の `createSessionClient()` が `profiles` の自分自身の行を読めること（FEAT-002 の RLS 設定済み）。
- 本バージョンの Next.js での Server Component → Client Component Props 受け渡し制限（シリアライズ可能な値のみ）を遵守する。本設計で渡す値はすべて文字列 / `null` / `boolean` のため問題ない。
- 本バージョンの Next.js での Server Action を Client Component から `<form action={serverAction}>` で呼ぶシグネチャは `node_modules/next/dist/docs/` で確認のうえ既存利用箇所と揃える（AGENTS.md 方針）。

#### スコープ外
- マイページ実装（FEAT-005）。
- ヘッダー以外のページ・コンポーネントのレスポンシブ調整（実機検証は別タスク）。
- アバターアップロード機能・`profiles` テーブル構造の変更（FEAT-002 で完了済み）。
- ロゴデザイン・サービス名表記の変更。
- 矢印キーによるメニュー項目間移動・完全な WAI-ARIA roving tabindex 実装（必須は Escape のみ）。
- アバター画像読み込み失敗時の `onError` フォールバック（初版未実装、必要なら別タスク化）。
- `next/image` 採用および `next.config` の `images` 設定変更。

#### 注意事項（曖昧要件の明示・ビルドへの判断委譲はしない方針で残す備考）
- **ドロップダウンの横幅**：task.md で固定指定されていない。本設計では `w-48` を推奨する。実装時に表示崩れが見つかれば `w-44` / `w-52` 範囲で微調整可。
- **メニュー上部の「ユーザー識別行」表示**：`displayName` をドロップダウン上部に小さく表示する案は **省略可** とする。最小実装ではメニュー項目のみで足り、表示するか否かは既存トーンとの馴染みを見て実装段階で判断してよい（どちらの選択でも task.md 要件は満たす）。
- **アバター画像 `onError` フォールバック**：初版では `avatarUrl !== null` の Props 判定のみに依存し、画像読み込み失敗時の自動切り替えは入れない。これは「最初は小さく始め、実害があれば別タスクで足す」設計姿勢の意図的な選択である。

