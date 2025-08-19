# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Development Commands

### Docker Development Environment
```bash
# Main development build (from root directory)
docker-compose up --build

# Rebuild and restart backend only
docker compose build backend && docker compose up -d backend

# Start Firebase emulator for local database
firebase emulators:start --only database
```

### Testing
```bash
# Run all backend tests
cd backend && NODE_OPTIONS=--experimental-vm-modules yarn jest

# Run backend tests with watch mode
cd backend && NODE_OPTIONS=--experimental-vm-modules yarn jest --watch

# Run frontend tests
cd frontend && yarn test

# Run single backend test file
cd backend && NODE_OPTIONS=--experimental-vm-modules yarn jest __tests__/specific.test.ts
```

### Backend Development
```bash
# Lint backend code
cd backend && yarn lint

# Fix backend linting issues
cd backend && yarn lint:fix

# Type check backend
cd backend && tsc --noEmit

# Run TypeScript scripts in backend container (required pattern)
docker exec aphorist-backend-1 sh -c 'cd /app && NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node script.ts'

# Example: Run migration
docker exec aphorist-backend-1 sh -c 'cd /app && NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node migrate.ts'
```

### Frontend Development
```bash
# Build frontend with type checking
cd frontend && yarn build

# Type check frontend
cd frontend && yarn typecheck

# Lint frontend code
cd frontend && yarn lint

# Fix frontend linting issues
cd frontend && yarn lint:fix
```

### Production
```bash
# Build and run production services
docker-compose -f docker-compose.prod.yml build
docker-compose -f docker-compose.prod.yml up -d

# View production logs
docker-compose -f docker-compose.prod.yml logs -f

# Seed database in development
curl -X POST http://localhost:3000/api/seed-default-stories -H "Content-Type: application/json" -d '{}'
```

## Architecture Overview

This is a full-stack web application for Aphorists - a platform for threaded discussions with quoted text replies.

### Core Technologies
- **Backend**: Node.js/TypeScript with Express
- **Frontend**: React/TypeScript with Create React App
- **Database**: Firebase Realtime Database (RTDB)
- **Vector Search**: FAISS with Google Vertex AI embeddings
- **Containerization**: Docker with docker-compose
- **Authentication**: Magic link email authentication

### Key Architectural Patterns

#### Database Design (Firebase RTDB)
The data model uses a flat, denormalized structure optimized for RTDB:
- **Direct UUID keys**: Posts and replies use condensed UUIDs as direct keys (`/posts/$postId`, `/replies/$replyId`)
- **Index nodes**: Sorted queries use dedicated index paths (`/indexes/repliesFeedByTimestamp`) to emulate Redis Z-sets
- **Metadata tracking**: Separate nodes for counts and relationships (`/userMetadata`, `/postMetadata`, `/replyMetadata`)
- **Atomic counters**: Reply counts and quote counts updated via Firebase Transactions

#### Database Abstraction Layer
- `DatabaseClientInterface`: Abstract interface for database operations
- `FirebaseClient`: Maps Redis-like commands (`hSet`, `zAdd`, etc.) to RTDB operations
- `LoggedDatabaseClient`: Wraps database client with logging

#### Vector Search System
- In-memory FAISS index for semantic search
- Sharded storage in RTDB for scalability (`/vectorIndexStore/$shardId`)
- Vertex AI integration for embedding generation
- Automatic indexing of posts and replies on creation

#### Reply Threading Model
- **Direct parent tracking**: Each reply references its immediate parent (`parentId`, `parentType`)
- **Root post reference**: All replies maintain reference to thread root (`rootPostId`)
- **Quote-based replies**: Every reply must quote specific text with selection range
- **Engagement sorting**: Frontend calculates engagement scores from quote reply counts

#### Key Backend Services
- **VectorService**: Manages FAISS index, embedding generation, and vector search
- **Route handlers**: Modular Express routes for auth, posts, replies, feed, search
- **Middleware**: Authentication, rate limiting, request logging

#### Frontend Architecture
- **Context-based state**: User context, post tree context, reply context
- **Virtualized lists**: React Virtuoso for performance with large datasets
- **Text selection system**: Custom hooks for quote selection and highlighting
- **Operator pattern**: Business logic separated into operator classes (PostTreeOperator, SearchOperator, etc.)

### Important Development Notes

#### Backend Container Execution
When running TypeScript scripts in the backend container, always use this pattern:
```bash
docker exec aphorist-backend-1 sh -c 'cd /app && NODE_OPTIONS="--loader ts-node/esm --experimental-specifier-resolution=node" node script.ts'
```

#### Package Management
Use Yarn for all package management operations. The project uses ES modules (`"type": "module"` in package.json).

#### Firebase Emulator
Local development requires the Firebase emulator running on localhost:9000 for database operations.

#### Vector Search
The vector search system requires GCP credentials and Vertex AI access. It maintains an in-memory FAISS index that rebuilds on server restart from RTDB data.
- all data files (including json, csv, small files, etc.) should be committed with dvc. no data files should be committed to git regardless of their size.