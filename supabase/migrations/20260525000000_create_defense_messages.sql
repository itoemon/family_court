CREATE TABLE defense_messages (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id    uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id    uuid NOT NULL,
  role       text NOT NULL CHECK (role IN ('user', 'assistant')),
  content    text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE defense_messages ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own defense messages"
  ON defense_messages FOR SELECT
  USING (user_id = auth.uid());

CREATE POLICY "users can insert own defense messages"
  ON defense_messages FOR INSERT
  WITH CHECK (user_id = auth.uid());

GRANT SELECT, INSERT ON defense_messages TO authenticated;
GRANT ALL            ON defense_messages TO service_role;
