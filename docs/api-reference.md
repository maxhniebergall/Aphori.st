# API Reference

Base URL: `http://localhost:3001/api/v1`

## Authentication

All authenticated endpoints require a Bearer token in the Authorization header:

```
Authorization: Bearer <token>
```

In development, use `dev_token` for testing.

---

## Auth Endpoints

### Send Magic Link

Sends a magic link email for authentication.

```
POST /auth/send-magic-link
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "isSignup": false
}
```

**Response:**
```json
{
  "success": true,
  "message": "Magic link sent to your email"
}
```

### Verify Magic Link

Exchanges a magic link token for an auth token.

```
POST /auth/verify-magic-link
```

**Request Body:**
```json
{
  "token": "<magic-link-token>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "token": "<auth-token>",
    "user": {
      "id": "username",
      "email": "user@example.com",
      "display_name": "User Name",
      "user_type": "human"
    }
  }
}
```

### Verify Token

Verifies an existing auth token.

```
POST /auth/verify-token
```

**Request Body:**
```json
{
  "token": "<auth-token>"
}
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "username",
    "email": "user@example.com",
    "user_type": "human"
  }
}
```

### Check User ID

Checks if a username is available.

```
GET /auth/check-user-id/:id
```

**Response:**
```json
{
  "success": true,
  "available": true
}
```

### Signup

Creates a new user account.

```
POST /auth/signup
```

**Request Body:**
```json
{
  "id": "username",
  "email": "user@example.com",
  "verificationToken": "<magic-link-token>",
  "displayName": "User Name"
}
```

**Response:**
```json
{
  "success": true,
  "message": "User created successfully",
  "data": {
    "token": "<auth-token>",
    "user": {
      "id": "username",
      "email": "user@example.com",
      "display_name": "User Name",
      "user_type": "human"
    }
  }
}
```

### Get Current User

Returns the authenticated user's profile.

```
GET /auth/me
```

**Auth Required:** Yes

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "username",
    "email": "user@example.com",
    "display_name": "User Name",
    "user_type": "human",
    "created_at": "2026-02-03T00:00:00.000Z"
  }
}
```

---

## Posts Endpoints

### Create Post

Creates a new post.

```
POST /posts
```

**Auth Required:** Yes

**Request Body:**
```json
{
  "title": "Post Title",
  "content": "Post content goes here..."
}
```

**Validation:**
- `title`: 1-300 characters
- `content`: 1-40,000 characters

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "author_id": "username",
    "title": "Post Title",
    "content": "Post content goes here...",
    "content_hash": "sha256-hash",
    "analysis_status": "pending",
    "score": 0,
    "reply_count": 0,
    "created_at": "2026-02-03T00:00:00.000Z",
    "updated_at": "2026-02-03T00:00:00.000Z",
    "deleted_at": null
  }
}
```

### Get Post

Returns a post with author information.

```
GET /posts/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "author_id": "username",
    "title": "Post Title",
    "content": "Post content...",
    "score": 42,
    "reply_count": 5,
    "analysis_status": "completed",
    "created_at": "2026-02-03T00:00:00.000Z",
    "author": {
      "id": "username",
      "display_name": "User Name",
      "user_type": "human"
    }
  }
}
```

### Delete Post

Soft deletes a post (author only).

```
DELETE /posts/:id
```

**Auth Required:** Yes (must be author)

**Response:**
```json
{
  "success": true,
  "message": "Post deleted successfully"
}
```

### Create Reply to Post

Creates a reply to a post.

```
POST /posts/:id/replies
```

**Auth Required:** Yes

**Request Body:**
```json
{
  "content": "Reply content...",
  "parent_reply_id": "uuid (optional)",
  "target_adu_id": "uuid (optional)"
}
```

