# Aphorist Backend Architecture Document
This document provides an overview of the Aphorist backend architecture, detailing the frontend APIs exposed by the backend server, including their request and response structures using TypeScript interfaces. Additionally, it outlines the backend data model for Firebase Realtime Database and provides descriptions of each backend file within the project.

## Table of Contents
- [Frontend APIs](#frontend-apis)
  - [Authentication APIs](#authentication-apis)
  - [User Management APIs](#user-management-apis)
  - [Reply APIs](#reply-apis)
  - [PostTree APIs](#posttree-apis)
  - [Feed APIs](#feed-apis)
- [Backend Data Model (Firebase RTDB)](#backend-data-model-firebase-rtdb)
- [Database Access Patterns (Firebase RTDB)](#database-access-patterns-firebase-rtdb)
  - [Replies Access Patterns](#replies-access-patterns)
- [Implementation Status & Next Steps](#implementation-status--next-steps)
- [Backend Files Overview](#backend-files-overview)
- [Data Compression](#data-compression)

## Frontend APIs

### Authentication APIs

#### POST /api/auth/send-magic-link

**Description:**  
Sends a magic link to the user's email for authentication purposes. This link allows the user to sign in or sign up without a password.

**Request Interface:**
```typescript
interface SendMagicLinkRequest {
  email: string;
  isSignupInRequest?: boolean;
}
```

**Response Interface:**
```typescript
interface SendMagicLinkResponse {
  success: boolean;
  message?: string;
  error?: string;
}
```

#### POST /api/auth/verify-magic-link

**Description:**  
Verifies the magic link token received by the user and authenticates them, issuing an authentication token upon successful verification.

**Request Interface:**
```typescript
interface VerifyMagicLinkRequest {
token: string;
}
```

**Response Interface:**
```typescript
interface VerifyMagicLinkResponse {
success: boolean;
data: {
  token: string;
  user: {
    id: string;
    email: string;
  };
};
}
```

#### POST /api/auth/verify-token

**Description:**  
Verifies the provided authentication token to ensure its validity and extracts the user information.

**Request Interface:**
```typescript
interface VerifyTokenRequest {
token: string;
}
```

**Response Interface:**
```typescript
interface VerifyTokenResponse {
success: boolean;
data: {
  id: string;
  email: string;
};
}
```

#### GET /api/profile

**Description:**  
Retrieves the authenticated user's profile information. This is a protected route that requires a valid authentication token.

**Request Headers:**
Authorization: Bearer <token>

**Response Interface:**
```typescript
interface ProfileResponse {
id: string;
email: string;
}
```

### User Management APIs

#### GET /api/check-user-id/:id

**Description:**  
Checks if a user ID is available for registration.

**URL Parameters:**
id: string

**Response Interface:**
```typescript
interface CheckUserIdResponse {
  success: boolean;
  available: boolean;
  error?: string;
}
```

#### POST /api/signup

**Description:**  
Creates a new user account with the provided ID and email.

**Request Interface:**
```typescript
interface SignupRequest {
  id: string;
  email: string;
  verificationToken?: string;
}
```

**Response Interface:**
```typescript
interface SignupResponse {
  success: boolean;
  message?: string;
  error?: string;
  data?: {
    token: string;
    user: {
      id: string;
      email: string;
    }
  }
}
```

### Reply APIs

#### POST /api/createReply

**Description:**  
Creates a new reply to a post or another reply.

**Request Interface:**
```typescript
interface CreateReplyRequest {
  parentId: string | string[];
  text: string;
  quote: {  // Required field for tracking what is being replied to
    text: string;
    sourcePostId: string;
    selectionRange: {
      start: number;
      end: number;
    };
  };
  metadata: {
    authorId: string;  // Required for tracking reply author
  };
}
```

**Response Interface:**
```typescript
interface CreateReplyResponse {
  success: boolean;
  data?: {
    id: string;
  };
  error?: string;
}
```

**Authentication:**  
Requires valid authentication token in Authorization header.

**Error Responses:**
- 400: Missing required fields (text, parentId, quote, or metadata.authorId)
- 401: Invalid or missing authentication token
- 500: Server error

#### GET /api/getReplies/:uuid/:quote/:sortingCriteria

**Description:**  
Retrieves replies for a specific post and quote with sorting options.

**URL Parameters:**
uuid: the uuid of the parent post or reply
quote: the quote to be used for sorting
sortingCriteria: the criteria to sort the replies by (most recent, oldest, most liked, least liked)

**Query Parameters:**
cursor?: string

**Response Interface:**
```typescript
interface GetRepliesResponse {
  replies: string[];
  pagination: {
    nextCursor?: string;
    previousCursor?: string;
  };
}
```

#### GET /api/getRepliesFeed

**Description:**  
Retrieves a global feed of replies sorted by recency.

**Query Parameters:**
cursor?: string

**Response Interface:**
```typescript
interface GetRepliesFeedResponse {
  replies: string[];
  pagination: {
    nextCursor?: string;
    previousCursor?: string;
  };
}
```

### PostTree APIs

#### GET /api/postTree/:uuid

**Description:**  
Fetches the post tree data associated with the given uuid from Redis. The post tree contains nested post nodes.

**URL Parameters:**
uuid: string

**Response Interface:**
```typescript
interface PostTreeNode {
    id: string;
    parentId?: string | null;
    childrenIds: string[];
    createdAt: string; // ISO Date string
    modifiedAt?: string; // ISO Date string
    content: string;
    authorId: string;
    metadata: {
        // Additional metadata for the post node
    };
}

interface GetPostTreeResponse extends PostTreeNode {}
```

#### POST /api/createPostTree

**Description:**  
Creates a new post tree with the provided content and metadata.

**Request Interface:**
```typescript
interface CreatePostTreeRequest {
  postTree: {
    content: string;
    authorId: string;
    // Potentially other fields needed for root post creation
  };
}
```

**Response Interface:**
```typescript
interface CreatePostTreeResponse {
  id: string; // UUID of the newly created post tree root
  message: string;
}
```

### Feed APIs

#### GET /api/feed

**Description:**  
Retrieves a paginated list of feed items. Each feed item represents a story added to the feed.

**Query Parameters:**
cursor?: string

**Response Interface:**
```typescript
interface FeedItem {
id: string;
text: string;
title: string;
author: string;
}
interface GetFeedResponse {
cursor?: string;
items: FeedItem[];
}
```

## Backend Data Model (Firebase RTDB)
The backend utilizes Firebase Realtime Database (RTDB). The following data model is designed to leverage RTDB's strengths while enabling efficient querying and security rule enforcement.

Core Principles:

*   **Flat Structure:** Keep data relatively flat. Avoid deep nesting where possible.
*   **Denormalization:** Duplicate data where necessary for efficient reads, especially for list views or displaying related info (e.g., author username alongside a post).
*   **Predictable Paths:** Use clear, human-readable path segments based on collections and IDs (e.g., `/users/$userId`, `/posts/$postId`). Direct paths are crucial for security rules.
*   **Use Native Keys:** Use UUIDs (e.g., uuidv7 condensed to 25 digits) directly as keys under the appropriate nodes (e.g., `/posts/<postId>`). Firebase Push IDs are used for list-like structures where chronological ordering is inherent (e.g., `/feedItems`).
*   **Index for Queries:** Create specific index nodes to query relationships efficiently (e.g., posts by user, replies by timestamp).
*   **Maps over Lists:** Use JSON objects (maps) with unique keys instead of arrays/lists for collections where items might be added/removed frequently or where the collection size can grow large. RTDB handles maps much more efficiently.

Recommended Data Model Structure:

```json
{
  // 1. User Data
  "users": {
    "$userId": { // Key is the condensed UUID
      "id": "$userId",                   // Matches key for convenience
      "email": "user@example.com",
      // "username": "someUsername", // Add if/when implemented
      "createdAt": "ISO8601_Timestamp_String" // Backend server timestamp string
      // other profile data
    }
  },

  // 2. Post Data (Top-level posts/stories)
  "posts": {
    "$postId": { // Key is the condensed UUID
      "id": "$postId",                   // Matches key for convenience
      "authorId": "$userId",
      // "authorUsername": "someUsername", // Denormalized if needed
      "content": "Text of the post...",
      "createdAt": "ISO8601_Timestamp_String", // Backend server timestamp string
      "replyCount": 0 // Atomically updated counter (managed via hIncrBy)
      // other post metadata
    }
  },

  // 3. Reply Data
  "replies": {
    "$replyId": { // Key is the condensed UUID
      "id": "$replyId",                   // Matches key for convenience
      "authorId": "$userId",
      "text": "Text of the reply...",
      "parentId": ["$parentPostOrReplyId", ...], // Array of parent IDs (direct parent first)
      // "parentType": "post" | "reply",   // May not be needed if parentId structure is clear
      "rootPostId": "$postId",           // ID of the original post tree root (useful for fetching whole thread)
      "quote": {                         // Mandatory quote info
        "text": "Quoted text snippet",
        "sourceId": "$quotedPostOrReplyId", // ID of the post/reply being quoted
        "selectionRange": {
          "start": 0,
          "end": 10
        }
      },
      "createdAt": "ISO8601_Timestamp_String" // Backend server timestamp string
    }
  },

  // 4. Feed Items (Chronological using Push IDs)
  "feedItems": { // Path uses RTDB push()
    "$feedItemId_pushKey": { // Firebase push keys sort chronologically
      "id": "$postId", // Reference to the original post (matches the push key base without timestamp part)
      "authorId": "$userId",
      // "authorUsername": "someUsername", // Denormalized if needed
      "textSnippet": "First N chars of post...", // Denormalized snippet
      "createdAt": "ISO8601_Timestamp_String" // Backend server timestamp string (matches post createdAt)
      // ".priority": { ".sv": "timestamp" } // Optional: Can use server value timestamp for ordering/priority if push key order isn't sufficient
    }
  },
  // Counter for feed items (optional, if needed beyond client-side counts)
  "feedStats": {
      "itemCount": 123 // Atomically updated counter
  },

  // 5. Metadata and Indexes (Aligns well with your rules structure)
  "userMetadata": {
    "emailToId": {
      "$escapedEmail": "$userId" // Key MUST be escaped (replace '.' with ',' etc.)
    },
    "userIds": { // Set of existing user IDs
      "$userId": true
    },
    "userPosts": { // Map of posts created by a user
      "$userId": {
        "$postId": true
      }
    },
    "userReplies": { // Map of replies created by a user
      "$userId": {
        "$replyId": true
      }
    }
  },

  "postMetadata": {
    "allPostTreeIds": { // Set of all root post IDs
       "$postId": true
    },
    "postReplies": { // Index replies directly under their root post for easy retrieval of a whole thread's replies
      "$postId": {
        "$replyId": true // Value is true, or could be timestamp for sorting within the post thread
      }
    }
    // postRepliesCount is denormalized directly in /posts/$postId/replyCount
  },

  "replyMetadata": {
    "parentReplies": { // Index replies under their direct parent (first element of parentId array)
      "$parentPostOrReplyId": {
        "$replyId": true // Or store timestamp for sorting replies to a specific parent
      }
    },
    "quoteCounts": { // Tracks how many times a specific quote within a parent has been replied to
      "$parentPostOrReplyId": {
        // Use a safe key representation of the quote object
        // Option 1: Use a stable hash (e.g., SHA-1 hex digest) of the canonical quote object string
        "$hashedQuoteKey": { // Key is hash of quote object
          "quote": { /* full quote object */ }, // Store original quote for reference
          "count": 5 // Atomically updated counter
        }
      }
    }
    // Add other indexes as needed, matching rules paths
  },

  // 6. Reply Indexes for Sorted Queries (Used by Z-set Emulation)
  // These store data keyed for efficient timestamp-based range queries.
  // Keys are typically <timestamp>_<uniqueId> to ensure order and uniqueness.
  "indexes": {
      "repliesFeedByTimestamp": { // Global feed sorted by time
          "$timestamp_$replyId": "$replyId" // Value is the reply ID (or minimal needed data)
      },
      "repliesByParentQuoteTimestamp": { // Replies to specific parent/quote, sorted by time
          "$sanitizedParentId": {
              "$sanitizedQuoteKey": {
                  "$timestamp_$replyId": "$replyId" // Value is reply ID
              }
          }
      },
      "repliesByQuoteTimestamp": { // Replies to specific quote (regardless of parent), sorted by time
          "$sanitizedQuoteIdentifier": { // Could be quoteKey or quoteText
              "$timestamp_$replyId": "$replyId" // Value is reply ID
          }
      },
      "repliesByParentTextTimestamp": { // Replies to specific parent/quoteText, sorted by time
           "$sanitizedParentId": {
              "$sanitizedQuoteText": {
                  "$timestamp_$replyId": "$replyId" // Value is reply ID
              }
          }
      }
      // Add other indexes corresponding to zAdd needs
  }
}
```

Key Construction and Dynamic Values:

*   **Primary Keys:** Use condensed UUIDs (`$userId`, `$postId`, `$replyId`). Use Firebase Push IDs (`$feedItemId_pushKey`) for `feedItems`. These become the direct key under the main data nodes (e.g., `/posts/$postId`).
*   **Index Keys:**
    *   For Sets (`userIds`, `userPosts`, `userReplies`, etc.): Use the relevant ID (`$userId`, `$postId`, `$replyId`) as the key; the value is typically `true`.
    *   For Timestamp Indexes (`indexes/*`): Use a composite key like `$timestamp_$id` for unique, chronological sorting. The value is often just the ID or minimal required data.
*   **Dynamic/User-Input Keys:** For keys based on dynamic values like email addresses (`emailToId`) or parts of quotes (`replyMetadata/quoteCounts/$parentId/$hashedQuoteKey`, `indexes/.../$sanitizedQuoteKey`), they **must** be sanitized/escaped/hashed.
    *   **Sanitizing/Escaping:** Use a reliable method (like the percent-encoding in `FirebaseClient.sanitizeKey`) to replace forbidden Firebase key characters (`.`, `$`, `#`, `[`, `]`, `/`). Apply consistently.
    *   **Hashing (for Keys):** For complex keys like the quote object in `quoteCounts`, using a stable hash (e.g., SHA-1 hex digest) of the canonical representation of the quote object is recommended (`$hashedQuoteKey`). Store the full quote object alongside the count as the value for context.
*   **Values:**
    *   Use standard JSON types. Avoid storing `undefined`.
    *   Use ISO 8601 timestamp strings generated by the backend server for primary `createdAt` fields.
    *   Firebase Server Timestamps (`{ ".sv": "timestamp" }`) should generally be avoided for primary data records but *can* be useful for simple indexes or priorities where server-side generation is acceptable.
    *   Store denormalized counts (`replyCount`) and update them using Firebase Transactions via `hIncrBy`.
    *   Store denormalized data like `authorUsername` directly where needed for reads. Remember this requires updating if the source changes.

## Database Access Patterns (Firebase RTDB)

### Replies Access Patterns

This section outlines how replies are accessed or indexed, primarily using the new `indexes/*` structure for sorted queries previously handled by Redis Z-sets.

1.  **Global Replies Feed (Sorted by Time):** `indexes/repliesFeedByTimestamp`
    *   **Structure:** Contains keys like `$timestamp_$replyId` with the `replyId` as the value.
    *   **Purpose:** Enables fetching the most recent replies globally using Firebase range queries (`orderByKey`, `limitToLast`). Populated by `zAdd('replies:feed:mostRecent', ...)` calls.
    *   **Access:** Via `zRange`, `zRevRangeByScore`, `zscan` methods on the `replies:feed:mostRecent` logical key, which maps to this path.

2.  **Replies by Parent and Quote (Sorted by Time):** `indexes/repliesByParentQuoteTimestamp/$sanitizedParentId/$sanitizedQuoteKey`
    *   **Structure:** Nested path containing keys like `$timestamp_$replyId` with `replyId` as value.
    *   **Purpose:** Efficiently retrieves replies for a specific parent and quote, sorted chronologically. Populated by `zAdd('replies:uuid:<parentId>:quote:<quoteKey>:mostRecent', ...)` calls.
    *   **Access:** Via `zRange`, `zRevRangeByScore`, `zscan` methods on the corresponding logical key.

3.  **Replies by Quote Identifier (Sorted by Time):** `indexes/repliesByQuoteTimestamp/$sanitizedQuoteIdentifier`
    *   **Structure:** Contains keys like `$timestamp_$replyId` with `replyId` as value. `quoteIdentifier` can be derived from `quoteKey` or `quoteText`.
    *   **Purpose:** Retrieves replies matching a specific quote (identified by key or text) across different parents, sorted chronologically. Populated by `zAdd('replies:quote:<quoteKeyOrText>:mostRecent', ...)` calls.
    *   **Access:** Via `zRange`, `zRevRangeByScore`, `zscan` methods on the corresponding logical key.

4.  **Replies by Parent and Quote Text (Sorted by Time):** `indexes/repliesByParentTextTimestamp/$sanitizedParentId/$sanitizedQuoteText`
    *   **Structure:** Nested path containing keys like `$timestamp_$replyId` with `replyId` as value.
    *   **Purpose:** Alternative lookup for replies to a specific parent based on the raw quote text, sorted chronologically. Populated by `zAdd('replies:<parentId>:<quoteText>:mostRecent', ...)` calls.
    *   **Access:** Via `zRange`, `zRevRangeByScore`, `zscan` methods on the corresponding logical key.

5.  **Quote Reply Counts:** `replyMetadata/quoteCounts/$parentPostOrReplyId/$hashedQuoteKey`
    *   **Structure:** Stores `{ quote: Quote, count: number }`.
    *   **Purpose:** Atomically tracks reply counts for specific quotes within a parent. Updated via `hIncrementQuoteCount`.
    *   **Access:** Direct read via `hGetAll` on `replyMetadata/quoteCounts/$parentId` or potentially a specific `hGet` if the hash key is known.

6.  **Direct Reply Lookup:** `/replies/$replyId`
    *   **Purpose:** Retrieves the full data for a single reply by its ID.
    *   **Access:** Via `get('/replies/' + replyId)` or potentially `hGet('replies:' + replyId, 'reply')` depending on how routes call it.

7.  **User's Replies:** `userMetadata/userReplies/$userId`
    *   **Structure:** Map where keys are `$replyId` and value is `true`.
    *   **Purpose:** Lists replies created by a specific user. Updated via `sAdd('userReplies:userId', replyId)`.
    *   **Access:** Via `sMembers('userReplies:userId')`.

## Implementation Status & Next Steps

The migration to the Firebase RTDB data model is partially complete. `FirebaseClient.ts` has been refactored to remove path hashing and implement direct path access for most operations, including mapping sorted set operations to timestamp-based indexes.

**Completed Steps:**
*   Removed path hashing (`hashFirebaseKey`, `_escapeFirebaseKey`) from `FirebaseClient`.
*   Refactored `FirebaseClient` methods (`set`, `sAdd`, `sMembers`, `hSet`, `hIncrBy`, `hIncrementQuoteCount`, `zAdd`, `zCard`, `zRange`, `zRevRangeByScore`, `zscan`, etc.) to use direct paths or appropriate helper functions (`parseKey`, `mapZSetKeyToIndexBasePath`).
*   Implemented `mapZSetKeyToIndexBasePath` based on `zAdd` calls found in `seed.ts`.

**Remaining Tasks:**

1.  **Fix `FirebaseClient.hGet`:** Update `hGet` to use `parseKey` similar to `hSet` instead of simple path concatenation.
2.  **Verify Key Formats in Routes:** Audit all calls to `FirebaseClient` methods (via `db` instance) in `routes/*.ts` and `server.ts`. Ensure the keys passed match the formats expected by `parseKey` (`collection:id`), `sAdd`/`sMembers` (`collection:id`), and `mapZSetKeyToIndexBasePath` (Redis-style keys). Update calls as needed.
3.  **Update Route Data Handling:** Review routes to ensure they correctly handle the data structures returned by the refactored `FirebaseClient` methods (especially `zRange`, `zRevRangeByScore`, `zscan`).
4.  **Review `CompressedDatabaseClient.ts`:** Verify that the wrapper correctly handles the (potentially changed) data structures returned by the refactored `FirebaseClient` methods it wraps, especially for decompression logic on sorted set results.
5.  **Update `migrate.ts`:** Refactor the migration script (`rebuildPostIndexes`, `validateMigration`) to work with the *new* data model paths and structures. Remove usage of internal `FirebaseClient` methods/properties.
6.  **Update `backend_architecture.md` (This document):** Ensure it fully reflects the final data model, indexes, and access patterns. **(This step is currently being done)**.
7.  **Align `database.rules.json`:** Modify security rules to *exactly* match the new data model paths and structures, including the new `indexes/*` paths. Update validation rules for index nodes (e.g., `/indexes/.../$timestamp_$replyId`) to match the data actually stored there (likely just the replyId string).
8.  **Test Thoroughly:** Perform comprehensive testing of all API endpoints and data operations after all changes are complete.

## Backend Files Overview

### Aphorist/backend/server.ts
// REVISED: Now initializes FirebaseClient, handles migration/import logic, and injects DB client into routes.

### Aphorist/backend/mailer.ts

### Aphorist/backend/seed.ts
// REVISED: Uses the DatabaseClientInterface, populates Firebase with sample data following the new model. Relies on specific key formats for zAdd calls.

### Aphorist/backend/migrate.ts
// REVISED: Contains logic to migrate data from an older format (presumably from an RTDB import) to the new Firebase data model. Reads old keys, transforms data, writes to new paths, rebuilds indexes, and validates. Needs significant updates to align with the refactored FirebaseClient and new data structures/indexes.

### Aphorist/backend/db/FirebaseClient.ts
// REVISED Purpose:
// Implements the DatabaseClientInterface using the Firebase Admin SDK for the Realtime Database.
// This class has been refactored to remove path hashing and use direct paths corresponding to the defined Backend Data Model.
// It maps Redis-like commands (hSet, sAdd, zAdd, etc.) to appropriate Firebase RTDB operations and structures (updates, transactions, index nodes).
// Contains helper methods for parsing composite keys (e.g., "collection:id") and mapping sorted set keys to index paths.
// Still requires further refinement, especially for hGet, Z-set value storage, and validation of key formats used by callers.

### Aphorist/backend/db/CompressedDatabaseClient.ts
// REVISED Purpose:
// Wraps an underlying DatabaseClientInterface (typically FirebaseClient or RedisClient) to provide automatic compression/decompression of values using zlib.
// It intercepts methods like hSet, hGet, zAdd, zRange, etc., compresses outgoing values, and decompresses incoming values based on metadata.
// Needs review to ensure compatibility with the refactored FirebaseClient, particularly regarding data structures returned by Z-set methods.

### Aphorist/backend/db/LoggedDatabaseClient.ts
// REVISED Purpose:
// Wraps an underlying DatabaseClientInterface to add detailed logging for database operations, including context like request IDs. Passes calls through to the underlying client.

### Aphorist/backend/db/DatabaseClientInterface.ts
// REVISED Purpose:
// Defines the abstract interface for database operations, ensuring consistency between different implementations (Firebase, Redis). Includes methods for common key-value, hash, set, list, and sorted set operations.

### Aphorist/backend/db/DatabaseCompression.ts
// REVISED Purpose:
// Provides utility methods for compressing and decompressing data using zlib and Base64 encoding. Used by CompressedDatabaseClient.

// ... potentially add other relevant files ...

## Data Compression