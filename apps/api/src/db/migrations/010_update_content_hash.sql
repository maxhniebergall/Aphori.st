-- Rename content_hash to analysis_content_hash for clarity
ALTER TABLE posts RENAME COLUMN content_hash TO analysis_content_hash;
ALTER TABLE replies RENAME COLUMN content_hash TO analysis_content_hash;

DROP INDEX IF EXISTS idx_posts_content_hash;
CREATE INDEX idx_posts_analysis_content_hash ON posts(analysis_content_hash);

DROP INDEX IF EXISTS idx_replies_content_hash;
CREATE INDEX idx_replies_analysis_content_hash ON replies(analysis_content_hash);
