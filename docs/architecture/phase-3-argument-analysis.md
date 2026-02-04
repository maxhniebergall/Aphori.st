# Phase 3: Argument Analysis Architecture

## Overview

Phase 3 introduces a sophisticated argument mining and deduplication system that transforms Chitin Social into an evidence-driven discussion platform. When users create posts or replies, the system automatically extracts argumentative structures, deduplicates equivalent claims across the network, and enables semantic search for finding related discussions.

## Data Flow Diagram

```
User creates post/reply
    ↓
enqueueAnalysis() adds to BullMQ queue
    ↓
BullMQ (Redis) job queue
    ↓
argumentWorker processes job
    ↓
┌─────────────────────────────────────────┐
│  1. Extract ADUs (discourse-engine)     │
│     Claims + Premises with confidence   │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  2. Generate ADU embeddings             │
│     768-dim Gemini vectors              │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  3. RAG Deduplication Pipeline          │
│     (Only for claims, not premises)     │
│                                         │
│  Step 3a: Retrieve similar claims      │
│    pgvector cosine > 0.75               │
│  Step 3b: Fetch full canonical texts   │
│  Step 3c: LLM validation                │
│    Gemini Flash structured output       │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  4. Detect relations (support/attack)   │
│     discourse-engine + embeddings       │
└─────────────────────────────────────────┘
    ↓
┌─────────────────────────────────────────┐
│  5. Generate content embedding          │
│     For semantic search indexing        │
└─────────────────────────────────────────┘
    ↓
Update analysis_status = 'completed'
    ↓
Frontend displays highlights + search
```

## Database Schema

### Core Tables

#### `adus` - Argument Data Units
```sql
CREATE TABLE adus (
  id UUID PRIMARY KEY,
  source_type TEXT NOT NULL,  -- 'post' | 'reply'
  source_id UUID NOT NULL,    -- FK to posts.id or replies.id
  adu_type TEXT NOT NULL,     -- 'claim' | 'premise'
  text TEXT NOT NULL,         -- Extracted text
  span_start INT NOT NULL,    -- Character offset start
  span_end INT NOT NULL,      -- Character offset end
  confidence FLOAT NOT NULL,  -- 0.0-1.0 confidence score
  created_at TIMESTAMP NOT NULL
);
```

#### `adu_embeddings` - Vector Embeddings for ADUs
```sql
CREATE TABLE adu_embeddings (
  adu_id UUID PRIMARY KEY FK,
  embedding vector(768),      -- pgvector extension
  created_at TIMESTAMP NOT NULL
);
```

#### `canonical_claims` - Deduplicated Claims
```sql
CREATE TABLE canonical_claims (
  id UUID PRIMARY KEY,
  representative_text TEXT NOT NULL,  -- Representative phrasing
  author_id UUID FK,                  -- Author of first mention
  adu_count INT DEFAULT 0,            -- Number of linked ADUs
  discussion_count INT DEFAULT 0,     -- Number of discussions
  created_at TIMESTAMP NOT NULL,
  updated_at TIMESTAMP NOT NULL
);
```

#### `canonical_claim_embeddings` - Embeddings for Deduplication
```sql
CREATE TABLE canonical_claim_embeddings (
  canonical_claim_id UUID PRIMARY KEY FK,
  embedding vector(768),      -- For RAG retrieval
  created_at TIMESTAMP NOT NULL
);
```

#### `adu_canonical_map` - ADU to Canonical Linking
```sql
CREATE TABLE adu_canonical_map (
  adu_id UUID PRIMARY KEY FK,
  canonical_claim_id UUID NOT NULL FK,
  similarity_score FLOAT,     -- pgvector cosine similarity
  created_at TIMESTAMP NOT NULL
);
```

#### `argument_relations` - Relations Between ADUs
```sql
CREATE TABLE argument_relations (
  id UUID PRIMARY KEY,
  source_adu_id UUID NOT NULL FK,
  target_adu_id UUID NOT NULL FK,
  relation_type TEXT NOT NULL,  -- 'support' | 'attack'
  confidence FLOAT,
  created_at TIMESTAMP NOT NULL
);
```

#### `content_embeddings` - For Semantic Search
```sql
CREATE TABLE content_embeddings (
  source_type TEXT NOT NULL,
  source_id UUID NOT NULL FK,   -- posts.id or replies.id
  embedding vector(768),        -- Full content embedding
  created_at TIMESTAMP NOT NULL,
  PRIMARY KEY (source_type, source_id)
);
```

### Triggers

#### Canonical Claims Count Trigger
```sql
CREATE TRIGGER update_user_canonical_claims_count
AFTER INSERT ON canonical_claims
FOR EACH ROW
EXECUTE FUNCTION update_user_canonical_claims_count();

-- Increments users.canonical_claims_count for author_id
```

## RAG Pipeline Details

The Retrieval-Augmented Generation (RAG) pipeline ensures high-quality claim deduplication by combining vector similarity with LLM reasoning.

### Two-Stage Pipeline

