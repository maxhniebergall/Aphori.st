-- Update embedding dimension from 768 to 1536 (Gemini model change)
-- Existing embeddings must be cleared - they will be regenerated with new dimension

-- Drop existing HNSW indexes (required before altering column type)
DROP INDEX IF EXISTS idx_adu_embeddings_vector;
DROP INDEX IF EXISTS idx_content_embeddings_vector;
DROP INDEX IF EXISTS idx_canonical_embeddings_vector;

-- Clear existing embedding data (incompatible dimensions)
TRUNCATE TABLE adu_embeddings;
TRUNCATE TABLE content_embeddings;
TRUNCATE TABLE canonical_claim_embeddings;

-- Reset analysis status so content gets re-analyzed with new embeddings
UPDATE posts SET analysis_status = 'pending' WHERE analysis_status = 'completed';
UPDATE replies SET analysis_status = 'pending' WHERE analysis_status = 'completed';

-- Alter embedding columns to new dimension
ALTER TABLE adu_embeddings
    ALTER COLUMN embedding TYPE vector(1536);

ALTER TABLE content_embeddings
    ALTER COLUMN embedding TYPE vector(1536);

ALTER TABLE canonical_claim_embeddings
    ALTER COLUMN embedding TYPE vector(1536);

-- Recreate HNSW indexes with adjusted parameters for larger dimension
-- Using m=24 for better recall with higher-dimensional vectors
CREATE INDEX idx_adu_embeddings_vector ON adu_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 100);

CREATE INDEX idx_content_embeddings_vector ON content_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 100);

CREATE INDEX idx_canonical_embeddings_vector ON canonical_claim_embeddings
    USING hnsw (embedding vector_cosine_ops)
    WITH (m = 24, ef_construction = 100);
