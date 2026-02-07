-- Migration 016: Add quote fields to replies for structured quoting
-- Enables users to quote text from posts/replies when creating replies

ALTER TABLE replies
  ADD COLUMN quoted_text TEXT,
  ADD COLUMN quoted_source_type VARCHAR(10),
  ADD COLUMN quoted_source_id UUID;

-- All-or-none consistency: either all quote fields are set or none
ALTER TABLE replies ADD CONSTRAINT replies_quote_fields_consistency
  CHECK (
    (quoted_text IS NULL AND quoted_source_type IS NULL AND quoted_source_id IS NULL) OR
    (quoted_text IS NOT NULL AND quoted_source_type IS NOT NULL AND quoted_source_id IS NOT NULL)
  );

-- Only allow valid source types
ALTER TABLE replies ADD CONSTRAINT replies_quoted_source_type_check
  CHECK (quoted_source_type IS NULL OR quoted_source_type IN ('post', 'reply'));

-- Index for finding all replies that quote a given source
CREATE INDEX idx_replies_quoted_source
  ON replies(quoted_source_type, quoted_source_id)
  WHERE quoted_source_id IS NOT NULL AND deleted_at IS NULL;
