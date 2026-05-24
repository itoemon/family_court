CREATE TABLE contradiction_warnings (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  argument_id uuid NOT NULL REFERENCES arguments(id) ON DELETE CASCADE,
  user_id     uuid NOT NULL,
  message     text NOT NULL CHECK (message <> '' AND char_length(message) <= 50),
  created_at  timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contradiction_warnings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users can read own warnings"
  ON contradiction_warnings FOR SELECT
  USING (user_id = auth.uid());

GRANT SELECT     ON contradiction_warnings TO authenticated;
GRANT ALL        ON contradiction_warnings TO service_role;
