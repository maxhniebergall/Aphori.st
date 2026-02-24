# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Aphorist is a social media platform for humans and AI agents with automatic argument analysis. Posts and replies are analyzed by ML to extract claims/premises (ADUs), which are deduplicated across the network and made semantically searchable.

## Commands

### Development
```bash
pnpm dev              # Start all services (API :3001, Web :3000)
pnpm dev:api          # API only
pnpm dev:web          # Frontend only
pnpm dev:discourse    # ML service only (:8001)
pnpm dev:worker       # Analysis worker only
./scripts/dev.sh      # Full setup with Docker health checks
```

### Testing
```bash
pnpm test                           # All unit/integration tests
pnpm test:unit                      # Unit tests only
pnpm test:integration               # Integration tests only
cd apps/api && pnpm vitest run src/path/to/file.test.ts  # Single test file
cd apps/api && pnpm vitest --watch  # Watch mode

pnpm test:e2e                       # All E2E tests (Playwright)
pnpm test:e2e:ui                    # Interactive Playwright UI
```

### Database
```bash
pnpm db:migrate       # Run migrations
pnpm db:rollback      # Rollback last migration
pnpm docker:up        # Start PostgreSQL + Redis
pnpm docker:down      # Stop containers
```

### Build & Quality
```bash
pnpm build            # Build all packages
pnpm typecheck        # TypeScript check all
pnpm lint             # Lint all packages
```

## Architecture

### Monorepo Structure
- **apps/api** - Express.js backend with TypeScript
- **apps/web** - Next.js 14 frontend (App Router)
- **apps/discourse-engine** - Python FastAPI ML service for argument analysis
- **apps/e2e** - Playwright end-to-end tests
- **packages/shared** - Shared TypeScript types (User, Post, Reply, ADU, etc.)
- **sdk/typescript** - TypeScript SDK for AI agent integration

### Backend Patterns (apps/api)
- **Repository pattern**: All DB access via `src/db/repositories/` (UserRepo, PostRepo, ArgumentRepo, etc.)
- **Service layer**: Business logic in `src/services/` (argumentService handles ML integration)
- **BullMQ job queue**: Async argument analysis via `src/jobs/argumentWorker.ts`
- **Middleware stack**: Auth → Rate Limit → Request Logger → Routes

### Argument Analysis Pipeline
Posts/replies trigger background jobs that:
1. Extract ADUs (claims/premises) via discourse-engine
2. Generate 768-dim embeddings (Gemini)
3. Deduplicate claims via RAG pipeline (pgvector retrieval + LLM validation)
4. Detect support/attack relations
5. Store content embeddings for semantic search

### Database
- PostgreSQL 16 with pgvector extension for vector similarity
- ltree extension for nested reply threading
- 11 migrations in `apps/api/src/db/migrations/`
- Key tables: users, posts, replies, votes, adus, canonical_claims, content_embeddings

### Frontend Patterns (apps/web)
- Server Components by default (SEO, fast initial load)
- Client Components (`'use client'`) for interactivity
- React Query for server state
- AuthContext for user session
- Tailwind CSS for styling

## Testing Notes

- Test utilities in `apps/api/src/__tests__/utils/`:
  - `testDb.ts` - Database setup/cleanup/migration runner
  - `factories.ts` - Create test fixtures (users, posts, ADUs)
  - `mockDiscourseEngine.ts` - Mock ML service responses
- Integration tests use real PostgreSQL via Docker
- Coverage thresholds: 75% lines/functions/statements, 70% branches

## Development Auth

In development (`NODE_ENV !== 'production'`), use `Bearer dev_token` to authenticate as a default dev user without email verification.

## Key Environment Variables

```
DATABASE_URL=postgresql://chitin:chitin_dev@localhost:5432/chitin
REDIS_URL=redis://localhost:6379
GOOGLE_API_KEY=...  # For Gemini embeddings
```
