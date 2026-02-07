-- Support/attack relations between ADUs
CREATE TABLE argument_relations (
    id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    source_adu_id UUID NOT NULL REFERENCES adus(id) ON DELETE CASCADE,
    target_adu_id UUID NOT NULL REFERENCES adus(id) ON DELETE CASCADE,
    relation_type VARCHAR(10) NOT NULL CHECK (relation_type IN ('support', 'attack')),
    confidence FLOAT NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT no_self_relation CHECK (source_adu_id != target_adu_id),
    UNIQUE(source_adu_id, target_adu_id, relation_type)
);

CREATE INDEX idx_argument_relations_source ON argument_relations(source_adu_id);
CREATE INDEX idx_argument_relations_target ON argument_relations(target_adu_id);
