-- FEAT-003: 法律作成機能

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
  proposed_article text,
  created_at       timestamptz DEFAULT now() NOT NULL,
  CONSTRAINT law_proposals_type CHECK (proposal_type IN ('amendment', 'deletion')),
  CONSTRAINT law_proposals_article_required
    CHECK (proposal_type != 'amendment' OR (proposed_article IS NOT NULL AND char_length(proposed_article) <= 2000)),
  UNIQUE(law_id)
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

-- インデックス
CREATE INDEX ON public.law_members(user_id);
CREATE INDEX ON public.law_invitations(invitee_id);
CREATE INDEX ON public.law_proposal_votes(proposal_id);

-- RLS 有効化
ALTER TABLE public.laws               ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_members        ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_invitations    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.law_proposals      ENABLE ROW LEVEL SECURITY;
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

-- GRANT: authenticated のみ（anon への GRANT は付与しない）
GRANT SELECT ON public.laws               TO authenticated;
GRANT SELECT ON public.law_members        TO authenticated;
GRANT SELECT ON public.law_invitations    TO authenticated;
GRANT SELECT ON public.law_proposals      TO authenticated;
GRANT SELECT ON public.law_proposal_votes TO authenticated;

GRANT ALL ON public.laws               TO service_role;
GRANT ALL ON public.law_members        TO service_role;
GRANT ALL ON public.law_invitations    TO service_role;
GRANT ALL ON public.law_proposals      TO service_role;
GRANT ALL ON public.law_proposal_votes TO service_role;
