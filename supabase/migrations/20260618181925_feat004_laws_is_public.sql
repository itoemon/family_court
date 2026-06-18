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

-- PostgREST のスキーマキャッシュを再読込（Management API 直 SQL 適用では
-- 自動反映されず、新列 is_public を含む select が REST 経由で
-- "column does not exist" 扱いになるため明示的にリロードする）。
NOTIFY pgrst, 'reload schema';
