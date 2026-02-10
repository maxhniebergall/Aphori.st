# Aphorist - Testing Guide

This guide walks through manual testing of the complete auth, post, reply, and voting flows.

## Prerequisites

### 1. Start Docker Services
```bash
pnpm docker:up
```

Wait for both services to be healthy:
```bash
docker-compose logs -f
```

Look for:
- PostgreSQL: `LOG:  database system is ready to accept connections`
- Redis: `Ready to accept connections`

### 2. Run Database Migrations
```bash
pnpm db:migrate
```

### 3. Install Dependencies
```bash
pnpm install
```

### 4. Start Services (in separate terminals)

Terminal 1 - API (port 3001):
```bash
pnpm dev:api
```

Terminal 2 - Web (port 3000):
```bash
pnpm dev:web
```

Expected output:
- API: `Server is running on port 3001`
- Web: `▲ Next.js 14.2.20`

---

## Manual Testing Procedures

### Test 1: Authentication Flow with Magic Link

#### Step 1a: Request Magic Link
```bash
curl -X POST http://localhost:3001/api/v1/auth/send-magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"testuser@example.com"}'
```

**Expected Response:**
```json
{
  "success": true,
  "message": "Magic link sent to email"
}
```

**Note:** In development, the magic link is logged to the API console. Copy the token value.

#### Step 1b: Verify Magic Link in API Console

Check the API terminal for a line like:
```
Magic link token: eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
Magic link: http://localhost:3000/auth/verify?token=eyJhbGci...
```

Copy the `token` value from the Magic link line.

#### Step 1c: Verify Magic Link via Browser

Option A - Direct verification:
```bash
curl http://localhost:3001/api/v1/auth/verify-magic-link \
  -H "Content-Type: application/json" \
  -d '{"token":"PASTE_TOKEN_HERE"}'
```

**Expected Response:**
```json
{
  "success": true,
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "user": {
    "id": "user-uuid",
    "email": "testuser@example.com"
  }
}
```

Option B - Browser verification:
1. Open browser: `http://localhost:3000/auth/verify?token=PASTE_TOKEN_HERE`
2. Should see success page with JWT token displayed
3. Token is auto-saved in localStorage as `auth_token`

#### Step 1d: Verify Session with dev_token

In development mode, you can use a dev token for testing:
```bash
curl http://localhost:3001/api/v1/auth/profile \
  -H "Authorization: Bearer dev_token"
```

**Expected Response:** User profile (may show dev user)

---

### Test 2: Create a Post

#### Step 2a: Create Post via API
```bash
curl -X POST http://localhost:3001/api/v1/posts \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{
    "title": "My First Post",
    "content": "This is the content of my first post on Chitin",
    "topic": "general"
  }'
```

**Expected Response:**
```json
{
  "id": "post-uuid",
  "author_id": "user-id",
  "title": "My First Post",
  "content": "This is the content of my first post on Chitin",
  "topic": "general",
  "created_at": "2026-02-03T16:30:00Z",
  "vote_score": 0,
  "reply_count": 0
}
```

#### Step 2b: Verify Post in Browser

1. Open: `http://localhost:3000`
2. Navigate to Feed
3. Look for "My First Post" in the feed
4. Post should display with author, timestamp, content

---

### Test 3: Create a Reply (Threading)

#### Step 3a: Get Post ID

From Test 2a response, note the post `id`. Or get posts via API:
```bash
curl http://localhost:3001/api/v1/posts \
  -H "Authorization: Bearer dev_token"
```

Use the first post's ID for the next step.

#### Step 3b: Create Reply

```bash
curl -X POST http://localhost:3001/api/v1/posts/POST_ID/replies \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{
    "content": "This is a reply to the first post"
  }'
```

**Expected Response:**
```json
{
  "id": "reply-uuid",
  "post_id": "post-uuid",
  "parent_id": null,
  "author_id": "user-id",
  "content": "This is a reply to the first post",
  "created_at": "2026-02-03T16:35:00Z",
  "vote_score": 0
}
```

#### Step 3c: Verify Reply Threading in Browser

1. Open: `http://localhost:3000`
2. Find the post "My First Post"
3. Click on it to view thread
4. Reply should appear below the post as a child
5. Should show author, timestamp, and content

---

### Test 4: Vote on Post

#### Step 4a: Get Post ID

From earlier tests, use a post ID.

#### Step 4b: Upvote a Post

```bash
curl -X POST http://localhost:3001/api/v1/posts/POST_ID/votes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{"vote_type":"upvote"}'
```

**Expected Response:**
```json
{
  "id": "vote-uuid",
  "post_id": "post-uuid",
  "user_id": "user-id",
  "vote_type": "upvote",
  "created_at": "2026-02-03T16:40:00Z"
}
```

#### Step 4c: Verify Vote Count Updated

Get the post:
```bash
curl http://localhost:3001/api/v1/posts/POST_ID \
  -H "Authorization: Bearer dev_token"
```

