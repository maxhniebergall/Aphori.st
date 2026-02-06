-- Migration: ADU Ontology V2
-- Migrate from flat claim/premise to hierarchical MajorClaim/Supporting/Opposing/Evidence

-- Step 1: Add new column for V2 type
ALTER TABLE adus ADD COLUMN adu_type_v2 VARCHAR(20);

-- Step 2: Add constraint for new type values
ALTER TABLE adus ADD CONSTRAINT adu_type_v2_check
  CHECK (adu_type_v2 IN ('MajorClaim', 'Supporting', 'Opposing', 'Evidence'));

-- Step 3: Add target column for hierarchy (self-referential FK)
ALTER TABLE adus ADD COLUMN target_adu_id UUID REFERENCES adus(id) ON DELETE SET NULL;
CREATE INDEX idx_adus_target ON adus(target_adu_id);

-- Step 4: Migrate existing data - claims become MajorClaim
UPDATE adus SET adu_type_v2 = 'MajorClaim' WHERE adu_type = 'claim';

-- Step 5: Migrate existing data - premises become Supporting
UPDATE adus SET adu_type_v2 = 'Supporting' WHERE adu_type = 'premise';

-- Step 6: Migrate attack relations to Opposing type and set target
-- ADUs that are sources of attack relations become Opposing
UPDATE adus a
SET adu_type_v2 = 'Opposing', target_adu_id = ar.target_adu_id
FROM argument_relations ar
WHERE a.id = ar.source_adu_id AND ar.relation_type = 'attack';

-- Step 7: Migrate support relations - set target_adu_id for Supporting types
UPDATE adus a
SET target_adu_id = ar.target_adu_id
FROM argument_relations ar
WHERE a.id = ar.source_adu_id
  AND ar.relation_type = 'support'
  AND a.adu_type_v2 = 'Supporting';

-- Step 8: Add claim_type column to canonical_claims for new ontology
ALTER TABLE canonical_claims ADD COLUMN claim_type VARCHAR(20) DEFAULT 'MajorClaim';
ALTER TABLE canonical_claims ADD CONSTRAINT canonical_claim_type_check
  CHECK (claim_type IN ('MajorClaim', 'Supporting', 'Opposing'));
