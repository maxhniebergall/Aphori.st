-- Deduplicated canonical claims
CREATE TABLE canonical_claims (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    representative_text TEXT NOT NULL,
    adu_count INTEGER NOT NULL DEFAULT 0,
    discussion_count INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_canonical_claims_adu_count ON canonical_claims(adu_count DESC);

-- Embeddings for canonical claims (768-dim Gemini, used in dedup matching)
CREATE TABLE canonical_claim_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    canonical_claim_id UUID NOT NULL REFERENCES canonical_claims(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    UNIQUE(canonical_claim_id)
);

CREATE INDEX idx_canonical_embeddings_vector ON canonical_claim_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Mapping ADUs to canonical claims
CREATE TABLE adu_canonical_map (
    adu_id UUID NOT NULL REFERENCES adus(id) ON DELETE CASCADE,
    canonical_claim_id UUID NOT NULL REFERENCES canonical_claims(id) ON DELETE CASCADE,
    similarity_score FLOAT NOT NULL CHECK (similarity_score >= 0 AND similarity_score <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (adu_id, canonical_claim_id)
);

CREATE INDEX idx_adu_canonical_map_canonical ON adu_canonical_map(canonical_claim_id);
