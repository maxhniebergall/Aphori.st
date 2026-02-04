# Phase 3 Setup and Deployment Guide

This guide walks through setting up the Phase 3 Argument Analysis system for local development and production deployment.

## Table of Contents

- [Prerequisites](#prerequisites)
- [Environment Configuration](#environment-configuration)
- [Database Setup](#database-setup)
- [Service Startup](#service-startup)
- [Health Check Verification](#health-check-verification)
- [End-to-End Pipeline Testing](#end-to-end-pipeline-testing)
- [Troubleshooting](#troubleshooting)

## Prerequisites

### System Requirements

- Node.js 18+ (for API)
- Python 3.11+ (for discourse-engine)
- PostgreSQL 16+ with pgvector extension
- Redis 7+ (for BullMQ job queue)
- Docker (optional, for containerized deployment)
- Google Cloud credentials (for Gemini API)

### Installation

#### macOS

```bash
# Install Node.js
brew install node

# Install Python
brew install python@3.11

# Install PostgreSQL with pgvector
brew install postgresql@16
brew install postgresql-16-pgvector

# Install Redis
brew install redis

# Install Docker (optional)
brew install docker
```

#### Ubuntu/Debian

```bash
# Install Node.js
curl -fsSL https://deb.nodesource.com/setup_18.x | sudo -E bash -
sudo apt-get install -y nodejs

# Install Python
sudo apt-get install -y python3.11 python3.11-venv

# Install PostgreSQL with pgvector
sudo apt-get install -y postgresql postgresql-contrib
sudo apt-get install -y postgresql-16-pgvector

# Install Redis
sudo apt-get install -y redis-server

# Install Docker (optional)
curl -fsSL https://get.docker.com -o get-docker.sh
sudo sh get-docker.sh
```

#### Windows

Use [WSL2](https://docs.microsoft.com/en-us/windows/wsl/install) with Ubuntu setup above, or:

```powershell
# Install via Chocolatey
choco install nodejs
choco install python
choco install postgresql
choco install redis-64
```

## Environment Configuration

### 1. Google Cloud Setup

Create a Google Cloud project and enable Gemini API:

```bash
# Create project
gcloud projects create chitin-social-phase3

# Enable Generative AI API
gcloud services enable generativelanguage.googleapis.com

# Create service account
gcloud iam service-accounts create chitin-api \
  --display-name="Chitin Social API"

# Create and download key
gcloud iam service-accounts keys create chitin-key.json \
  --iam-account=chitin-api@chitin-social-phase3.iam.gserviceaccount.com

# Set environment variable
export GOOGLE_API_KEY=$(cat chitin-key.json | jq -r '.private_key' | head -1)
```

For local development, you can also use an API key from the Google Cloud Console.

### 2. API Environment Variables

Create `.env` file in `apps/api/`:

```bash
# Database
DB_HOST=localhost
DB_PORT=5432
DB_USER=postgres
DB_PASSWORD=postgres
DB_NAME=chitin

# Redis (for BullMQ)
REDIS_URL=redis://localhost:6379

# Google Cloud
GOOGLE_API_KEY=your_api_key_here

# Discourse Engine
DISCOURSE_ENGINE_URL=http://localhost:8000

# Environment
NODE_ENV=development
LOG_LEVEL=info
```

### 3. Discourse Engine Environment Variables

Create `.env` file in `discourse-engine/chitin_wrapper/`:

```bash
# Google Cloud
GOOGLE_API_KEY=your_api_key_here

# Service Config
DISCOURSE_ENGINE_PORT=8000
DISCOURSE_ENGINE_HOST=0.0.0.0

# Caching
GCS_CACHE_BUCKET=chitin-embedding-cache
MODEL_CACHE_DIR=./models

# Logging
LOG_LEVEL=info
```

### 4. Web App Environment Variables

Create `.env.local` file in `apps/web/`:

```bash
NEXT_PUBLIC_API_URL=http://localhost:3001
NEXT_PUBLIC_WEB_URL=http://localhost:3000
```

## Database Setup

### 1. Start PostgreSQL

```bash
# macOS
brew services start postgresql@16

# Ubuntu/Debian
sudo systemctl start postgresql

# Verify running
psql --version
```

### 2. Create Database and User

```bash
# Connect to PostgreSQL
psql postgres

# Create database
CREATE DATABASE chitin;

# Create user
CREATE USER chitin_user WITH PASSWORD 'secure_password';

# Grant privileges
GRANT ALL PRIVILEGES ON DATABASE chitin TO chitin_user;
ALTER DATABASE chitin OWNER TO chitin_user;

# Exit psql
\q
```

### 3. Enable pgvector Extension

```bash
# Connect as chitin user
psql -U chitin_user -d chitin

# Enable pgvector
CREATE EXTENSION IF NOT EXISTS vector;

# Verify
\dx  -- Should show 'vector' extension

# Exit
\q
```

### 4. Run Migrations

```bash
cd apps/api

# Install dependencies
pnpm install

# Run migrations
pnpm run db:migrate
```

Verify tables were created:

```bash
psql -U chitin_user -d chitin -c "\dt"

# Should show:
# adus
# adu_embeddings
# canonical_claims
# canonical_claim_embeddings
# adu_canonical_map
# argument_relations
# content_embeddings
# posts
# replies
# users
# votes
# etc.
```

Verify pgvector indexes:

```bash
psql -U chitin_user -d chitin -c "\di"

# Should show:
# adu_embeddings_embedding_idx
# canonical_claim_embeddings_embedding_idx
# content_embeddings_embedding_idx
```

### 5. Start Redis

```bash
# Start Redis server
redis-server

# Verify in another terminal
redis-cli ping  # Should respond: PONG
```

## Service Startup

### 1. Start Database and Cache

```bash
# Terminal 1: PostgreSQL
brew services start postgresql@16

# Terminal 2: Redis
redis-server

# Verify both running
psql -U postgres -c "SELECT version();"
redis-cli ping
```

### 2. Start Discourse Engine

```bash
cd discourse-engine/chitin_wrapper

# Create Python environment
python3.11 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# Install dependencies
pip install -r requirements.txt

# Start service
python -m uvicorn main:app --reload --port 8000
```

Output should show:
```
Uvicorn running on http://127.0.0.1:8000
```

### 3. Start API Server

```bash
cd apps/api

# Install dependencies (if not already done)
pnpm install

# Start development server
pnpm run dev
```

Output should show:
```
Server running on http://localhost:3001
```

### 4. Start Web App

```bash
cd apps/web

# Install dependencies (if not already done)
pnpm install

# Start development server
pnpm run dev
```

Output should show:
```
Ready on http://localhost:3000
```

## Health Check Verification

### 1. Discourse Engine Health

```bash
curl http://localhost:8000/health
```

Expected response:
```json
{
  "status": "ok",
  "models_loaded": true
}
```

If `models_loaded: false`, wait 10-30 seconds for models to load, then retry.

### 2. API Server Health

```bash
curl http://localhost:3001/health
```

Expected response:
```json
{
  "status": "ok",
  "database": "connected",
  "redis": "connected"
}
```

### 3. Database Connection

```bash
psql -U chitin_user -d chitin -c "SELECT COUNT(*) FROM adus;"
```

Expected response:
```
 count
-------
     0
(1 row)
```

### 4. Redis Connection

```bash
redis-cli INFO server
```

Expected: Server info displayed

### 5. Web App

Navigate to http://localhost:3000 in browser. Should load without errors.

## End-to-End Pipeline Testing

### Test 1: Create Post and Trigger Analysis

```bash
# Create test user
curl -X POST http://localhost:3001/api/v1/auth/register \
  -H "Content-Type: application/json" \
  -d '{
    "username": "testuser",
    "email": "test@example.com",
    "password": "password123"
  }'

# Create post
curl -X POST http://localhost:3001/api/v1/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer TOKEN_FROM_ABOVE" \
  -d '{
    "content": "Climate change is real. We must act now. Therefore, governments should implement carbon taxes."
  }'

# Watch for job processing in terminal running API server
# Should see logs:
# - "Enqueuing analysis job"
# - "Extracting ADUs"
# - "Processing canonical claims"
# - "Analysis completed"
```

### Test 2: Fetch ADUs from Database

```bash
# Get post ID from previous step
POST_ID="<post_id_from_above>"

# Fetch ADUs
curl http://localhost:3001/api/v1/arguments/posts/$POST_ID/adus \
  -H "Authorization: Bearer TOKEN"

# Expected response:
{
  "success": true,
  "data": [
    {
      "id": "adu_1",
      "source_type": "post",
      "source_id": "post_id",
      "adu_type": "claim",
      "text": "Climate change is real",
      "span_start": 0,
      "span_end": 22,
      "confidence": 0.95
    },
    ...
  ]
}
```

### Test 3: Query Canonical Claims

```bash
# Fetch claims from database
psql -U chitin_user -d chitin -c \
  "SELECT id, representative_text, adu_count FROM canonical_claims LIMIT 5;"

# Should show created canonical claims
```

### Test 4: Semantic Search

```bash
curl "http://localhost:3001/api/v1/search?q=climate+change&type=semantic" \
  -H "Authorization: Bearer TOKEN"

# Expected response:
{
  "success": true,
  "data": {
    "query": "climate change",
    "results": [
      {
        "id": "post_id",
        "content": "Climate change is real...",
        "author": "testuser",
        "similarity": 0.89
      }
    ]
  }
}
```

### Test 5: Run Unit Tests

```bash
cd apps/api

# Install test dependencies
pnpm install

# Run unit tests
pnpm run test:unit

# Expected output:
# ✓ ArgumentRepo (8 tests)
# ✓ ArgumentService (6 tests)
```

### Test 6: Run Integration Tests

```bash
cd apps/api

# Run integration tests
pnpm run test:integration

# Expected output:
# ✓ Arguments Routes (6 tests)
# ✓ Search Routes (4 tests)
# ✓ Worker Pipeline (6 tests)
```

## Troubleshooting

### PostgreSQL Issues

**Error: `FATAL: role "postgres" does not exist`**

```bash
# Create postgres user
sudo -u postgres createuser postgres
sudo -u postgres createdb postgres

# Or use alternate user
psql -U $(whoami) postgres
```

**Error: `pgvector extension not found`**

```bash
# Reinstall pgvector
brew reinstall postgresql-16-pgvector

# Or compile from source
git clone https://github.com/pgvector/pgvector.git
cd pgvector
make
make install
```

**Error: `Could not connect to server`**

```bash
# Check if PostgreSQL is running
ps aux | grep postgres

# Start if not running
brew services start postgresql@16

# Try connecting with correct credentials
psql -U chitin_user -d chitin -h localhost
```

### Redis Issues

**Error: `redis-cli: command not found`**

```bash
# Install Redis
brew install redis

# Start Redis
redis-server
```

**Error: `Could not connect to Redis`**

```bash
# Check if Redis is running
redis-cli ping

# Start if not running
redis-server

# Verify port (default 6379)
lsof -i :6379
```

### Discourse Engine Issues

**Error: `models_loaded: false` after 30+ seconds**

```bash
# Check Python/PyTorch installation
python -c "import torch; print(torch.__version__)"

# Reinstall dependencies
pip install -r requirements.txt --force-reinstall

# Check system RAM (models need 2-4GB)
free -h

# Enable debug logging
LOG_LEVEL=DEBUG python -m uvicorn main:app --reload
```

**Error: `GOOGLE_API_KEY not found`**

```bash
# Set environment variable
export GOOGLE_API_KEY=your_key_here

# Or add to .env file
echo "GOOGLE_API_KEY=your_key_here" >> .env

# Verify it's set
echo $GOOGLE_API_KEY
```

**Error: `API key has insufficient permissions`**

```bash
# Verify API key has Generative AI permissions
gcloud projects get-iam-policy chitin-social-phase3

# Grant permissions to service account
gcloud projects add-iam-policy-binding chitin-social-phase3 \
  --member=serviceAccount:chitin-api@chitin-social-phase3.iam.gserviceaccount.com \
  --role=roles/aiplatform.user
```

**Error: `Request timeout` on first API call**

This is normal. First request takes 10-30s as models load. Subsequent requests are fast.

```bash
# Monitor model loading
tail -f discourse-engine.log | grep -i "model\|load\|ready"

# Wait for "Ready" message, then retry
```

### API Server Issues

**Error: `EADDRINUSE: address already in use :::3001`**

```bash
# Find process using port
lsof -i :3001

# Kill process
kill -9 <PID>

# Or use different port
API_PORT=3002 pnpm run dev
```

**Error: `Database connection failed`**

```bash
# Verify credentials in .env
cat apps/api/.env

# Test connection
psql -U chitin_user -d chitin -c "SELECT 1"

# Run migrations
pnpm run db:migrate
```

**Error: `Job queue error`**

```bash
# Check Redis is running
redis-cli ping

# Check BullMQ connection in logs
grep -i "bullmq\|redis" apps/api/logs/*

# Restart Redis
redis-cli FLUSHALL
redis-server
```

### Web App Issues

**Error: `API endpoint not reachable`**

```bash
# Check API server is running
curl http://localhost:3001/health

# Check web app environment variables
cat apps/web/.env.local

# Verify API_URL is correct
echo $NEXT_PUBLIC_API_URL
```

**Error: `Posts not appearing after creation`**

```bash
# Check API logs
tail -f api.log | grep -i "post"

# Check database
psql -U chitin_user -d chitin -c "SELECT COUNT(*) FROM posts;"

# Check job queue
redis-cli LLEN "bull:argument-analysis:wait"
```

### Common Errors

**Error: `Analysis failed`**

```bash
# Check discourse-engine logs
docker logs discourse-engine  # If using Docker
tail -f discourse-engine.log

# Check API worker logs
grep -i "error\|failed" api.log

# Common causes:
# 1. discourse-engine not running
# 2. Models not loaded
# 3. API key invalid
# 4. LLM rate limit exceeded
```

**Error: `Span offset out of bounds`**

```bash
# Check ADU extraction
curl -X POST http://localhost:8000/analyze/adus \
  -H "Content-Type: application/json" \
  -d '{"texts": [{"id": "test", "text": "Your test text"}]}'

# Verify span_start < span_end
# Verify span_end <= text.length
```

## Production Deployment

### Docker Compose

```bash
# Build all services
docker-compose build

# Start all services
docker-compose up -d

# Check status
docker-compose ps

# View logs
docker-compose logs -f api
docker-compose logs -f discourse-engine
```

### Kubernetes (GKE)

```bash
# Create cluster
gcloud container clusters create chitin-cluster

# Deploy API
kubectl apply -f k8s/api-deployment.yaml

# Deploy discourse-engine
kubectl apply -f k8s/discourse-engine-deployment.yaml

# Check status
kubectl get deployments
kubectl logs deployment/chitin-api
```

### Environment Variables in Production

Use secrets manager:

```bash
# Google Cloud Secret Manager
gcloud secrets create GOOGLE_API_KEY --data-file=-

# Kubernetes Secrets
kubectl create secret generic google-api \
  --from-literal=GOOGLE_API_KEY=your_key_here
```

Never commit API keys to version control!

## Monitoring

### Logs

```bash
# API logs
tail -f logs/api.log

# Discourse Engine logs
tail -f logs/discourse-engine.log

# Database logs
tail -f /var/log/postgresql/postgresql.log
```

### Metrics

Monitor:
- Job queue length: `redis-cli LLEN "bull:argument-analysis:*"`
- Database size: `SELECT pg_size_pretty(pg_database_size('chitin'));`
- API latency: HTTP request duration
- Gemini API usage: Google Cloud Console

### Health Checks

Periodically verify:

```bash
# Health checks every 60s
while true; do
  curl -s http://localhost:3001/health | jq .
  curl -s http://localhost:8000/health | jq .
  sleep 60
done
```

## Next Steps

1. Follow [End-to-End Pipeline Testing](#end-to-end-pipeline-testing)
2. Create test posts and verify analysis
3. Run full test suite: `pnpm run test`
4. Review argument highlighting in web UI
5. Test semantic search functionality
6. Deploy to production when ready

For issues, check the [Troubleshooting](#troubleshooting) section above.
