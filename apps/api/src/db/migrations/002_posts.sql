-- Migration: 002_posts
-- Description: Create posts table with analysis status tracking

-- Create analysis_status enum
CREATE TYPE analysis_status AS ENUM ('pending', 'processing', 'completed', 'failed');

-- Create posts table
CREATE TABLE posts (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    author_id VARCHAR(64) NOT NULL REFERENCES users(id),
    title VARCHAR(300) NOT NULL,
    content TEXT NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    analysis_status analysis_status NOT NULL DEFAULT 'pending',
    score INTEGER NOT NULL DEFAULT 0,
    reply_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,

    -- Content length constraints
    CONSTRAINT content_length CHECK (char_length(content) <= 40000),
    CONSTRAINT title_length CHECK (char_length(title) >= 1)
);

-- Create indexes
CREATE INDEX idx_posts_author_id ON posts(author_id);
CREATE INDEX idx_posts_analysis_status ON posts(analysis_status);
CREATE INDEX idx_posts_content_hash ON posts(content_hash);
CREATE INDEX idx_posts_created_at ON posts(created_at DESC);
CREATE INDEX idx_posts_score ON posts(score DESC);

-- Composite index for hot ranking
CREATE INDEX idx_posts_hot ON posts(score, created_at DESC) WHERE deleted_at IS NULL;

-- Add trigger to update updated_at
CREATE TRIGGER update_posts_updated_at
    BEFORE UPDATE ON posts
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();
