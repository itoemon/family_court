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

---

## FEAT-005 対応: マイページ（自分専用統合ハブ）の新設

由来: `docs/backlog.md` の `[FEAT-005] マイページ（フレンド・過去のケース・プロフィール統合ハブ）`

### 概要

#### 目的
ログインユーザー本人のためのダイジェスト型統合ハブ `/me` を新設する。プロフィール・フレンド・過去のケース・参加中の法律を 1 画面で俯瞰でき、詳細編集は既存専用ページへのディープリンクで行う「読み取り専用ダイジェスト」と位置付ける。

#### 背景
- 現状ユーザー本人の活動状況を一望できる場所がなく、`/profile`・`/friends`・`/history`・`/laws` を都度個別に開く必要がある。
- 直前の FEAT-RESP-HEADER でヘッダーがアバター起点のドロップダウンに刷新されたため、アバターから自然に遷移する先として「マイページ」を設置すると導線が綺麗に繋がる。
- 編集・追加・削除は既存ページに完成済みのため、マイページは「ダイジェスト + ディープリンク」に責務を限定し、最小スコープで価値を出す。

#### GitHub / Linear 型 + 全画面サイズ統一の方針
- ページ最上部に「アイデンティティ行」（中型アバター + 表示名 + 小さなプロフィール編集導線）を置き、その下に縦並びでセクションカード 4 枚を積む。
- カードは全て同型の「タイトル + 件数バッジ + ダイジェスト + もっと見るリンク」構造に統一し、視覚的なリズムを揃える。
- FEAT-RESP-HEADER と同じく breakpoint を一切使わず、`max-w-2xl mx-auto` の 1 カラムレイアウトで PC・タブレット・スマートフォンすべての横幅で同一 UI を提供する。

### 影響範囲

#### 新設ファイル
- `app/me/page.tsx`（Server Component。データ取得を集約し各カードに props を渡すオーケストレータ）
- `app/me/_components/MeHeader.tsx`（Server Component。ページ最上部のアイデンティティ行）
- `app/me/_components/SectionCard.tsx`（Server Component。4 カード共通のレイアウトシェル）
- `app/me/_components/ProfileCard.tsx`（Server Component。プロフィールセクション）
- `app/me/_components/FriendsCard.tsx`（Server Component。フレンドセクション）
- `app/me/_components/CasesCard.tsx`（Server Component。過去のケースセクション）
- `app/me/_components/LawsCard.tsx`（Server Component。参加中の法律セクション）

#### 変更ファイル
- `middleware.ts`（`PROTECTED_PATH_PREFIXES` 配列に `"/me"` を 1 件追加。他の要素・順序・if 条件構造は不変）
- `app/components/HeaderUserMenu.tsx`（認証時メニューの **先頭** に「マイページ」項目を 1 行追加。他項目の順序・配色・遷移挙動および未認証時メニューは不変）

#### 参照のみ（変更しない）
- `app/profile/page.tsx`（プロフィール SELECT パターン参考）
- `app/friends/page.tsx`（フレンド SELECT パターン参考）
- `app/history/page.tsx`（ケース SELECT パターン参考）
- `app/laws/page.tsx`（法律 SELECT パターン参考）
- `lib/types.ts`（既存型を再利用）
- `lib/supabase/server.ts`（`createSessionClient` / `createAdminClient`）
- `app/components/Header.tsx`（ヘッダー本体・マウント方法は不変）

#### 触らないもの
- `supabase/` 配下（migration / RLS / スキーマ）
- `package.json` / `package-lock.json`（新規 npm 依存なし）
- `tailwind.config.*`（新規カラートークンなし）
- `/profile`・`/friends`・`/history`・`/laws` 各既存ページの本体実装・レイアウト
- `app/actions/auth.ts`（`logout` Server Action）

### 配置・命名

#### page ローカル `_components/` 規約への整合
- 配置は `app/me/_components/*` とし、`app/laws/[id]/_components/`・`app/friends/_components/` 等の既存慣習に揃える。page 直下にローカル UI を集約することで、import 距離から「この page 専用」が自明になる。
- `app/components/` 直下（グローバル UI）には置かない。マイページ専用の構成要素を他ページから流用する予定はなく、グローバル化は過剰構造化となる。

#### ファイル名 / コンポーネント名
- 各セクションは責務 + `Card` で命名（`ProfileCard` / `FriendsCard` / `CasesCard` / `LawsCard`）。
- 共通シェルは `SectionCard`（カード枠 + タイトル行 + バッジ + もっと見るリンクのレイアウトのみ、データは持たない）。
- ページ最上部のアイデンティティ行は `MeHeader`（`app/components/Header.tsx` と名前空間が衝突しないよう `Me` 接頭辞）。

### ページ構成

#### 全体構造（上から下）

1. **アイデンティティ行（`MeHeader`）**
   - 中型アバター（`w-16 h-16` 丸型）+ 表示名（`text-xl font-bold text-stone-800`）+ 「プロフィールを編集する」 小リンク（`text-sm text-brand-700`）。
   - アバター未設定時は HeaderUserMenu と同じ人型シルエット（`bg-stone-200` + `text-stone-600`）にフォールバック。
   - 表示名未取得時は「（名前未設定）」のプレースホルダ文字列。500 は投げない。
2. **セクションカード 4 枚（縦並び、各 `SectionCard`）**
   1. プロフィール（`ProfileCard`）
   2. フレンド（`FriendsCard`）
   3. 過去のケース（`CasesCard`）
   4. 参加中の法律（`LawsCard`）

#### セクション並び順の決定根拠

| 並び | セクション | 根拠 |
|------|----------|------|
| 1 | プロフィール | アイデンティティ行直下に置き、`/profile` への編集導線をページ上方に集約する。FEAT-RESP-HEADER でヘッダードロップダウンを縮約した結果、`/profile` 遷移ポイントを目立つ位置に再確保する意味もある |
| 2 | フレンド | 「本人 → 関係する人々」の自然な視線移動。フレンド有無が他セクション（誰と話したか等）の前提情報になりやすい |
| 3 | 過去のケース | 個人活動（自分が当事者となった対話）の振り返り。フレンドの次に置くことで「誰と」→「何を話したか」の流れになる |
| 4 | 参加中の法律 | 複数人で共有するルール（コミュニティ的関与）。最も外向きの関与なのでページ末尾に置く |

カラム数は 1 カラム固定（breakpoint なし）。

#### ダイジェスト件数 N の決定

各カードのダイジェスト件数を `N = 5` に固定する。

| 候補 | 採否 | 理由 |
|------|------|------|
| N=3 | 不採用 | 「最近の活動」を一望するには情報量が不足。空状態と差別化しにくい |
| **N=5（採用）** | 採用 | GitHub / Linear のアクティビティセクションが慣習的に採用する件数。縦並び 1 カラムでも閲覧負荷が低く、空状態（0 件）と十分なディレクションを両立できる |
| N=10 以上 | 不採用 | スクロール量が増え「ダイジェスト」の主旨から外れる。詳細閲覧は「もっと見る」遷移先で行う |

task.md は「最小 3、最大 5」と範囲指定しており、本設計はその上限値を採用する。

#### `defense_custom_instruction` のサマリ文字数

`ProfileCard` で表示する弁護人カスタム指示プレビューは **先頭 100 文字 + 100 文字超なら末尾に `…`** とする。

| 候補 | 採否 | 理由 |
|------|------|------|
| 50 文字 | 不採用 | 1 文に満たないことが多く、設定意図が伝わりにくい |
| **100 文字（採用）** | 採用 | 1〜2 文を読める分量で「どういう人格・口調を設定しているか」が即理解できる。`text-sm text-stone-500` で 2〜3 行に収まる |
| 200 文字以上 | 不採用 | カードの縦サイズが膨らみ、他セクションとの視覚バランスを崩す |

未設定時は「弁護人カスタム指示は未設定です」+ 「プロフィールで編集する」 リンクのみを表示する。

### データ取得設計

#### 取得経路の集約

`app/me/page.tsx` で 1 インスタンスの `createSessionClient()` を作成し、`auth.getUser()` で user を取得後、各セクションのクエリを `Promise.all` で並列発行する。各カードコンポーネントは取得済みデータを props で受け取るのみで自前クエリは持たない（責務集中とテスタビリティのため）。

未認証時は middleware が `/auth/login` にリダイレクトするが、二重防御として `if (!user) redirect("/auth/login")` を `page.tsx` 冒頭に置く（`/history`・`/friends`・`/laws` と同じパターン）。

#### クエリ一覧

| 用途 | テーブル | クライアント | フィルタ |
|------|---------|------------|---------|
| 自分のプロフィール | `profiles` | `createSessionClient` | `.eq("id", user.id).single()`。SELECT 列は `display_name, avatar_url, defense_custom_instruction` の 3 列のみ |
| フレンド関係（accepted） | `friend_requests` | `createSessionClient` | `.or("sender_id.eq.${user.id},receiver_id.eq.${user.id}").eq("status","accepted").order("created_at",{ascending:false})` |
| フレンドの相手プロフィール解決 | `profiles` | `createAdminClient` | `.in("id", friendIds).select("id, display_name, avatar_url")`。**MEDIUM-001 の profiles 跨ぎ carve-out に整合**（後述「profiles 跨ぎ参照を admin で維持する判断」） |
| 過去のケース | `cases` | `createSessionClient` | `.or("plaintiff_id.eq.${user.id},defendant_id.eq.${user.id}").eq("phase","verdict").order("created_at",{ascending:false})` |
| 自分のメンバーシップ | `law_members` | `createSessionClient` | `.eq("user_id", user.id)` |
| 法律本体 | `laws` | `createSessionClient` | `.in("id", lawIds).select("id, name, owner_id, created_at")` |
| pending 招待 | `law_invitations` | `createSessionClient` | `.eq("invitee_id", user.id).eq("status","pending")` |

法律ダイジェストの「最近 N 件」は **メンバーシップ + pending 招待を合算** し、メンバーシップ側は `law_members.joined_at` の降順、招待側は `law_invitations.invited_at` の降順でマージしたあと先頭 5 件を取る。役割は次のロジックで決まる:

- 当該 `laws.owner_id === user.id` → 「オーナー」
- それ以外で `law_members` 行あり → 「メンバー」
- `law_invitations.status = 'pending'` 行あり → 「招待中」

#### 件数（totalCount）の取り扱い

各カードの件数バッジは「全件数」を表示する（直近 5 件分の `.length` ではない）。実装ストラテジは 2 候補:

| 候補 | 採否 | 理由 |
|------|------|------|
| 別途 `count: "exact", head: true` クエリを発行 | 不採用（初版） | クエリ数が増える。本ドメインでは個人が抱える件数は数十程度に収まる想定で、データ転送量の差が無視できる |
| **全件取得して `.length` で件数を出し、表示用に先頭 5 件 `slice` する（採用）** | 採用 | クエリ 1 本で件数とダイジェストを同時に賄える。SELECT 列を最小化（`id` のみ含む必要列）し転送量を抑える |

将来「過去のケースが数百件規模になる」段階で別 backlog の指摘事項として count クエリ分離に切り替える余地を残す。

#### `friend_requests` の自己関連行取得が session client で通る根拠

`supabase/migrations/20260526000002_feat002_phase2_friends.sql` の `friend_requests_select_own` ポリシー（`USING (sender_id = auth.uid() OR receiver_id = auth.uid())`）により、自分が sender / receiver いずれかの行のみ可視。新規 RLS 拡張は不要。

#### `cases` の自己関連行取得が session client で通る根拠

`cases` テーブルは ADR-003 の通り「誰でも読める」公開 SELECT ポリシー。アプリ層で `.or("plaintiff_id.eq.${user.id},defendant_id.eq.${user.id}")` フィルタを付けることで、本ページの「自分が関与したケース」要件を満たす。`/history` で同パターンの運用実績あり（ただし `/history` 自体は admin を使用しているため、本ページが session client へ揃える形になる）。

#### `laws` / `law_members` / `law_invitations` の取得が session client で通る根拠

`[[design.md::MEDIUM-001 対応]]` で導入済みの `laws_select_member_or_invitee` ポリシーと、各テーブル既存 SELECT ポリシー（メンバーのみ / invitee 本人 / オーナー）により、本ページで取得したい行集合はすべて可視。新規 RLS 拡張は不要。

#### profiles 跨ぎ参照を admin で維持する判断（重要・RLS 整合）

task.md は「`createAdminClient` は使用しない」と述べているが、その直後で「`[[design.md::MEDIUM-001 対応]]` の二層防御方針に整合」を根拠として挙げている。MEDIUM-001 セクション本文は **profiles テーブルだけは admin 経由のまま残す** carve-out を明示しており（「`profiles` テーブルは本 PR では触らない」節）、その carve-out 込みが MEDIUM-001 の方針である。よって本設計は次のように切り分ける:

- **ドメインテーブル**（`friend_requests`, `cases`, `law_members`, `laws`, `law_invitations`）: 全て `createSessionClient`。RLS 二層防御を効かせる。
- **`profiles` の自分自身行**（`MeHeader`, `ProfileCard`）: `createSessionClient`。既存 RLS（`自分のプロフィールのみ参照可`）で通る。
- **`profiles` の他人行**（`FriendsCard` の友人 N 人分の `display_name` / `avatar_url`）: `createAdminClient`。MEDIUM-001 carve-out の踏襲。

この設計の理由:

- `profiles` の RLS を「自分」「フレンド」「公開列」など多段化することは可能だが、列レベル GRANT は role 単位（`authenticated` / `anon` / `service_role`）でしか書けず「他人なら一部列のみ SELECT」を表現できない（[[design.md::MEDIUM-001 対応]] 参照）。本タスクの「RLS / migration / DB スキーマには一切手を加えない」絶対条件にも違反するため不可。
- `.in("id", friendIds)` の `friendIds` は **同じセッション内で `friend_requests_select_own` RLS 経由で取得したフレンド ID 集合に限定する**。これにより admin バイパスの露出範囲は「自分のフレンドの `display_name` / `avatar_url` の 2 列のみ」に絞られる。`/friends` の現行実装と同じ運用パターン。
- 取得列は `display_name, avatar_url` のみとし、`api_key_encrypted` / `defense_custom_instruction` / `email` 等の機微列は SELECT しない。

#### 取得失敗時のフォールバック

- 各セクションのクエリ結果に対して例外 / エラーオブジェクトを個別にハンドルし、失敗・空配列はそのセクションのみ「空状態」表示にダウングレードする。ページ全体を 500 にしない（task.md 解決すべき設計上の課題 B）。
- 失敗時は `console.error("[me] <section> query failed:", error)` でサーバ側ログに残す（既存 `/history` / `/laws` と同じログ形式）。
- `MeHeader` の `profiles` 取得失敗は `displayName: null` / `avatarUrl: null` で握りつぶし、人型シルエット + 「（名前未設定）」プレースホルダにフォールバックする（FEAT-RESP-HEADER と同方針）。
- `Promise.all` を使う場合は `Promise.allSettled` への切り替えを検討する。`Promise.all` 1 つの失敗で全セクションが落ちる挙動を避けたいため、本設計では `Promise.allSettled` を採用する。

### コンポーネント設計

#### `app/me/page.tsx`

責務:

- `createSessionClient()` を作成し `auth.getUser()` 実行。未認証なら `/auth/login` にリダイレクト。
- 上記 6 系統のクエリを `Promise.allSettled` で並列発行（profile・friend_requests・cases・law_memberships・laws・invitations + friend profiles[admin]）。
- 各結果を整形して各カードの props を作る。失敗したセクションは空配列 / null を props に渡す。
- `MeHeader` + 4 つの `SectionCard` 群をレンダリングする。

レイアウト:

```tsx
<main className="min-h-screen bg-stone-50">
  <div className="max-w-2xl mx-auto px-4 py-10 space-y-6">
    <MeHeader displayName={...} avatarUrl={...} />
    <ProfileCard ... />
    <FriendsCard ... />
    <CasesCard ... />
    <LawsCard ... />
  </div>
</main>
```

`max-w-2xl mx-auto px-4 py-10` は `/history` / `/friends` / `/laws` と同じコンテナ寸法。`space-y-6` でカード間にゆとりを持たせる。

#### `app/me/_components/MeHeader.tsx`

Props 型:

```typescript
type MeHeaderProps = {
  displayName: string | null;
  avatarUrl: string | null;
};
```

責務:

- 中型アバター（`w-16 h-16 rounded-full`、`<img>` で描画。`next/image` は使わない＝`next.config` を触らない方針）+ 表示名 + 「プロフィールを編集する」リンク（`<Link href="/profile" className="text-sm text-brand-700 hover:text-brand-800 hover:underline">`）。
- `avatarUrl === null` の場合は HeaderUserMenu と同じ `UserSilhouette` SVG にフォールバック（インライン SVG を本ファイル内に直書き、または `HeaderUserMenu.tsx` から複製）。
- `displayName === null` の場合は「（名前未設定）」のプレースホルダ。

設計判断:

