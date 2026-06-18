-- FEAT-004 付随修正: laws サブシステムの RLS 無限再帰を解消する。
--
-- 背景: FEAT-003 / MEDIUM-001 で定義された SELECT ポリシーが、自テーブルや
-- 相互参照テーブルを RLS 下のサブクエリで参照していたため、評価時に
-- 「infinite recursion detected in policy (42P17)」を起こし、認証ユーザーによる
-- laws 系の読み取りが全滅していた（FEAT-004 で laws を session client 読みして露見）。
--   - law_members_select は law_members 自身を参照（自己再帰）
--   - laws_select_member_or_invitee ↔ law_invitations_select は laws ↔ law_invitations の相互再帰
--
-- 方針: 判定を SECURITY DEFINER 関数（RLS をバイパス）に切り出し、各ポリシーから
-- それを呼ぶことで再帰の連鎖を断つ（Supabase の定石）。可視性のセマンティクスは不変。
--
-- 冪等方針: CREATE OR REPLACE FUNCTION / DROP POLICY IF EXISTS → CREATE POLICY（OPS-002）。
BEGIN;

-- ── 判定ヘルパー（SECURITY DEFINER = 所有者権限で実行し RLS を適用しない）──
-- 非公開スキーマ private に置く。PostgREST は公開スキーマ（既定 public）の関数のみ
-- RPC として露出するため、private の関数は /rest/v1/rpc 経由で呼べない。これにより
-- 「メンバー/オーナー関係の boolean オラクル」化を防ぐ（Supabase 定石・MEDIUM-001 対応）。
-- RLS ポリシーからの呼び出しには authenticated への USAGE/EXECUTE 付与が必要。
-- search_path='' で検索パス汚染を防ぎ、全参照をスキーマ修飾する。
CREATE SCHEMA IF NOT EXISTS private;
GRANT USAGE ON SCHEMA private TO authenticated;

CREATE OR REPLACE FUNCTION private.is_law_member(p_law_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.law_members
    WHERE law_id = p_law_id AND user_id = p_user_id
  );
$$;

CREATE OR REPLACE FUNCTION private.is_law_owner(p_law_id uuid, p_user_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.laws
    WHERE id = p_law_id AND owner_id = p_user_id
  );
$$;

GRANT EXECUTE ON FUNCTION private.is_law_member(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION private.is_law_owner(uuid, uuid) TO authenticated;

-- ── ポリシー張り替え（セマンティクス不変・再帰を排除）──

-- law_members: 同じ法律のメンバーなら閲覧可（自己参照を SD 関数経由に）
DROP POLICY IF EXISTS law_members_select ON public.law_members;
CREATE POLICY law_members_select ON public.law_members FOR SELECT
  USING (private.is_law_member(law_id, auth.uid()));

-- law_invitations: invitee 本人 OR 法律オーナー（laws 参照を SD 関数経由に）
DROP POLICY IF EXISTS law_invitations_select ON public.law_invitations;
CREATE POLICY law_invitations_select ON public.law_invitations FOR SELECT
  USING (
    invitee_id = auth.uid()
    OR private.is_law_owner(law_id, auth.uid())
  );

-- law_proposals: メンバーのみ（law_members 参照を SD 関数経由に）
DROP POLICY IF EXISTS law_proposals_select ON public.law_proposals;
CREATE POLICY law_proposals_select ON public.law_proposals FOR SELECT
  USING (private.is_law_member(law_id, auth.uid()));

-- law_proposal_votes: 提案の属する法律のメンバーのみ
-- （law_proposals 経由で is_law_member を呼ぶ。law_proposals のサブクエリは
--  修正済み law_proposals_select=is_law_member(SD) を適用するため再帰しない）
DROP POLICY IF EXISTS law_proposal_votes_select ON public.law_proposal_votes;
CREATE POLICY law_proposal_votes_select ON public.law_proposal_votes FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.law_proposals lp
      WHERE lp.id = law_proposal_votes.proposal_id
        AND private.is_law_member(lp.law_id, auth.uid())
    )
  );

-- laws: オーナー OR メンバー OR pending invitee（MEDIUM-001 のセマンティクスを保持）。
-- member 判定は SD 関数。invitee 判定の EXISTS(law_invitations) は修正済み
-- law_invitations_select（invitee_id OR is_law_owner(SD)）を適用するため laws へ再帰しない。
DROP POLICY IF EXISTS laws_select_member_or_invitee ON public.laws;
CREATE POLICY laws_select_member_or_invitee ON public.laws FOR SELECT
  USING (
    owner_id = auth.uid()
    OR private.is_law_member(id, auth.uid())
    OR EXISTS (
      SELECT 1 FROM public.law_invitations i
      WHERE i.law_id = laws.id
        AND i.invitee_id = auth.uid()
        AND i.status = 'pending'
    )
  );

-- 旧版（public スキーマに作ってしまった判定関数）が存在すれば撤去する。
-- ポリシーは上で private.* へ張り替え済みのため依存は残っていない。
-- 新規 DB では未作成のため no-op（冪等）。
DROP FUNCTION IF EXISTS public.is_law_member(uuid, uuid);
DROP FUNCTION IF EXISTS public.is_law_owner(uuid, uuid);

COMMIT;

-- PostgREST のスキーマキャッシュを再読込（Management API 直 SQL 適用では
-- 自動反映されないため、新オブジェクトが REST 経由で即時可視になるよう明示）。
NOTIFY pgrst, 'reload schema';
