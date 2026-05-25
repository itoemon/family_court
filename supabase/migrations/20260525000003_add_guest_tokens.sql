-- Rollback: DROP TABLE IF EXISTS guest_tokens;

CREATE TABLE guest_tokens (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  case_id     uuid        NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  token_hash  text        NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz
);

CREATE INDEX ON guest_tokens(case_id);

ALTER TABLE guest_tokens ENABLE ROW LEVEL SECURITY;
-- ポリシーを CREATE しないことで anon/authenticated ロールはブロック

-- service_role は RLS バイパスだが table-level GRANT も必要
GRANT ALL ON public.guest_tokens TO service_role;
