-- Globally-deduplicated concept definitions
CREATE TABLE v3_concept_nodes (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    term TEXT NOT NULL,
    definition TEXT NOT NULL,
    embedding vector(1536),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_v3_concepts_embedding ON v3_concept_nodes
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 200);

-- Link each I-Node mention to the concept it uses
CREATE TABLE v3_i_node_concept_map (
    i_node_id UUID NOT NULL REFERENCES v3_nodes_i(id) ON DELETE CASCADE,
    concept_id UUID NOT NULL REFERENCES v3_concept_nodes(id),
    term_text TEXT NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (i_node_id, term_text)
);

CREATE INDEX idx_v3_concept_map_concept ON v3_i_node_concept_map(concept_id);

-- Equivocation flags: same term, different concepts across a scheme edge
CREATE TABLE v3_equivocation_flags (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    scheme_node_id UUID NOT NULL REFERENCES v3_nodes_s(id) ON DELETE CASCADE,
    term TEXT NOT NULL,
    premise_i_node_id UUID NOT NULL REFERENCES v3_nodes_i(id) ON DELETE CASCADE,
    conclusion_i_node_id UUID NOT NULL REFERENCES v3_nodes_i(id) ON DELETE CASCADE,
    premise_concept_id UUID NOT NULL REFERENCES v3_concept_nodes(id),
    conclusion_concept_id UUID NOT NULL REFERENCES v3_concept_nodes(id),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE(scheme_node_id, term)
);

CREATE INDEX idx_v3_equivocation_scheme ON v3_equivocation_flags(scheme_node_id);
