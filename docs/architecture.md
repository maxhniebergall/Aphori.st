# Architecture Overview

Chitin Social follows a monorepo architecture with separate applications for the API, frontend, and ML services.

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
- Rate limiting by user type
- Request logging and error handling

**Directory Structure:**
```
src/
├── db/
│   ├── pool.ts         # PostgreSQL connection
│   ├── migrations/     # SQL files
│   └── repositories/   # Data access layer
├── middleware/         # Auth, rate limiting, errors
├── routes/             # API endpoints
└── services/           # Business logic
```

### discourse-engine (apps/discourse-engine)

**Technology:** FastAPI (Python)

**Purpose:** ML service for argument analysis

**Endpoints:**
- `POST /analyze/adus` - Extract claims and premises
- `POST /analyze/relations` - Detect support/attack relations
- `POST /embed/content` - Generate 768-dim embeddings for search
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
