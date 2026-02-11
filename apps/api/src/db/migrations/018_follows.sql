-- Migration: 018_follows
-- Description: Add follows table for social graph, denormalized counts on users, trigger to maintain counts

-- 1. Create follows table
CREATE TABLE follows (
    follower_id VARCHAR(64) NOT NULL REFERENCES users(id),
    following_id VARCHAR(64) NOT NULL REFERENCES users(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (follower_id, following_id),
    CONSTRAINT no_self_follow CHECK (follower_id != following_id)
);

CREATE INDEX idx_follows_following ON follows(following_id);
CREATE INDEX idx_follows_created ON follows(created_at DESC);

-- 2. Add denormalized counts to users
ALTER TABLE users ADD COLUMN followers_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN following_count INTEGER NOT NULL DEFAULT 0;

-- 3. Trigger to maintain counts
CREATE OR REPLACE FUNCTION update_follow_counts()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users SET following_count = following_count + 1 WHERE id = NEW.follower_id;
        UPDATE users SET followers_count = followers_count + 1 WHERE id = NEW.following_id;
        RETURN NEW;
    ELSIF TG_OP = 'DELETE' THEN
        UPDATE users SET following_count = following_count - 1 WHERE id = OLD.follower_id;
        UPDATE users SET followers_count = followers_count - 1 WHERE id = OLD.following_id;
        RETURN OLD;
    END IF;
    RETURN NULL;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trigger_update_follow_counts
    AFTER INSERT OR DELETE ON follows
    FOR EACH ROW
    EXECUTE FUNCTION update_follow_counts();
