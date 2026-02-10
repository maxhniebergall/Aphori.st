# Architecture Overview

Aphorist follows a monorepo architecture with separate applications for the API, frontend, and ML services.

## System Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (Next.js 14)                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Server      │  │ Client      │  │ React Query │              │
│  │ Components  │  │ Components  │  │ Cache       │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
└─────────┼────────────────┼────────────────┼─────────────────────┘
          │                │                │
          ▼                ▼                ▼
┌─────────────────────────────────────────────────────────────────┐
│                        API (Express.js)                          │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐              │
│  │ Auth        │  │ Routes      │  │ Middleware  │              │
│  │ Middleware  │  │             │  │ Rate Limit  │              │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘              │
│         │                │                │                      │
│         ▼                ▼                ▼                      │
│  ┌─────────────────────────────────────────────────┐            │
│  │              Repositories                        │            │
│  │  UserRepo │ PostRepo │ ReplyRepo │ VoteRepo     │            │
│  │  ArgumentRepo                                    │            │
│  └──────────────────────┬──────────────────────────┘            │
└─────────────────────────┼───────────────────────────────────────┘
                          │
          ┌───────────────┼───────────────┐
          ▼               ▼               ▼
   ┌────────────┐  ┌────────────┐  ┌────────────┐
   │ PostgreSQL │  │   Redis    │  │ discourse- │
   │ + pgvector │  │  (BullMQ)  │  │  engine    │
   └────────────┘  └────────────┘  └────────────┘
```

## Components

### Frontend (apps/web)

**Technology:** Next.js 14 with App Router

**Key Features:**
- Server Components for initial data fetching (SEO, fast initial load)
- Client Components for interactivity (voting, forms)
- React Query for server state management
- Tailwind CSS for styling

**Directory Structure:**
```
src/
├── app/           # App Router pages (server components by default)
├── components/    # Reusable UI components
├── contexts/      # React contexts (AuthContext)
├── hooks/         # Custom React hooks
└── lib/           # API client, utilities
```

### API (apps/api)

**Technology:** Express.js with TypeScript

**Key Features:**
- Repository pattern for data access
- JWT authentication with magic links
- Rate limiting by user type and action
- BullMQ job queue for async argument analysis
- Request logging and error handling

**Directory Structure:**
```
src/
├── db/
│   ├── pool.ts         # PostgreSQL connection
│   ├── migrations/     # SQL files
│   └── repositories/   # Data access layer (UserRepo, PostRepo, ArgumentRepo, etc.)
├── jobs/
│   ├── queue.ts        # BullMQ queue configuration
│   ├── argumentWorker.ts  # Background analysis worker
│   └── enqueueAnalysis.ts # Job enqueue helper
├── middleware/         # Auth, rate limiting, errors
├── routes/             # API endpoints
└── services/
    └── argumentService.ts  # discourse-engine client + Gemini integration
```

### discourse-engine (apps/discourse-engine)

**Technology:** FastAPI (Python)

**Purpose:** ML service for argument analysis — extracts ADUs from text, detects argument relations, and generates embeddings via Gemini.

**Endpoints:**
- `POST /analyze/adus` - Extract ADUs with V2 ontology (MajorClaim, Supporting, Opposing, Evidence) and hierarchical targeting
- `POST /analyze/relations` - Detect support/attack relations between ADUs
- `POST /embed/content` - Generate 1536-dim Gemini embeddings for semantic search and deduplication
- `POST /validate/claim-equivalence` - LLM-powered semantic equivalence check for RAG dedup
- `GET /health` - Health check with model status

## Data Flow

### Creating a Post

```
1. User submits post via frontend
2. Frontend calls POST /api/v1/posts
3. API validates input, creates post in PostgreSQL
4. API returns post immediately (analysis_status: 'pending')
5. API enqueues BullMQ job for analysis
6. Worker calls discourse-engine for ADU extraction
7. Worker stores ADUs and embeddings
8. Worker updates analysis_status to 'completed'
9. Frontend polls or receives update, shows highlights
```

### Authentication Flow

```
1. User enters email
2. Frontend calls POST /api/v1/auth/send-magic-link
3. API generates JWT, sends email with magic link
4. User clicks link, frontend calls POST /api/v1/auth/verify-magic-link
5. API verifies token, returns auth JWT
6. Frontend stores JWT in localStorage
7. Subsequent requests include Bearer token
```

### Voting

```
1. User clicks upvote/downvote
2. Frontend optimistically updates UI
3. Frontend calls POST /api/v1/votes
4. API upserts vote, trigger updates score
5. If error, frontend reverts optimistic update
```

## Argument Analysis Pipeline

When a post or reply is created, a BullMQ job is enqueued for background analysis. The `argumentWorker` processes each job through these stages:

```
1. Fetch content from database
2. Verify content hash (skip if content was edited after enqueue)
3. Extract ADUs via discourse-engine (MajorClaim/Supporting/Opposing/Evidence)
4. Generate 1536-dim embeddings for each ADU (Gemini)
5. Store ADUs with hierarchy (target_adu_id links)
6. RAG deduplication for each claim:
   a. pgvector retrieval: find canonical claims with cosine > 0.75
   b. LLM validation: Gemini Flash confirms semantic equivalence
   c. Link to existing canonical or create new one
7. Generate content embedding for semantic search
8. Update analysis_status to 'completed'
```

**Worker configuration:** Concurrency of 2, exponential backoff retry (1s, 2s, 4s, 8s, 16s) across 5 attempts. Failed jobs update `analysis_status` to `'failed'`.

**Idempotency:** Each job carries a SHA-256 content hash. If the content was edited between enqueue and processing, the worker skips the stale job.

## Database Design

See [Database Schema](./database-schema.md) for detailed table definitions.

**Key Design Decisions:**

1. **UUID Primary Keys** - Generated in application, not auto-increment
2. **ltree for Replies** - Materialized path for efficient tree queries
3. **pgvector for Search** - Vector similarity search without external service
4. **Triggers for Scores** - Automatic score updates on vote changes

## Scalability Considerations

**Current (POC):**
- Single Express instance
- In-memory rate limiting
- Single PostgreSQL instance

**Future Scaling:**
- Multiple API instances behind load balancer
- Redis-backed rate limiting
- Read replicas for PostgreSQL
- Connection pooling with PgBouncer
- CDN for static assets

## Security

- JWT tokens with configurable expiry
- Magic link tokens with 15-minute expiry
- Rate limiting by user type and action
- Input validation with Zod
- SQL injection prevention via parameterized queries
- Helmet middleware for security headers (Phase 5)
