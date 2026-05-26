-- Rollback: DROP INDEX IF EXISTS guest_tokens_token_hash_idx;

CREATE UNIQUE INDEX guest_tokens_token_hash_idx ON guest_tokens(token_hash);
