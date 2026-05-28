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
