-- Prevent duplicate active escrows for the same pair of argument components.
-- When two users independently bridge the same pair of components on the same day,
-- only the first S-node gets the escrow; subsequent attempts fail silently via ON CONFLICT.
CREATE UNIQUE INDEX idx_unique_active_bridge
ON v3_nodes_s (
  LEAST(component_a_id, component_b_id),
  GREATEST(component_a_id, component_b_id)
)
WHERE escrow_status = 'active'
  AND component_a_id IS NOT NULL
  AND component_b_id IS NOT NULL;
