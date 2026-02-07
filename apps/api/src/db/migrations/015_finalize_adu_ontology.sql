-- Migration: Finalize ADU Ontology V2
-- Drop old adu_type column and rename adu_type_v2 to adu_type

-- Step 1: Verify all ADUs have been migrated (adu_type_v2 NOT NULL)
-- This will fail if any rows weren't migrated
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM adus WHERE adu_type_v2 IS NULL LIMIT 1) THEN
    RAISE EXCEPTION 'Migration incomplete: some ADUs have NULL adu_type_v2';
  END IF;
END $$;

-- Step 2: Drop the old constraint
ALTER TABLE adus DROP CONSTRAINT IF EXISTS adus_adu_type_check;

-- Step 3: Drop the old column
ALTER TABLE adus DROP COLUMN adu_type;

-- Step 4: Rename the new column
ALTER TABLE adus RENAME COLUMN adu_type_v2 TO adu_type;

-- Step 5: Rename the constraint for consistency
ALTER TABLE adus DROP CONSTRAINT adu_type_v2_check;
ALTER TABLE adus ADD CONSTRAINT adus_adu_type_check
  CHECK (adu_type IN ('MajorClaim', 'Supporting', 'Opposing', 'Evidence'));

-- Step 6: Make adu_type NOT NULL now that migration is complete
ALTER TABLE adus ALTER COLUMN adu_type SET NOT NULL;

-- Note: argument_relations table is kept for cross-post relations but
-- is no longer populated for intra-post relations (now implicit in adu_type)
