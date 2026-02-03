# E2E Tests - Chitin Social

Automated end-to-end tests using Playwright for the Chitin Social platform.

## Quick Start

### Prerequisites

- Docker (PostgreSQL and Redis must be running)
- pnpm

### Setup

1. Start Docker services:
```bash
pnpm docker:up
```

2. Run migrations:
```bash
pnpm db:migrate
```

3. Start API and Web servers (from root):
```bash
# Terminal 1
pnpm dev:api

# Terminal 2
pnpm dev:web
```

### Run Tests

From the root directory:

```bash
# Run all tests
pnpm test:e2e

# Run specific test file
pnpm test:e2e tests/auth.spec.ts

# Run tests in headed mode (see browser)
pnpm --filter @chitin/e2e test:headed

# Run tests in UI mode (interactive)
pnpm --filter @chitin/e2e test:ui

# Debug tests
pnpm --filter @chitin/e2e test:debug
```

## Test Suites

### auth.spec.ts
Tests authentication flow:
- Login page display
- Magic link request
- Magic link verification
- Token storage in localStorage
- Dev token usage

### posts.spec.ts
Tests post creation and display:
- Feed page display
- Create post via API
- Post appears in feed
- Post metadata display
- Fetch posts via API

### replies.spec.ts
Tests reply functionality and threading:
- Create reply to post
- Reply count increments on parent
- Fetch replies
- Display thread in UI
- Nested replies support

### voting.spec.ts
Tests voting system:
- Upvote posts
- Downvote posts
- Vote score updates
- Vote on replies
- Display vote counts in feed
- Handle vote conflicts

### feed.spec.ts
Tests feed aggregation:
- Display feed page
- Fetch feed data
- Multiple posts in feed
- Post metadata in feed
- Pagination support
- Sorting order
- Real-time updates

### integration.spec.ts
Tests complete user journeys:
- Full flow: auth → create post → reply → vote → view in feed
- Multiple posts with interactions
- Rate limiting
- Concurrent operations

## Configuration

Edit `playwright.config.ts` to change:
- Base URL (defaults to `http://localhost:3000`)
- Browsers to test (chromium, firefox, webkit)
- Timeout settings
- Screenshots and traces

## Test Data

Tests use the dev_token for authentication in development mode. You can see API requests in the browser console and responses in the terminal.

## Debugging

### View Test Report
```bash
pnpm --filter @chitin/e2e test && npx playwright show-report
```

### Enable Debugging
```bash
PWDEBUG=1 pnpm --filter @chitin/e2e test:debug
```

### Check Screenshots
Failed tests save screenshots in `test-results/` directory.

## Common Issues

### "Connection refused" on API calls
- Ensure API is running on port 3001: `pnpm dev:api`
- Check Docker containers: `docker-compose logs`

### "Target page, context or browser has been closed"
- API/Web servers crashed. Restart them and re-run tests

### Tests timeout
- API or web server is slow. Check resource usage
- Increase timeout in playwright.config.ts

## CI/CD Integration

The tests are configured to run in CI mode with:
- 2 retries for flaky tests
- Single worker (no parallelization)
- No `--headed` flag
- Full reporting

For GitHub Actions, add a workflow that:
1. Starts Docker containers
2. Runs migrations
3. Starts API and web servers
4. Runs `pnpm test:e2e`
5. Uploads test report

## Performance

- Full test suite completes in ~2-3 minutes
- Individual test files in ~30-60 seconds
- Headed mode adds overhead due to rendering

## Maintenance

When adding new features:
1. Add corresponding test spec
2. Update this README
3. Run full test suite to ensure no regressions
4. Fix any flaky tests
