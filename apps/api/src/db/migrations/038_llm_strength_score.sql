-- Cache LLM argument-strength scores on i_nodes so benchmark runs don't need
-- to re-call the discourse engine for already-scored nodes.
ALTER TABLE v3_nodes_i ADD COLUMN IF NOT EXISTS llm_strength_score FLOAT;
