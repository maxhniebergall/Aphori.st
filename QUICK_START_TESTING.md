# Quick Start - Testing Chitin Social

## 5-Minute Setup

### 1. Start Services (3 terminals)

**Terminal 1 - Docker:**
```bash
pnpm docker:up
docker-compose logs -f
```
Wait for: `database system is ready to accept connections` and `Ready to accept connections`

**Terminal 2 - API:**
```bash
pnpm db:migrate
pnpm dev:api
```
Wait for: `Server is running on port 3001`

**Terminal 3 - Web:**
```bash
pnpm dev:web
```
Wait for: `▲ Next.js 14.2.20`

### 2. Verify Setup
```bash
# In a new terminal
curl http://localhost:3001/api/v1/posts -H "Authorization: Bearer dev_token"
curl http://localhost:3000
```

## Manual Testing (15 minutes)

### Quick Test Flow
```bash
# 1. Request magic link
curl -X POST http://localhost:3001/api/v1/auth/request-magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com"}'

# 2. Create post (use dev_token)
curl -X POST http://localhost:3001/api/v1/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{"title":"Test Post","content":"Hello","topic":"general"}'

# 3. Get POST_ID from response, then create reply
curl -X POST http://localhost:3001/api/v1/posts/POST_ID/replies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{"content":"Test reply"}'

# 4. Vote on post
curl -X POST http://localhost:3001/api/v1/posts/POST_ID/votes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{"vote_type":"upvote"}'

# 5. View feed
curl http://localhost:3001/api/v1/feed \
  -H "Authorization: Bearer dev_token"
```

### Browser Testing
1. Open http://localhost:3000
2. Try to login (or check if logged in with dev token)
3. View feed
4. Check if your post appears
5. Check vote/reply counts

## Automated Testing (2 minutes)

```bash
# Run all tests (32 tests)
pnpm test:e2e

# Watch tests with UI
pnpm test:e2e:ui

# See browser while testing
pnpm test:e2e:headed
```

## Full Testing Checklist

- [ ] Docker services healthy
- [ ] API responds on port 3001
- [ ] Web responds on port 3000
- [ ] Can create post via curl
- [ ] Can create reply via curl
- [ ] Can vote via curl
- [ ] Post appears in feed via curl
- [ ] Can see post in browser
- [ ] Automated tests pass

## Troubleshooting

### Docker won't start
```bash
open -a Docker  # macOS
# Wait 10 seconds
pnpm docker:up
```

### API won't start
```bash
docker-compose logs postgres
# Wait for readiness, then
pnpm db:migrate
pnpm dev:api
```

### Tests fail with "Connection refused"
- Make sure API is running on 3001
- Make sure Web is running on 3000
- Check: `curl http://localhost:3001/health`

### Tests timeout
- Increase timeout in `apps/e2e/playwright.config.ts`
- Check API/Web responsiveness

## Documentation

- **Manual testing:** `TESTING_GUIDE.md`
- **E2E tests:** `apps/e2e/README.md`
- **Full summary:** `TEST_IMPLEMENTATION_SUMMARY.md`

## Key Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/auth/request-magic-link` | Request login link |
| POST | `/api/auth/verify-magic-link` | Verify token |
| GET | `/api/auth/profile` | Get user profile |
| POST | `/api/posts` | Create post |
| GET | `/api/posts` | List posts |
| GET | `/api/posts/:id` | Get post |
| POST | `/api/posts/:id/replies` | Create reply |
| GET | `/api/posts/:id/replies` | Get replies |
| POST | `/api/posts/:id/votes` | Vote on post |
| GET | `/api/feed` | Get aggregated feed |

## dev_token

In development, use `dev_token` for all authenticated requests:
```bash
curl -H "Authorization: Bearer dev_token" http://localhost:3001/api/v1/posts
```

## Next Steps

1. Run manual tests from TESTING_GUIDE.md
2. Run automated tests: `pnpm test:e2e`
3. Review results
4. Fix any failures
5. Deploy when ready

---

**Questions?** Check the detailed guides for more information.