- SVG のコード重複 vs グローバルコンポーネント切り出し: 本対応では `HeaderUserMenu.tsx` 内の `UserSilhouette` を `MeHeader.tsx` 内に複製して並走させる。`app/components/UserSilhouette.tsx` への切り出しは妥当な動機（DRY）だが、本タスクのスコープに「グローバルコンポーネント再編」を含めると影響範囲が広がる。task.md の「最小スコープで価値を出す」方針に整合させ、ローカル duplicate を許容する判断。10 行 SVG 1 つで実害は小さい。次に第 3 の利用者が現れた段階で別タスクで切り出しを提案する。
- アバターサイズ `w-16 h-16`: HeaderUserMenu のアバター（`w-8 h-8`）の 2 倍。ページ最上部の「アイデンティティ宣言」として認識しやすい大きさ。

#### `app/me/_components/SectionCard.tsx`

Props 型:

```typescript
type SectionCardProps = {
  title: string;
  titleId: string;              // aria-labelledby に渡す
  count?: number | null;        // null なら件数バッジ非表示（取得失敗時）
  moreHref: string;
  moreLabel: string;            // 視覚情報なしで遷移先が分かる明示テキスト
  children: React.ReactNode;
};
```

責務:

- カードの外枠（`bg-white border border-stone-200 rounded-2xl shadow-sm p-5`）。
- `<section aria-labelledby={titleId}>` 構造で `<h2 id={titleId}>` を内包。
- タイトル行: 左に `<h2>` + 件数バッジ、右に「もっと見る」リンク（`text-sm text-brand-700 hover:text-brand-800 hover:underline`、`aria-label={moreLabel}`）。
- 件数バッジ: `text-xs bg-stone-100 text-stone-500 rounded-full px-2 py-0.5`（`count` が `undefined` または `null` なら描画しない）。
- `children` には各カード固有のダイジェスト本体（リストまたは空状態文）。

このコンポーネントは **データを持たず**、見出し・件数・もっと見るリンク・ボディの「フレーム」だけを担う。データ取得・整形は各 `*Card.tsx` または `page.tsx` 側に閉じる。

#### `app/me/_components/ProfileCard.tsx`

Props 型:

```typescript
type ProfileCardProps = {
  displayName: string | null;
  avatarUrl: string | null;
  defenseCustomInstructionExcerpt: string | null;  // 既に 100 文字 truncate 済み
};
```

責務:

- タイトル「プロフィール」、もっと見るリンク `/profile`、もっと見る label `プロフィールを編集する`。
- 件数バッジは表示しない（プロフィールは 1 件で件数概念がない）。
- 本体（横並び 1 行）: 小アバター（`w-10 h-10 rounded-full`） + 表示名 + その下に弁護人カスタム指示プレビュー。
- `defenseCustomInstructionExcerpt` が `null` または空文字列なら空状態文「弁護人カスタム指示は未設定です」+ 補助文を表示。

#### `app/me/_components/FriendsCard.tsx`

Props 型:

```typescript
type FriendsCardProps = {
  totalCount: number | null;    // null なら取得失敗
  recent: { id: string; displayName: string; avatarUrl: string | null }[];  // 最大 5 件
};
```

責務:

- タイトル「フレンド」、件数バッジ、もっと見るリンク `/friends`、もっと見る label `フレンドを管理する`。
- 本体: `recent` が空かつ `totalCount === 0` なら空状態「まだフレンドはいません」+ 補助文。`recent` が空かつ `totalCount === null` なら同様の空状態だが「取得に失敗しました」までは出さない（ノイズ抑止）。
- 空でなければアバター + 表示名の縦並びリスト。各行はリンク化せず、編集導線は「フレンドを管理する」リンクに集約。

#### `app/me/_components/CasesCard.tsx`

Props 型:

```typescript
type CasesCardProps = {
  totalCount: number | null;
  recent: { id: string; topic: string; createdAt: string }[];  // 最大 5 件
};
```

責務:

- タイトル「過去のケース」、件数バッジ、もっと見るリンク `/history`、もっと見る label `過去のケースをすべて見る`。
- 本体: 空なら空状態「まだ判決が出たケースはありません」+ 補助文。
- 各行は `<Link href={"/case/" + id}>` で個別ケースへ直接遷移（`/history` と同じ挙動）。表示は `topic`（`line-clamp-1`） + 日付（`new Date(createdAt).toLocaleDateString("ja-JP")`）。
- 相手ユーザー名は **表示しない**（task.md の表示要素は「トピックと日付」のみ）。これにより `cases` 系では `profiles` 跨ぎ参照を不要にできる。

#### `app/me/_components/LawsCard.tsx`

Props 型:

```typescript
type LawsCardProps = {
  totalCount: number | null;
  recent: { id: string; name: string; role: "owner" | "member" | "invitee" }[];  // 最大 5 件
};
```

責務:

- タイトル「参加中の法律」、件数バッジ、もっと見るリンク `/laws`、もっと見る label `参加中の法律をすべて見る`。
- 本体: 空なら空状態「まだ参加している法律はありません」。
- 各行: 法律名 + 役割ラベル。
  - オーナー: `text-xs bg-stone-100 text-stone-700 rounded-full px-2 py-0.5`
  - メンバー: `text-xs bg-stone-100 text-stone-600 rounded-full px-2 py-0.5`
  - 招待中: `text-xs bg-amber-100 text-amber-700 rounded-full px-2 py-0.5`（`/laws` の「提案中」バッジと同じトーン）
- オーナー / メンバー行: `<Link href={"/laws/" + id}>` で詳細へ。
- 招待中行: `<Link href="/laws">` に遷移する（招待受諾 UI は `/laws` 上の `PendingInvitations` に集約済みで、本ページに受諾フォームを置かない方針のため）。

#### 各カードの空状態テキスト（確定案）

| カード | 本文 | 補助文 |
|-------|------|------|
| プロフィール | 弁護人カスタム指示は未設定です | プロフィールでカスタム指示を編集できます |
| フレンド | まだフレンドはいません | フレンドを追加すると、ここに最近の 5 人が表示されます |
| 過去のケース | まだ判決が出たケースはありません | ホームからケースを作成して話し合いを始められます |
| 参加中の法律 | まだ参加している法律はありません | 法律を作成するか、招待を受けるとここに表示されます |

本文は `text-stone-500 text-sm`、補助文は `text-stone-400 text-xs` を基本トーンとする。

### 既存ページとの役割分担

| 操作 | マイページ（`/me`） | 既存ページ |
|------|-------------------|----------|
| プロフィール閲覧（ダイジェスト） | ◯ | `/profile` 冒頭にもプロフィール表示あり |
| 表示名・API キー・アバター画像・弁護人カスタム指示の編集 | × | `/profile` |
| フレンド一覧（直近 5 名） | ◯ | `/friends` |
| フレンド検索・申請・承認・拒否・削除 | × | `/friends` |
| 過去のケース一覧（直近 5 件） | ◯ | `/history` |
| ケース作成 | × | `/`（ホーム） |
| ケース閲覧 | ◯（行クリックで `/case/[id]` へ） | `/case/[id]` |
| 法律一覧（直近 5 件・招待含む） | ◯ | `/laws` |
| 法律作成 | × | `/laws/new` |
| 法律詳細・改定・退会・所有権移譲・招待受諾 | × | `/laws/[id]` / `/laws`（`PendingInvitations`） |

マイページからは **読み取りのみ**。マイページ内に form を置かない。すべての編集系操作は既存ページに遷移して行う。

### ヘッダー導線

#### `HeaderUserMenu.tsx` の認証時メニュー先頭への 1 項目追加

既存の認証時メニュー項目順（上から）:

1. 過去のケース — `<Link href="/history">`
2. フレンド — `<Link href="/friends">`
3. プロフィール — `<Link href="/profile">`
4. 区切り線
5. ログアウト

本対応で次の項目を **先頭** に追加:

```tsx
<Link
  href="/me"
  role="menuitem"
  onClick={close}
  className={menuItemClass}
>
  マイページ
</Link>
```

差分位置: 既存「過去のケース」 `<Link>` の直前。`menuItemClass` は同ファイル内の既存定数（`'block w-full text-left px-4 py-2 text-sm text-stone-700 hover:bg-stone-100 hover:text-stone-900 focus-visible:outline-none focus-visible:bg-stone-100 focus-visible:text-stone-900'`）を再利用する。新規スタイル定義は追加しない。

不変項目:

- 「過去のケース」「フレンド」「プロフィール」「区切り線」「ログアウト」の順序・配色・遷移先・スタイル。
- 未認証時メニュー（ログイン / サインアップ）の構造・スタイル・順序。
- アバターボタン（トリガ）の挙動、外側クリック / Escape ハンドリング、`aria-*` 属性、フォーカスリング。

#### middleware の保護パス追加

`middleware.ts` の `PROTECTED_PATH_PREFIXES` を `["/history", "/profile", "/friends", "/laws", "/me"]` に拡張する。既存の `pathname === p || pathname.startsWith(p + "/")` 判定構造をそのまま流用するため、`/me` 単独 / `/me/...` の両方が保護される。判定ロジック・matcher 設定・`getUser` 呼び出し位置は不変。

### アクセシビリティ設計

#### ランドマーク / 見出し階層

- ページ全体は `<main>` 配下（`/me/page.tsx` の最上位 JSX）。
- `MeHeader` 内に `<h1 className="text-xl font-bold text-stone-800">{displayName ?? "（名前未設定）"}</h1>` を置き、ページ全体の `<h1>` を 1 つに保つ。
- 各 `SectionCard` は `<section aria-labelledby={titleId}>` 内に `<h2 id={titleId}>{title}</h2>` を置く。`titleId` は安定文字列（`"me-section-profile"` / `"me-section-friends"` / `"me-section-cases"` / `"me-section-laws"`）を `page.tsx` から渡す（Server Component 間の props でユニーク ID は静的に決定可能）。

#### リンクラベル

「もっと見る」「すべて見る」等の汎用文言だけに頼らず、可視テキストまたは `aria-label` で遷移先を明示する:

- プロフィールカード: 「プロフィールを編集する」
- フレンドカード: 「フレンドを管理する」
- 過去のケースカード: 「過去のケースをすべて見る」
- 参加中の法律カード: 「参加中の法律をすべて見る」

可視テキストとして表示する（`aria-label` のみではなく）方針を取る。SR 読み上げと視覚的把握を同等に扱う。

#### フォーカスリング

全リンクに次のクラスを適用する:

```
focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2 focus-visible:ring-offset-stone-50
```

FEAT-RESP-HEADER で確立したトーンに揃える。`brand-500` は使用しない。

#### アバター画像

- 各セクションのアバターには `alt={displayName ?? ""}`。`alt=""` は装飾扱いの慣用に揃え、SR が冗長に読み上げないようにする（表示名は隣接テキストとして読み上げられる）。
- `MeHeader` のアバターは `alt={displayName ?? "プロフィール画像"}` とし、ページ最上位では識別語を確保する。

#### スクリーンリーダー

- 件数バッジは可視テキスト `{count}件` を内包する（SR が自然に読み上げる）。
- 役割ラベル（オーナー / メンバー / 招待中）も可視テキスト。装飾色（amber 系）に意味付けが偏らないようテキストを必須とする。

### セキュリティ設計

#### 認証・認可

- middleware で `/me` への未認証アクセスを `/auth/login` にリダイレクト（`PROTECTED_PATH_PREFIXES` に追加）。
- Server Component 内でも二重防御として `if (!user) redirect("/auth/login")` を `page.tsx` 冒頭に置く。
- 認可はアプリ層 + RLS の二段で行う。各クエリには `eq("id"|"user_id"|"plaintiff_id"|"defendant_id"|"sender_id"|"receiver_id"|"invitee_id", user.id)` 系のフィルタを必ず明示し、RLS バイパス時の保険を効かせる（`cases` の公開 SELECT に対しては特に重要）。

#### 取得列の最小化

- `profiles` は本人 / 他人いずれの SELECT でも、`api_key_encrypted` / `defense_custom_instruction` 等の機微列を不必要に取得しない。
  - 本人: `display_name, avatar_url, defense_custom_instruction` の 3 列のみ。
  - 他人（フレンド）: `display_name, avatar_url` の 2 列のみ。
- `cases` は `id, topic, created_at, plaintiff_id, defendant_id, phase` のみ（`phase` はフィルタ用、SELECT 自体は条件適用で十分なので省略可）。本文・発言ログは取得しない。
- `laws` は `id, name, owner_id, created_at` のみ。`article` 全文は取得しない（ダイジェスト不要、ペイロード肥大防止）。
- `law_members` は `law_id, joined_at`、`law_invitations` は `law_id, invited_at` のみ。

#### Server / Client 境界

- 本ページ全体が Server Component で完結し、Client Component は存在しない。Server Action も使用しない（編集 operation がないため）。
- Server から Client への props 受け渡しは発生しない（`HeaderUserMenu.tsx` 側の変更は別ファイルの 1 行追加に閉じる）。

#### 入力検証

- 本対応はサーバへの新規入力経路（API Route / Server Action）を追加しない。
- `defense_custom_instruction` の表示は React の自動 escape に任せる。`dangerouslySetInnerHTML` は使用しない。

#### 外部リソース（アバター画像）

- `profiles.avatar_url` は FEAT-002 で確立済みの Supabase Storage URL を信頼。FEAT-RESP-HEADER と同方針で `<img>` 描画とし、`next/image` は不採用（`next.config` の `images` 設定変更を避ける）。`width` / `height` 属性を明示してレイアウトシフトを抑止する。
- 画像読み込み失敗時の `onError` フォールバックは初版未実装（FEAT-RESP-HEADER と揃えた意図的な選択）。

#### RLS バイパス（admin client）の露出範囲

- `friend_requests` 経由で取得した自分のフレンド ID 集合（最大 5 件、accepted のみ）に対してのみ `profiles.{display_name, avatar_url}` を admin で SELECT する。
- 「自分以外の任意ユーザー」の `profiles` 列を読み取る経路は本ページからは存在しない（`friendIds` 経由でしか admin 呼び出しを行わない）。
- `friendIds` 自体が空配列の場合は admin クエリを発行しない（早期 return）。

### 制約・前提条件

#### 絶対条件（task.md 由来）

- 新規 npm 依存を追加しない（heroicons パッケージ・ヘッドレス UI ライブラリ等を含む）。
- breakpoint（`sm:` `md:` `lg:` `xl:`）を導入しない。全画面サイズで同一 UI を維持する。
- RLS / migration / DB スキーマを一切変更しない（`supabase/` 配下不可侵）。
- 既存テーブルへのカラム追加なし。
- 配色は既存 `stone-*` / `brand-700` / `brand-800`（および既存 `amber-100` / `amber-700` を法律の招待中バッジに限定して再利用）の範囲で完結させる。`brand-500` は使用しない。
- マイページからの編集・追加・削除操作を一切実装しない（form 不可、Server Action 不可）。
- 既存ページ `/profile` / `/friends` / `/history` / `/laws` のレイアウト・挙動を変更しない。
- ログアウト挙動・middleware の認証チェック構造を変更しない（`PROTECTED_PATH_PREFIXES` に `"/me"` を 1 件追記のみ）。
- ヘッダー本体（`Header.tsx`）のレイアウトを変更しない。`HeaderUserMenu.tsx` への 1 項目追加のみ。
- ロゴ・サービス名表記の変更なし。

#### 前提条件

- FEAT-002 で `profiles.avatar_url` / `profiles.display_name` / `profiles.defense_custom_instruction` が利用可能。
- FEAT-RESP-HEADER で `app/components/HeaderUserMenu.tsx` が認証時メニューを縦並びで描画する構造に刷新済み。
- PR #26 (MEDIUM-001) で `laws_select_member_or_invitee` ポリシーが導入済み。
- `friend_requests_select_own` ポリシー（PR #20）が `sender_id = auth.uid() OR receiver_id = auth.uid()` を許可している。
- `cases` テーブルが公開 SELECT 可能（ADR-003）。
- `lib/supabase/server.ts` の `createSessionClient` / `createAdminClient` が既存通り利用可。
- 本バージョンの Next.js での Server Component の挙動（`async function Page()` の Server レンダリング、Server → Server 子コンポーネントへの props 受け渡し）は AGENTS.md 方針に従い `node_modules/next/dist/docs/` を実装時に確認する。

#### スコープ外

- 公開プロフィールページ化（他ユーザーが `/u/[id]` 等で本人プロフィールを閲覧する経路）。
- 通知 / アクティビティフィード / 推薦ロジック等の SNS 拡張。
- 弁護人 AI 統計・利用履歴・トークン消費可視化等のセクション追加。
- `/me/edit` 等のサブパス（編集系はすべて既存ページに委譲）。
- アバター画像読み込み失敗時の `onError` フォールバック。
- 矢印キーによるカード / 項目間ナビゲーション（必須は Tab + Enter のみ）。
- `next/image` 採用および `next.config` の `images` 設定変更。
- profiles テーブルの RLS 整備（[[design.md::MEDIUM-001 対応]] と同じく別 backlog 項目で扱う）。
- マイページから直接「法律の招待を受諾」する UI（招待受諾は `/laws` の `PendingInvitations` に集約済み）。
- 「最近 N 件」の N をユーザー設定で可変にする機能。

