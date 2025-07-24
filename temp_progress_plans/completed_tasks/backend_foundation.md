# Backend Foundation Implementation Plan

## Overview
Core backend infrastructure for vector search, including embedding generation and vector storage.

## Sequential Implementation Order

### Phase 1: Embedding Provider Architecture
**MUST BE IMPLEMENTED FIRST** - All other phases depend on this

1. **Create Embedding Provider Interface** (`backend/services/embeddingProviderInterface.ts`)
   - Abstract interface for embedding generation
   - Support for both production (Vertex AI) and development (mock) providers

2. **Implement Mock Embedding Provider** (`backend/services/mockEmbeddingProvider.ts`)
   - Generate deterministic fake vectors for local development
   - Same dimensions as Vertex AI embeddings (e.g., 768 dimensions)
   - Consistent output for same input text

3. **Implement Vertex AI Embedding Provider** (`backend/services/gcpEmbeddingProvider.ts`)
   - Integration with `gemini-embedding-exp-03-07` model
   - Error handling and retry logic
   - Rate limiting considerations

4. **Environment-Based Provider Selection**
   - Use mock provider when `NODE_ENV=development` or no GCP credentials
   - Use Vertex AI provider in production

### Phase 2: Vector Storage Infrastructure
**SEQUENTIAL DEPENDENCY** - Requires Phase 1 to be complete

1. **Extend FirebaseClient.ts**
   - `addVectorToShard()` - Handle sharded vector writes with metadata updates
   - `getVectorIndexMetadata()` - Read metadata for shard management
   - `getAllVectorsFromShards()` - Bulk read for FAISS index building
   - Transaction support for atomic metadata updates

2. **RTDB Schema Implementation**
   - Create `/vectorIndexStore/` with shard structure
   - Create `/vectorIndexMetadata/` with active shard tracking
   - Implement shard capacity management (10,000 entries per shard)

### Phase 3: FAISS Integration
**SEQUENTIAL DEPENDENCY** - Requires Phase 2 to be complete

1. **Install FAISS Library**
   ```bash
   cd backend && yarn add faiss-node
   ```

2. **Create VectorService** (`backend/services/vectorService.ts`)
   - FAISS index initialization (IndexFlatL2 or IndexFlatIP)
   - Index building from RTDB shards on startup
   - Incremental vector addition
   - Search functionality with k=10 fixed results
   - Content ID to FAISS index mapping

3. **Memory Management**
   - 10,000 vector limit for in-memory FAISS index
   - Warning logs when exceeding limit
   - Graceful handling of large datasets

## Implementation Notes

### Mock Embedding Provider Specifications
- **Vector Dimensions**: 768 (match Vertex AI)
- **Generation Method**: Hash-based deterministic vectors from input text
- **Consistency**: Same input always produces same vector
- **Performance**: Fast generation for development testing

### Error Handling Requirements
- Network failures for Vertex AI calls
- RTDB transaction failures
- FAISS index corruption recovery
- Out-of-memory conditions

### Configuration Requirements
- Environment variables for provider selection
- GCP credentials validation
- FAISS index size limits
- Shard capacity configuration

## Files to Create/Modify
- `backend/services/embeddingProviderInterface.ts` (NEW)
- `backend/services/mockEmbeddingProvider.ts` (MODIFY - already exists)
- `backend/services/gcpEmbeddingProvider.ts` (RENAME from vertexAIEmbeddingProvider.ts)
- `backend/services/vectorService.ts` (NEW)
- `backend/services/databaseClient.ts` (MODIFY - extend FirebaseClient)
- `backend/types/index.ts` (MODIFY - add vector types)