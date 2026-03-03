-- Migration 036: Add canonical_i_node_id for I-Node deduplication
-- Convention: canonical_i_node_id = NULL means this node IS canonical (root).
-- Non-null means it's a duplicate pointing to its canonical root.
-- ON DELETE RESTRICT prevents deleting a canonical node while duplicates still reference it,
-- avoiding silent promotion of duplicates to canonical status.

ALTER TABLE v3_nodes_i
  ADD COLUMN canonical_i_node_id UUID REFERENCES v3_nodes_i(id) ON DELETE RESTRICT;

CREATE INDEX idx_v3_i_nodes_canonical
  ON v3_nodes_i(canonical_i_node_id)
  WHERE canonical_i_node_id IS NOT NULL;
