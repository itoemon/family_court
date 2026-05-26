-- FEAT-002 Phase 2: フレンド機能

CREATE TABLE friend_requests (
  id          uuid        DEFAULT gen_random_uuid() PRIMARY KEY,
  sender_id   uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  receiver_id uuid        NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  status      text        NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending', 'accepted', 'rejected')),
  created_at  timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT no_self_request CHECK (sender_id <> receiver_id)
);

-- 同一ペアの重複を方向問わず防止（A→B と B→A を同一キーとして扱う）
CREATE UNIQUE INDEX friend_requests_pair_idx
  ON friend_requests (LEAST(sender_id, receiver_id), GREATEST(sender_id, receiver_id));

CREATE INDEX friend_requests_sender_idx   ON friend_requests (sender_id);
CREATE INDEX friend_requests_receiver_idx ON friend_requests (receiver_id);

ALTER TABLE friend_requests ENABLE ROW LEVEL SECURITY;

-- 直接クライアントアクセス対策: 自分が関与するレコードのみ参照可
CREATE POLICY "friend_requests_select_own"
  ON friend_requests FOR SELECT
  USING (sender_id = auth.uid() OR receiver_id = auth.uid());

-- INSERT / UPDATE / DELETE はサービスロール（API Routes）のみ
-- anon への GRANT は不要（全アクセスは API Route 経由で service_role が行う）
GRANT SELECT ON public.friend_requests TO authenticated;
GRANT ALL    ON public.friend_requests TO service_role;

-- ユーザー検索関数: auth.users を参照するため SECURITY DEFINER で定義
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
      p.display_name ILIKE replace(replace(query, '\', '\\'), '%', '\%') || '%' ESCAPE '\'
      OR u.email = query
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

-- PUBLIC への暗黙的 EXECUTE を剥奪し service_role のみに限定
REVOKE ALL ON FUNCTION search_users(text, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION search_users(text, uuid) TO service_role;
