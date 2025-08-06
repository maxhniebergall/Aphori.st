# Reply Deduplication Feature

## Overview
A system to detect and manage duplicate replies using vector similarity matching. When replies are posted, they are checked against existing replies in the vector index. Similar replies (within 0.08 similarity threshold) are grouped as duplicates with special handling, UI, and voting mechanisms.

## Core Components

### 1. DuplicateReply Data Model
- Inherits from Reply base class
- Additional fields:
  - `duplicateGroupId`: UUID linking related duplicates
  - `originalReplyId`: Reference to the first reply in the group
  - `similarityScore`: Cosine similarity to original (0-1)
  - `votes`: Object tracking user votes on which duplicate is better
  - `parentConnections`: Array of parent reply/post IDs for web mapping

### 2. Database Schema Extensions

#### New RTDB Paths
```
/duplicateReplies/$duplicateReplyId
/duplicateGroups/$groupId
  - originalReplyId
  - duplicateIds: []
  - createdAt
  - parentConnections: []
/indexes/duplicatesByGroup/$groupId/$replyId
/userMetadata/$userId/duplicateVotes/$groupId
```

#### Metadata Tracking
- `duplicateCount` in post metadata
- `duplicateGroupCount` global counter
- Parent connection tracking for web visualization

### 3. Vector Similarity Detection System

#### Detection Pipeline
1. New reply generates embedding via Vertex AI
2. FAISS similarity search with 0.08 threshold
3. If matches found:
   - Create duplicate group (if first duplicate)
   - Add to existing group (if group exists)
   - Generate DuplicateReply object
4. Update parent connection web

#### Similarity Threshold
- **0.08**: Primary threshold for duplicate detection
- Configurable via environment variable
- May need tuning based on real-world usage

### 4. Frontend UI & Routing

#### New Routes
- `/dupe/$duplicateGroupId`: Main duplicate comparison view
- `/dupe/$duplicateGroupId/web`: Parent connection visualization
- `/dupe/$duplicateGroupId/vote`: Voting interface

#### UI Components
- **DuplicateComparisonView**: Side-by-side reply comparison
- **DuplicateVotingPanel**: Vote for best duplicate
- **ParentConnectionWeb**: Graph visualization of connected parents
- **DuplicateIndicator**: Badge on original replies showing duplicate count

### 5. Voting & Ranking System *(Future Feature)*

#### Voting Mechanics
- Users can vote for "best" duplicate in each group
- Weighted scoring based on user reputation
- Winner becomes canonical duplicate  
- Losers remain accessible but deprioritized

#### Ranking Algorithm
```typescript
score = (upvotes * userWeight) - (downvotes * userWeight) + (similarityBonus)
```

### 6. Parent Connection Web *(Future Feature)*

#### Connection Mapping
- Track all parent replies/posts of duplicates
- Create network graph of related discussions
- Identify conversation clusters around similar ideas
- Enable discovery of related threads

#### Visualization
- Interactive graph showing:
  - Duplicate groups as nodes
  - Parent connections as edges
  - Thread relationships
  - Conversation clusters

## Implementation Architecture

### Backend Services

#### DuplicateDetectionService
```typescript
class DuplicateDetectionService {
  async checkForDuplicates(reply: Reply): Promise<DuplicateGroup | null>
  async createDuplicateGroup(originalReply: Reply, duplicateReply: Reply): Promise<DuplicateGroup>
  async addToDuplicateGroup(groupId: string, reply: Reply): Promise<void>
}
```

#### DuplicateVotingService *(Future Feature)*
```typescript
class DuplicateVotingService {
  async voteForDuplicate(userId: string, groupId: string, replyId: string): Promise<void>
  async getRankings(groupId: string): Promise<DuplicateRanking[]>
}
```

### Database Operations
- Extend existing DatabaseClientInterface with duplicate-specific methods
- Atomic operations for duplicate group creation
- Efficient querying for similarity searches
- Parent connection indexing

### Vector Integration
- Extend VectorService for duplicate detection
- Batch similarity searches for performance
- Index management for duplicate embeddings
- Similarity threshold configuration

## Technical Considerations

### Performance
- Similarity searches on every reply creation
- FAISS index optimization for duplicate detection
- Caching strategies for frequently accessed duplicates
- Batch processing for large duplicate groups

### Scalability
- Sharded duplicate group storage
- Pagination for large duplicate sets
- Efficient parent connection traversal
- Memory management for connection graphs

### Edge Cases
- Multiple duplicates posted simultaneously
- Users gaming the voting system
- False positive similarity matches
- Deleted original replies in duplicate groups

## Implementation Priority

### Critical Phase (Steps 1-4): Core Duplicate Detection
**Phase 1: Core Infrastructure**
1. Database schema updates
2. DuplicateReply model implementation
3. Basic vector similarity detection

**Phase 2: Detection & Storage**
1. Duplicate detection pipeline
2. Group creation and management
3. Parent connection tracking

**Phase 3: Basic UI**
1. Simple duplicate comparison interface
2. Basic duplicate display on `/dupe/UUID` route

**Phase 4: Integration**
1. Integration with reply creation flow
2. Basic duplicate indicators in main UI

### Future Features (Post-Critical Implementation)

**Phase 5: Advanced UI & Voting**
1. Advanced voting system implementation
2. Parent connection web visualization
3. Enhanced duplicate comparison interface

**Phase 6: Optimization**
1. Performance tuning
2. Advanced ranking algorithms
3. User experience improvements

## Success Metrics
- Reduction in truly duplicate content
- User engagement with duplicate comparison
- Accuracy of similarity detection (manual review)
- Performance impact on reply creation
- Discovery of related conversation clusters

## Future Enhancements
- Machine learning for similarity threshold optimization
- Advanced NLP for semantic duplicate detection
- Cross-thread duplicate detection
- Automated duplicate resolution
- Integration with search and recommendation systems