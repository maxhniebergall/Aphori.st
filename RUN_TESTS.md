# Running Tests - Complete Setup Guide

## Critical Prerequisites

### 1. Start Docker
```bash
pnpm docker:up
docker-compose logs -f
```

Wait for both services to report ready:
- PostgreSQL: `LOG:  database system is ready to accept connections`
- Redis: `Ready to accept connections`

### 2. Run Database Migrations
```bash
pnpm db:migrate
```

### 3. Option A: Manual Server Start (Recommended for Development)

Start these in **three separate terminals**:

**Terminal 1 - API**
```bash
pnpm dev:api
```

Expected output:
```
Server running on port 3001
Database connection established
```

**Terminal 2 - Web**
```bash
pnpm dev:web
```

Expected output:
```
▲ Next.js 14.2.20
```

**Terminal 3 - Run Tests**
```bash
cd apps/e2e
npx playwright test api-only.spec.ts --project=chromium
```

### Option B: Auto-start via Playwright

```bash
npx playwright test api-only.spec.ts --project=chromium
```

Playwright will automatically start both servers, but this is slower on first run.

## Test Suites

### API-Only Tests (Recommended)
Tests core API functionality without UI dependencies:

```bash
npx playwright test api-only.spec.ts
```

Tests:
- Authentication (magic link, token verification)
- Post creation and listing
- Reply creation and threading
- Voting system
- Feed aggregation
- Complete user flow

### Full Test Suite (UI + API)
Tests both API and user interface (requires correct UI selectors):

```bash
npx playwright test
```

Note: Many UI tests may fail if the web app UI structure differs from expectations.

## Troubleshooting

### Tests can't connect to API

**Check Docker is running:**
```bash
docker-compose ps
```

All containers should show `Up` status.

**Check API is running:**
```bash
curl http://localhost:3001/health
```

Should return: `{"status":"healthy","timestamp":"..."}`

**Check migrations ran:**
```bash
pnpm db:migrate
```

**Clear Docker and restart:**
```bash
pnpm docker:down
pnpm docker:up
docker-compose logs -f
```

### Database connection error

1. Check PostgreSQL is accessible:
   ```bash
   docker-compose logs postgres
   ```

2. Check credentials in .env match docker-compose.yml:
   - User: `chitin`
   - Password: `chitin_dev`
   - Database: `chitin`

### Tests timeout

1. Increase timeout in `playwright.config.ts`:
   ```typescript
   webServer: [
     { timeout: 180000 },  // 3 minutes
     { timeout: 180000 },
   ]
   ```

2. Check API/Web responsiveness:
   ```bash
   curl http://localhost:3001/health
   curl http://localhost:3000
   ```

## Viewing Test Results

### HTML Report
```bash
npx playwright show-report
```

### Screenshots
Failed tests save screenshots in:
```
apps/e2e/test-results/
```

### CLI Output
```bash
npx playwright test --reporter=list
```

## Test Execution Summary

**API-Only Tests:**
- 14 tests total
- Covers: auth, posts, replies, voting, feed
- Expected time: 30-60 seconds
- Status: Use this for CI/CD

**Full Test Suite:**
- 96 tests total (14 API + 82 UI)
- Covers: auth UI, post creation UI, threading, voting UI, feed UI
- Expected time: 2-3 minutes
- Status: Work in progress (UI selectors may need updates)

## Quick Commands Reference

```bash
# Setup
pnpm docker:up
pnpm db:migrate
pnpm install

# Start servers (manual)
pnpm dev:api
pnpm dev:web

# Run tests
pnpm test:e2e                          # All tests
pnpm test:e2e:headed                   # See browser
pnpm test:e2e:ui                       # Interactive mode

# From e2e directory
cd apps/e2e
npx playwright test api-only.spec.ts   # API only
npx playwright test                    # All tests
npx playwright show-report             # View results
```

## Environment Variables

Required in `.env`:
```
DATABASE_URL=postgresql://chitin:chitin_dev@localhost:5432/chitin
REDIS_URL=redis://localhost:6379
JWT_SECRET=dev-secret-change-in-production
JWT_EXPIRES_IN=7d
NODE_ENV=development
API_URL=http://localhost:3001
APP_URL=http://localhost:3000
```

## Development Notes

- Tests use `dev_token` for authentication in development mode
- Magic link returns `dev_token` instead of generating a real token
- API automatically initializes database on startup
- Redis is used for caching but tests work without it initially

## Next Steps

1. Ensure Docker is running and healthy
2. Run migrations: `pnpm db:migrate`
3. Start servers manually for better diagnostics
4. Run API-only tests: `npx playwright test api-only.spec.ts`
5. Fix any failures
6. Run full test suite if needed

## CI/CD Integration

For GitHub Actions or other CI systems:

```yaml
- name: Start Docker
  run: pnpm docker:up

- name: Run migrations
  run: pnpm db:migrate

- name: Run API tests
  run: pnpm test:e2e --project=chromium

- name: Upload report
  if: always()
  uses: actions/upload-artifact@v3
  with:
    name: playwright-report
    path: apps/e2e/playwright-report/
```