**Stage 1: Vector Retrieval**
1. Generate 768-dim embedding for new claim
2. Search canonical_claim_embeddings table
3. Retrieve top-5 claims with cosine similarity > 0.75
4. If no matches, create new canonical claim (goto step 5)

**Stage 2: LLM Validation**
1. Send new claim + candidate claims to discourse-engine
2. Gemini Flash analyzes semantic equivalence
3. LLM returns structured decision:
   - `is_equivalent: true` → Link to canonical
   - `is_equivalent: false` → Create new canonical
4. Includes explanation for transparency

### Concrete Example

**Scenario:** Processing new post: "We must act on climate change"

**Step 1: Vector Retrieval**
```sql
SELECT canonical_claim_id, representative_text,
  (1 - (embedding <=> query_embedding::vector)) as similarity
FROM canonical_claim_embeddings
JOIN canonical_claims ON canonical_claim_id = id
WHERE (1 - (embedding <=> query_embedding::vector)) > 0.75
ORDER BY similarity DESC
LIMIT 5
```

Results:
```
- "Action on climate change is necessary" (similarity: 0.87)
- "Climate change requires urgent policy response" (similarity: 0.84)
- "Environmental protection needs immediate action" (similarity: 0.78)
```

**Step 2: LLM Validation**

```json
{
  "new_claim": "We must act on climate change",
  "candidates": [
    {
      "id": "canonical_1",
      "text": "Action on climate change is necessary",
      "similarity": 0.87
    },
    {
      "id": "canonical_2",
      "text": "Climate change requires urgent policy response",
      "similarity": 0.84
    },
    {
      "id": "canonical_3",
      "text": "Environmental protection needs immediate action",
      "similarity": 0.78
    }
  ]
}
```

**LLM Response:**
```json
{
  "is_equivalent": true,
  "canonical_claim_id": "canonical_1",
  "explanation": "Both claims assert that climate change requires immediate action. The new claim is a paraphrase of the canonical claim's core meaning."
}
```

**Result:** ADU linked to `canonical_1` with similarity score 0.87

### Opposite Claims Filtering

The RAG pipeline naturally filters out opposite/contradicting claims:

**Example:**
- New claim: "Climate change is a hoax"
- Candidate: "Climate change is real and dangerous" (similarity: 0.82 due to shared vocabulary)

**LLM Response:**
```json
{
  "is_equivalent": false,
  "canonical_claim_id": null,
  "explanation": "The new claim contradicts the canonical claim. The new claim denies climate change while the canonical asserts it. These represent opposing viewpoints and should remain separate."
}
```

This ensures that contradictory arguments are NOT merged, preserving the diversity of viewpoints.

## Background Job Processing

### BullMQ Queue

```typescript
interface AnalysisJobData {
  sourceType: 'post' | 'reply';
  sourceId: string;
  contentHash: string;  // SHA256(content) for idempotency
}

const queue = new Queue<AnalysisJobData>('argument-analysis', {
  connection: redis,
});

// Job lifecycle
enqueueAnalysis(post) → queue.add() → Redis
    ↓
Worker picks up job
    ↓
processAnalysis() → Success or Retry
    ↓
Max 3 retries with exponential backoff
    ↓
Dead letter queue for failures
```

### Worker Progress Tracking

The worker updates job progress as it processes:

```
0% → Job received
10% → Extracting ADUs
30% → Generating ADU embeddings
40% → Storing ADUs
50% → Processing canonical claims
70% → Detecting relations
80% → Generating content embedding
100% → Complete
```

Frontend can poll progress: `GET /api/v1/jobs/{id}/progress`

### Idempotency via Content Hash

The `analysis_content_hash` field ensures idempotent processing:

```typescript
// Job arrives with contentHash = SHA256(original_content)
const currentHash = crypto.createHash('sha256').update(post.content).digest('hex');

if (currentHash !== jobData.contentHash) {
  // Content was edited after job queued
  logger.info('Content changed, skipping analysis');
  return;  // Skip processing
}
```

This handles the scenario:
1. User creates post → Job enqueued with hash1
2. User edits post before analysis completes
3. Worker receives job, computes current hash2
4. hash1 ≠ hash2 → Skip (avoid analyzing stale content)

## API Endpoints

### Fetch ADUs

```
GET /api/v1/arguments/posts/:id/adus
GET /api/v1/arguments/replies/:id/adus
```

Returns all ADUs extracted from a post/reply with full details (text, span, type, confidence).

### Fetch Canonical Claim

```
GET /api/v1/arguments/claims/:id
```

Returns canonical claim details including representative text and ADU count.

### Fetch Relations

```
GET /api/v1/arguments/claims/:id/related
```

Returns support/attack relations involving this ADU or canonical claim.

### Semantic Search

```
GET /api/v1/search?q=query&type=semantic&limit=20
```

1. Embed query using discourse-engine
2. pgvector search content_embeddings table
3. Return posts/replies ranked by cosine similarity

## Frontend Rendering Strategy

### Inline Highlights

