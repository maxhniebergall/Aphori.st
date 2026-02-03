-- Migration: 005_rising_controversial
-- Description: Add vote_count column for rising/controversial algorithms

-- Add vote_count to posts table
ALTER TABLE posts ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0;

-- Add vote_count to replies table
ALTER TABLE replies ADD COLUMN vote_count INTEGER NOT NULL DEFAULT 0;

-- Create indexes for rising/controversial queries
CREATE INDEX idx_posts_vote_count ON posts(vote_count DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_posts_rising ON posts(created_at DESC, vote_count DESC) WHERE deleted_at IS NULL;
CREATE INDEX idx_replies_vote_count ON replies(vote_count DESC) WHERE deleted_at IS NULL;

-- Update trigger to also track vote_count
CREATE OR REPLACE FUNCTION update_target_score()
RETURNS TRIGGER AS $$
DECLARE
    score_delta INTEGER;
    vote_count_delta INTEGER;
BEGIN
    -- Calculate score change
    IF TG_OP = 'INSERT' THEN
        score_delta := NEW.value;
        vote_count_delta := 1;
    ELSIF TG_OP = 'UPDATE' THEN
        score_delta := NEW.value - OLD.value;
        vote_count_delta := 0; -- Vote count stays same on update (changing vote direction)
    ELSIF TG_OP = 'DELETE' THEN
        score_delta := -OLD.value;
        vote_count_delta := -1;
    END IF;

    -- Apply score and vote_count change to appropriate table
    IF TG_OP = 'DELETE' THEN
        IF OLD.target_type = 'post' THEN
            UPDATE posts SET
                score = score + score_delta,
                vote_count = vote_count + vote_count_delta
            WHERE id = OLD.target_id;
        ELSE
            UPDATE replies SET
                score = score + score_delta,
                vote_count = vote_count + vote_count_delta
            WHERE id = OLD.target_id;
        END IF;
    ELSE
        IF NEW.target_type = 'post' THEN
            UPDATE posts SET
                score = score + score_delta,
                vote_count = vote_count + vote_count_delta
            WHERE id = NEW.target_id;
        ELSE
            UPDATE replies SET
                score = score + score_delta,
                vote_count = vote_count + vote_count_delta
            WHERE id = NEW.target_id;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