#### 注意事項（曖昧要件の明示・実装段階で迷ったときの判断指針）

- **profiles 跨ぎ admin の使用**: task.md は「`createAdminClient` を使用しない」と書いているが、その理由として参照される MEDIUM-001 セクション自体が profiles 跨ぎを admin に残す carve-out を明示している。本設計は MEDIUM-001 carve-out を踏襲し、profiles cross-user reads（フレンド表示名 / アバター）のみ admin を許容する。これは task.md の精神（二層防御）と矛盾しない。実装段階で疑義が出た場合はリードに上申し、独自判断で profiles RLS を改修しない。
- **ダイジェスト件数 N=5 の確定**: 範囲指定（3〜5）の上限を採用。実装後の実機検証でカードが縦に長すぎると判断された場合に限り、`N = 3 〜 5` の範囲で再調整可。再調整時は 3 つのアクティビティカード（フレンド / 過去のケース / 参加中の法律）で N を統一する。
- **`defense_custom_instruction` のサマリ文字数 100**: 既存 truncate ユーティリティ（`lib/text-utils.ts::truncate` 等）が 100 文字版を持たない場合、新規ユーティリティ追加は不要で `string.slice(0, 100) + (length > 100 ? "…" : "")` の素朴な実装でよい。前後の空白除去（`.trim()`）は行ってよい。
- **法律「招待中」行のクリック先**: 招待受諾 UI は `/laws` 上の `PendingInvitations` 部分にあり、招待 ID を URL クエリ等で受け取る経路は本対応で新設しない。「招待中」行は `/laws` ルートへの遷移とし、招待を見つけるのは一覧上の `PendingInvitations` セクションに委ねる。
- **`SectionCard` の `count = 0` 表示**: 件数 0 のときバッジを「0件」と表示するか、バッジ自体を出さないか迷う可能性がある。本設計では `count === 0` でも `0件` バッジを表示する（取得失敗との区別を明確化するため）。取得失敗時のみ `count = null` を渡してバッジ非表示にする。
- **アバター画像の SVG 重複**: `UserSilhouette` を `MeHeader.tsx` 内に再掲する（`HeaderUserMenu.tsx` からの複製）。本タスクのスコープを「マイページ新設 + ヘッダー 1 項目追加」に閉じるため、`app/components/UserSilhouette.tsx` へのグローバル切り出しはあえて行わない。第 3 の利用者が現れた段階で別タスクで切り出しを提案する。
- **`Promise.all` vs `Promise.allSettled`**: 本設計は `Promise.allSettled` を採用する。1 つのセクションのクエリ失敗で全ページが落ちる挙動を避けるため。result は `result.status === 'fulfilled' ? result.value : null` 等で分岐させる。
- **件数表示の精度**: 全件取得して `.length` で件数を求める方針なので、Supabase の暗黙的な行数上限（PostgREST デフォルト 1000）に達するほどユーザーが大量に持つ場合は件数が頭打ちになる。本タスクのフェーズではこの上限を超えるユーザーは想定外（個人がフレンド数千・ケース数千を持つ段階で別タスクで count クエリ分離・ページング導入）。

---

## FEAT-006 対応: チャット回数仕様の柔軟化と固定挨拶の導入

### 概要

ケースのチャット回数を「2 回 / 3 回 / 5 回の事前選択」から「3 回デフォルト + 両者合意による早期終了 + 双方の意思での 3 回延長」に切り替える。あわせて開始時 / 終了時の挨拶を **システム自動投入の固定文** とし、ユーザーは `/profile` で文面を上書き設定できる。

#### 背景

- 現行 UI（`app/page.tsx` の 2/3/5 セレクター）は、最初に固定値を選ばせるため摩擦が大きく、また「挨拶もカウントに含まれる」ことで実質の議論ラウンドが目減りしていた。
- 解決策として、(a) 開始は常に 3 ラウンドで固定、(b) 早期終了は会話中の両者合意で発火、(c) 3 ラウンド終了直前に「続けたい / 終わりたい」の 2 択を両者に提示し OR 条件で +3 ラウンド延長、(d) 挨拶はラウンド外の固定文として扱う、という構造に再設計する。

#### 方針の根幹（task.md 由来）

- **旧データ全削除統一**: 本番 DB は現状テストデータのみのため、後方互換ロジックは作らない。マイグレーションの最初のステップで `cases` 全行を削除し、cascade で `arguments` / `verdicts` / `judge_messages` も一掃する。`profiles` / `friend_requests` / `laws` / `law_*` は保持する。
- **延長回数の上限なし**: ダイチ判断により上限は設けない。`max_rounds` カラムは残し、延長のたびに `+= 3` で履歴を間接保持する。
- **配色制約**: 既存 `stone-*` / `brand-700` / `brand-800` のみ。`brand-500` 不使用。breakpoint 不採用。
- **AI 不変**: 弁護人 AI のプロンプト・出力契約は変更しない。挨拶は AI 経由で生成せず、システム固定文を直接挿入する。
- **ポーリング前提**: リアルタイム push は導入せず、既存の CaseRoom polling 機構（phase / round / 状態）に乗せる。

### 影響範囲

| カテゴリ | パス | 変更種別 |
| --- | --- | --- |
| migration | `supabase/migrations/20260612NNNNNN_feat006_chat_rounds_and_greetings.sql` | 新規（旧データ削除 + カラム追加 + check 制約更新 + RLS 追記） |
| schema 反映 | `supabase/schema.sql` | 追記（FEAT-002 と同じく snapshot 方針に乗る）。`cases.phase` の check 値を更新、`cases.end_proposed_by` / `cases.extension_vote_*` 追加、`profiles.opening_greeting` / `closing_greeting` 追加、`arguments.is_greeting` 追加 |
| ケース作成 UI | `app/page.tsx` | `maxRounds` の `useState` / `<select>` ブロック / POST body のキーを削除 |
| ケース作成 API | `app/api/cases/route.ts` | POST body の `maxRounds` 受領を撤去し、INSERT 時の `max_rounds` 列は default に委ねる（明示指定もしない） |
| ケースルーム | `app/case/[id]/CaseRoom.tsx` | 終了提案アイコン + 状態表示、延長投票モーダル、固定挨拶 row のレンダリング、polling 反映の拡張 |
| 新規 API | `app/api/cases/[id]/end-proposal/route.ts` | POST: 終了提案のトグル（提案 / 撤回 / 合意成立判定） |
| 新規 API | `app/api/cases/[id]/extension-vote/route.ts` | POST: 延長投票（`continue` / `finish` を 1 回確定） |
| プロフィール UI | `app/profile/page.tsx` | 「開始時の挨拶」「終了時の挨拶」テキスト入力欄を追加 |
| プロフィール API | `app/api/profile/route.ts`（既存実装位置に合わせる） | PATCH で `openingGreeting` / `closingGreeting` を受領 |
| ラウンド遷移 / 開始挨拶投入 | `app/api/cases/[id]/start/route.ts` または `app/api/cases/[id]/argument/route.ts` のいずれか既存の opening 進入点 | opening phase 開始時に両者の `opening_greeting` を `arguments` に `is_greeting = true` で挿入 |
| フェーズラベル | `lib/types.ts` / `PHASE_LABELS` 定義箇所 | `"extension_voting"` を追加 |
| 型定義 | `lib/types.ts` | `Case` 型に `endProposedBy` / `extensionVotePlaintiff` / `extensionVoteDefendant` 追加、`Profile` 型に `openingGreeting` / `closingGreeting` 追加、`Argument` 型に `isGreeting` 追加、`phase` リテラルに `"extension_voting"` 追加 |
| snake→camel マップ | `lib/case-response.ts` | 新カラムのキー変換を追加（BUG-003 同様の事故防止） |

### API 仕様

#### POST `/api/cases/[id]/end-proposal`

- **用途**: 「終了を提案」アイコンのトグル。提案 → 撤回 → 提案 → 相手の合意で確定、までを 1 エンドポイントで扱う。
- **認可**: 当該ケースの `plaintiff_id` または `defendant_id` と一致する認証ユーザー、もしくは有効な guest token（被告ゲスト）を持つ呼び出し元のみ受け付ける。
- **冪等性**: トグル意味論のためサーバ側で現在状態を読んで分岐する。クライアントが同じ操作を 2 度送れば「提案 → 撤回」と進む点に注意。
- **リクエスト**: ボディなし。
- **サーバ処理**:
  - `cases` を `SELECT id, plaintiff_id, defendant_id, end_proposed_by, phase FOR UPDATE`（admin client + ロックは Postgres の `select … for update` を Supabase の RPC 不可前提では「楽観的更新」で代替: `update … where end_proposed_by IS [old]`）。
  - 呼び出し元の actor identifier（認証ユーザーなら `auth.uid()`、ゲストなら `cases.defendant_id IS NULL` 配下で `'defendant_guest'` を表す sentinel）の決定:
    - 認証ユーザー（原告）: `actorId = plaintiff_id`
    - 認証ユーザー（被告）: `actorId = defendant_id`
    - ゲスト（被告）: `actorId` には UUID を入れられないため、`cases` 側のカラムを `uuid null` ではなく **`text null`** にする（後述 [データモデル] 参照）。`actorId = 'guest'` 固定。
  - 分岐:
    1. `end_proposed_by IS NULL` → `actorId` をセット。レスポンス: `{ state: "proposed", proposedBy: "plaintiff"|"defendant" }`
    2. `end_proposed_by = actorId` → `NULL` に戻す（撤回）。レスポンス: `{ state: "withdrawn" }`
    3. `end_proposed_by != actorId` → 相手が提案中で、自分が同意した状態。`phase = 'judging'` に更新し、判決生成キューに乗せる既存処理を呼び出す。レスポンス: `{ state: "accepted", phase: "judging" }`
- **エラー**:
  - 401 / 403: 認証または ケース当事者でない
  - 409: `phase` が `argument` 以外（`waiting` / `opening` / `closing` / `extension_voting` / `judging` / `verdict`）の状態で提案された場合（提案できるフェーズは `argument` のみ）
  - 500: 楽観的更新失敗が連続したとき（リトライ案内）

#### POST `/api/cases/[id]/extension-vote`

- **用途**: 延長投票（`continue` / `finish` の 1 回限り）。
- **認可**: end-proposal と同じ。
- **リクエスト**: `{ vote: "continue" | "finish" }`
- **サーバ処理**:
  - `cases.phase === 'extension_voting'` でない場合は 409。
  - 投票者は自分側のカラムのみ書き込み可（原告 → `extension_vote_plaintiff`、被告 → `extension_vote_defendant`）。すでに値が入っているなら 409（投票後の取り消し不可）。
  - 書き込み後に両者の vote 状況を判定:
    - 片側だけ → そのまま `phase = 'extension_voting'` を維持し、レスポンス `{ state: "awaiting_opponent", myVote, opponentVote: null }`
    - 両者揃った場合:
      - どちらかが `continue` → `max_rounds = max_rounds + 3`、`extension_vote_plaintiff = NULL`、`extension_vote_defendant = NULL`、`phase = 'argument'`、`round = max_rounds_pre + 1`（延長分の最初）、`current_turn = 'plaintiff'`。レスポンス: `{ state: "extended", newMaxRounds }`
      - 両者 `finish` → `phase = 'judging'` に遷移し既存の判決生成フローを起動。レスポンス: `{ state: "finalized", phase: "judging" }`
- **エラー**:
  - 400: `vote` 値が不正
  - 401 / 403: 認可エラー
  - 409: フェーズ不一致 / 自分の票がすでに確定済み

#### PATCH `/api/profile`（既存）

- **追加項目**:
  - `openingGreeting?: string | null`
  - `closingGreeting?: string | null`
- **バリデーション**:
  - 文字列長は **既存 argument の上限 500 文字 / 4** = **125 文字** を上限とする（短い挨拶を想定し、暴発防止）。
  - 空文字 (`""`) は 400 で拒否（NULL 化したい場合は明示的に `null` を送る = 「デフォルトに戻す」ボタンの動作）。
  - 改行は 1 文字までを許容（複数行挨拶は UX 上不要）。`/\n.*\n/.test(value)` で拒否。
  - 既存 `escapeXml` をプロンプト挿入時に流用するため、保存時点での過剰な sanitize は行わない（React 描画側で自動 escape されるため）。

#### POST `/api/cases/[id]/start`（既存があれば。なければ opening 進入点ロジック）

- **追加処理**: opening phase に遷移するタイミングで、原告と被告の `profiles.opening_greeting`（NULL なら SQL のデフォルト「よろしくお願いします」）を `arguments` テーブルに `role = plaintiff/defendant`、`phase = 'opening'`、`round = 0`、`content = 挨拶文`、`is_greeting = true` で 2 行 INSERT する。被告がゲストの場合は **被告側の挨拶はサーバデフォルト固定文**（プロフィールが存在しないため）。
- **同じく** closing phase 終了タイミング（判決生成直前）に、`profiles.closing_greeting` を `phase = 'closing'`、`round = 0`、`is_greeting = true` で 2 行 INSERT する。

### データモデル

#### 1. `cases` への追加カラム

```sql
alter table public.cases
  add column end_proposed_by text null
    check (end_proposed_by is null or end_proposed_by in ('plaintiff','defendant','guest')),
  add column extension_vote_plaintiff text null
    check (extension_vote_plaintiff is null or extension_vote_plaintiff in ('continue','finish')),
  add column extension_vote_defendant text null
    check (extension_vote_defendant is null or extension_vote_defendant in ('continue','finish'));
```

##### `end_proposed_by` を `uuid` ではなく `text` にした理由

- task.md は「`end_proposed_by uuid null`」を例示しているが、被告がゲストの場合 `user_id` 相当の UUID が存在しない（`defendant_id IS NULL` かつ `defendant_guest_name` 経由でのみ識別される）。
- これを `uuid` のまま運用すると、ゲスト被告は終了提案を出せない（NULL を入れると未提案と区別不能）か、無理やり原告の UUID を流用するなどの破綻が出る。
- **roleベース**（`'plaintiff'` / `'defendant'` / `'guest'`）に変更することで、認証被告とゲスト被告を同じ意味論で扱える。ロール識別は API 側の認証情報から確定する（クライアント送信値を信用しない）。
- ロールが 1 ケース内で複数被告を持たない前提（要件定義書通り）なので、`'defendant'` と `'guest'` を分けるか統一するかは選択肢があるが、本設計では `cases.defendant_id IS NULL` の場合に `'guest'`、それ以外で `'defendant'` を使う。実装側で `defendant_id IS NULL ? 'guest' : 'defendant'` と一義に決定できる。

##### 延長投票の保存方式（案 A: cases 2 カラム / 案 B: 別テーブル）

| 観点 | 案 A（cases に 2 カラム） | 案 B（`case_extension_votes` 別テーブル） |
| --- | --- | --- |
| マイグレーション量 | 小（ALTER 2 列） | 大（CREATE TABLE + INDEX + RLS + GRANT） |
| 状態取得 | `cases` 1 行で完結 | JOIN または別クエリ必要 |
| 投票後リセット | カラムを NULL に戻すだけ | 履歴行が残るため最新を取り直すロジックが必要 |
| 複数延長の履歴 | 残らない（max_rounds の総和でラウンド数のみ復元可） | 全延長の票が時系列で残る |
| RLS 追加 | 既存 `cases` ポリシーに自動追従 | 新テーブル用ポリシーを 2 件追加 |
| 投票取消 | 「カラム書込後は変更不可」を API 側で担保 | INSERT のみ許可、UPDATE/DELETE 禁止で表現可能 |

**推奨: 案 A**。理由:

1. task.md「投票後の取り消しは許可しない（一度押したら確定）」を満たしつつ、両者投票後に「リセット → 次の延長サイクル」を素直に行うには A の方が状態管理が単純（次の `extension_voting` フェーズ突入時にカラムが空になっている状態が保証される）。
2. 複数延長の票履歴は、`arguments.round` が `max_rounds` の遷移と整合しているため、必要なら `max_rounds` の最終値とラウンドの境界（3, 6, 9, ...）から「延長は何回行われたか」を間接的に復元できる。生の票履歴の保存は **YAGNI**。
3. RLS の追加範囲が `cases` 既存ポリシーで全て賄え、攻撃面が増えない。
4. 将来「票履歴の監査」が要件化された場合、`case_extension_votes` テーブルを追加し、書き込み経路だけ二重化すれば良い（後付けで案 B に移行可能）。

#### 2. `profiles` への追加カラム

```sql
alter table public.profiles
  add column opening_greeting text null
    check (opening_greeting is null or (char_length(opening_greeting) between 1 and 125)),
  add column closing_greeting text null
    check (closing_greeting is null or (char_length(closing_greeting) between 1 and 125));
```

- 既存 `defense_custom_instruction` と同じく nullable + check 制約パターン。
- 空文字 (`""`) は length 0 のため check 制約で拒否される（API 層と多重防御）。
- 文字数上限 125 は arguments 上限 500 の 1/4 を採用（短い挨拶を想定）。
- 既定値は **DB 側に持たせない**（NULL = 未設定 = サーバ側でアプリ既定文を採用 の意味論）。サーバ側既定文を `lib/case-response.ts` または別の `lib/greetings.ts` に集約する。

