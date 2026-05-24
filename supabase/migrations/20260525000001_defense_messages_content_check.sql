ALTER TABLE defense_messages
  ADD CONSTRAINT defense_messages_content_not_empty CHECK (content <> '');
