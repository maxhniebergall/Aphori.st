# Aphorist Backend Architecture Document (Revised)

**Last Updated:** May 5, 2025

This document provides an overview of the Aphorist backend architecture, detailing the frontend APIs exposed by the backend server, including their request and response structures using TypeScript interfaces. Additionally, it outlines the backend data model for Firebase Realtime Database and provides descriptions of each backend file within the project.

## Table of Contents

  * [Frontend APIs](#frontend-apis)
      * [Authentication APIs](#authentication-apis)
      * [User Management APIs](#user-management-apis)
      * [Reply APIs](#reply-apis)
      * [Post APIs](#post-apis)
      * [Feed APIs](#feed-apis)
  * [Backend Data Model (Firebase RTDB)](#backend-data-model-firebase-rtdb)
  * [Database Access Patterns (Firebase RTDB)](#database-access-patterns-firebase-rtdb)
      * [Replies Access Patterns](#replies-access-patterns)
  * [Implementation Status & Next Steps](#implementation-status--next-steps)
  * [Path Management and Key Sanitization (Proposed Enhancement)](#path-management-and-key-sanitization-proposed-enhancement)
  * [Backend Files Overview](#backend-files-overview)
  * [Data Compression](#data-compression)

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
Authorization: Bearer \<token\>

**Response Interface:**

```typescript
interface ProfileResponse {
id: string;
email: string;
// username?: string; // Add when implemented
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
  verificationToken?: string; // If email verification precedes signup completion
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
Creates a new reply to a post or another reply. Requires authentication.

**Request Interface:**

```typescript
interface CreateReplyRequest {
  parentId: string; // ID of the direct parent post or reply being replied to
  text: string;
  quote: {  // Required field for tracking what specific text is being replied to
    text: string;
    sourceId: string; // ID of the post/reply where the quote originated
    selectionRange: {
      start: number;
      end: number;
    };
  };
  // authorId is derived from the authentication token on the backend
}
```

**Response Interface:**

```typescript
interface CreateReplyResponse {
  success: boolean;
  data?: {
    id: string; // ID of the newly created reply
  };
  error?: string;
}
```

**Authentication:**
Requires valid authentication token in Authorization header. Backend uses token to determine `authorId`.

**Error Responses:**

  * 400: Missing required fields (`parentId`, `text`, `quote`) or invalid data format.
  * 401: Invalid or missing authentication token.
  * 404: Parent post or reply not found.
  * 500: Server error.

#### GET /api/getReplies/:uuid/:quote/:sortingCriteria

**Description:**
Retrieves replies for a specific post and quote with sorting options.

**URL Parameters:**

  * uuid: The uuid of the parent post or reply.
  * quote: The quote identifier (e.g., sanitized text or quote key hash) used for filtering/indexing.
  * sortingCriteria: The criteria to sort the replies by (e.g., `mostRecent`, `oldest`).

**Query Parameters:**

  * cursor?: string (For pagination, likely a timestamp or `timestamp_replyId`)

**Response Interface:**

```typescript
interface GetRepliesResponse {
  // Typically returns an array of Reply IDs or full Reply objects
  replies: string[] | ReplyData[];
  pagination: {
    nextCursor?: string;
    // previousCursor?: string; // Optional, depending on pagination strategy
  };
}

// Define ReplyData structure if returning full objects
interface ReplyData {
  id: string;
  authorId: string;
  // authorUsername?: string;
  text: string;
  parentId: string;
  parentType: "post" | "reply";
  rootPostId: string;
  quote: { /* ... */ };
  createdAt: string; // ISO 8601 Timestamp String
}
```

#### GET /api/getRepliesFeed

**Description:**
Retrieves a global feed of replies sorted by recency.

**Query Parameters:**

  * cursor?: string (For pagination)

**Response Interface:**

```typescript
interface GetRepliesFeedResponse {
  replies: string[] | ReplyData[]; // Array of Reply IDs or full Reply objects
  pagination: {
    nextCursor?: string;
  };
}
```

### Post APIs

*(Formerly PostTree APIs)*

#### GET /api/post/:uuid

**Description:**
Fetches the data for a **single post** associated with the given uuid. Does *not* fetch replies.

**URL Parameters:**

  * uuid: string (ID of the post)

**Response Interface:**

```typescript
// Define PostData structure
interface PostData {
    id: string;
    authorId: string;
    // authorUsername?: string;
    content: string;
    createdAt: string; // ISO 8601 Timestamp String
    replyCount: number;
    // other post metadata
}

interface GetPostResponse {
  success: boolean;
  post?: PostData;
  error?: string;
}
```

#### POST /api/createPost

**Description:**
Creates a new root post. Requires authentication.

**Request Interface:**

```typescript
interface CreatePostRequest {
  content: string;
  // authorId is derived from the authentication token on the backend
  // other potential fields for root post creation
}
```

**Response Interface:**

```typescript
interface CreatePostResponse {
  success: boolean;
  data?: {
    id: string; // UUID of the newly created post
  };
  message?: string;
  error?: string;
}
```

### Feed APIs

#### GET /api/feed

**Description:**
Retrieves a paginated list of feed items (representing root posts).

**Query Parameters:**

  * cursor?: string (For pagination, likely a Push ID or timestamp)

**Response Interface:**

```typescript
interface FeedItem {
  id: string; // ID of the post
  authorId: string;
  // authorUsername?: string;
  textSnippet: string; // e.g., First N characters of post content
  createdAt: string; // ISO 8601 Timestamp String
  // Potentially other fields like title, replyCount
}

interface GetFeedResponse {
  success: boolean;
  items?: FeedItem[];
  pagination?: {
    nextCursor?: string;
  };
  error?: string;
}

```

## Backend Data Model (Firebase RTDB)

The backend utilizes Firebase Realtime Database (RTDB). The following data model is designed to leverage RTDB's strengths while enabling efficient querying and security rule enforcement.

**Core Principles:**

  * **Flat Structure:** Keep data relatively flat. Avoid deep nesting where possible.
  * **Denormalization:** Duplicate data where necessary for efficient reads, especially for list views or displaying related info (e.g., author username alongside a post).
  * **Predictable Paths:** Use clear, human-readable path segments based on collections and IDs (e.g., `/users/$userId`, `/posts/$postId`). Direct paths are crucial for security rules.
  * **Use Native Keys:** Use UUIDs (e.g., uuidv7 condensed to 25 digits) directly as keys under the appropriate nodes (e.g., `/posts/<postId>`). Firebase Push IDs are used for list-like structures where chronological ordering is inherent (e.g., `/feedItems`).
  * **Index for Queries:** Create specific index nodes to query relationships efficiently (e.g., posts by user, replies by timestamp).
  * **Maps over Lists:** Use JSON objects (maps) with unique keys instead of arrays/lists for collections where items might be added/removed frequently or where the collection size can grow large. RTDB handles maps much more efficiently.

**Data Model Structure:**

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
      "replyCount": 0 // Atomically updated counter (managed via Firebase Transaction)
      // other post metadata
    }
  },

  // 3. Reply Data
  "replies": {
    "$replyId": { // Key is the condensed UUID
      "id": "$replyId",                   // Matches key for convenience
      "authorId": "$userId",
      "text": "Text of the reply...",
      "parentId": "$directParentId",       // <<< CHANGED: ID of the direct parent (post or reply)
      "parentType": "post" | "reply",   // <<< ADDED: Type of the direct parent
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
  "feedItems": { // Path uses RTDB push() for chronological ordering
    "$feedItemId_pushKey": { // Firebase push keys sort chronologically
      "id": "$postId", // Reference to the original post
      "authorId": "$userId",
      // "authorUsername": "someUsername", // Denormalized if needed
      "textSnippet": "First N chars of post...", // Denormalized snippet
      "createdAt": "ISO8601_Timestamp_String" // Backend server timestamp string (matches post createdAt)
    }
  },
  // Counter for feed items (optional, if needed beyond client-side counts)
  "feedStats": {
      "itemCount": 123 // Atomically updated counter via Transaction
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
    "parentReplies": { // <<< UPDATED: Index replies under their DIRECT parent
      "$directParentId": { // Key is the ID from /replies/$replyId/parentId
        "$replyId": true // Or store timestamp for sorting replies to a specific parent
      }
    },
    "quoteCounts": { // Tracks how many times a specific quote within a parent has been replied to
      "$parentPostOrReplyId": {
        // Use a safe key representation of the quote object
        // Option: Use a stable hash (e.g., SHA-1 hex digest) of the canonical quote object string
        "$hashedQuoteKey": { // Key is hash of quote object
          "quote": { /* full quote object */ }, // Store original quote for reference
          "count": 5 // Atomically updated counter via Transaction
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
          "$timestamp_$replyId": "$replyId" // Value is the reply ID
      },
      "repliesByParentQuoteTimestamp": { // Replies to specific parent/quote, sorted by time
          "$sanitizedParentId": {
              "$sanitizedQuoteKey": {
                  "$timestamp_$replyId": "$replyId" // Value is reply ID
              }
          }
      },
      // ... other sorted indexes as needed ...
      // Example:
      // "repliesByRootPostTimestamp": { // All replies for a thread sorted by time
      //     "$rootPostId": {
      //         "$timestamp_$replyId": "$replyId"
      //     }
      // }
  }
}
```

**Key Construction and Dynamic Values:**

  * **Primary Keys:** Use condensed UUIDs (`$userId`, `$postId`, `$replyId`). Use Firebase Push IDs (`$feedItemId_pushKey`) for `feedItems`. These become the direct key under the main data nodes (e.g., `/posts/$postId`).
  * **Index Keys:**
      * For Sets (`userIds`, `userPosts`, `userReplies`, etc.): Use the relevant ID (`$userId`, `$postId`, `$replyId`) as the key; the value is typically `true`.
      * For Timestamp Indexes (`indexes/*`): Use a composite key like `$timestamp_$id` for unique, chronological sorting. The value is often just the ID or minimal required data. `$timestamp` should be a fixed-length numerical representation (e.g., milliseconds since epoch).
  * **Dynamic/User-Input Keys:** For keys based on dynamic values like email addresses (`emailToId`) or parts of quotes (`replyMetadata/quoteCounts/$parentId/$hashedQuoteKey`, `indexes/.../$sanitizedQuoteKey`), they **must** be sanitized/escaped/hashed.
      * **Sanitizing/Escaping:** Use a reliable method (like percent-encoding) to replace forbidden Firebase key characters (`.`, `$`, `#`, `[`, `]`, `/`). Apply consistently.
      * **Hashing (for Keys):** For complex keys like the quote object in `quoteCounts`, using a stable hash (e.g., SHA-1 hex digest) of the canonical representation of the quote object is recommended (`$hashedQuoteKey`). Store the full quote object alongside the count as the value for context.
  * **Values:**
      * Use standard JSON types. Avoid storing `undefined`.
      * Use ISO 8601 timestamp strings generated consistently by the backend server (preferably in UTC) for primary `createdAt` fields. This approach was chosen to simplify potential data migration or restoration tasks compared to using Firebase Server Timestamps.
      * Store denormalized counts (`replyCount`, `quoteCounts/.../count`) and update them **atomically** using **Firebase Transactions** to prevent race conditions.
      * Store denormalized data like `authorUsername` directly where needed for reads. Remember this requires updating if the source changes (e.g., user profile update).

## Database Access Patterns (Firebase RTDB)

This section outlines how key data entities, particularly replies requiring sorted queries, are accessed using the defined data model and index structures. The `indexes/*` paths emulate sorted set functionality previously associated with Redis Z-sets.

### Replies Access Patterns

1.  **Global Replies Feed (Sorted by Time):** `indexes/repliesFeedByTimestamp`

      * **Access:** Use Firebase range queries (`orderByKey`, `limitToLast(N)`, `endAt(cursor)`) on this path to fetch pages of the most recent replies globally. The keys (`$timestamp_$replyId`) ensure chronological order.
      * **Maps to:** `zRange`, `zRevRangeByScore`, `zscan` calls on the logical key `replies:feed:mostRecent` in `FirebaseClient`.

2.  **Replies by Parent and Quote (Sorted by Time):** `indexes/repliesByParentQuoteTimestamp/$sanitizedParentId/$sanitizedQuoteKey`

      * **Access:** Use range queries on the nested path to get replies for a specific parent/quote combination, sorted by time.
      * **Maps to:** `zRange`, `zRevRangeByScore`, `zscan` calls on logical keys like `replies:uuid:<parentId>:quote:<quoteKey>:mostRecent`.

3.  **(Other Indexed Lookups):** Similar access patterns apply to other paths defined under `/indexes`, allowing sorted fetching based on quote identifiers, parent/quote text, etc.

4.  **Quote Reply Counts:** `replyMetadata/quoteCounts/$parentPostOrReplyId/$hashedQuoteKey`

      * **Access:** Direct read via `get()` on the specific path to get the count object `{ quote, count }`. Can also read all quote counts for a parent via `get()` on `/replyMetadata/quoteCounts/$parentPostOrReplyId`.
      * **Update:** Use **Firebase Transaction** to atomically increment the `count` field.
      * **Maps to:** `hGetAll('replyMetadata:quoteCounts:' + parentId)`, `hIncrementQuoteCount`.

5.  **Direct Reply Lookup:** `/replies/$replyId`

      * **Access:** Direct read via `get('/replies/' + replyId)`.

6.  **User's Replies:** `userMetadata/userReplies/$userId`

      * **Access:** Direct read via `get('/userMetadata/userReplies/' + userId)` to retrieve the map of reply IDs.
      * **Maps to:** `sMembers('userReplies:' + userId)`.

7.  **Replies for a Post Thread:** `postMetadata/postReplies/$postId`

      * **Access:** Direct read via `get('/postMetadata/postReplies/' + postId)` to get all reply IDs for a thread. Combine with reads from `/replies/$replyId` as needed. Alternatively, query `/replies` using `orderByChild('rootPostId').equalTo('$postId')` (requires defining `.indexOn` rule for `rootPostId` on `/replies`). A dedicated index like `indexes/repliesByRootPostTimestamp` might be more efficient for sorted retrieval.

8.  **Client-Side Orchestration for Engagement-Sorted Replies (New Frontend Strategy):**
    *   **Context:** The frontend (`PostTreeOperator`) is implementing a new strategy to display replies sorted by engagement (total count of replies to their own quotes) and then by recency, without filtering by a specific quote selected in the parent.
    *   **Current Access Pattern (Client-Side):**
        1.  Fetch all direct reply IDs for a parent node: Direct read from `replyMetadata/parentReplies/$directParentId` to get a map like `{ replyId1: true, ... }`.
        2.  Fetch individual reply data: For each `replyId` obtained, direct read from `/replies/$replyId`.
        3.  Fetch quote counts for each reply: For each `replyId`, access its quote counts (how many times quotes *within this reply* have been replied to). This is done via the existing API `GET /api/replies/quoteCounts/:replyId` (which reads from `replyMetadata/quoteCounts/$replyId`).
        4.  Client-Side Processing: The frontend then calculates a total engagement score for each reply by summing its fetched quote counts and performs the sorting (engagement desc, then createdAt desc).
    *   **Backend Implication (Minimal Initial Change):** This approach composes existing backend read capabilities. No immediate new backend APIs or data model *modifications* are required for the frontend to implement this initial version.
    *   **Future Optimization:** For improved performance, reduced client-side complexity, and more robust pagination, a dedicated backend API endpoint could be developed in the future. Such an endpoint might accept a `parentId` and pagination parameters, and return a pre-sorted (by engagement/recency) list of replies. This would involve server-side aggregation of data similar to the client-side steps described above.

## Implementation Status & Next Steps

The backend architecture has been significantly refactored to align with Firebase RTDB best practices and remove previous complexities like path hashing and database-level compression.

**Completed Steps:**

  * Refactored `FirebaseClient` to use direct RTDB paths.
  * Mapped Redis-like commands (`hSet`, `sAdd`, `zAdd`, etc.) to appropriate RTDB operations (updates, transactions, index nodes).
  * Defined clear index structures (`/indexes/*`) for emulating sorted sets.
  * Refined API definitions and data structures based on feedback (e.g., Reply `parentId`, Post API).
  * **Decision:** Removed database-level value compression (`CompressedDatabaseClient` is no longer needed).

**Remaining Tasks:**

1.  **Verify `FirebaseClient` Implementation:** Double-check that all methods correctly implement the intended RTDB operations (especially ensuring Transactions are used for counters). Verify `hGet` implementation.
2.  **Verify Key Formats in Routes:** Audit all calls to `FirebaseClient` methods (via `db` instance) in `routes/*.ts` and `server.ts`. Ensure the keys passed match the formats expected by the client (e.g., `collection:id`, Redis-style Z-set keys for mapping, sanitized keys where needed). Update calls as needed.
3.  **Update Route Data Handling:** Review routes to ensure they correctly handle the data structures returned by the refactored `FirebaseClient` methods (especially for sorted set emulations). Adjust API response formats if needed.
4.  **Update `migrate.ts`:** Refactor the migration script to work with the *new* data model paths and structures. Remove dependencies on deprecated components like `CompressedDatabaseClient`.
5.  **Align `database.rules.json`:** **Critically important.** Modify security rules to *exactly* match this data model's paths and structures. Add validation for all nodes, including the `indexes/*` paths (e.g., ensuring `$timestamp_$replyId` keys store string `replyId` values). Define `.indexOn` rules for fields used in queries (e.g., `rootPostId` on `/replies` if using `orderByChild`).
6.  **Test Thoroughly:** Perform comprehensive end-to-end testing of all API endpoints and data operations after all changes are complete.

## Path Management and Key Sanitization (Proposed Enhancement)

**Current State & Challenge:**
- The `FirebaseClient.ts` currently constructs Firebase paths using string templates and direct calls to sanitization utilities (e.g., `this.sanitizeKey()`).
- Specific path structures are often hardcoded within various methods (e.g., in `sAdd`, `hIncrBy`, `mapZSetKeyToIndexBasePath`).
- While recent efforts have improved sanitization consistency, this approach can be error-prone, difficult to maintain, and makes schema changes cumbersome. Ensuring every dynamic path segment is correctly sanitized relies on developer diligence within each method.

**Proposed Strategy: Centralized Path Generation & Typed Identifiers**

To improve robustness, maintainability, and type safety, a more centralized path management system is proposed:

1.  **Path Definition Module/Service:**
    *   Create a dedicated module (e.g., `firebasePaths.ts` or a `PathBuilder` class) responsible for generating all Firebase Realtime Database paths.
    *   This module would contain typed functions for each distinct path structure in the application.
    *   Example:
        ```typescript
        // firebasePaths.ts
        import { sanitizeKey } from './firebaseUtils'; // Assuming sanitizeKey is extracted or accessible

        export const paths = {
          user: (userId: string) => `users/${sanitizeKey(userId)}`,
          userEmailMap: (escapedEmail: string) => `userMetadata/emailToId/${escapedEmail}`, // Assumes email is pre-escaped by caller
          post: (postId: string) => `posts/${sanitizeKey(postId)}`,
          reply: (replyId: string) => `replies/${sanitizeKey(replyId)}`,
          replyQuoteCount: (
            parentId: string, 
            hashedQuoteKey: string
          ) => `replyMetadata/quoteCounts/${sanitizeKey(parentId)}/${sanitizeKey(hashedQuoteKey)}`,
          index: {
            repliesFeedByTimestamp: () => `indexes/repliesFeedByTimestamp`,
            repliesByParentQuoteTimestamp: (
              parentId: string, 
              sanitizedQuoteKey: string
            ) => `indexes/repliesByParentQuoteTimestamp/${sanitizeKey(parentId)}/${sanitizedQuoteKey}` // Note: might expect pre-sanitized quoteKey
          },
          // ... other paths for userPosts, postReplies, feedItems, etc.
        };
        ```
    *   Sanitization logic for path segments would be encapsulated within these path builder functions, ensuring consistency.

2.  **FirebaseClient Integration:**
    *   The `FirebaseClient` methods would import and use this path building module/service instead of constructing paths manually.
    *   Example (inside `FirebaseClient.ts`):
        ```typescript
        // Assuming 'this.paths' is an instance of the PathBuilder or imports 'paths'
        async hIncrementQuoteCount(parentId: string, hashedQuoteKey: string, quoteValue: any): Promise<number> {
            // parentId and hashedQuoteKey are raw inputs here
            const refPath = this.paths.reply.quoteCount(parentId, hashedQuoteKey);
            const ref = this.db.ref(refPath);
            // ... transaction logic ...
        }
        ```

3.  **Typed Resource Identifiers (Optional but Recommended):**
    *   Introduce simple opaque types or branded types for different kinds of IDs (e.g., `UserId`, `PostId`, `HashedQuoteKey`).
    *   Path builder functions would accept these typed IDs, improving type safety and clarity about what kind of identifier is expected.
    *   Sanitization functions might then be more specific, e.g., `sanitizeUserId(id: UserId): string`.

**Benefits:**
*   **Single Source of Truth:** Path structures are defined in one place, making schema changes easier to implement and verify.
*   **Reduced Errors:** Consistent sanitization applied by the path builders minimizes the risk of missed sanitization in client methods.
*   **Improved Readability & Maintainability:** `FirebaseClient` methods become cleaner as path construction logic is abstracted away.
*   **Enhanced Testability:** The path generation logic can be unit-tested independently.
*   **Type Safety (with typed IDs):** Reduces the chance of passing the wrong type of ID to a path function.

**Migration Steps (If Adopted):**
1.  Develop the `firebasePaths.ts` module with functions for all known paths.
2.  Refactor `FirebaseClient.ts` methods one by one to use the new path builders.
3.  Update call sites of `FirebaseClient` methods if their parameter signatures change (e.g., if they now expect raw IDs instead of pre-formatted/pre-sanitized keys for some operations).

This proposal aims to address the current challenges with path management and make the backend data access layer more robust and maintainable in the long term.

## Backend Files Overview

*(Update file descriptions based on final implementation)*

  * **Aphorist/backend/server.ts:** Initializes Firebase Admin SDK, `FirebaseClient`, handles startup logic (migration?), sets up Express app, injects DB client into route handlers.
  * **Aphorist/backend/routes/\*.ts:** Define API endpoints, handle requests/responses, interact with the database via the injected `DatabaseClientInterface` (`db`). Needs careful review of key formats passed to `db`.
  * **Aphorist/backend/db/FirebaseClient.ts:** Implements `DatabaseClientInterface` using Firebase Admin SDK. Contains logic for direct path operations, mapping abstract commands (like `zAdd`) to RTDB index writes, and handling key parsing/sanitization. **Crucially uses Transactions for atomic increments.**
  * **Aphorist/backend/db/DatabaseClientInterface.ts:** Defines the abstract interface for database operations.
  * **Aphorist/backend/db/LoggedDatabaseClient.ts:** (Optional) Wraps `FirebaseClient` to add logging.
  * **Aphorist/backend/db/CompressedDatabaseClient.ts:** **Deprecated/Removed.** No longer needed as database compression is removed.
  * **Aphorist/backend/db/DatabaseCompression.ts:** **Deprecated/Removed.** No longer needed.
  * **Aphorist/backend/mailer.ts:** Handles sending emails (e.g., magic links).
  * **Aphorist/backend/seed.ts:** Populates Firebase with sample data following the new model.
  * **Aphorist/backend/migrate.ts:** Contains logic to migrate data to the new model. Needs updating.

## Data Compression

**Strategy:** Database-level compression is **not** used in this architecture.

**Rationale:** To simplify the backend implementation, improve data readability directly within the Firebase console (aiding debugging and inspection), and reduce backend CPU overhead, the `CompressedDatabaseClient` has been removed.

**Bandwidth Optimization:** Standard HTTP-level compression (e.g., gzip negotiated via `Accept-Encoding` / `Content-Encoding` headers) should be enabled at the web server or load balancer level. This effectively compresses data transferred between the backend server and frontend clients, optimizing user-facing bandwidth consumption without adding complexity to database interactions.

-----