##### 既定文の保管場所

```typescript
// lib/greetings.ts
export const DEFAULT_OPENING_GREETING = "よろしくお願いします";
export const DEFAULT_CLOSING_GREETING = "ありがとうございました。";

export function resolveOpeningGreeting(profileValue: string | null): string {
  return profileValue ?? DEFAULT_OPENING_GREETING;
}

export function resolveClosingGreeting(profileValue: string | null): string {
  return profileValue ?? DEFAULT_CLOSING_GREETING;
}
```

理由: SQL の `default` リテラルとアプリ側既定文が二重定義になると更新時のドリフトが起きる。「NULL → アプリ側既定」一本に統一する。

#### 3. `arguments` への追加カラム（挨拶記録方式の確定）

##### 候補比較

| 観点 | 案 1: `arguments.is_greeting` | 案 2: `judge_messages` 流用 | 案 3: 別テーブル `case_greetings` |
| --- | --- | --- | --- |
| 既存 SELECT 経路への影響 | `is_greeting = false` フィルタを追加するだけ | `judge_messages` に「ユーザー挨拶」が混入し、`trigger_type` の意味が崩壊 | 新テーブル分の SELECT 経路を追加 |
| 表示順序の整合 | `created_at` で他発言と一意に時系列ソート可 | `judge_messages` と `arguments` を UNION して並べる必要があり既存ロジックの大改修 | UNION 必要 |
| ラウンドカウント除外 | `WHERE is_greeting = false` で round count から除外可 | judge_messages はもともとカウント対象外なので簡単だが、新挨拶ロールの role / phase 表現が不能 | テーブル分離なので自然 |
| migration 量 | 小（ALTER 1 列） | 中（`judge_messages.trigger_type` check 緩和、表示 UI 改修） | 大（CREATE + RLS + GRANT + UI） |
| 「ユーザーの発言」としての意味論 | 自然（実際にユーザーが何を言うかをサーバが代行投入しただけ） | 不自然（裁判官メッセージではない） | 自然 |

**推奨: 案 1**。理由:

1. 表示順序（時系列の吹き出し並び）が既存の `arguments` SELECT パスにそのまま乗る。CaseRoom の描画ロジックは「`is_greeting === true` のときラベル `「開始の挨拶」` / `「終了の挨拶」` を吹き出し上部に小さく付ける」だけの差分で済む。
2. round カウントは既存の round 集計クエリに `.eq("is_greeting", false)` を 1 行足すだけで除外できる（あるいはサーバ側で `arguments.round = 0` のレコードを集計から除外する規約とする）。
3. 弁護人 AI 生成（`/api/cases/[id]/defense/draft`）は `arguments` を読んで対話履歴を構築するため、挨拶も自然に履歴に入る。これは AI 動作にとって自然な振る舞い（実際の対話の入口・出口を AI も見える）。task.md「弁護人 AI の挙動・プロンプト・出力契約は変更しない」と矛盾しないが、AI に挨拶が見えること自体は許容範囲（出力契約は変わらない）。
4. 案 2 / 案 3 は表示の UNION や新テーブル新設の差分が大きく、レビュー / 検証コストに見合わない。

##### `arguments.is_greeting` の DDL

```sql
alter table public.arguments
  add column is_greeting boolean not null default false;
```

- `round = 0` は挨拶行の規約値とする。既存の `round` カラムには制約がない（`int not null`）ので、`is_greeting = true ⇒ round = 0` をアプリ側で担保する。check 制約まで張るかは選択肢があるが、過剰防衛のため初版では入れない（必要なら次の migration で追加）。

#### 4. `cases.phase` の check 制約更新

`phase` は ENUM ではなく `text + check`。

```sql
alter table public.cases drop constraint if exists cases_phase_check;
alter table public.cases add constraint cases_phase_check
  check (phase in ('waiting','opening','argument','closing','extension_voting','judging','verdict'));
```

ENUM ではないため `ALTER TYPE ADD VALUE` 不要。`drop constraint → add constraint` で 1 トランザクション内で安全に切替できる。

#### 5. PHASE_LABELS 更新

```typescript
// 既存定義位置（lib/types.ts もしくは lib/phase.ts）に "extension_voting" を追加
export const PHASE_LABELS: Record<Phase, string> = {
  waiting: "参加待ち",
  opening: "冒頭陳述",
  argument: "本論",
  closing: "最終弁論",
  extension_voting: "延長投票",
  judging: "判決生成中",
  verdict: "判決",
};
```

ラベル文言「延長投票」は既存トーン（漢字 4 文字、簡潔）に揃える。

#### 6. 旧データ削除と migration の段取り

##### 候補比較

| 観点 | 案 A（1 migration に集約） | 案 B（削除と DDL を分離） |
| --- | --- | --- |
| 原子性 | 高（途中で止まれば全ロールバック） | 低（削除後に DDL が失敗するとデータだけ消えた中途半端な状態） |
| レビュー見通し | コメント区分で十分対応可 | 良（1 ファイル 1 関心） |
| 履歴の読み解きやすさ | 「feat006 一括」で意味明確 | 2 ファイルで意図が分散 |
| ロールバック | 1 ファイル削除 + revert で済む | 2 ファイル順序を考慮して revert |

**推奨: 案 A**。理由: 本タスクの DDL は 1 つの目的（FEAT-006 仕様への移行）に紐付き、削除 → DDL → RLS の各ステップは互いに依存している。途中失敗時のデータ整合性を最優先し、1 ファイルにまとめる。レビュー見通しは SQL コメントで区分する。

##### 削除順序

- 既存 cascade 設定の確認: `arguments` / `verdicts` / `judge_messages` はいずれも `case_id ... on delete cascade` で定義済み（schema.sql:91, 108, 126）。
- したがって **`delete from public.cases;` 1 文** で下流テーブルも自動的に空になる。明示的な順次 DELETE は不要。
- ただし、レビュー時の意図を明確にするためコメントで「cascade により arguments / verdicts / judge_messages も同時に削除される」と書く。

##### migration ファイル名

`supabase/migrations/20260612NNNNNN_feat006_chat_rounds_and_greetings.sql`

`NNNNNN` は配置時の HHMMSS。複数 migration を出す予定がないため 1 ファイルのみ。

### API 設計（詳細）

#### 認証 / 認可パターン

- 認証ユーザー: `createSessionClient()` で `auth.getUser()` を呼び、`user.id === plaintiff_id || user.id === defendant_id` をチェック。
- ゲスト被告: 既存の `verifyGuestToken(case_id, token)` を呼び（`lib/guest-token.ts`）、検証成功なら `actorRole = 'guest'` として処理。
- 失敗時は 401 / 403 を返す。
- DB 書き込みは `createAdminClient()` を使い、サーバ側で確認した actor 情報のみ書き込む（クライアント送信値を信用しない）。

#### 状態遷移と排他

- `end-proposal` の楽観的更新パターン:

```typescript
// 簡略化した擬似コード
const { data: current } = await admin
  .from("cases")
  .select("end_proposed_by, phase")
  .eq("id", caseId)
  .single();

if (current.phase !== "argument") {
  return error(409, "phase_not_acceptable");
}

if (current.end_proposed_by === null) {
  const { error } = await admin
    .from("cases")
    .update({ end_proposed_by: actorRole })
    .eq("id", caseId)
    .is("end_proposed_by", null);
  if (error || ...) return retry();
  return ok({ state: "proposed" });
}
// ... 同様に「自分が提案中 → 撤回」と「相手が提案中 → 同意」を分岐
```

- 「自分が提案 → 即同時に相手も提案」が同時刻に発生した場合、楽観的更新の WHERE 条件で片方が失敗してリトライする。リトライ時は最新状態を読み直し、`'相手が提案中'` 経路で同意 → judging に進む（事故にならない）。

#### 冪等性

- `extension-vote` は **一度入った値の上書き禁止**を `WHERE extension_vote_<side> IS NULL` で表現する。クライアントの 2 度押しは 2 回目が 409 になる。
- `end-proposal` はトグルなので「同じ操作の 2 度押し」は意味的に「提案 → 撤回」と進む。クライアント UI 側でアイコン状態を最新化することで誤操作を抑える。

### コンポーネント設計

#### `app/page.tsx`（ケース作成画面）

- 削除:
  - `const [maxRounds, setMaxRounds] = useState(3)` 相当の state
  - `<label>議論ラウンド数</label>` 配下の `<select>` ブロック
  - `body: JSON.stringify({ topic, maxRounds, ... })` から `maxRounds` キー
- 保持:
  - `topic` 入力、被告選択フロー、submit ロジック
- 追加なし。

#### `app/case/[id]/CaseRoom.tsx`

##### 終了提案アイコンの配置

- レイアウト: 自分側の入力欄ヘッダー（入力フォームの右上または送信ボタン左隣）に **常設**。チャット欄の長辺に沿って配置するのではなく、自分が操作するエリアの近接位置に置く。これは「終了提案＝自分の意思表示」という UX 意味論に揃える。
- アイコン: SVG（`stroke-current text-stone-500`）。新規 npm 依存なしのため、`HeaderUserMenu.tsx::UserSilhouette` と同じパターンでインライン SVG を `CaseRoom.tsx` 内に直書きする。アイコンの図柄は「下向き矢印付きドア（exit）」や「丸に中黒（停止）」など中立的なもの。**配色は `stone-500`（未提案）/ `stone-700`（自分が提案中、押下状態）**。`brand-500` 不使用、`brand-700` も終了系の文脈には強いので不採用。
- ホバー: `hover:bg-stone-100 rounded`。プレス時は `active:bg-stone-200`。
- アクセシブル名: `aria-label="話し合いの終了を提案する"`（押下状態時は `"終了の提案を取り下げる"`）。

##### 状態表示

- 自分が提案中: アイコン背景 `bg-stone-200`、`aria-pressed="true"`。隣に小さく `「あなたが終了を提案中」` のテキスト（`text-xs text-stone-600`）。
- 相手が提案中: 画面上部に **dismiss 不可のバナー**を出す。文言: `「相手が話し合いの終了を提案しています。同意する場合は終了を提案を押してください」`。配色 `bg-stone-100 border-stone-300 text-stone-700`。CTA としてバナー内に **「同意して終了」ボタン**（`bg-brand-700 hover:bg-brand-800 text-white`）も配置し、ボタンが押された場合の挙動はサイドアイコン押下と同じ（end-proposal API を叩く）。
  - 撤回は提案者本人のサイドアイコンからのみ可能。バナー側からの「拒否」ボタンは設けない（要件にないため）。

##### 延長投票モーダル

- 発火条件: polling 結果の `phase === "extension_voting"` を検出した時点でモーダルを開く。
- モーダル内容:
  - タイトル: `「話し合いを続けますか？」`
  - 説明: `「3 回の議論が終わりました。もう少し話し合いたい場合は「続ける」、ここで判決に進む場合は「終わる」を選んでください。一度選ぶと取り消せません」`
  - ボタン 2 つ:
    - `「続ける（+3 回）」`: `bg-brand-700 hover:bg-brand-800 text-white`
    - `「終わる（判決へ）」`: `bg-stone-200 hover:bg-stone-300 text-stone-700`
  - 配置: モーダル中央。閉じる × ボタンは設けない（投票を強制するため）。
- 投票後:
  - 自分の投票が反映されていない（API レスポンス `state: "awaiting_opponent"`）の場合、モーダルを `「相手の投票を待っています」` の表示に切り替えて保持。`my vote` の表示と「自分の判断を取り消すことはできません」の注記を入れる。
  - 両者投票完了 → polling で `phase` が `argument` または `judging` に切り替わる → モーダルを閉じる。
- 既存の polling 周期（5〜10 秒）で十分。新たな `useInterval` を設けない。

##### 固定挨拶の表示

- 通常の発言 row と同じ吹き出しコンポーネントを再利用。
- 吹き出し上部に小さくラベル: `「開始の挨拶」` または `「終了の挨拶」`（`text-xs text-stone-500 mb-1`）。
- `arguments` の SELECT 経路で `is_greeting` をそのまま受け取り、各 row の描画時に分岐する。
- ラウンドカウンタ（画面上部の「ラウンド X / Y」表示など）は `is_greeting = false` の行のみ集計する。

##### 状態管理に追加するもの

- polling 経由で `cases` から取得する追加フィールド: `endProposedBy`, `extensionVotePlaintiff`, `extensionVoteDefendant`, `phase`（`"extension_voting"` を含む）
- ローカル `useState`: モーダル開閉フラグ、終了提案 API の in-flight フラグ（重複押下抑止）
- fetch サイクル: 既存 polling に新カラムを差し込むだけで、新規 interval は不要

#### `app/profile/page.tsx`

- 既存のフォーム（`display_name`, API キー, アバター, `defense_custom_instruction`）に **2 つのテキスト入力**を追加:
  - 「開始時の挨拶」: `<input type="text" maxLength={125}>` + placeholder `「よろしくお願いします」`
  - 「終了時の挨拶」: 同様
- 値が空のままで保存しようとした場合、クライアント側でも `「空欄では保存できません。デフォルト（よろしくお願いします）に戻すには「デフォルトに戻す」を押してください」` を出す。
- 「デフォルトに戻す」ボタンを各入力の隣に小さく配置（`text-stone-500 hover:text-stone-700 text-xs underline`）。押下で当該フィールドを **NULL** として PATCH を送る。
- 保存 / リセット時の loading / success / error の UX は既存のプロフィール編集パターンを踏襲する（新規パターン導入なし）。

#### `app/api/profile/route.ts` 系

- PATCH body の zod / バリデーション層に `openingGreeting?: string | null` / `closingGreeting?: string | null` を追加。
- バリデーション:
  1. `value === null` → そのまま NULL を UPDATE 対象に
  2. `typeof value === 'string'` で長さ 1〜125、改行は 1 つまで → そのまま UPDATE
  3. 空文字 `""` → 400 `validation_error` with `field: "openingGreeting"` 等
- 既存の `defense_custom_instruction` のバリデーション実装を雛形にする。

#### `lib/types.ts` / `lib/case-response.ts`

```typescript
export type Phase = "waiting" | "opening" | "argument" | "closing" | "extension_voting" | "judging" | "verdict";

export interface Case {
  // 既存フィールド
  endProposedBy: "plaintiff" | "defendant" | "guest" | null;
  extensionVotePlaintiff: "continue" | "finish" | null;
  extensionVoteDefendant: "continue" | "finish" | null;
}

export interface Profile {
  // 既存
  openingGreeting: string | null;
  closingGreeting: string | null;
}

export interface ArgumentRow {
  // 既存
  isGreeting: boolean;
}
```

`lib/case-response.ts` は BUG-003 で学んだとおり、snake → camel を **明示マップ** する。新カラム 3 つを必ず手動で写像する。

### セキュリティ設計

#### RLS 追加

- `cases` の SELECT は既存「誰でもケースを参照可」(`using (true)`) で新カラムも自動的に SELECT 可能。新規ポリシー不要。
- `cases` の UPDATE は現状 RLS ポリシーが定義されていない（書き込みは API Route 経由で admin client）。本対応も書き込みは admin client 経由なので RLS 追加不要。
- `arguments.is_greeting` の SELECT は既存「誰でも発言を参照可」(`using (true)`) で問題なし。INSERT は admin client 経由なので RLS 不要。
- `profiles.opening_greeting` / `closing_greeting` の SELECT: 既存「自分のプロフィールのみ参照可」で本人 SELECT のみ許可されている。他人の挨拶を取り出すのは **判定済みケース当事者がサーバ側で admin client 経由で読む** 用途のみで、クライアント直接アクセス経路はないため追加ポリシー不要。
- `profiles.opening_greeting` / `closing_greeting` の UPDATE: 既存「自分のプロフィールのみ更新可」で本人 UPDATE のみ許可される。**ただし** 既存ポリシーは行レベルで「自分の行のみ UPDATE 可」を保証するだけで、列単位の制限はない。本対応で UPDATE 経路が API Route 経由（`/api/profile`）であれば、列単位の安全性は API 層が担保する。

#### 入力検証 / XSS

- 挨拶テキストは既存 `escapeXml`（`lib/text-utils.ts` 等）を AI プロンプト挿入時に適用。
- DB 保存時は escape しない（React 描画側で自動 escape）。
- 文字数上限は DB check 制約 + API バリデーションの二重防御。

#### API 認可

- 終了提案 / 延長投票 / プロフィール更新の各エンドポイントで、認証ユーザーまたはゲストトークンの検証を必ず行う。検証失敗時は処理開始前に return。
- DB 書き込みは確認済み actor の identity でのみ。クライアント送信値（user_id 等）を信用しない。

#### CSRF / リプレイ

- 既存の Supabase セッションクッキー + Next.js の SameSite 既定値に乗る。本対応で新規追加なし。
- ゲストトークンは既存の HMAC nonce 方式（PR #16 / `guest_tokens`）に乗る。

