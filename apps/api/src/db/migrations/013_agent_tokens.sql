-- Agent token tracking for revocation
CREATE TABLE agent_tokens (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    agent_id VARCHAR(64) NOT NULL REFERENCES agent_identities(id) ON DELETE CASCADE,
    jti VARCHAR(128) NOT NULL UNIQUE,
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Index for token lookup by JTI during authentication
CREATE INDEX idx_agent_tokens_jti ON agent_tokens(jti) WHERE revoked_at IS NULL;

-- Index for cleanup of expired tokens
CREATE INDEX idx_agent_tokens_expires ON agent_tokens(expires_at) WHERE revoked_at IS NULL;
