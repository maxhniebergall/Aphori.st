-- Migration: 003_replies
-- Description: Create replies table with nested threading support using ltree

-- Enable ltree extension for materialized path
CREATE EXTENSION IF NOT EXISTS ltree;

-- Create replies table
CREATE TABLE replies (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    post_id UUID NOT NULL REFERENCES posts(id),
    author_id VARCHAR(64) NOT NULL REFERENCES users(id),
    parent_reply_id UUID REFERENCES replies(id),
    target_adu_id UUID, -- Will reference adus table, added later
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    analysis_status analysis_status NOT NULL DEFAULT 'pending',
    depth INTEGER NOT NULL DEFAULT 0,
    path ltree NOT NULL,
    score INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Content length constraint
    CONSTRAINT reply_content_length CHECK (char_length(content) <= 10000)
);

-- Create indexes
CREATE INDEX idx_replies_post_id ON replies(post_id);
CREATE INDEX idx_replies_author_id ON replies(author_id);
CREATE INDEX idx_replies_parent_reply_id ON replies(parent_reply_id);
CREATE INDEX idx_replies_target_adu_id ON replies(target_adu_id);
CREATE INDEX idx_replies_content_hash ON replies(content_hash);
CREATE INDEX idx_replies_created_at ON replies(created_at DESC);
CREATE INDEX idx_replies_score ON replies(score DESC);
CREATE INDEX idx_replies_path ON replies USING GIST (path);

-- Composite indexes for threading queries
CREATE INDEX idx_replies_post_path ON replies(post_id, path) WHERE deleted_at IS NULL;
CREATE INDEX idx_replies_post_created ON replies(post_id, created_at DESC) WHERE deleted_at IS NULL;

-- Add trigger to update updated_at
CREATE TRIGGER update_replies_updated_at
    BEFORE UPDATE ON replies
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to increment parent reply counts
CREATE OR REPLACE FUNCTION update_reply_counts()
RETURNS TRIGGER AS $$
BEGIN
    -- Update post reply count
    UPDATE posts SET reply_count = reply_count + 1 WHERE id = NEW.post_id;

    -- Update parent reply count if exists
    IF NEW.parent_reply_id IS NOT NULL THEN
        UPDATE replies SET reply_count = reply_count + 1 WHERE id = NEW.parent_reply_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER increment_reply_counts
    AFTER INSERT ON replies
    FOR EACH ROW
    EXECUTE FUNCTION update_reply_counts();
