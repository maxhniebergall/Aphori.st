-- Drop FK on v3_nodes_i before dropping adus (v2_adu_id references adus)
ALTER TABLE v3_nodes_i DROP COLUMN IF EXISTS v2_adu_id;

-- Drop V2 argument analysis tables (in dependency order)
DROP TABLE IF EXISTS argument_relations CASCADE;
DROP TABLE IF EXISTS adu_canonical_map CASCADE;
DROP TABLE IF EXISTS canonical_claim_embeddings CASCADE;
DROP TABLE IF EXISTS canonical_claims CASCADE;
DROP TABLE IF EXISTS adu_embeddings CASCADE;
DROP TABLE IF EXISTS adus CASCADE;

-- Drop V2 enum type
DROP TYPE IF EXISTS adu_type CASCADE;

-- Drop V2 user counter column (no longer meaningful without canonical_claims)
ALTER TABLE users DROP COLUMN IF EXISTS canonical_claims_count;