### 制約・前提条件

#### 絶対条件（task.md 由来）

- `design.md` は永続資料。既存 FEAT-001〜FEAT-005、MEDIUM-001、LOW バッチ、FEAT-RESP-HEADER、BUG-002/003 のセクションを削除・短縮しない。本セクションは末尾追記のみ。
- 旧データ全削除前提。後方互換ロジックを一切書かない（既存 `max_rounds = 2/5` のケースを残す処理、`is_greeting` を持たない arguments を扱う分岐などは不要）。
- 新規 npm 依存追加禁止。アイコンは SVG インライン。モーダルは既存 Tailwind ユーティリティで素朴に組む。
- breakpoint 導入禁止。全画面サイズで同一 UI。
- 配色は `stone-*` / `brand-700` / `brand-800` の範囲。`brand-500` は終了系・延長 CTA 双方で使用しない。
- 弁護人 AI のプロンプト・出力契約変更なし。挨拶は AI 経由生成せず、システム固定文を直接 INSERT する。
- ヘッダー本体（`Header.tsx`）のレイアウト変更なし。マイページ (`/me`) 本体に挨拶設定 UI を追加しない（`/profile` のみ）。
- 延長回数の上限は設けない。

#### 前提条件

- `cases.phase` は `text + check` 制約（ENUM ではない）。`ALTER TABLE ... DROP CONSTRAINT / ADD CONSTRAINT` で値追加する。
- `arguments` / `verdicts` / `judge_messages` の `case_id` は `on delete cascade`（schema.sql 確認済み）。`DELETE FROM cases` 1 文で下流が掃ける。
- ゲスト被告の識別は既存 `verifyGuestToken` 経由。ゲストには `profiles` 行が存在しないため、ゲスト被告の挨拶はサーバ既定文を採用する。
- `profiles.id = auth.users.id` の 1:1 関係は維持。
- Next.js 16.2.6 / React 19.2.4 / Tailwind 4.x / Supabase 2.105.4 の現行スタック（[[environment.md]]）。

#### スコープ外

- 終了提案のリアルタイム push（既存 polling で十分）
- 判決画面 UI 改修
- 挨拶設定の i18n / 国際化
- 既存ケースのデータ補正 / 移行（削除のみで対応）
- マイページ `/me` への挨拶 UI 追加（`/profile` のみ）
- ケース作成画面の他項目（topic、被告選択フロー）変更
- 弁護人 AI の挙動 / プロンプト / 出力契約変更
- 延長回数の上限
- 配色トーンの追加（既存範囲のみで完結）
- breakpoint 導入
- 「終了を提案」のリッチアニメーション / トースト通知
- 延長投票モーダルの閉じる × ボタン（強制投票）
- `case_extension_votes` 別テーブル化（案 A 採用のため）
- 挨拶記録の `judge_messages` 流用 / 別テーブル新設（案 1 採用のため）

#### 注意事項（曖昧要件の明示・実装段階で迷ったときの判断指針）

- **`end_proposed_by` の型を `text` に変えた理由**: task.md は `uuid null` を例示しているが、ゲスト被告の UUID が存在しないため、`text` (`'plaintiff'` / `'defendant'` / `'guest'`) に変更している。これは task.md の意図（「誰が提案中かを保存し、相手が押したら確定」）を実装で破綻なく満たすための判断であり、リード判断を要する場合は実装着手前に上申すること。
- **挨拶を AI 履歴に含めるか**: 案 1 採用により `arguments` テーブルに挨拶が混在するため、`/api/cases/[id]/defense/draft` が `arguments` を読んで AI に渡す経路で挨拶も自然に AI 入力に含まれる。これは「AI の挙動・プロンプト・出力契約を変更しない」と矛盾しない（プロンプト構造とテンプレは不変、入力データの中身が増えるだけ）。AI が挨拶を「弁論」と誤解する懸念がある場合、`is_greeting = true` の行を defense/draft 側で除外する案も取り得る。**初版では除外せず**、ダイチ判断で品質劣化が観察されたら次の PR で除外する。
- **`extension_voting` 移行のタイミング**: `phase === 'argument'` で `round === max_rounds` の最終ターンが終了した直後、判決生成キューに乗せる前に `phase = 'extension_voting'` へ書き換える。実装上は既存の「`closing` → `judging`」遷移ロジックの直前に分岐を入れる形でよいが、要件には「`closing` フェーズの扱い」が明示されていない。本設計では **closing フェーズは廃止せず維持** し、`closing` 終了 → `extension_voting` → (continue) `argument` 再開 または (両者 finish) `judging` の順序とする。closing フェーズ中の挨拶（終了挨拶）は `extension_voting` 突入時点ではまだ投入しない。両者 finish 確定 → `judging` 遷移時点で終了挨拶を INSERT する。
- **既存ケース作成 API の互換**: task.md は「body の `maxRounds` を受け取っている場合、当該フィールドは無視する」と書いているが、より明快に、`app/api/cases/route.ts` の POST ハンドラから `maxRounds` の参照を完全に撤去する（無視ではなく非読み取り）。クライアント (`app/page.tsx`) から送らない以上、サーバが「受領しない」と表明することで仕様の明確性が増す。
- **「同意して終了」CTA の二重押下**: 相手側バナーの CTA とサイドアイコンの両方が end-proposal API を叩くため、ボタン押下後は両方とも disable する。in-flight フラグを 1 つ持って共通制御する。
- **既存 `max_rounds` カラムを残す理由**: 値そのものは「現在の上限ラウンド数」を表現するため、延長のたびに `+= 3` する形で実体は意味を保つ。仕様変更で `max_rounds` 自体を撤去する案も考えられるが、判決生成側で「現在何ラウンド消化したか」をクエリで使う既存箇所があるため、カラム削除は破壊変更が大きい。**残置 + 加算更新** が最小侵襲。
- **`round` の初期値と挨拶 row の関係**: 挨拶 row は `round = 0` で INSERT する。既存ケースの SELECT クエリで `round = 1` から始まる前提の箇所がある場合、`is_greeting = false` フィルタを明示的に追加する（または `round > 0` で代替）。実装時に grep で `from("arguments")` を全件チェックすること。
- **migration の transaction 単位**: Supabase の migration は 1 ファイル 1 トランザクション。本対応は `DELETE FROM cases;` + DDL を 1 ファイルに集約するため、途中失敗時は全ロールバックされる。BEGIN/COMMIT を明示する必要はない（暗黙のトランザクション）。
- **PostgREST GRANT**: 新カラムは元テーブルへの GRANT を継承するため、追加 GRANT 不要。新テーブルを作る案 B / 案 3 を採用しなかった理由の一つでもある。
- **延長後の `round` リセット**: 「両者の片方が continue → +3 ラウンド」の遷移で、`round` は **加算前 `max_rounds + 1`**（例: 元 3 → 延長後 max_rounds 6 → 次の round は 4）にする。「延長後の最初のターンは原告から」を採用するため `current_turn = 'plaintiff'` にリセットする。これは task.md に明示はないが、各延長サイクルの起点を一貫させるための判断。
- **`closing` 挨拶のタイミング**: 判決生成が走る直前（`phase = 'judging'` に遷移する直前）に終了挨拶を INSERT する。延長で `argument` に戻る場合は終了挨拶を入れない。延長最終確定（両者 finish）の処理内で INSERT を行う。
- **「終了を提案」中の延長投票**: `phase === 'argument'` で終了提案が既に乗っている状態で最終ラウンドに到達した場合、終了提案を維持したまま `extension_voting` に遷移する。`extension_voting` フェーズに入った時点で `end_proposed_by` を NULL にリセットする（投票結果が `argument` への復帰なら過去の終了提案は意味を失うため、開始状態に戻すのが UX として自然）。実装は extension_voting 遷移処理内で `end_proposed_by = NULL` も同時更新。
- **配色補足**: 「終了を提案」自体は重い意思決定だが、サイドアイコンは「常設」のため目立たせすぎないトーン（`stone-500`）を採用。押下確定後のバナー・CTA は「相手側の合意誘導」のため `brand-700` を採用（既存プライマリ）。延長 CTA の「続ける」も `brand-700`、「終わる」は中立的な `stone-200`。これらは task.md の制約「stone-* / brand-700 / brand-800 の範囲」に収まる。

---

## BUG-007 対応: ログイン成功後にページ遷移しない問題

### 由来

`docs/backlog.md` の BUG-007（2026-06-15 ダイチ手動確認）。`/auth/login` でメール+パスワードを入力して「ログイン」を押すと、認証自体は成功し UI 上のステータス（ヘッダーのアバター/ドロップダウン等）はログイン後の状態に切り替わるが、ページ遷移が発生せず、ユーザーが手動でリンクを踏まないと先に進めない症状。

### 原因の特定

`app/auth/login/page.tsx` の signin 成功後ハンドラに 2 つの問題が同居していた。

1. `router.push("/")` の直後に `router.refresh()` を呼んでおり、refresh が後勝ちすることで current page（login）の Server Component を再描画してしまい、push による遷移効果が打ち消されるパターンに当たっていた疑い。Next.js App Router の `router.push` と `router.refresh` の組み合わせで、refresh が push 先ではなく現在ページに作用するため、login ページに留まったままヘッダー等の Server Component だけ最新の auth 状態で再描画される、という挙動と整合的。
2. `next` クエリパラメータが解釈されておらず、常に `"/"` 固定で遷移していた。middleware の保護パス（`PROTECTED_PATH_PREFIXES`）からのリダイレクト先として将来 `?next=...` を付ける拡張余地を残せていなかった。

### 修正方針

- `router.refresh()` の呼び出しを削除。push 先（`/` 等）のページが新しい auth cookie で server-render されるため、refresh で current page を再描画する必要はない。
- `useSearchParams()` を導入し、`searchParams.get("next") || "/"` で遷移先を解決する。`?next=` が付いていない場合は従来通り `"/"` にフォールバックするため、middleware 側で `next` を付ける改修と独立して導入できる。
- エラー時の処理を `else { ... }` から `if (error) { ...; return; }` の early return に整理し、可読性を上げる。

### スコープ外（別タスクで扱う）

- middleware（`middleware.ts:38`）の `NextResponse.redirect(new URL("/auth/login", request.url))` に `next` クエリを付与する改修。本タスクは login 側のフォールバック先の柔軟性のみを担保する。
- ログイン後の遷移先を `/me` 等にユーザーごとにカスタマイズする機能。
- ログアウト後のリダイレクト先処理（`/api/auth/signout` 等が同じ問題を抱えているかは別途検証）。

### テスト観点

`tests/e2e/` に以下の観点で spec を追加する想定。

1. **通常ログイン**: `e2e_user_a@example.com` / `E2eTest123!` で `/auth/login` から signin → URL が `/` または middleware による振り分け先（例: `/me` 等）に変わり、login ページに留まらないこと。
2. **`?next=` 付きログイン**: `/auth/login?next=/history` を開いて signin → `/history` に遷移すること。
3. **誤ったパスワード**: 既存のエラーメッセージ「メールアドレスまたはパスワードが違います」表示が崩れないこと（リグレッション確認）。

### 監査観点（オーディに渡す論点）

- `router.refresh()` を削除したことによる副作用がないか（ログイン後にヘッダーが最新 auth 状態で表示されるか、Server Component が最新の auth cookie で render されるか）
- `useSearchParams()` の利用について Next 16 の Suspense ラップ要件に抵触していないか（既存 `CaseRoom.tsx` が同パターンで通っているので問題ない想定だが、build 警告が出ていないかの確認）
- `next` パラメータの open redirect 脆弱性: 外部 URL が `?next=https://evil.example.com` のように渡された場合、`router.push(next)` で外部に遷移してしまう可能性がないか。Next.js の `router.push` は内部パス扱いをするため通常は問題ないが、念のため検証する観点

---

## BUG-004 対応: ゲスト/アカウント参加直後に弁護人 AI タブが表示されない問題

### 由来

`docs/backlog.md` の BUG-004（2026-06-13 ダイチ手動確認）。被告がゲストとして参加した直後、対話チャットのみが表示され「弁護人AI」タブが表示されない。ページをリロードすると弁護人 AI タブが現れる症状。調査の結果、**アカウント参加経路でも同じバグが潜在している**ことが判明したため、両経路を併せて修正する。

### 原因の特定

`app/case/[id]/CaseRoom.tsx` の useEffect が `fetchDefenseMessages` をマウント時 1 回だけ呼び、その後の参加成功イベントに反応していなかった。

#### マウント時の初回呼び出しが 401/403 になる経路

`fetchDefenseMessages` は `/api/cases/[id]/defense` を fetch する。この時点では:

- ゲスト経路: `cases.defendant_guest_name` がまだ NULL、ブラウザに guest cookie もない → `resolveAuth` が 401 を返す
- アカウント経路: `cases.defendant_id` がまだ NULL（参加していない状態）→ `resolveAuth` が「user.id が plaintiff/defendant のどちらでもない」と判定して 403 を返す

CaseRoom 側はこれを受けて `setShowDefenseTab(false)` に倒れる（`app/case/[id]/CaseRoom.tsx:202-212`）。

#### 参加後に再 fetch されない

useEffect の依存配列が `[fetchDefenseMessages]` で、`fetchDefenseMessages` は `useCallback([caseId])` のため caseId が変わらない限り再生成されない。つまり「マウント時に 1 回だけ呼ばれる」設計。参加成功で `setMyRole("defendant")` しても `fetchDefenseMessages` は再呼び出しされず、`showDefenseTab=false` のまま残る。

リロードで CaseRoom が再マウント → guest cookie 有 + `defendant_guest_name` 有（または `defendant_id = user.id`）→ 200 OK → `showDefenseTab=true` で復帰する、という挙動だった。

### 修正方針

`handleJoinAsAccount` と `handleJoinAsGuest` の両方で、参加 PATCH 成功 → `setMyRole("defendant")` + `setCaseData(data)` の直後に `await fetchDefenseMessages()` を明示呼び出しする。これにより:

- 認証クッキーないし guest cookie が確実に有効な状態で defense API が呼ばれ、200 OK → `showDefenseTab=true` が成立する
- useEffect 内の呼び出しは「マウント時の初回 fetch」専用となり、副作用パターンが純化される。結果として `react-hooks/set-state-in-effect` の disable コメントが不要になり、削除した

### スコープ外（別タスクで扱う）

- defense API の `resolveAuth` の経路自体の見直し（例: 参加前の閲覧者に空配列を返す設計に変えるなど）。現状の 401/403 は authorization の要件として正しい挙動であり、本タスクは「クライアント側で参加後に再 fetch する」ことで解決する。
- `useEffect` の依存配列を `[fetchDefenseMessages, myRole]` のようにして自動再走させる案。これは「state 更新を依存配列で受ける」設計に倒れ、コードの意図が「マウント時の初回 fetch + イベント駆動の再 fetch」と分かれている方が明示的なため採用しない。

### テスト観点

`tests/e2e/` の既存 spec（CRITICAL-M04: ゲスト被告フロー）を流用しつつ、以下の観点で追加検証する。

1. **ゲスト参加直後の弁護人 AI タブ表示**: 別ユーザーでケース作成 → ゲスト経路で参加 → `setMyRole("defendant")` 直後にリロードせずに「弁護人 AI」タブが表示されること。
2. **アカウント参加直後の弁護人 AI タブ表示**: 同じシナリオでアカウント経由参加 → リロードせずに「弁護人 AI」タブが表示されること。
3. **リグレッション**: 既存 CRITICAL-M04（ゲスト被告フロー全体）が引き続き通過すること。

### 監査観点（オーディに渡す論点）

- `handleJoinAsAccount` / `handleJoinAsGuest` 内で `await fetchDefenseMessages()` を呼ぶことによる race condition の有無（`setCaseData(data)` の React reconciliation と `fetchDefenseMessages` 内の `setShowDefenseTab` の順序）
- `react-hooks/set-state-in-effect` disable コメント削除の妥当性（plugin が今後挙動を厳格化したときに再発しないか）
- `fetchDefenseMessages` が参加直前にも呼ばれている事実は変わらないため、参加前の 401/403 が CSP / network panel 等に出る点。これは「正しい authorization の挙動」だが、ノイズログを減らす意味で「myRole が null のときは fetchDefenseMessages を呼ばない」というガードを入れる選択肢もある。本 PR では既存挙動を維持する判断としたが、オーディが推奨するなら次 PR で対応する。

---

## FEAT-MIDDLEWARE-NEXT 対応: 保護パスのリダイレクトに `?next=` を付与する

### 由来

BUG-007（PR #44）対応時に「`middleware.ts` の `/auth/login` リダイレクトに `next` パラメータを付与する改修」をスコープ外として残していた残宿題。`app/auth/login/page.tsx` 側は `useSearchParams().get("next") || "/"` で `?next=` を解釈する実装が既に入っており、middleware 側で `next` を付与した瞬間に「保護パス → ログイン → 元のページに戻る」フローが完成する前方互換構成だった。本タスクはこの宿題の回収。

### 修正方針

`middleware.ts:37-39` の以下の経路を変更する。