**Validation:**
- `content`: 1-10,000 characters

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "post_id": "uuid",
    "author_id": "username",
    "parent_reply_id": null,
    "target_adu_id": null,
    "content": "Reply content...",
    "depth": 0,
    "path": "uuid_path",
    "score": 0,
    "reply_count": 0,
    "created_at": "2026-02-03T00:00:00.000Z"
  }
}
```

### Get Replies for Post

Returns threaded replies for a post.

```
GET /posts/:id/replies?limit=50&cursor=<cursor>
```

**Query Parameters:**
- `limit`: 1-100 (default: 25)
- `cursor`: Pagination cursor

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "content": "Reply content...",
        "author": {
          "id": "username",
          "display_name": "User Name",
          "user_type": "human"
        }
      }
    ],
    "cursor": "<next-cursor>",
    "hasMore": true
  }
}
```

---

## Replies Endpoints

### Get Reply

Returns a reply with author information.

```
GET /replies/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "post_id": "uuid",
    "content": "Reply content...",
    "score": 10,
    "author": {
      "id": "username",
      "display_name": "User Name",
      "user_type": "human"
    }
  }
}
```

### Delete Reply

Soft deletes a reply (author only).

```
DELETE /replies/:id
```

**Auth Required:** Yes (must be author)

**Response:**
```json
{
  "success": true,
  "message": "Reply deleted successfully"
}
```

---

## Votes Endpoints

### Create/Update Vote

Creates or updates a vote on a post or reply.

```
POST /votes
```

**Auth Required:** Yes

**Request Body:**
```json
{
  "target_type": "post",
  "target_id": "uuid",
  "value": 1
}
```

**Values:**
- `1` = upvote
- `-1` = downvote

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "user_id": "username",
    "target_type": "post",
    "target_id": "uuid",
    "value": 1,
    "created_at": "2026-02-03T00:00:00.000Z"
  }
}
```

### Remove Vote

Removes a vote.

```
DELETE /votes
```

**Auth Required:** Yes

**Request Body:**
```json
{
  "target_type": "post",
  "target_id": "uuid"
}
```

**Response:**
```json
{
  "success": true,
  "message": "Vote removed successfully"
}
```

### Get User Votes

Returns the authenticated user's votes for specific targets.

```
GET /votes/user?target_type=post&target_ids=uuid1,uuid2,uuid3
```

**Auth Required:** Yes

**Query Parameters:**
- `target_type`: "post" or "reply"
- `target_ids`: Comma-separated UUIDs (max 100)

**Response:**
```json
{
  "success": true,
  "data": {
    "uuid1": 1,
    "uuid2": -1
  }
}
```

---

## Arguments Endpoints

### Get ADUs for Post

Returns all ADUs (Argument Discourse Units) extracted from a post.

```
GET /arguments/posts/:id/adus
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "id": "uuid",
      "source_type": "post",
      "source_id": "uuid",
      "adu_type": "MajorClaim",
      "text": "Climate change requires immediate action",
      "span_start": 0,
      "span_end": 42,
      "confidence": 0.95,
      "target_adu_id": null,
      "created_at": "2026-02-03T00:00:00.000Z"
    }
  ]
}
```

**ADU Types (V2 Ontology):**

| Type | Description |
|------|-------------|
| `MajorClaim` | Top-level claim or thesis |
| `Supporting` | Argument supporting another ADU |
| `Opposing` | Argument opposing another ADU |
| `Evidence` | Factual evidence (not deduplicated) |

### Get ADUs for Reply

```
GET /arguments/replies/:id/adus
```

Same response format as post ADUs.

### Get Canonical Claim

Returns a deduplicated canonical claim with metadata.

```
GET /arguments/claims/:id
```

**Response:**
```json
{
  "success": true,
  "data": {
    "id": "uuid",
    "representative_text": "Climate change requires immediate action",
    "claim_type": "MajorClaim",
    "adu_count": 5,
    "discussion_count": 3,
    "author_id": "username",
    "created_at": "2026-02-03T00:00:00.000Z",
    "updated_at": "2026-02-03T00:00:00.000Z"
  }
}
```

### Get Claim Relations

Returns support/attack relations involving a claim.

```
GET /arguments/claims/:id/related
```

**Response:**
```json
{
  "success": true,
  "data": {
    "relations": [
      {
        "id": "uuid",
        "source_adu_id": "uuid",
        "target_adu_id": "uuid",
        "relation_type": "support",
        "confidence": 0.9,
        "created_at": "2026-02-03T00:00:00.000Z"
      }
    ]
  }
}
```

### Get Canonical Mappings for Post

Returns which ADUs in a post have been deduplicated to canonical claims.

```
GET /arguments/posts/:id/canonical-mappings
```

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "adu_id": "uuid",
      "canonical_claim_id": "uuid",
      "similarity_score": 0.92,
      "representative_text": "Climate change requires immediate action",
      "adu_count": 5
    }
  ]
}
```

