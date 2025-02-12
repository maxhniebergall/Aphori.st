# Loading State Simplification Plan

## Current Complexity Issues

### 1. Split Data Structure
- StoryTree and Reply are separate entities
- Different storage patterns (hash storage vs sorted sets)
- Separate APIs for fetching each type
- Different compression/decompression handling
- Separate loading state management for each type

### 2. Multiple Loading Patterns
- Direct StoryTree fetch: `/api/storyTree/:uuid`
- Reply by UUID: `/api/getReply/:uuid`
- Replies by post+quote: `/api/getReplies/:uuid/:quote/:sortingCriteria`
- Global replies feed: `/api/getRepliesFeed`
- Replies by quote across posts: `/api/getReplies/:quote/:sortingCriteria`

### 3. Frontend Complexity
- InfiniteLoader assumes uniform data source
- Managing multiple loading states
- Complex state synchronization
- Separate quote reply count tracking
- Multiple sorting criteria handling

### 4. Current Caching Implementation
- Sibling node caching in useSiblingNavigation
- Loaded indexes tracking in useInfiniteNodes
- Component-level memoization
- Basic state caching in StoryTreeOperator
- No global caching strategy
- No response caching
- Limited cache persistence
- No cache invalidation strategy

## Proposed Solutions

### 1. Unified Data Model ✅
```typescript
// Implemented in:
// - frontend/src/context/types.ts
// - backend/types/index.ts

interface UnifiedNode {
    id: string; // probably a UUID
    type: 'story' | 'reply'; // only "story" is a top-level post, replies always have stories as an ancestor
    content: string; // the text content of the node
    metadata: {
        parentId: string[] | null; // the parent node id of the node
        quote?: Quote; // the quote that the node is replying to, is a subset of the content of the parent node
        author: string; // the author of the node
        createdAt: string; // the timestamp of the node, in epoch time
        title?: string; // the title of the story, if it is a story
    };
}
```

### 2. Simplified Loading Strategy ✅
- Batch loading with initial replies included
- Cursor-based pagination instead of index-based
- Single loading state for the entire tree
- Remove global loading indicators
- Let InfiniteLoader handle progressive loading

### 3. Global Caching Strategy ✅
1. Cache Service:
   ```typescript
   // Implemented in frontend/src/services/CacheService.ts
   interface CacheService {
     get(key: string): UnifiedNode | null;
     set(key: string, value: UnifiedNode): void;
     getMany(keys: string[]): UnifiedNode[];
     clear(): void;
     size(): number;
   }
   ```

2. Cache Levels:
   - Memory Cache (Primary) ✅
     - LRU cache with size limit
     - Persists during session
     - Shared across components
   - Response Cache ✅
     - Cache API responses
     - Decompression results caching
     - Batch request results

3. Cache Keys:
   - Story Trees: `story:${uuid}`
   - Replies: `reply:${uuid}`
   - Batch Results: `batch:${cursor}`
   - Quote Results: `quote:${postId}:${quote}:${cursor}`

4. Cache Optimization:
   - Content is read-only, so no invalidation needed within a session
   - Cache persists only during session
   - Memory-only caching with size limits
   - LRU eviction policy for memory management

### 4. Backend API Changes ✅
1. Unified Node Structure:
   ```typescript
   // Implemented in backend/types/index.ts
   interface UnifiedNode {
     id: string;
     type: 'story' | 'reply';
     content: string;
     metadata: UnifiedNodeMetadata;
   }
   ```

2. Cursor-based Pagination:
   ```typescript
   // Implemented in:
   // - backend/services/pagination.ts
   // - backend/types/index.ts
   interface CursorPagination {
     cursor?: string;
     limit: number;
     direction: 'forward' | 'backward';
   }
   ```

## Implementation Status

### Phase 1: Frontend Type System and Structure Cleanup ✅
- [x] Create and implement UnifiedNode interface
  - [x] Define interface in `frontend/src/context/types.ts`
  - [x] Add proper type validations
  - [x] Fix circular dependencies
  - [x] Update existing interfaces (StoryTreeLevel, Quote)
- [x] Implement CacheService
  - [x] Create CacheService class with LRU cache in `frontend/src/services/CacheService.ts`
  - [x] Add memory cache implementation
  - [x] Add response cache layer
  - [x] Set up cache size limits
  - [x] Add batch caching support

### Phase 2: Backend API Updates (In Progress)
- [x] Create unified node structure
  - [x] Update `backend/types/index.ts`
  - [x] Add migration scripts `backend/migrate.ts`
  - [ ] Update database schema 
    - TODO test + run the database migration script `backend/migrate.ts`
  - [x] Update type definitions
- [ ] Implement combined node endpoint
  - [x] Create new unified endpoint (implemented in `/api/combinedNode/:uuid`)
  - [ ] Add backward compatibility layer
  - [ ] Update compression handling
- [x] Implement cursor-based pagination
  - [x] Create `backend/services/pagination.ts`
  - [x] Add cursor-based pagination types
  - [x] Add sorting support
  - [x] Create tests in `backend/services/__tests__/pagination.test.ts`

### Phase 3: Migration and Testing (Pending)
- [ ] Update frontend components
  - [ ] Update `frontend/src/components/StoryTreeHolder.tsx`
  - [ ] Update `frontend/src/components/StoryTreeLevel.tsx`
  - [ ] Update `frontend/src/components/QuoteRenderer.tsx`
- [ ] Add comprehensive testing
  - [x] Unit tests for pagination service
  - [ ] Integration tests for unified endpoints
  - [ ] Migration tests
  - [ ] Performance benchmarks
- [ ] Update documentation
  - [ ] API documentation
  - [ ] Type system documentation
  - [ ] Migration guides
- [ ] Performance optimization
  - [ ] Cache tuning
  - [ ] Query optimization
  - [ ] Bundle size analysis

## Current Issues Being Addressed
1. TypeScript Errors:
   - [x] Fixed: `UnifiedNode` interface implementation
   - [x] Fixed: Cursor pagination types
   - [ ] Pending: Component type updates
   - [ ] Pending: Migration type safety

2. Loading State Issues:
   - Multiple loading patterns
   - Complex state synchronization
   - Separate quote reply count tracking
   - Multiple sorting criteria handling
   - [x] Implemented cursor-based pagination
   - [x] Implemented global caching strategy
   - [ ] Pending: Component loading state updates
   - [ ] Pending: Loading indicator simplification

3. Caching Issues:
   - [x] Implemented LRU caching
   - [x] Implemented batch caching
   - [x] Implemented memory management
   - [ ] Pending: Cache invalidation testing

## Next Steps
1. Create database migration scripts
2. Implement the database query methods in PaginationService
3. Update frontend components to use UnifiedNode
4. Create API documentation
5. Add integration tests
6. Performance testing and optimization
7. Update combined node endpoint with backward compatibility layer and improved compression handling

## Success Metrics
- Reduced code complexity
- Fewer loading states
- Better user experience
- Simplified state management
- More predictable loading behavior
- Improved performance through caching
- Reduced memory usage
- Faster subsequent loads
- Smoother scrolling experience 