変更前:

```ts
if (!user && isProtected) {
  return NextResponse.redirect(new URL("/auth/login", request.url));
}
```

変更後:

```ts
if (!user && isProtected) {
  const loginUrl = new URL("/auth/login", request.url);
  loginUrl.searchParams.set("next", pathname + request.nextUrl.search);
  return NextResponse.redirect(loginUrl);
}
```

`pathname + request.nextUrl.search` で「保護パスの絶対パス + クエリ」を `next` に格納する。例:

- `/history` にアクセス → `/auth/login?next=%2Fhistory` → ログイン後 `/history` へ
- `/history?filter=verdict` にアクセス → `/auth/login?next=%2Fhistory%3Ffilter%3Dverdict` → ログイン後 `/history?filter=verdict` へ

### スコープ外（別タスクで扱う）

- ハッシュフラグメント（`#anchor`）の保持: middleware はサーバサイドのためフラグメントを受け取れない。クライアント側で保持する仕組みが必要だが本タスク範囲外。
- 「ログアウト後のリダイレクト先処理」: 別途検証。
- ログイン後の遷移先を `/me` などにユーザーごとカスタマイズする機能: 本タスク範囲外。

### セキュリティ観点

`pathname + search` は `request.nextUrl` 由来でサーバ側が認識した相対パスのみで構成される。外部 URL の混入余地はない（middleware は同一オリジン内のリクエストにしか作用しない、matcher も内部パスに限定）。さらに `app/auth/login/page.tsx` の open redirect ガード（`new URL(rawNext, window.location.origin)` で origin 一致確認）が二重防御として機能する。

### テスト観点

`tests/e2e/` に以下の観点で spec を追加する想定。

1. **基本動作**: 未認証で `/history` にアクセス → URL が `/auth/login?next=%2Fhistory` に変わること（リダイレクト先の URL 確認）。
2. **クエリ保持**: 未認証で `/history?filter=verdict` 等にアクセス → URL が `/auth/login?next=` に元クエリも含めてエンコードされていること。
3. **ログイン後の復帰**: 上記の状態でログイン → 元の保護パスに正しく戻ること（BUG-007 修正と連携）。
4. **既存ログイン動作のリグレッション**: `/auth/login` を直接開いてログイン（`next` なし）→ `/` に遷移すること。

### 監査観点（オーディに渡す論点）

- `pathname + request.nextUrl.search` の値が常に内部パス由来であるかの再確認（middleware の matcher 設定 + Next.js の仕様で保証されているが、念のため）
- ループの可能性: `/auth/login` 自体は matcher で除外されているため middleware 経由でリダイレクトされない（無限ループにならない）
- `searchParams.set("next", value)` の URLEncode が正しく機能していること（手動エンコードでなく URL API に任せる）

---

## BUG-005 閉廷アナウンス条件の修正

### 概要（変更の目的・背景）

AI が生成する「閉廷宣告」`judge_message`（`judge_messages.trigger_type = 'closing'`）が、現状では「全ラウンド消化 → `phase=extension_voting` 遷移時」に発火している。`lib/judge.ts` の closing プロンプトは「閉廷と審議入りを告げる」内容で書かれており、本来は **`phase=judging` への遷移直前** に発火すべきもの。

現状の不整合:

- ユーザーがまだ延長 / 終了を決めていない `extension_voting` 段階で「閉廷宣言」が出る
- 延長が選ばれて新たな 3 ラウンドが始まる場合でも、既に「閉廷宣言」が DB に残る
- AI 出力文脈（閉廷 = 審議入りの直前）と実 DB 状態が乖離する

本変更は、AI 閉廷宣告の発火位置を `extension_voting` 遷移時から、**ユーザーが終了を確定した瞬間 = `phase=judging` 遷移直後** に移動する。`extension_voting` 期間中は AI 閉廷宣告を一切発火させない。

固定挨拶（closing greeting、`arguments` テーブルへの「ありがとうございました。」2 行 INSERT）の挿入位置は変更しない（FEAT-006 で確定した位置をそのまま維持）。AI 閉廷宣告 (`judge_messages`) のみが本タスクの対象である。

### API 仕様（変更・追加するエンドポイントのリクエスト/レスポンス定義）

外部 I/F（リクエスト URL・メソッド・リクエストボディ・レスポンス JSON）の変更はない。以下 3 つのエンドポイントの **内部副作用** のみが変わる。

#### `POST /api/cases/[id]/argument`

- **副作用変更**: 全ラウンド完了で `phase=argument → extension_voting` に遷移する際、これまで生成・挿入していた `trigger_type='closing'` の `judge_messages` レコードを **生成しない**。
- **保持される副作用**: ターン交代時の `trigger_type='turn'` 生成は従来通り。`extension_voting` 遷移後も `judge_messages` への INSERT を行わない（turn を含めて何も挿入しない）。
- **レスポンス**: 変更なし（`buildCaseResponse` の戻り値構造は維持）。

#### `POST /api/cases/[id]/end-proposal`

- **副作用追加**: `phase=judging` 遷移成功直後、既存の `insertClosingGreetingsForCase`（closing greeting 2 行 INSERT into `arguments`）が成功したあとに、続けて AI 閉廷宣告を生成して `judge_messages` テーブルへ 1 行 INSERT する。
- **エラーハンドリング**: AI 閉廷宣告生成または INSERT が失敗してもレスポンスは 200 のままとする。失敗は `console.error` でログのみ。`phase=judging` 遷移と closing greeting INSERT は保持されたまま判決生成フローに進める。
- **レスポンス**: 変更なし。

#### `POST /api/cases/[id]/extension-vote`

- **副作用追加**: 両者 finish 確定時の `phase=judging` 遷移成功・closing greeting INSERT 成功直後に、AI 閉廷宣告を生成して `judge_messages` テーブルへ 1 行 INSERT する。`continue` 経路（延長確定）では何も追加しない。
- **エラーハンドリング**: `end-proposal` と同一（生成・INSERT 失敗時もレスポンス 200、ログのみ）。
- **レスポンス**: 変更なし。

### データモデル（DB スキーマ・型定義の変更）

DB スキーマ変更なし。新規 migration なし。

| テーブル | 既存カラム | 本タスクでの扱い |
|---|---|---|
| `judge_messages` | `id`, `case_id`, `content`, `trigger_type` (`'opening' / 'turn' / 'closing'`), `created_at` | **発火位置のみ変更**。スキーマ・既存レコード・型は不変 |
| `arguments` | `is_greeting`, `phase`, `round` 等 | 触れない（closing greeting は既存 `insertClosingGreetingsForCase` のままで担う） |
| `profiles` | `opening_greeting`, `closing_greeting` | 触れない |
| `cases` | `phase`, `end_proposed_by`, `extension_vote_*` | 触れない |

`lib/types.ts` の `JudgeTrigger = "opening" | "turn" | "closing"` も変更しない。

過去の `judge_messages.trigger_type='closing'` レコード（旧経路で挿入されたもの）はそのまま残す。マイグレーションでの遡及修正は行わない（要件は「新規生成のみ振る舞いが変わる」。観察可能なバグは演出の整合性問題であり、過去ケースを書き換える価値はない）。

### コンポーネント設計（新設・変更するファイルの責務と仕様）

#### 新設: `lib/case-closing.ts`

AI 閉廷宣告の生成と `judge_messages` への INSERT を担う共通ヘルパー。`end-proposal` と `extension-vote` の 2 経路で同一処理が必要になるため切り出すが、closing greeting と 1 関数に集約することはしない（テーブル境界保護のため）。

**公開関数**: `insertClosingJudgeMessage(admin, plaintiffApiKey, params): Promise<void>`

- 引数:
  - `admin`: `ReturnType<typeof createAdminClient>`
  - `plaintiffApiKey`: `string | null`（呼び出し側で `decryptApiKey` 済みの平文。`null` の場合は AI 生成をスキップし `console.warn` のみ）
  - `params`: `{ caseId: string; topic: string }`
- 責務:
  1. `plaintiffApiKey` が `null` または空文字なら `console.warn` で「[judge] closing: plaintiff has no api_key_encrypted」相当のログを出して return
  2. `generateJudgeMessage({ trigger: "closing", topic, plaintiffName: "", defendantName: "", lastSpeakerRole: "plaintiff" }, plaintiffApiKey)` を try/catch で呼ぶ（`plaintiffName` / `defendantName` / `lastSpeakerRole` は closing プロンプトで未使用のためダミー値を埋めて `generateJudgeMessage` のシグネチャ互換を保つ）。例外は `console.error` でログのみとし、上位に伝播させない
  3. 生成された文字列が空でなければ `admin.from("judge_messages").insert({ case_id: caseId, content, trigger_type: "closing" })` を try/catch で呼ぶ。INSERT エラーも `console.error` でログのみ
- 戻り値: `void`（呼び出し側は phase 遷移を続行する設計のため、エラー情報を返さない）
- **責務外**: `arguments` テーブルへの SELECT / INSERT、closing greeting 文字列の生成、`phase` カラムの更新、`current_turn` の操作、`lastSpeakerRole` 等のコンテキスト解決

**ファイル境界の制約（重要）**:

- このファイルは `arguments` テーブルを SELECT / INSERT / UPDATE してはならない（テーブル境界の侵食防止）
- 固定挨拶文字列（`DEFAULT_CLOSING_GREETING` 等）を import / 参照してはならない
- `cases` テーブルへの UPDATE を行わない（呼び出し側で `phase=judging` 遷移を完了した状態で呼ばれる前提）

`lib/judge.ts` の closing プロンプト本体は変更しない。

#### 変更: `app/api/cases/[id]/argument/route.ts`

- L132 の warn メッセージから `nextPhase === "extension_voting" ? "closing" : "turn"` の三項演算子を削除し、`turn` を直書きする（warn の意味論は「turn 生成のための API キーが無い」のみ）。
- L146 の `triggerType` 算出（`nextPhase === "extension_voting" ? "closing" : "turn"`）を削除し、`triggerType = "turn"` 固定にする。
- 結果として `argument/route.ts` は `judge_messages` へ `trigger_type='closing'` を一切 INSERT しなくなる。
- 矛盾チェック処理（L162 以降）には触れない。

#### 変更: `app/api/cases/[id]/end-proposal/route.ts`

- `insertClosingGreetingsForCase` 呼び出し成功（`greetingError == null`）の直後に、以下の処理を追加:
  1. `profiles` から `plaintiff_id` を使って `api_key_encrypted` を SELECT
  2. `decryptApiKey` で平文化
  3. `lib/case-closing.ts` の `insertClosingJudgeMessage` を `{ caseId, topic }` のみで呼ぶ
- 既存の rollback ロジック（`greetingError` 発生時に `phase=argument` に戻す）には触れない。
- `insertClosingJudgeMessage` 内で起きるエラーは関数内で吸収されるため、呼び出し側で try/catch を再度書く必要はない。
- **`lastSpeakerRole` の解決は不要**（後述「`lastSpeakerRole` の解決方針」参照）。

#### 変更: `app/api/cases/[id]/extension-vote/route.ts`

- `judgingUpdated && judgingUpdated.length > 0` 分岐内、`insertClosingGreetingsForCase` 呼び出し成功（`greetingError == null`）の直後に、`end-proposal` と同一の処理（`profiles.api_key_encrypted` SELECT → `decryptApiKey` → `insertClosingJudgeMessage({ caseId, topic })`）を追加。
- `eitherContinue` 経路（延長確定）には何も追加しない。

#### `lastSpeakerRole` / `plaintiffName` / `defendantName` の解決方針（撤去）

当初設計では `end-proposal` / `extension-vote` 呼び出し側で `arguments` テーブルから `lastSpeakerRole` を導出し、`profiles.display_name` で `plaintiffName` / `defendantName` を解決して `insertClosingJudgeMessage` に渡す方針を採用していた。しかし実装着手時に `lib/judge.ts:49-56` の closing プロンプトを再確認したところ、`topic` のみ参照し `lastSpeakerRole` / `plaintiffName` / `defendantName` を一切使用していないことが判明（オーディ 2 巡目 `audit_20260615_192508.md` LOW-001 指摘、コミット `b7419e7` で消化）。

このため最終設計では以下のように簡略化している:

- `insertClosingJudgeMessage` の引数は `{ caseId, topic }` のみ
- ヘルパー内で `generateJudgeMessage` のシグネチャ互換のため `plaintiffName: ""` / `defendantName: ""` / `lastSpeakerRole: "plaintiff"` のダミー値を埋めて呼ぶ
- 呼び出し側（`end-proposal` / `extension-vote`）は `profiles.api_key_encrypted` の SELECT と `decryptApiKey` のみを行う。`arguments` テーブルへの追加 SELECT・`defendantName` の組み立てロジックは持ち込まない

`lib/judge.ts` の closing プロンプトを将来 `lastSpeakerRole` 依存に拡張する場合は、本ヘルパーの引数復活と呼び出し側 SELECT の追加を同時に行う必要がある（ダミー値で動作してしまうため、コンパイラには検知されない暗黙のリスク）。

### セキュリティ設計（認証・認可・入力検証の方針）

- **認証・認可**: 呼び出し元の `end-proposal` / `extension-vote` で既に確立されている `determineActor` ベースの認可（`auth.getUser()` または `verifyGuestToken`）に乗る。`insertClosingJudgeMessage` ヘルパー自身は認可判定を行わない（既に認可済みコードパスからのみ呼ばれる設計）。
- **API キー取り扱い**: 平文 API キーは `insertClosingJudgeMessage` の引数として一度だけ渡し、関数内で保持しない（`Anthropic` クライアント生成後はクライアント側のメモリに乗るが、これは既存 `lib/judge.ts:generateJudgeMessage` と同一パターン）。ブラウザ送出禁止は既存のサーバ側 API ルート境界で担保される。
- **入力検証**: AI 出力（`generateJudgeMessage` の戻り値）の検証は既存パターンを踏襲 — 空文字列なら INSERT を抑止する（`judge_messages` 空文字 INSERT ガードは PR #14 (D-5) で全 3 箇所に既導入のため、新規 INSERT 経路でも同じガードを適用する）。
- **エラー時情報漏洩**: `console.error` ログにはユーザー入力・API キー・PII を載せない（プレフィックス `[judge] closing:` と汎用エラーメッセージのみ。`lib/judge.ts` のエラーオブジェクトをそのまま `console.error` の 2 引数目に渡すのは既存と同様）。
- **副作用の一方向性**: AI 閉廷宣告 INSERT は `phase=judging` 遷移後に行う設計のため、ヘルパー側の失敗で `cases` 状態が中途半端になることはない（判決画面に進めるのに必要な状態遷移は既に完了済み）。

### 制約・前提条件

- `lib/judge.ts:49-54` の closing プロンプト本体・トークン数・モデル指定（`claude-haiku-4-5-20251001`）は変更しない。
- `lib/greetings.ts:insertClosingGreetingsForCase` のシグネチャ・挙動を変更しない。closing greeting と AI 閉廷宣告の挿入順序（greeting → AI、2026-06-15 ダイチ確認）はこの「ヘルパーを 2 つに分割したまま、呼び出し順を呼び出し側で固定する」設計で守る。
- 過去の `judge_messages.trigger_type='closing'` レコード（旧経路で挿入されたもの）は移行・削除しない。
- `extension_voting` フェーズ中の UI（バナー・モーダル・サイドアイコン）は変更しない。CaseRoom 側のコンポーネントも触らない。
- 「閉廷しました」というシステム表示ラベル（CaseRoom 内）が存在するかは未確認。存在した場合は本タスク完了後に backlog 上の派生タスクとして記録し、別 PR で扱う（task.md スコープ外明示）。
- `judge_messages` SELECT が読み取り公開のため、`phase=judging` 遷移後の AI 閉廷宣告挿入が遅延すると、verdict 画面で一時的に「閉廷宣告がない状態」が見える可能性がある。AI 生成は通常数秒で完了するため UX 影響は許容範囲だが、テスタは「closing greeting → AI 閉廷宣告 → verdict 表示」のタイミング順序を polling 経由で観察する spec を 1 本以上含めること。
- 並行リクエストでの重複 INSERT 抑止: `end-proposal` / `extension-vote` 双方とも `phase=judging` 遷移を楽観ロック（`WHERE phase=argument` または `WHERE phase=extension_voting AND 両者票一致`）で 1 リクエストに絞っているため、その後に呼ぶ `insertClosingJudgeMessage` も自動的に 1 度しか呼ばれない。ヘルパー内で重複防止ロックを追加する必要はない。
- 注意事項（解消未確定の論点）:
  - **`lastSpeakerRole` を SELECT する追加 DB アクセスのコスト**: 既存 `end-proposal` / `extension-vote` には arguments テーブルへの SELECT がなく、本タスクで 1 ラウンドトリップ追加される。`judging` 遷移経路は頻度が低いため許容と判断するが、もし polling 中の負荷観測で問題が出たら、`end-proposal` 内で `cases.current_turn` の反転値を fallback として使う最適化を後追いで検討する（ただし current_turn は「次に話す人」を示すため、反転すれば「直前に話した人」になるという前提が成立するかは要検証。今回は精度を優先して arguments 由来とする）。
  - **`api_key_encrypted` が NULL のケース**: 原告がプロフィール画面で API キーを未登録のまま `phase=judging` に到達するシナリオでは、AI 閉廷宣告生成がスキップされる（`console.warn` ログのみ）。closing greeting は INSERT されるため会話としては最低限成立する。verdict 生成自体も同じ API キーを使うため、未登録状態では verdict 画面側で別途エラー処理が走る既存挙動に乗る（本タスクで verdict 側の挙動は変えない）。

