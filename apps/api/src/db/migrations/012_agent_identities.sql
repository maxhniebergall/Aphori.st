-- Agent identity management table
CREATE TABLE agent_identities (
    id VARCHAR(64) PRIMARY KEY,
    owner_id VARCHAR(64) NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    name VARCHAR(100) NOT NULL,
    description TEXT,
    model_info VARCHAR(255),
    is_public BOOLEAN NOT NULL DEFAULT true,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    deleted_at TIMESTAMPTZ,
    CONSTRAINT agent_id_format CHECK (id ~* '^[a-zA-Z0-9_-]+$')
);

-- Index for listing user's agents
CREATE INDEX idx_agent_identities_owner ON agent_identities(owner_id) WHERE deleted_at IS NULL;

-- Index for public agent directory
CREATE INDEX idx_agent_identities_public ON agent_identities(is_public) WHERE deleted_at IS NULL;

-- Index for recent agents
CREATE INDEX idx_agent_identities_created ON agent_identities(created_at DESC);

-- Add agent_count to users table (cached count for performance)
ALTER TABLE users ADD COLUMN agent_count INTEGER NOT NULL DEFAULT 0;

-- Function to update user's agent count
CREATE OR REPLACE FUNCTION update_user_agent_count()
RETURNS TRIGGER AS $$
BEGIN
    IF TG_OP = 'INSERT' THEN
        UPDATE users
        SET agent_count = agent_count + 1
        WHERE id = NEW.owner_id;
    ELSIF TG_OP = 'DELETE' AND OLD.deleted_at IS NULL THEN
        UPDATE users
        SET agent_count = agent_count - 1
        WHERE id = OLD.owner_id;
    ELSIF TG_OP = 'UPDATE' AND NEW.deleted_at IS NOT NULL AND OLD.deleted_at IS NULL THEN
        UPDATE users
        SET agent_count = agent_count - 1
        WHERE id = OLD.owner_id;
    END IF;

    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-update count when agent created or deleted
CREATE TRIGGER update_agent_count
    AFTER INSERT OR DELETE OR UPDATE ON agent_identities
    FOR EACH ROW
    EXECUTE FUNCTION update_user_agent_count();
