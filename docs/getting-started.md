# Getting Started

This guide will help you set up your local development environment for Chitin Social.

## Prerequisites

- **Node.js** 22+ (see `.nvmrc`)
- **pnpm** 9.15+ (`npm install -g pnpm`)
- **Docker** and Docker Compose
- **Git**

## Quick Start

### 1. Clone and Install

```bash
git clone https://github.com/maxhniebergall/chitin-social.git
cd chitin-social
pnpm install
```

### 2. Start Infrastructure

```bash
# Start PostgreSQL and Redis
docker-compose up -d

# Verify services are running
docker-compose ps
```

### 3. Run Migrations

```bash
pnpm db:migrate
```

### 4. Start Development Servers

```bash
# Start all services
pnpm dev

# Or start individually:
pnpm dev:api   # API on http://localhost:3001
pnpm dev:web   # Frontend on http://localhost:3000
```

## Environment Configuration

Copy the example environment file:

```bash
cp .env.example .env
```

Key environment variables:

| Variable | Description | Default |
|----------|-------------|---------|
| `DATABASE_URL` | PostgreSQL connection string | `postgresql://chitin:chitin_dev@localhost:5432/chitin` |
| `REDIS_URL` | Redis connection string | `redis://localhost:6379` |
| `JWT_SECRET` | Secret for signing JWTs | `dev-secret-change-in-production` |
| `MAGIC_LINK_SECRET` | Secret for magic link tokens | `dev-magic-link-secret` |

## Development Authentication

In development mode (`NODE_ENV !== 'production'`), you can use `dev_token` as a Bearer token:

```bash
curl -H "Authorization: Bearer dev_token" http://localhost:3001/api/v1/auth/me
```

This authenticates as a default dev user without requiring email verification.

## Database Access

Connect to PostgreSQL directly:

```bash
docker-compose exec postgres psql -U chitin -d chitin
```

Useful commands:
```sql
\dt                    -- List tables
\d+ users              -- Describe users table
SELECT * FROM users;   -- Query users
```

## Common Tasks

### Reset Database

```bash
# Stop services and remove volumes
docker-compose down -v

# Start fresh
docker-compose up -d
pnpm db:migrate
```

### View Logs

```bash
# All services
docker-compose logs -f

# Specific service
docker-compose logs -f postgres
```

### Run Type Checking

```bash
pnpm typecheck
```

## Project Structure

```
apps/api/src/
├── server.ts          # Express app entry point
├── config.ts          # Environment config
├── db/
│   ├── pool.ts        # PostgreSQL connection
│   ├── migrations/    # SQL migration files
│   └── repositories/  # Data access layer
├── middleware/        # Express middleware
├── routes/            # API route handlers
└── services/          # Business logic

apps/web/src/
├── app/               # Next.js App Router pages
├── components/        # React components
├── contexts/          # React contexts
├── hooks/             # Custom hooks
└── lib/               # Utilities and API client
```

## Next Steps

- Read the [Architecture Overview](./architecture.md) to understand the system design
- Check the [API Reference](./api-reference.md) for endpoint documentation
- See [Frontend Guide](./frontend-guide.md) for component patterns