---

## FEAT-004 法案 Hub（公開・インポート）

由来: `docs/backlog.md` の `[FEAT-004] 法案 Hub（公開・インポート機能）`。依存: FEAT-003（法律作成機能）/ FEAT-002（フレンド機能）。スコープ確定: task.md「スコープ確定事項（2026-06-18 ダイチ確認）」。

### 概要（変更の目的・背景）

FEAT-003 で「オーナー + 招待メンバーのみ閲覧可」の法律機能を実装済みである。`laws` には公開フラグが無く、フレンド関係外のユーザーが他人の良い法律を再利用する手段がない。FEAT-004 は「オーナーが任意で法律を公開 → 他の認証ユーザーが Hub（`/laws/hub`）で閲覧・検索 → 自分がオーナーの新規法律として純クローンでインポート」という流れを追加する、新サブシステムの最小実装である。

設計の最重要原則は **「公開で広げる範囲を `laws` 本体（`name` / `article`）だけに限定する」** ことである。公開法律であってもメンバー構成・招待・提案・投票は非メンバーに一切見せない。これは既存の RLS 境界（`law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` は「メンバーのみ SELECT」）を**変更しない**ことで自動的に担保する。本タスクで触れるのは `laws` の公開可視範囲を 1 段広げる SELECT ポリシーの追加のみである。

確定済みの 3 方針（task.md より、設計はこの前提で固定）:

1. **公開モデル = `is_public` トグル**: `laws` に `is_public boolean` を 1 つ追加し、オーナーが ON/OFF で Hub 公開を切り替える最小モデル。`visibility` enum 化・限定公開は行わない。
2. **インポート = 純クローン**: 公開法律の `name` + `article` をコピーしてインポーターがオーナーの**新規法律**を作る。出自リンク（`imported_from` 等）は**持たない**。
3. **Hub の可視範囲 = 認証ユーザーのみ**: 既存 `laws` が `authenticated` 限定 GRANT なのと一貫させる。`anon` 公開・SEO はしない。`/laws/hub` は middleware の `/laws` プレフィックス保護に既に含まれる（後述「制約・前提条件」で確認）。

### API 仕様（変更・追加するエンドポイント）

#### 共通方針（既存パターン踏襲）

全 3 エンドポイントとも FEAT-003 / environment.md の規約に従う:

- 認証確認は `createSessionClient()` + `auth.getUser()`。`null` なら 401。
- 動的セグメント `[id]` は処理先頭・DB アクセス前に `isUuid()`（`lib/text-utils.ts`、PR #27 で共通化済み）で検証し、不正なら 400。不正値そのものをレスポンス/ログにエコーしない（LOW バッチ対応の方針踏襲）。
- 書き込み（visibility 更新・import の INSERT）は `createAdminClient()` 経由で行い、認可はアプリ層で明示的に判定する（RLS に委ねない）。
- エラーレスポンス形状は既存ルートと同形 `Response.json({ error: <string> }, { status })`。
- 読み取り（Hub 一覧の `laws` SELECT）は MEDIUM-001 の二層防御方針に整合させ、`laws` 本体は `createSessionClient()`（新 RLS `laws_select_public` で二重防御）で読む。他ユーザーの `profiles.display_name` だけは `createAdminClient()` で narrow に取得する（理由は後述）。

---

#### 1. `PATCH /api/laws/[id]/visibility`（公開トグル・オーナーのみ）

法律の Hub 公開状態を切り替える。

**リクエスト**
```json
{ "is_public": true }
```

**レスポンス**
```json
{ "id": "uuid", "is_public": true }
```

**処理順序**
1. `auth.getUser()` → null なら 401
2. `isUuid(id)` → 不正なら 400
3. body の `is_public` が `boolean` 型か検証（`typeof !== "boolean"` なら 400）
4. `createAdminClient()` で対象 `laws` の `owner_id` を SELECT → 行なしなら 404
5. `owner_id !== user.id` なら 403
6. `createAdminClient()` で `laws.is_public` を更新。**`updated_at` は触らない**
7. 更新後の `{ id, is_public }` を返す

**`updated_at` を更新しない設計判断**: FEAT-003 では `updated_at` は「条文（`article`）の改定が合意成立した時刻」を表す意味論で運用している（改定合意時に `laws.updated_at = now()`）。公開状態の切り替えは条文改定ではなく可視性メタデータの変更であるため、`updated_at` を動かすと「最終改定日時」の意味が壊れ、`/laws` 一覧等の並び順・表示に意図しない影響を与える。したがって visibility 変更では `updated_at` を据え置く。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 400 | `id` が UUID でない / `is_public` が boolean でない |
| 401 | 未認証 |
| 403 | 呼び出し元がオーナーでない |
| 404 | 法律が存在しない |

---

#### 2. `GET /api/laws/public`（Hub 一覧・認証ユーザー）

公開法律を新しい順に返す。Hub ページの初期表示およびクライアント側の検索に用いる。

**クエリパラメータ**
- `q`（任意）: `name` の部分一致検索語。サーバ側で `trim` + 長さ上限（後述）+ LIKE 特殊文字エスケープを行う。

**レスポンス**
```json
[
  {
    "id": "uuid",
    "name": "法律名",
    "article": "条文テキスト",
    "owner_display_name": "表示名",
    "created_at": "ISO8601"
  }
]
```

**`owner_id` を返さないこと**（task.md 明示）。オーナーの個人識別子・メール等は一切含めない。表示名（`owner_display_name`）のみ返す。

**処理**
1. `auth.getUser()` → null なら 401
2. `q` を正規化（`trim`、空なら無条件、長さ上限超過は上限で切る、LIKE 特殊文字 `% _ \` をエスケープ）
3. 共有ヘルパー `fetchPublicLaws({ sessionClient, adminClient, q })`（後述）を呼び出して整形済み配列を取得
4. 配列を返す

**件数上限 = 50（MVP）の根拠**: 本アプリの想定ユーザー規模（恋人・夫婦・家族の少人数・低頻度利用、ADR-002）では公開法律の総数が当面小さい。ページネーション UI を持ち込むと Hub の最小スコープを超える。`created_at DESC` で新着 50 件に固定し、「探したいものは検索（`q`）で絞る」運用とする。将来 50 件で溢れる規模になった時点でカーソルページネーションを追加する（スコープ外・後述）。上限到達時にサイレントに打ち切られることを UI 側で示すかは実装段階で判断（最小実装では「新着 50 件」である旨の注記で足りる）。

**`owner_display_name` の取得方法と admin 利用範囲（重要）**:

- `laws` 本体（`is_public = true` の行）は `createSessionClient()` で SELECT する。新 RLS `laws_select_public` により認証ユーザーは公開法律行を読める（= RLS が認可境界そのものを表現し、二層防御になる）。
- ただしオーナーは**他人**であり、`profiles` の他人行 SELECT 権限は FEAT-002 以降「本人行のみ」に絞られている（MEDIUM-001 でも `profiles` の他者列開放は意図的にスコープ外とした）。そのため `owner_display_name` はセッションクライアントでは取得できない。
- 解決策: `laws` を読んで得た `owner_id` の集合に対し、`createAdminClient()` で `profiles` を `select("id, display_name").in("id", ownerIds)` の **1 クエリ（バッチ）** で引き、`owner_id → display_name` のマップを作って各行に解決する。**`owner_id` はレスポンス整形時に捨てる**（応答境界で落とす）。
- admin の利用範囲は「`profiles.display_name` の読み取りのみ」に限定する。`api_key_encrypted` 等の機微列は SELECT しない。これは FEAT-003 `GET /api/laws` がオーナー名を解決するのに admin で `profiles` を引いていたのと同一の限定パターンである。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 401 | 未認証 |

---

#### 3. `POST /api/laws/[id]/import`（純クローン）

公開法律をインポートし、呼び出しユーザーがオーナーの新規法律を作成する。

**パスパラメータ**: `[id]` = インポート**元**の公開法律 ID。

**リクエスト**: ボディなし。

**レスポンス**
```json
{ "id": "uuid" }
```
（新規作成された法律の ID。UI はこれで `/laws/[id]` に遷移する）

**処理順序**
1. `auth.getUser()` → null なら 401
2. `isUuid(id)` → 不正なら 400
3. `createAdminClient()` でインポート元 `laws` を `select("id, name, article, is_public")` で取得 → 行なしなら 404
4. `is_public !== true` なら 403（非公開法律はインポート不可）
5. `createAdminClient()` で新規 `laws` を INSERT:
   - `name` = インポート元と同一
   - `article` = インポート元のコピー
   - `owner_id` = インポーター（`user.id`）
   - `is_public` = `false`（クローンは既定で非公開。公開したければインポーター自身が visibility トグルで明示的に公開する）
6. `createAdminClient()` で `law_members` にインポーター本人を INSERT（`law_id` = 新規法律, `user_id` = `user.id`）。FEAT-003 `POST /api/laws` の「作成者 = オーナー兼メンバー」初期化と同一手順
7. 新規法律の `{ id }` を返す

**設計上の注意（純クローンの徹底）**:
- インポート元の `law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` は**一切コピーしない**。複製するのは `name` と `article` のみ。
- 出自リンク（`imported_from` 等のカラム）は持たない（確定方針 2）。元法律と新法律の間にデータ上の参照関係を作らない。
- **元法律は完全に不変**: import 経路はインポート元 `laws` 行を `is_public` の読み取りにしか使わず、UPDATE/DELETE しない。所有者・条文・行数が変わらないことを E2E で検証する。
- name/article の文字数制約（`name` ≤ 100 / `article` ≤ 2000）はインポート元が作成時に既に満たしているため新たな検証は不要だが、DB の CHECK 制約（FEAT-003 で定義済み）は INSERT 時に引き続き効く。
- 重複インポート検知はしない（同じ法律を何度でもインポート可、確定スコープ）。

**`laws` + `law_members` の 2 INSERT の整合性**: FEAT-003 `POST /api/laws` と同一の初期化手順を踏襲する。2 文に分けて INSERT する場合、`law_members` INSERT が失敗するとメンバー無しの孤児 `laws` 行が残るリスクがあるが、これは FEAT-003 法律作成と同一の既存パターンであり、本タスクで新たに整合性機構（RPC/トランザクション）を導入することはしない（FEAT-003 の実装手順をそのまま再利用する）。FEAT-003 の `POST /api/laws` がエラーハンドリング・順序をどう実装しているかをビルドが確認し、import でも同一手順を再現すること（引き継ぎメモ参照）。

**エラー**
| ステータス | 条件 |
|-----------|------|
| 400 | `id` が UUID でない |
| 401 | 未認証 |
| 403 | インポート元が非公開（`is_public = false`） |
| 404 | インポート元が存在しない |

### データモデル（DB スキーマ・型定義の変更）

#### `laws` への列追加

```sql
ALTER TABLE public.laws
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;
```

- `NOT NULL DEFAULT false`: 既存の全法律は非公開がデフォルト。公開は明示的なオプトインのみ。
- `ADD COLUMN IF NOT EXISTS` で冪等化（OPS-002 方針。`schema.sql` と二重適用しても 42701/duplicate column で停止しない）。

#### RLS ポリシー追加（既存ポリシーは変更しない）

```sql
DROP POLICY IF EXISTS laws_select_public ON public.laws;
CREATE POLICY laws_select_public ON public.laws FOR SELECT
  TO authenticated
  USING (is_public = true);
```

**設計の核心（複数 PERMISSIVE ポリシーの OR 評価）**: PostgreSQL は同一テーブル・同一コマンド（SELECT）に対する複数の **PERMISSIVE** ポリシーを **OR** で結合する。したがって既存の `laws_select_member_or_invitee`（MEDIUM-001 で導入、オーナー/メンバー/pending invitee に許可）と、新規 `laws_select_public`（`is_public = true` に許可）は OR 評価され、**ある行は「メンバー等である」または「公開である」のいずれかを満たせば SELECT 可**となる。これにより:
- メンバーは自分の非公開法律を従来どおり閲覧できる（`laws_select_member_or_invitee` 経由、挙動不変）。
- 全認証ユーザーは公開法律を閲覧できる（`laws_select_public` 経由、新規）。
- 既存ポリシーを**一切書き換えない**ため、メンバー閲覧 UX のリグレッションが構造的に起きない。

**`TO authenticated` 限定**: ポリシーを `authenticated` ロールに限定し、`anon` には評価させない（確定方針 3・FEAT-002 LOW-001 の最小権限の教訓）。既存 `laws` の GRANT は `authenticated` のみで、本タスクで GRANT は変更しない。

**他テーブルのポリシーは変更しない**: `law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` の SELECT ポリシーは「メンバーのみ」のまま据え置く。これにより、法律が公開されても**メンバー構成・招待・提案・投票は非メンバーから観測不能**であることが RLS 側で自動的に保証される（Hub はこれらのテーブルを引かない）。

#### インデックス（推奨・冪等）

```sql
CREATE INDEX IF NOT EXISTS idx_laws_public_created
  ON public.laws (created_at DESC)
  WHERE is_public = true;
```

Hub 一覧の `WHERE is_public = true ORDER BY created_at DESC LIMIT 50` を支える部分インデックス。MVP 規模では性能上必須ではないが、コストが極小で前方安全性が高いため推奨する。`IF NOT EXISTS` + 明示名で冪等化する。

#### migration ファイル（新規 1 枚・冪等）

ファイル例: `supabase/migrations/<timestamp>_feat004_laws_is_public.sql`

```sql
-- FEAT-004: laws に is_public を追加し、公開法律を全認証ユーザーが
--           SELECT できる RLS ポリシーを足す（Hub 公開・インポートの土台）。
-- 冪等方針: OPS-002 に従い ADD COLUMN IF NOT EXISTS / DROP POLICY IF EXISTS → CREATE。
BEGIN;

ALTER TABLE public.laws
  ADD COLUMN IF NOT EXISTS is_public boolean NOT NULL DEFAULT false;

DROP POLICY IF EXISTS laws_select_public ON public.laws;
CREATE POLICY laws_select_public ON public.laws FOR SELECT
  TO authenticated
  USING (is_public = true);

CREATE INDEX IF NOT EXISTS idx_laws_public_created
  ON public.laws (created_at DESC)
  WHERE is_public = true;

