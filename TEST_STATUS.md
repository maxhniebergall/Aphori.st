# Testing Status & Issues Found

## Summary

Tests are **partially working** but have revealed some API design issues that need to be addressed.

## What Works ✅

1. **Authentication Endpoints**
   - POST `/api/v1/auth/send-magic-link` - Works
   - POST `/api/v1/auth/verify-magic-link` - Works
   - GET `/api/v1/auth/me` - Works (with valid token)

2. **Feed Endpoint**
   - GET `/api/v1/feed` - Works

3. **Direct API Calls**
   - All API responses follow format: `{success: true, data: {...}}`

## What Doesn't Work ❌

### 1. **dev_token User Doesn't Exist in Database**

**Problem:**
- The `dev_token` authentication sets `user_id = 'dev_user'`
- But 'dev_user' is NOT created in the database
- Any operation requiring this user fails with 500 error

**Current Tests That Fail:**
- POST `/api/v1/posts` (create post)
- POST `/api/v1/posts/:id/replies` (create reply)
- POST `/api/v1/votes` (voting)

**Error:**
```
POST /api/v1/posts
Status: 500
Response: {"error":"Internal Server Error","message":"Failed to create post"}
```

### 2. **API Design Mismatches**

**Vote Endpoint Format Mismatch**
- Tests expected: `POST /posts/:id/votes {vote_type: 'upvote'}`
- Actual API: `POST /votes {target_type: 'post', target_id, value: 1}`

**Posts List Missing**
- Tests expected: `GET /posts` (list all posts)
- Actual API: Only `GET /posts/:id` (get single post)
- Posts listing is done via: `GET /feed`

## Solutions

### Quick Fix (Recommended)

**Option 1: Create dev_user in Database**

```sql
INSERT INTO users (id, email, user_type, created_at)
VALUES ('dev_user', 'dev@chitin.social', 'human', NOW());
```

Then run: `docker-compose exec postgres psql -U chitin -d chitin -f /path/to/insert.sql`

**Option 2: Seed Database During Migrations**

Add to the database initialization script:
```sql
INSERT INTO users (id, email, user_type, created_at)
VALUES ('dev_user', 'dev@chitin.social', 'human', NOW())
ON CONFLICT (id) DO NOTHING;
```

### Better Long-Term Fix

**Update Auth Middleware to Auto-Create dev_user**

File: `apps/api/src/middleware/auth.ts`

```typescript
// After line 34, before next():
if (config.env !== 'production' && token === 'dev_token') {
  // Ensure dev_user exists
  const devUser = await UserRepo.findById('dev_user');
  if (!devUser) {
    await UserRepo.create({
      id: 'dev_user',
      email: 'dev@chitin.social',
      user_type: 'human',
    });
  }

  req.user = {
    id: 'dev_user',
    email: 'dev@chitin.social',
    user_type: 'human',
  };
  next();
  return;
}
```

## Test Results

### Before Fix
- Passed: 1/14
- Failed: 13/14 (all due to dev_user not existing)

### After Creating dev_user (Expected)
- Passed: Should be 10+/14
- Remaining failures: Only API design issues

## API Design Issues to Address

1. **Vote Endpoint Inconsistency**
   - Consider adding: `POST /posts/:id/votes` as convenience wrapper
   - Or update documentation to use correct format

2. **Posts Listing**
   - No `GET /posts` endpoint
   - Users must use `/feed` for listing
   - Consider adding simple `GET /posts` endpoint

3. **Response Format**
   - Some endpoints return: `{success: true, data: {...}}`
   - But individual GET endpoints return: `{...}` directly
   - Should standardize response format

## Next Steps

1. **Immediate:** Create dev_user in database (Option 1 or 2 above)
2. **Run tests again:** `npx playwright test api-only.spec.ts`
3. **Fix remaining failures:** Update tests to match actual API design
4. **Long-term:** Consider API design improvements listed above

## Manual Testing Alternative

If you don't want to fix the database issue right now, use this manual approach:

```bash
# 1. Create a real user via signup
curl -X POST http://localhost:3001/api/v1/auth/signup \
  -H "Content-Type: application/json" \
  -d '{
    "id": "testuser123",
    "email": "test@example.com",
    "displayName": "Test User"
  }'

# 2. Get magic link and verify
curl -X POST http://localhost:3001/api/v1/auth/send-magic-link \
  -H "Content-Type: application/json" \
  -d '{"email": "test@example.com"}'

# 3. Use the verified token for post creation
curl -X POST http://localhost:3001/api/v1/posts \
  -H "Authorization: Bearer <verified_token>" \
  -H "Content-Type: application/json" \
  -d '{
    "title": "My Post",
    "content": "Post content"
  }'
```

## Files Involved

- API Auth Middleware: `apps/api/src/middleware/auth.ts`
- Post Routes: `apps/api/src/routes/posts.ts`
- Vote Routes: `apps/api/src/routes/votes.ts`
- Feed Routes: `apps/api/src/routes/feed.ts`
- Tests: `apps/e2e/tests/api-only.spec.ts`

## Recommendations

✅ **For Development:** Create dev_user in database (Option 1) - quick fix
✅ **For Testing:** Use real user signup flow instead of dev_token
✅ **For Codebase:** Standardize API response format and add missing endpoints
