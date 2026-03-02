-- V4 Source Ontology: Hierarchical R-Nodes for domain-level reputation

CREATE TYPE source_level AS ENUM ('DOMAIN','DOCUMENT','EXTRACT');

CREATE TABLE v3_sources (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  level source_level NOT NULL DEFAULT 'DOMAIN',
  url TEXT UNIQUE,
  title TEXT,
  parent_source_id UUID REFERENCES v3_sources(id) ON DELETE CASCADE,
  reputation_score FLOAT NOT NULL DEFAULT 1.0 CHECK (reputation_score >= 0.0 AND reputation_score <= 1.0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_v3_sources_url ON v3_sources(url) WHERE url IS NOT NULL;
CREATE INDEX idx_v3_sources_level ON v3_sources(level);
CREATE INDEX idx_v3_sources_parent ON v3_sources(parent_source_id) WHERE parent_source_id IS NOT NULL;

-- Trigger to auto-update updated_at
CREATE TRIGGER v3_sources_updated_at BEFORE UPDATE ON v3_sources
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Add source_ref_id FK to v3_nodes_i linking to v3_sources (phase 1: domain-level sources only)
-- Note: v3_nodes_i already has source_id referencing the originating post/reply;
-- source_ref_id is the separate FK to the v3_sources reputation table.
ALTER TABLE v3_nodes_i
  ADD COLUMN source_ref_id UUID REFERENCES v3_sources(id) ON DELETE SET NULL;
CREATE INDEX idx_v3_i_nodes_source_ref ON v3_nodes_i(source_ref_id) WHERE source_ref_id IS NOT NULL;

-- Extend v3_edges to support source premises (R-Nodes as premise nodes)
-- node_id becomes nullable; exactly one of node_id or source_id must be set when role='premise'
ALTER TABLE v3_edges
  ADD COLUMN source_id UUID REFERENCES v3_sources(id) ON DELETE CASCADE;

ALTER TABLE v3_edges ALTER COLUMN node_id DROP NOT NULL;

-- Constraint: for premise edges, exactly one of node_id or source_id must be non-null
-- For non-premise edges (conclusion, motivation), node_id must be set and source_id must be null
ALTER TABLE v3_edges ADD CONSTRAINT chk_edge_premise_origin CHECK (
  CASE
    WHEN role = 'premise' THEN (node_id IS NOT NULL) != (source_id IS NOT NULL)
    ELSE node_id IS NOT NULL AND source_id IS NULL
  END
);
