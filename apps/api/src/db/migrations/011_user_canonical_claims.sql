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
    IF TG_OP = 'INSERT' THEN
        IF NEW.author_id IS NOT NULL THEN
            UPDATE users
            SET canonical_claims_count = canonical_claims_count + 1
            WHERE id = NEW.author_id;
        END IF;
    ELSIF TG_OP = 'DELETE' THEN
        IF OLD.author_id IS NOT NULL THEN
            UPDATE users
            SET canonical_claims_count = canonical_claims_count - 1
            WHERE id = OLD.author_id;
        END IF;
    ELSIF TG_OP = 'UPDATE' THEN
        -- Only adjust counts if the author_id actually changed
        IF OLD.author_id IS DISTINCT FROM NEW.author_id THEN
            IF OLD.author_id IS NOT NULL THEN
                UPDATE users
                SET canonical_claims_count = canonical_claims_count - 1
                WHERE id = OLD.author_id;
            END IF;

            IF NEW.author_id IS NOT NULL THEN
                UPDATE users
                SET canonical_claims_count = canonical_claims_count + 1
                WHERE id = NEW.author_id;
            END IF;
        END IF;
    END IF;

    IF TG_OP = 'DELETE' THEN
        RETURN OLD;
    ELSE
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update count when canonical claims are created, deleted, or reassigned
CREATE TRIGGER update_canonical_claims_count
    AFTER INSERT OR DELETE OR UPDATE OF author_id ON canonical_claims
    FOR EACH ROW
    EXECUTE FUNCTION update_user_canonical_claims_count();
