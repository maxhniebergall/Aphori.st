-- V4 Gamification Schema: Epistemic Weighting + Karma System

-- Extend v3_nodes_i with gamification columns
ALTER TABLE v3_nodes_i
  ADD COLUMN fact_subtype VARCHAR(20) CHECK (fact_subtype IN ('ENTHYMEME','ANECDOTE','DOCUMENT_REF','ACADEMIC_REF')),
  ADD COLUMN base_weight FLOAT NOT NULL DEFAULT 1.0,
  ADD COLUMN evidence_rank FLOAT NOT NULL DEFAULT 0.0,
  ADD COLUMN is_defeated BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN component_id UUID,
  ADD COLUMN node_role VARCHAR(20) CHECK (node_role IN ('ROOT','SUPPORT','ATTACK'));

-- Add index for nightly batch queries
CREATE INDEX idx_v3_i_nodes_component ON v3_nodes_i(component_id) WHERE component_id IS NOT NULL;
CREATE INDEX idx_v3_i_nodes_role ON v3_nodes_i(node_role) WHERE node_role IS NOT NULL;
CREATE INDEX idx_v3_i_nodes_defeated ON v3_nodes_i(is_defeated);

-- Extend v3_nodes_s with Crucible escrow columns
ALTER TABLE v3_nodes_s
  ADD COLUMN escrow_expires_at TIMESTAMPTZ,
  ADD COLUMN pending_bounty INT,
  ADD COLUMN escrow_status VARCHAR(20) DEFAULT 'none' CHECK (escrow_status IN ('none','active','paid','stolen','languished')),
  ADD COLUMN is_bridge BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN component_a_id UUID,
  ADD COLUMN component_b_id UUID;

CREATE INDEX idx_v3_s_nodes_escrow ON v3_nodes_s(escrow_status, escrow_expires_at) WHERE escrow_status = 'active';

-- Replace old karma columns on users with V4 karma types
ALTER TABLE users
  DROP COLUMN IF EXISTS vote_karma,
  DROP COLUMN IF EXISTS connection_karma,
  ADD COLUMN pioneer_karma FLOAT NOT NULL DEFAULT 0.0,
  ADD COLUMN builder_karma FLOAT NOT NULL DEFAULT 0.0,
  ADD COLUMN critic_karma FLOAT NOT NULL DEFAULT 0.0,
  ADD COLUMN epistemic_score FLOAT NOT NULL DEFAULT 1.0;

-- User karma profiles (daily yield tracking)
CREATE TABLE v3_user_karma_profiles (
  user_id UUID PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  daily_pioneer_yield FLOAT DEFAULT 0,
  daily_builder_yield FLOAT DEFAULT 0,
  daily_critic_yield FLOAT DEFAULT 0,
  last_batch_run_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Epistemic notifications (pull-only inbox)
CREATE TABLE v3_epistemic_notifications (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type VARCHAR(50) NOT NULL CHECK (type IN ('STREAM_HALTED','BOUNTY_STOLEN','BOUNTY_PAID','BOUNTY_LANGUISHED','UPSTREAM_DEFEATED')),
  payload JSONB NOT NULL DEFAULT '{}',
  is_read BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_v3_notif_user ON v3_epistemic_notifications(user_id, created_at DESC);
CREATE INDEX idx_v3_notif_unread ON v3_epistemic_notifications(user_id) WHERE is_read = FALSE;

-- Update the vote trigger: remove the vote_karma update since V4 karma is batch-only.
-- Votes now only affect post/reply scores (which feed into EvidenceRank as vote_score);
-- karma balance increments happen exclusively via the nightly batch pipeline.
CREATE OR REPLACE FUNCTION update_target_score()
RETURNS TRIGGER AS $$
DECLARE
    score_delta INTEGER;
BEGIN
    IF TG_OP = 'INSERT' THEN
        score_delta := NEW.value;
    ELSIF TG_OP = 'UPDATE' THEN
        score_delta := NEW.value - OLD.value;
    ELSIF TG_OP = 'DELETE' THEN
        score_delta := -OLD.value;
    END IF;

    IF TG_OP = 'DELETE' THEN
        IF OLD.target_type = 'post' THEN
            UPDATE posts SET score = score + score_delta WHERE id = OLD.target_id;
        ELSE
            UPDATE replies SET score = score + score_delta WHERE id = OLD.target_id;
        END IF;
        RETURN OLD;
    ELSE
        IF NEW.target_type = 'post' THEN
            UPDATE posts SET score = score + score_delta WHERE id = NEW.target_id;
        ELSE
            UPDATE replies SET score = score + score_delta WHERE id = NEW.target_id;
        END IF;
        RETURN NEW;
    END IF;
END;
$$ LANGUAGE plpgsql;

-- Backfill node_role from existing graph topology:
-- ROOT = I-nodes with no outgoing SUPPORT/ATTACK edges as a conclusion
-- SUPPORT = I-nodes that appear as premise in a SUPPORT S-node
-- ATTACK = I-nodes that appear as premise in an ATTACK S-node
-- Note: an I-node can be both premise in one scheme and conclusion in another;
-- node_role reflects its OUTGOING relationship (what it does to others)
UPDATE v3_nodes_i ni
SET node_role = CASE
  WHEN EXISTS (
    SELECT 1 FROM v3_edges e
    JOIN v3_nodes_s s ON s.id = e.scheme_node_id
    WHERE e.node_id = ni.id AND e.role = 'premise' AND s.direction = 'SUPPORT'
  ) THEN 'SUPPORT'
  WHEN EXISTS (
    SELECT 1 FROM v3_edges e
    JOIN v3_nodes_s s ON s.id = e.scheme_node_id
    WHERE e.node_id = ni.id AND e.role = 'premise' AND s.direction = 'ATTACK'
  ) THEN 'ATTACK'
  ELSE 'ROOT'
END
WHERE node_role IS NULL;