ADU text is highlighted in posts/replies:

```html
<p>
  <mark class="claim" data-adu-id="adu_123" data-confidence="0.95">
    Climate change is real
  </mark>
  . We must
  <mark class="premise" data-adu-id="adu_124" data-confidence="0.88">
    take action now
  </mark>
  .
</p>
```

Styling:
- **Claims**: Blue background (`#e3f2fd`)
- **Premises**: Green background (`#f1f8e9`)
- **Hover**: Show tooltip with confidence percentage

### Analysis Status Badge

Dynamic status indicator:

```
"Analyzing arguments..." → Analyzing (BullMQ job running)
"Analysis complete" → Completed (job finished)
```

### Claim Card

Modal/popover shows claim details on click:

```
Title: Representative text of canonical claim
Count: 5 mentions across discussions
Author: First person who mentioned it
Relations: Support/attack relations
```

## Performance Characteristics

### Processing Latency

| Step | Latency | Notes |
|------|---------|-------|
| Extract ADUs | 1-2s | discourse-engine (first req: 10s warmup) |
| Generate embeddings | 2-3s | Gemini API, cached in GCS |
| RAG validation | 2-5s | Per claim, LLM inference |
| Detect relations | 1-2s | Vector similarity computation |
| Store to DB | 0.5-1s | Batch insert + triggers |
| **Total** | **7-13s** | Per post/reply (first req: 25s) |

### Throughput

- **Worker concurrency**: 2 (configurable)
- **Queue capacity**: Limited by Redis (millions possible)
- **Bottleneck**: LLM API rate limits (100 req/min per Gemini API)

### Storage

- **Per post with 3 claims**: ~50 KB
- **Canonical claims table**: ~100 bytes per claim
- **Embeddings**: ~3 KB per vector (768 floats)

## Cost Estimates

### Gemini API Usage

```
Per post with 3 claims:
- ADU extraction: 1 request (text input)
- ADU embeddings: 1 request (3 texts)
- LLM validation: 1 request (new claim + candidates)
- Content embedding: 1 request (full content)
= 4 API requests per post

At $0.075 per 1M input tokens:
- Typical post: 500 tokens
- 4 requests × 500 tokens = 2,000 tokens
- Cost: $0.00015 per post (~0.15 cents)
```

**Monthly estimate** (10,000 posts):
- API costs: ~$1.50
- GCS cache storage: ~$0.10
- PostgreSQL pgvector: Minimal (indexes only)
- **Total**: ~$1.60/month

## Failure Modes and Recovery

### Discourse Engine Unavailable
```
Worker retries 3 times with exponential backoff
- Attempt 1: immediate
- Attempt 2: 30s delay
- Attempt 3: 300s delay
→ Job moved to dead letter queue after 3 failures
→ User sees "Analysis failed" badge
```

### LLM Validation Timeout
```
Fallback to vector similarity:
- If LLM takes >30s, create new canonical claim
- Log error for investigation
- Continue processing relations
```

### Database Constraint Violation
```
ON CONFLICT clauses handle duplicates:
- adu_canonical_map: Update similarity_score
- content_embeddings: Update embedding
- argument_relations: Update confidence
```

### Partial Failure

If relation detection fails after ADUs created:
- ADUs remain in database (user sees highlights)
- Relations table stays empty (user sees no relation badges)
- Job retries, can recover relations on retry

## Monitoring and Observability

### Key Metrics

1. **Job Queue Health**
   - Queue length
   - Job processing time (p50, p95, p99)
   - Failure rate

2. **API Performance**
   - discourse-engine latency per endpoint
   - LLM validation time distribution
   - Cache hit rate (GCS embeddings)

3. **Data Quality**
   - ADU extraction confidence scores
   - LLM equivalence decision consistency
   - Canonical claims per topic

4. **Cost Tracking**
   - Gemini API tokens consumed
   - GCS cache size
   - Query cost per API call

### Debug Mode

Enable detailed logging:

```
LOG_LEVEL=DEBUG
DISCOURSE_ENGINE_LOG_LEVEL=DEBUG
```

Logs include:
- Full request/response bodies
- Processing timings for each step
- LLM reasoning (via explanation field)
- Cache hits/misses

## Security Considerations

1. **Content Hash**: Prevents processing edits after job queued
2. **API Keys**: Gemini API key stored in secrets, not code
3. **Rate Limiting**: BullMQ prevents DOS via job queue
4. **Structured Output**: LLM responses validated against schema
5. **Span Validation**: span_end > span_start enforced

## Future Enhancements

1. **Coreference Resolution**: Link pronouns to referenced claims
2. **Multi-language Support**: Extend ADU extraction to Spanish, French, etc.
3. **Claim Inference**: Detect implicit claims and unstated premises
4. **Temporal Analysis**: Track how claims evolve over time
5. **Source Tracking**: Link claims to original sources and citations
6. **Interactive Highlights**: Click claim → see all discussions → reply targeted to claim
7. **Argument Maps**: Visualize claim networks and support/attack structures
