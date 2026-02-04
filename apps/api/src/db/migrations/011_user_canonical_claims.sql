-- Track canonical claims created by each user
ALTER TABLE canonical_claims ADD COLUMN author_id VARCHAR(64) REFERENCES users(id);

-- Index for user profile queries
CREATE INDEX idx_canonical_claims_author ON canonical_claims(author_id);

-- Add canonical_claims_count to users table (cached count for performance)
ALTER TABLE users ADD COLUMN canonical_claims_count INTEGER NOT NULL DEFAULT 0;

-- Backfill existing canonical claims count
UPDATE users SET canonical_claims_count = 0;

-- Function to update user's canonical claims count
CREATE OR REPLACE FUNCTION update_user_canonical_claims_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' AND NEW.author_id IS NOT NULL THEN
        UPDATE users
        SET canonical_claims_count = canonical_claims_count + 1
        WHERE id = NEW.author_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update count when new canonical claim created
CREATE TRIGGER update_canonical_claims_count
    AFTER INSERT ON canonical_claims
    FOR EACH ROW
    EXECUTE FUNCTION update_user_canonical_claims_count();