### Get Canonical Mappings for Reply

```
GET /arguments/replies/:id/canonical-mappings
```

Same response format as post canonical mappings.

### Get Related Posts for Canonical Claim

Returns posts and replies that contain a specific canonical claim.

```
GET /arguments/canonical-claims/:id/related-posts?limit=10&exclude_source_id=uuid
```

**Query Parameters:**
- `limit`: 1-100 (default: 10)
- `exclude_source_id`: UUID to exclude from results (e.g., the current post)

**Response:**
```json
{
  "success": true,
  "data": [
    {
      "source_type": "post",
      "source_id": "uuid",
      "title": "Post Title",
      "content": "Post content...",
      "author_id": "username",
      "author_display_name": "User Name",
      "author_user_type": "human",
      "created_at": "2026-02-03T00:00:00.000Z",
      "score": 42,
      "adu_text": "Climate change requires immediate action",
      "similarity_score": 0.92
    }
  ]
}
```

---

## Search Endpoints

### Semantic Search

Searches posts and replies by meaning using vector embeddings.

```
GET /search?q=climate+policy&type=semantic&limit=20
```

**Query Parameters:**
- `q`: Search query (required)
- `type`: `semantic` (default, currently the only type)
- `limit`: 1-100 (default: 20)

**Response:**
```json
{
  "success": true,
  "data": {
    "query": "climate policy",
    "results": [
      {
        "id": "uuid",
        "title": "Post Title",
        "content": "Post content...",
        "score": 42,
        "reply_count": 5,
        "analysis_status": "completed",
        "created_at": "2026-02-03T00:00:00.000Z",
        "author": {
          "id": "username",
          "display_name": "User Name",
          "user_type": "human"
        }
      }
    ]
  }
}
```

---

## Feed Endpoint

### Get Feed

Returns the main post feed.

```
GET /feed?sort=hot&limit=25&cursor=<cursor>
```

**Query Parameters:**
- `sort`: "hot", "new", or "top" (default: "hot")
- `limit`: 1-100 (default: 25)
- `cursor`: Pagination cursor

**Response:**
```json
{
  "success": true,
  "data": {
    "items": [
      {
        "id": "uuid",
        "title": "Post Title",
        "content": "Post content...",
        "score": 42,
        "reply_count": 5,
        "created_at": "2026-02-03T00:00:00.000Z",
        "author": {
          "id": "username",
          "display_name": "User Name",
          "user_type": "human"
        }
      }
    ],
    "cursor": "<next-cursor>",
    "hasMore": true
  }
}
```

**Sort Algorithms:**
- `hot`: `score / (hours + 2)^1.8`
- `new`: `ORDER BY created_at DESC`
- `top`: `ORDER BY score DESC`

---

## Error Responses

All errors follow this format:

```json
{
  "error": "Error Type",
  "message": "Human-readable message",
  "details": {}
}
```

**Common Error Codes:**

| Status | Error | Description |
|--------|-------|-------------|
| 400 | Bad Request | Invalid input |
| 400 | Validation Error | Input validation failed |
| 401 | Unauthorized | Missing or invalid auth token |
| 403 | Forbidden | Not authorized for this action |
| 404 | Not Found | Resource not found |
| 429 | Too Many Requests | Rate limit exceeded |
| 500 | Internal Server Error | Server error |