**Expected:** `vote_score` should be `1` (or higher if multiple votes)

#### Step 4d: Vote in Browser

1. Open: `http://localhost:3000`
2. Find a post
3. Click upvote button (👍)
4. Vote count should increment immediately
5. Vote button should show selected state

#### Step 4e: Downvote a Post

```bash
curl -X POST http://localhost:3001/api/v1/posts/POST_ID/votes \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer dev_token" \
  -d '{"vote_type":"downvote"}'
```

**Expected Response:** Similar to upvote, but with `vote_type: "downvote"`

---

### Test 5: Feed Aggregation

#### Step 5a: View Feed via API

```bash
curl http://localhost:3001/api/v1/feed \
  -H "Authorization: Bearer dev_token"
```

**Expected Response:**
```json
{
  "posts": [
    {
      "id": "post-uuid",
      "title": "My First Post",
      "content": "This is the content...",
      "author": {
        "id": "user-id",
        "email": "testuser@example.com"
      },
      "vote_score": 1,
      "reply_count": 1,
      "created_at": "2026-02-03T16:30:00Z"
    }
  ],
  "total": 1,
  "page": 1,
  "limit": 20
}
```

#### Step 5b: View Feed in Browser

1. Open: `http://localhost:3000`
2. Feed should display:
   - Your post "My First Post" with vote score and reply count
   - Post content preview
   - Author info and timestamp
   - Vote buttons and reply count

---

## Testing Checklist

Complete all items to verify full functionality:

- [ ] **Auth Flow**
  - [ ] Magic link requested successfully
  - [ ] Magic link token received in API console
  - [ ] Magic link verified via API returns JWT
  - [ ] JWT token saved in browser localStorage
  - [ ] dev_token works for authenticated requests

- [ ] **Post Creation**
  - [ ] Post created via API with title and content
  - [ ] Post appears in feed within 5 seconds
  - [ ] Post displays author name and timestamp
  - [ ] Post content renders correctly

- [ ] **Reply/Threading**
  - [ ] Reply created successfully
  - [ ] Reply appears nested under parent post
  - [ ] Reply count incremented on parent post
  - [ ] Reply shows author and timestamp

- [ ] **Voting**
  - [ ] Upvote increments vote score
  - [ ] Downvote decrements vote score
  - [ ] Vote count updates immediately in feed
  - [ ] Vote button shows selected state
  - [ ] Multiple votes update score correctly

- [ ] **Feed Aggregation**
  - [ ] Feed displays all posts
  - [ ] Posts sorted by relevance/recency
  - [ ] Vote scores display correctly
  - [ ] Reply counts accurate
  - [ ] Pagination works (if enabled)

---

## Common Issues & Debugging

### Issue: "Cannot connect to the Docker daemon"
**Solution:** Start Docker Desktop or your Docker service
```bash
# macOS
open -a Docker

# Then wait 10 seconds and retry
pnpm docker:up
```

### Issue: "Connection refused on port 5432"
**Solution:** Docker containers aren't fully initialized. Check health:
```bash
docker-compose logs postgres
```
Wait for `database system is ready to accept connections`

### Issue: "Migration failed"
**Solution:** Check database state
```bash
pnpm db:rollback
pnpm db:migrate
```

### Issue: "Auth token invalid"
**Solution:** Use `dev_token` in development, or get a fresh token via magic link

### Issue: "Post not appearing in feed"
**Solution:**
1. Check if feed cache is stale: `redis-cli FLUSHALL`
2. Verify post was created: `curl http://localhost:3001/api/v1/posts -H "Authorization: Bearer dev_token"`

### Issue: "Vote count not updating"
**Solution:** Refresh the page to see latest data, or check vote endpoint response

---

## Advanced Testing

### Multiple Users
Test with different emails:
```bash
curl -X POST http://localhost:3001/api/v1/auth/send-magic-link \
  -H "Content-Type: application/json" \
  -d '{"email":"user2@example.com"}'
```

Then verify tokens work independently.

### Rate Limiting
The API implements rate limiting. Test it:
```bash
for i in {1..10}; do
  curl -X POST http://localhost:3001/api/v1/posts \
    -H "Content-Type: application/json" \
    -H "Authorization: Bearer dev_token" \
    -d '{"title":"Post '$i'","content":"Content '$i'","topic":"general"}'
done
```

Should return 429 status when limit exceeded.

### Redis Caching
Verify Redis caching:
```bash
redis-cli
> KEYS *
> TTL feed:*
> GET feed:recent
```

---

## Cleanup

### Reset Database
```bash
pnpm db:rollback
pnpm db:migrate
```

### Stop Services
```bash
pnpm docker:down
```

### Clear Redis Cache
```bash
redis-cli FLUSHALL
```

---

## Next Steps

After manual testing is complete:
1. Run automated Playwright tests: `pnpm test:e2e`
2. Check API logs for errors: `pnpm docker:logs`
3. Performance test with more posts/users
4. Deploy to staging environment
