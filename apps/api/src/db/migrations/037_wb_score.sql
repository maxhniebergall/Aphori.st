ALTER TABLE v3_nodes_i ADD COLUMN wb_score FLOAT;
CREATE INDEX idx_v3_i_nodes_wb_score ON v3_nodes_i(wb_score DESC NULLS LAST);
