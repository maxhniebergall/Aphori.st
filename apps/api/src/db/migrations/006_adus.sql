-- Enable pgvector extension
CREATE EXTENSION IF NOT EXISTS vector;

-- ADUs (Argument Discourse Units)
CREATE TABLE adus (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_type VARCHAR(10) NOT NULL CHECK (source_type IN ('post', 'reply')),
    source_id UUID NOT NULL,
    adu_type VARCHAR(10) NOT NULL CHECK (adu_type IN ('claim', 'premise')),
    text TEXT NOT NULL,
    span_start INTEGER NOT NULL,
    span_end INTEGER NOT NULL,
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT valid_span CHECK (span_end > span_start)
);

CREATE INDEX idx_adus_source ON adus(source_type, source_id);
CREATE INDEX idx_adus_source_span ON adus(source_type, source_id, span_start);
