-- Migration: 004_votes
-- Description: Create votes table with unique constraints and score update triggers

-- Create vote_target_type enum
CREATE TYPE vote_target_type AS ENUM ('post', 'reply');

-- Create votes table
CREATE TABLE votes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_id VARCHAR(64) NOT NULL REFERENCES users(id),
    target_type vote_target_type NOT NULL,
    target_id UUID NOT NULL,
    value SMALLINT NOT NULL CHECK (value IN (1, -1)),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    -- Unique constraint: one vote per user per target
    CONSTRAINT unique_user_vote UNIQUE (user_id, target_type, target_id)
);

-- Create indexes
CREATE INDEX idx_votes_user_id ON votes(user_id);
CREATE INDEX idx_votes_target ON votes(target_type, target_id);
CREATE INDEX idx_votes_created_at ON votes(created_at DESC);

-- Add trigger to update updated_at
CREATE TRIGGER update_votes_updated_at
    BEFORE UPDATE ON votes
    FOR EACH ROW
    EXECUTE FUNCTION update_updated_at_column();

-- Function to update target score on vote insert/update/delete
CREATE OR REPLACE FUNCTION update_target_score()
RETURNS TRIGGER AS $$
DECLARE
    score_delta INTEGER;
BEGIN
    -- Calculate score change
    IF TG_OP = 'INSERT' THEN
        score_delta := NEW.value;
    ELSIF TG_OP = 'UPDATE' THEN
        score_delta := NEW.value - OLD.value;
    ELSIF TG_OP = 'DELETE' THEN
        score_delta := -OLD.value;
    END IF;

    -- Apply score change to appropriate table
    IF TG_OP = 'DELETE' THEN
        IF OLD.target_type = 'post' THEN
            UPDATE posts SET score = score + score_delta WHERE id = OLD.target_id;
        ELSE
            UPDATE replies SET score = score + score_delta WHERE id = OLD.target_id;
        END IF;
    ELSE
        IF NEW.target_type = 'post' THEN
            UPDATE posts SET score = score + score_delta WHERE id = NEW.target_id;
        ELSE
            UPDATE replies SET score = score + score_delta WHERE id = NEW.target_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_score_on_vote
    AFTER INSERT OR UPDATE OR DELETE ON votes
    FOR EACH ROW
    EXECUTE FUNCTION update_target_score();
