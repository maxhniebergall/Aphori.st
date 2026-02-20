-- V3 Neurosymbolic Hypergraph Schema (additive to V2)

-- Track which posts/replies have been V3-analyzed
CREATE TABLE v3_analysis_runs (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('post', 'reply')),
    source_id UUID NOT NULL,
    content_hash VARCHAR(64) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'processing', 'completed', 'failed')),
    error_message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    completed_at TIMESTAMPTZ
);
CREATE INDEX idx_v3_runs_source ON v3_analysis_runs(source_type, source_id);
CREATE UNIQUE INDEX idx_v3_runs_idempotent ON v3_analysis_runs(source_type, source_id, content_hash);

-- I-Nodes: Information nodes (FACT/VALUE/POLICY)
CREATE TABLE v3_nodes_i (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_run_id UUID NOT NULL REFERENCES v3_analysis_runs(id) ON DELETE CASCADE,
    source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('post', 'reply')),
    source_id UUID NOT NULL,
    v2_adu_id UUID REFERENCES adus(id) ON DELETE SET NULL,
    content TEXT NOT NULL,
    rewritten_text TEXT,
    epistemic_type VARCHAR(10) NOT NULL CHECK (epistemic_type IN ('FACT', 'VALUE', 'POLICY')),
    fvp_confidence FLOAT NOT NULL CHECK (fvp_confidence >= 0 AND fvp_confidence <= 1),
    span_start INTEGER NOT NULL,
    span_end INTEGER NOT NULL,
    extraction_confidence FLOAT NOT NULL CHECK (extraction_confidence >= 0 AND extraction_confidence <= 1),
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT v3_valid_span CHECK (span_end > span_start)
);
CREATE INDEX idx_v3_i_nodes_source ON v3_nodes_i(source_type, source_id);
CREATE INDEX idx_v3_i_nodes_run ON v3_nodes_i(analysis_run_id);
CREATE INDEX idx_v3_i_nodes_type ON v3_nodes_i(epistemic_type);

-- HNSW index for vector similarity search on I-Nodes
CREATE INDEX idx_v3_i_nodes_embedding ON v3_nodes_i
    USING hnsw (embedding vector_cosine_ops) WITH (m = 24, ef_construction = 200);

-- S-Nodes: Scheme nodes (logic hubs)
CREATE TABLE v3_nodes_s (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    analysis_run_id UUID NOT NULL REFERENCES v3_analysis_runs(id) ON DELETE CASCADE,
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('SUPPORT', 'ATTACK')),
    logic_type VARCHAR(50),
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    gap_detected BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_v3_s_nodes_run ON v3_nodes_s(analysis_run_id);

-- Edges: connect nodes via scheme nodes with roles
CREATE TABLE v3_edges (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_node_id UUID NOT NULL REFERENCES v3_nodes_s(id) ON DELETE CASCADE,
    node_id UUID NOT NULL,
    node_type VARCHAR(10) NOT NULL CHECK (node_type IN ('i_node', 'ghost')),
    role VARCHAR(20) NOT NULL CHECK (role IN ('premise', 'conclusion', 'motivation')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_v3_edges_scheme ON v3_edges(scheme_node_id);
CREATE INDEX idx_v3_edges_node ON v3_edges(node_id);

-- Enthymemes (ghost nodes): missing premises attached to scheme nodes
CREATE TABLE v3_enthymemes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_id UUID NOT NULL REFERENCES v3_nodes_s(id) ON DELETE CASCADE,
    content TEXT NOT NULL,
    fvp_type VARCHAR(10) NOT NULL CHECK (fvp_type IN ('FACT', 'VALUE', 'POLICY')),
    probability FLOAT NOT NULL CHECK (probability >= 0 AND probability <= 1),
    status VARCHAR(20) NOT NULL DEFAULT 'pending'
        CHECK (status IN ('pending', 'accepted', 'rejected')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER v3_enthymemes_updated_at BEFORE UPDATE ON v3_enthymemes
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE INDEX idx_v3_enthymemes_scheme ON v3_enthymemes(scheme_id);

-- Socratic questions generated for uncertain gaps
CREATE TABLE v3_socratic_questions (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_id UUID NOT NULL REFERENCES v3_nodes_s(id) ON DELETE CASCADE,
    question TEXT NOT NULL,
    context JSONB NOT NULL DEFAULT '{}',
    uncertainty_level FLOAT NOT NULL CHECK (uncertainty_level >= 0 AND uncertainty_level <= 1),
    resolved BOOLEAN NOT NULL DEFAULT FALSE,
    resolution_reply_id UUID REFERENCES replies(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_v3_socratic_scheme ON v3_socratic_questions(scheme_id);

-- Extracted values: value concepts linked to I-Nodes
CREATE TABLE v3_extracted_values (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    i_node_id UUID NOT NULL REFERENCES v3_nodes_i(id) ON DELETE CASCADE,
    text VARCHAR(255) NOT NULL,
    embedding vector(1536),
    cluster_label VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_v3_values_inode ON v3_extracted_values(i_node_id);
