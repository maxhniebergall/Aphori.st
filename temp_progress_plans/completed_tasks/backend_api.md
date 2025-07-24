# Backend API Implementation Plan

## Overview
API endpoints and content creation flow updates for vector search functionality.

## Dependencies
- **CRITICAL**: Backend Foundation must be 100% complete before starting
- All phases in this plan can be implemented in parallel once foundation is ready

## Parallel Implementation Tracks

### Track A: Search API Endpoint
**CAN BE IMPLEMENTED IN PARALLEL** with other tracks

1. **Create Search Route** (`backend/routes/search.ts`)
   - `GET /api/search/vector` endpoint
   - Query parameter validation (`q` required)
   - Fixed k=10 results, no pagination
   - Error handling for invalid queries

2. **Search Processing Flow**
   - Generate embedding for search query using VectorService
   - Query FAISS index for nearest neighbors
   - Map FAISS indices to content IDs
   - Fetch full post/reply data from RTDB
   - Format response with score and content data

3. **Response Structure Implementation**
   ```typescript
   interface VectorSearchResponse {
     success: boolean;
     results: Array<{
       id: string;
       type: "post" | "reply";
       score: number;
       data: PostData | ReplyData;
     }>;
     error?: string;
   }
   ```

### Track B: Content Creation Integration
**CAN BE IMPLEMENTED IN PARALLEL** with Track A

1. **Update Post Creation** (`backend/routes/posts.ts`)
   - Modify `createPost` handler
   - Generate embedding after post creation
   - Add vector to FAISS index and RTDB storage
   - Handle embedding generation failures gracefully

2. **Update Reply Creation** (`backend/routes/replies.ts`)
   - Modify `createReply` handler
   - Generate embedding after reply creation
   - Add vector to FAISS index and RTDB storage
   - Handle embedding generation failures gracefully

3. **Error Handling Strategy**
   - Post/reply creation should succeed even if embedding fails
   - Log embedding failures for manual retry
   - Implement background retry mechanism (future enhancement)

### Track C: Server Infrastructure
**CAN BE IMPLEMENTED IN PARALLEL** with other tracks

1. **Server Initialization** (`backend/server.ts`)
   - Initialize VectorService on startup
   - Build FAISS index from RTDB during startup
   - Handle startup failures gracefully
   - Add health check for vector search readiness

2. **Graceful Shutdown Implementation**
   - Handle SIGTERM signals
   - Wait for in-flight embedding operations
   - Ensure RTDB writes complete before shutdown
   - Maximum 30-second shutdown timeout

3. **Route Registration**
   - Register `/api/search` routes
   - Add appropriate middleware (auth, rate limiting)
   - Error handling middleware for vector search

## Implementation Details

### Search Endpoint Specifications
- **URL**: `GET /api/search/vector`
- **Query Parameters**: `q` (required string)
- **Response Time Target**: <2 seconds
- **Rate Limiting**: 10 requests/minute per user

### Content Creation Flow
```
1. Create post/reply in RTDB
2. Generate embedding (async, non-blocking)
3. Add to FAISS index (in-memory)
4. Store in RTDB vector storage
5. Return success (even if steps 2-4 fail)
```

### Migration Strategy
1. **Create Migration Script** (`backend/migrate.ts` - rewrite)
   - Read all existing posts and replies
   - Generate embeddings in batches
   - Use sharded storage for vectors
   - Progress logging and resume capability
   - Run via Docker container with proper NODE_OPTIONS

## Files to Create/Modify
- `backend/routes/search.ts` (NEW)
- `backend/routes/posts.ts` (MODIFY - add embedding generation)
- `backend/routes/replies.ts` (MODIFY - add embedding generation) 
- `backend/server.ts` (MODIFY - add VectorService initialization)
- `backend/migrate.ts` (MAJOR REWRITE - add embedding backfill)
- `backend/types/index.ts` (MODIFY - add search response types)

## Testing Requirements
- Unit tests for search endpoint with mock data
- Integration tests for content creation with embeddings
- Load testing for search performance
- Migration script testing with subset of data