COMMIT;
```

- 既存マイグレーション（`20260526000003_feat003_laws.sql` 等）は applied 済みのため**編集しない**。新規 1 枚を追加する。
- `BEGIN`/`COMMIT` で囲み、列追加・ポリシー作成・インデックス作成を 1 トランザクションにまとめる。

#### `schema.sql` への反映方針（OPS-002 = 冷凍庫）

`supabase/schema.sql` は本番スナップショット（「冷凍庫」）であり、新カラム・新ポリシーの**真実は migration 側**にある。OPS-002 の方針に従い、本タスクでは `schema.sql` を編集しない。`schema.sql → migrations/*.sql` の昇順一括適用（`scripts/setup-test-db.sh`、PR #55）は、冪等化済みの本 migration を再適用してもエラーなく通る（`ADD COLUMN IF NOT EXISTS` / `DROP POLICY IF EXISTS`）。テスト DB への適用はリードが行う（task.md 記載）。

#### 型定義（TypeScript）

`lib/types.ts` の既存 `Law` インターフェースに 1 フィールド追加する:

```typescript
export interface Law {
  id: string;
  name: string;
  article: string;
  owner_id: string;
  is_public: boolean;   // ← 追加（FEAT-004）
  created_at: string;
  updated_at: string;
}
```

Hub 一覧アイテム用の新規型を追加する（`owner_id` を含まない = レスポンス境界の型で個人識別子の漏洩を型レベルでも防ぐ）:

```typescript
export interface PublicLawListItem {
  id: string;
  name: string;
  article: string;
  owner_display_name: string;
  created_at: string;
}
```

### コンポーネント設計（新設・変更するファイルの責務と仕様）

#### 共有データ取得ヘルパー（新設）

`lib/laws-public.ts`（新規）に Hub 一覧取得ロジックを 1 箇所へ集約する。

設計判断（トレードオフ）: Hub ページ（Server Component の初期表示）と `GET /api/laws/public`（クライアント検索用 API）は**同一の取得・整形ロジック**を必要とする。同じ SQL 形・`owner_display_name` 解決・`owner_id` 除去・件数上限を 2 箇所に書くと、片方だけ修正されて漏洩境界がずれる危険がある。したがって両者が呼ぶ純粋な取得ヘルパー `fetchPublicLaws({ sessionClient, adminClient, q })` を切り出す（`lib/case-closing.ts` / `lib/text-utils.ts` 等、ロジックを lib に切り出す既存慣習に整合）。

責務:
1. `sessionClient` で `laws` を `select("id, name, article, owner_id, created_at").eq("is_public", true)` ＋ `q` があれば `.ilike("name", "%"+escaped+"%")` ＋ `.order("created_at", { ascending: false })` ＋ `.limit(50)` で取得（新 RLS `laws_select_public` で二層防御）。
2. 取得行の `owner_id` 集合に対し `adminClient` で `profiles` を `select("id, display_name").in("id", ownerIds)` でバッチ取得し、`owner_id → display_name` マップを作る。
3. 各行を `PublicLawListItem` に整形し（`owner_id` を捨て、`owner_display_name` を解決。display_name 欠落時は空文字や「（名前未設定）」等のフォールバック）、配列を返す。

#### API ルート（新設 3 本）

```
app/api/laws/
  public/
    route.ts            # GET（Hub 一覧。fetchPublicLaws を呼ぶ）
  [id]/
    visibility/
      route.ts          # PATCH（公開トグル・オーナーのみ）
    import/
      route.ts          # POST（純クローン）
```

各ルートの責務は「API 仕様」節に記載のとおり。`isUuid` ガード・認証確認・認可判定・admin 書き込みの順序を厳守する。

#### Hub ページ（新設）

```
app/laws/
  hub/
    page.tsx                       # Server Component: 初期一覧表示
    _components/
      PublicLawCard.tsx            # 公開法律 1 件の表示カード（条文プレビュー含む）
      HubSearch.tsx                # Client: 検索ボックス + 検索結果の差し替え
      ImportButton.tsx             # Client: インポート実行 → 遷移
```

**`app/laws/hub/page.tsx`（Server Component）**
- `createSessionClient()` で `auth.getUser()`（middleware 保護下だが二重で確認）。
- `fetchPublicLaws({ sessionClient, adminClient, q: searchParams.q })` で初期一覧（または初期検索結果）を取得。
- `HubSearch`（検索ボックス）と、各 `PublicLawCard` を縦並びでレンダリング。
- `/laws` への戻り導線・空状態（0 件）メッセージを含む。
- 配色・トーンは既存 `app/laws/` を踏襲（stone ベース、`brand-700/800` をプライマリに）。

**`PublicLawCard.tsx`**（Server / Client いずれでも可。表示専用なので Server 推奨だが、`ImportButton` を内包するため実装上は Client 子を内側に持つ構成）
- 表示要素: `name` / `owner_display_name` / `article` プレビュー / `ImportButton`。
- 条文プレビュー: 長文は折りたたみまたは省略（CSS `line-clamp` もしくは `truncate` ヘルパー）。`article` は**プレーンテキストとして描画**し、HTML 注入を許さない（既存 `ArticleSection` の描画パターンを踏襲）。
- Hub ページと検索結果（`HubSearch` のクライアント側差し替え）の**両方で同じ `PublicLawCard` を使う**ことで、表示ロジックの二重実装を避ける。

**`HubSearch.tsx`（Client Component）**
- `name` 部分一致の検索ボックス。入力をデバウンスして `GET /api/laws/public?q=...` を fetch し、結果（`PublicLawListItem[]`）でクライアント側のリストを差し替える。
- `fetch` の `res.ok` を必ず検査し、失敗時はエラー表示してリストを壊さない（LOW-002 の「fetch ステータス検査」教訓を踏襲。エラー配色は `rose-*`、`brand-*` をエラーに使わない）。
- 設計判断（トレードオフ）: 検索方式は (A) URL クエリ更新で Server Component を再レンダリング、(B) クライアント側 fetch で結果差し替え、の 2 案がある。task.md は `GET /api/laws/public` を IN スコープに明示しており、(B) を採ることでこのエンドポイントが Hub の検索体験で実際に使われ、初期表示（SSR・(A) 相当の `searchParams.q`）と live 検索の両立ができる。**推奨は (B)**（初期 SSR は `searchParams.q`、以降の絞り込みは debounce fetch）。両経路が `fetchPublicLaws` と `PublicLawCard` を共有するため整合は保たれる。

**`ImportButton.tsx`（Client Component）**
- クリックで `POST /api/laws/[id]/import` を実行。`res.ok` を検査。
- 成功時は返却 `{ id }` で `router.push("/laws/" + id)`（新規法律の詳細へ遷移）。
- 失敗時（403/404/401/500）はエラー表示し遷移しない。多重クリック防止に処理中は disabled。

#### 公開トグル UI（`/laws/[id]` への追記）

```
app/laws/[id]/_components/
  VisibilityToggle.tsx             # Client: 現在の公開状態表示 + ON/OFF 切替（新設）
```

- `/laws/[id]/page.tsx`（Server Component）の**オーナー分岐でのみ** `VisibilityToggle` をレンダリングする（非オーナー・非メンバーには出さない）。`laws.is_public` を初期値として props で渡す。
- `VisibilityToggle`: 現在の公開状態（公開中/非公開）を表示し、トグル操作で `PATCH /api/laws/[id]/visibility { is_public }` を実行。`res.ok` 検査の上、成功時は `router.refresh()` または楽観的更新で表示を同期。
- 既存 `ArticleSection` / `MemberList` / `ProposalPanel` と同居する詳細画面に自然に収まる配置（オーナー向け操作群の近く）。配色は既存トーン踏襲。
- 公開トグルは「危険操作」ではないため `rose-*` 等の警告色を用いず stone/brand トーンで統一する（FEAT-RESP-HEADER のログアウト扱いと同じ思想）。

#### `/laws` → `/laws/hub` の導線

`app/laws/page.tsx`（既存 Server Component）に `/laws/hub` への遷移リンクを 1 つ追加する。

設計判断（トレードオフ）: 導線は (A) `/laws` 一覧ページ内のリンク、(B) 共通ヘッダ（`HeaderUserMenu`）への項目追加の 2 案がある。(B) はグローバル到達性が高いが、ヘッダは直近 FEAT-RESP-HEADER で刷新されたばかりで、項目追加はその設計（最小項目セット）に影響する。**推奨は (A)**（`/laws` ページ内リンク）。Hub は「法律」機能の一部であり `/laws` からの遷移が文脈的に自然で、ヘッダ刷新の意図を崩さず変更も最小で済む。将来 Hub の利用頻度が高まればヘッダ導線を別途検討する（スコープ外）。

#### middleware

`/laws/hub` は既存の `/laws` プレフィックス保護に含まれる（FEAT-005 設計で確認した `PROTECTED_PATH_PREFIXES` のプレフィックスマッチ、PR #15 E-6）。**middleware は変更不要**。ビルドは `middleware.ts` が `/laws` をプレフィックスマッチで保護していること（`/laws/hub` が確かに保護対象に入ること）を grep で確認し、もし完全一致判定だった場合のみ報告すること（引き継ぎメモ参照）。

### セキュリティ設計（認証・認可・入力検証の方針）

#### 認証・認可

| 操作 | 認可条件 |
|------|---------|
| 公開トグル（visibility PATCH） | 認証済み + `laws.owner_id == user.id` |
| Hub 一覧（GET /api/laws/public） | 認証済み（全認証ユーザー） |
| インポート（POST import） | 認証済み + インポート元が `is_public == true` |
| Hub ページ（/laws/hub） | 認証済み（middleware `/laws` 保護下） |

- 公開トグルはオーナーのみ。非オーナーの PATCH は 403。
- インポートは元法律が `is_public = true` の場合のみ。非公開を import しようとしたら 403（存在しなければ 404）。
- Hub 一覧・インポートとも認証必須。`anon` には一切開放しない（`laws_select_public` は `TO authenticated`）。

#### 情報漏洩防止（本タスクの最重要観点）

- **`owner_id` ・メール等の個人識別子を Hub API レスポンスに含めない**。返すのは `owner_display_name` のみ。型 `PublicLawListItem` に `owner_id` を持たせないことで型レベルでも防ぐ。
- **公開法律でもメンバー情報・招待・提案・投票は非メンバーに見せない**。`law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` の SELECT ポリシーは「メンバーのみ」のまま変更せず、Hub はこれらを一切クエリしない。RLS とアプリ両面で非公開を担保する。
- **公開法律の `/laws/[id]` 詳細ページは非メンバーに開放しない**（task.md OUT スコープ）。新 RLS `laws_select_public` により非メンバーでも `laws` 行自体は SELECT 可能になるが、`/laws/[id]/page.tsx` の**メンバーシップ・ゲート（`law_members` 判定で非メンバー・非 pending invitee を redirect）を緩めてはならない**。非メンバーの公開法律閲覧は Hub 内のプレビューで完結させる。これは本タスクのリグレッション・ガードであり、E2E でなく実装制約として厳守する（引き継ぎメモ・オーディ観点参照）。

#### 入力検証

- `is_public`: `boolean` 型チェック（`typeof !== "boolean"` で 400）。
- `q`: `string` 化 + `trim` + 長さ上限（`name` 最大長 100 に整合させ 100 文字程度を上限とする。超過分は切り捨て）+ LIKE 特殊文字（`%` `_` `\`）のエスケープ。ワイルドカード注入・意図しない全件マッチを防ぐ。
- パス `[id]`: `isUuid()` で UUID 形式検証（不正なら 400）。不正値をレスポンス/ログにエコーしない。

#### 描画

- `article`・`name`・`owner_display_name` はすべてプレーンテキストとして描画する（React の既定エスケープに委ね、`dangerouslySetInnerHTML` を使わない）。既存 `ArticleSection` の条文描画パターンを踏襲し、HTML/スクリプト注入を許さない。

#### レートリミット

- FEAT-003 の `POST /api/laws`（法律作成）には Upstash レートリミットが設定されていない（レートリミットは PR #21 で `/api/users/search` にのみ導入）。インポート（`POST /api/laws/[id]/import`）は法律作成と同種の書き込みであり、**MVP では FEAT-003 の法律作成と同じくレートリミットを設けない**（一貫性優先）。ビルドは `POST /api/laws` 実装にレートリミット呼び出しが無いことを確認し、無ければ import でも踏襲する。将来、書き込み系全般にレートリミットを導入する際は法律作成・インポートを一括対象とする（スコープ外）。

### 制約・前提条件

#### 前提条件
- FEAT-003（`laws` / `law_members` / `law_invitations` / `law_proposals` / `law_proposal_votes` テーブル、`/laws` 系ページ・API）が稼働済みであること（PR #22）。
- MEDIUM-001 の `laws_select_member_or_invitee` ポリシーが適用済みであること（PR #26、本タスクはこれに OR で `laws_select_public` を足す）。
- `lib/text-utils.ts` に `isUuid()` が存在すること（PR #27 で共通化済み）。
- middleware が `/laws` をプレフィックスマッチで保護していること（PR #15 E-6、FEAT-005 で `PROTECTED_PATH_PREFIXES` を確認済み）。
- テスト DB（`eckrccrfnblzdbflnssf`）へ本 migration が適用済みであること（冪等。リードが適用、task.md 記載）。

#### 機能上の制約
- 公開は明示的オプトインのみ（`is_public` 既定 `false`）。既存法律は移行後も全件非公開。
- インポートは純クローン（`name` + `article` のみ）。出自リンク・元作者クレジットは持たない。
- インポート元は import 経路で不変（read-only 参照のみ）。
- 重複インポート検知なし（同一法律を何度でもインポート可）。
- Hub の `anon` 公開・SEO なし。

#### スコープ外（本タスクで実装しない）
- `visibility` の enum 化・限定公開（フレンドのみ公開等）。
- インポート出自リンク（`imported_from`）・元作者クレジット表示。
- `anon`（未認証）への Hub 公開・SEO・OGP。
- いいね / 人気度 / タグ / カテゴリ / 並べ替え（新着固定）。
- 公開法律へのコメント・モデレーション・通報。
- 非メンバーによる公開法律の `/laws/[id]` 詳細ページ閲覧（Hub 内プレビューで完結）。
- Hub 一覧のページネーション（50 件固定。溢れたらカーソルページネーションを後日）。
- 書き込み系 API のレートリミット導入（法律作成と一貫して未導入）。

#### 注意事項（曖昧要件・実装段階で確定する論点。ビルドへ判断を丸投げしない方針で明示）
- **検索方式 (A)/(B) の最終選択**: 本設計は (B)（クライアント debounce fetch + SSR 初期表示）を推奨するが、実装容易性の観点で (A)（URL クエリ更新で Server 再レンダリング）に倒しても task.md 要件は満たす。ただし (A) の場合でも `GET /api/laws/public` は IN スコープのため実装すること（最低限ヘルパー `fetchPublicLaws` の API 表層として）。
- **条文プレビューの省略量**: カードの `article` プレビュー文字数（例: 先頭 100〜200 文字 + `…`、または CSS `line-clamp`）は実装段階で既存トーンに合わせて確定する。プレーンテキスト描画は必須。
- **`owner_display_name` 欠落時の表示**: `profiles.display_name` が空/未取得のオーナーがいた場合のフォールバック文言（空文字 or 「（名前未設定）」）は実装段階で `MeHeader` 等の既存フォールバックに揃える。
- **`law_members` INSERT 失敗時の孤児 `laws` 行**: FEAT-003 `POST /api/laws` と同一の既存挙動に従う（本タスクで整合性機構を新規導入しない）。FEAT-003 の実装手順をビルドが確認し再現すること。
- **件数上限到達の UI 表現**: 50 件上限に達した場合の「新着 50 件のみ表示中」の注記有無は実装段階で判断（最小実装では省略可）。

### 実装中に発見・修正した RLS 無限再帰（FEAT-003 由来）

FEAT-004 で公開法律を session client（ユーザー JWT）で読む経路を追加したことで、FEAT-003 / MEDIUM-001 由来の RLS 設計に潜んでいた**無限再帰（`42P17: infinite recursion detected in policy`）**が顕在化した。本タスクの一部として恒久修正する（migration `20260618190000_feat004_fix_laws_rls_recursion.sql`）。

**症状**: 認証ユーザーが `laws` を RLS 下で SELECT すると 42P17 で失敗し、`/laws`・`/laws/[id]` が notFound になる。owner 自身の法律でも planner がポリシーのサブクエリを展開する過程で再帰検出に至る。

**根本原因**: SELECT ポリシーが RLS 下のサブクエリで自テーブル・相互参照テーブルを参照していた。
- `law_members_select` が `EXISTS(SELECT FROM law_members ...)` で**自テーブルを自己参照**。
- `laws_select_member_or_invitee`（`EXISTS(law_invitations)`）と `law_invitations_select`（`EXISTS(laws)`）が **laws ↔ law_invitations の相互参照**。

ポリシーのサブクエリにも RLS は適用されるため、これらは評価時に自分自身のポリシーを無限に再帰展開する。FEAT-003 出荷時から潜在していたが、`laws` を session client で読む経路が薄かったため未発覚だった（FEAT-004 で露見）。

**修正方針（Supabase 定石）**: 判定を **SECURITY DEFINER 関数**（所有者権限で実行し RLS を適用しない）に切り出し、各ポリシーからそれを呼ぶことで RLS 再帰の連鎖を断つ。可視性のセマンティクスは完全に不変。
- `public.is_law_member(p_law_id, p_user_id)`: `law_members` のメンバー判定。
- `public.is_law_owner(p_law_id, p_user_id)`: `laws` のオーナー判定。
- いずれも `SECURITY DEFINER` / `STABLE` / `SET search_path = ''`、参照はスキーマ修飾、`GRANT EXECUTE ... TO authenticated`。
- 張り替え対象ポリシー（セマンティクス不変）: `law_members_select` / `law_invitations_select` / `law_proposals_select` / `law_proposal_votes_select` / `laws_select_member_or_invitee`。
- migration 末尾で `NOTIFY pgrst, 'reload schema'` を発行（後述の PostgREST キャッシュ問題への対応）。

**検証**: A のユーザー JWT で `laws` / `law_members` を REST 直叩きして 42P17 が消えたことを確認。E2E は `tests/e2e/laws.spec.ts`（CRITICAL-L01〜L04: 作成・招待・改定合意・オーナー移譲）が 4/4 通過し、メンバー/招待/提案/移譲のセマンティクスが保たれていることを確認した。

### 運用上の知見: Management API 直 SQL 適用と PostgREST スキーマキャッシュ

migration を Supabase Management API（`/v1/projects/{ref}/database/query`）の直 SQL で適用すると、アプリが使う **PostgREST のスキーマキャッシュが自動更新されない**。このため新カラム（例: `laws.is_public`）を含む `select()` が REST 経由で「column does not exist」扱いになり、`maybeSingle()` が `{data:null}` を返して画面が notFound に倒れる、という形で顕在化する。

**対応**: スキーマを変更する migration の末尾に `NOTIFY pgrst, 'reload schema';` を発行してキャッシュを即時リロードする（本 FEAT-004 の 2 migration はいずれも発行する）。テスト DB へ手動適用した場合も同様にリロードが必要。`scripts/setup-test-db.sh` / `scripts/agents.sh:run_migrations` でも将来このリロードを組み込む余地がある（別タスク）。
