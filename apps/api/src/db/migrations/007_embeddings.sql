-- ADU embeddings (768-dim Gemini for relation detection + claim dedup)
CREATE TABLE adu_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    adu_id UUID NOT NULL REFERENCES adus(id) ON DELETE CASCADE,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(adu_id)
);

CREATE INDEX idx_adu_embeddings_vector ON adu_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);

-- Content embeddings (768-dim Gemini for semantic search)
CREATE TABLE content_embeddings (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('post', 'reply')),
    source_id UUID NOT NULL,
    embedding vector(768) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(source_type, source_id)
);

CREATE INDEX idx_content_embeddings_vector ON content_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 16, ef_construction = 64);
