# Aphorist Backend Architecture Document
This document provides an overview of the Aphorist backend architecture, detailing the frontend APIs exposed by the backend server, including their request and response structures using TypeScript interfaces. Additionally, it outlines any backend-private APIs and provides descriptions of each backend file within the project.

## Table of Contents
- [Frontend APIs](#frontend-apis)
  - [Authentication APIs](#authentication-apis)
  - [User Management APIs](#user-management-apis)
  - [Reply APIs](#reply-apis)
  - [PostTree APIs](#posttree-apis)
  - [Feed APIs](#feed-apis)
- [Backend-Private APIs](#backend-private-apis)
- [Backend Files Overview](#backend-files-overview)
- [Database Access Patterns for Replies](#database-access-patterns-for-replies)
- [Backend Data Model](#backend-data-model)
- [Redis Schema](#redis-schema)
- [API Endpoints](#api-endpoints)
  - [Post APIs](#post-apis)
  - [Reply APIs](#reply-apis)
  - [PostTree APIs](#posttree-apis)
  - [Feed APIs](#feed-apis)
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

## Backend-Private APIs

Currently, all exposed APIs are intended for frontend consumption. However, any future private APIs intended solely for backend operations should be documented in this section. These APIs are not exposed to the frontend and are used internally for tasks such as data migration, analytics, or administrative functions.

As of the current implementation, there are no backend-private APIs.

## Backend Files Overview

### Aphorist/backend/server.js

**Purpose:**  
This is the main server file that sets up and configures the Express.js server. It handles route definitions, middleware configurations (such as CORS and rate limiting), connects to the Redis database, and initializes various API endpoints for authentication, data management, and content retrieval.

**Key Responsibilities:**
- Server Configuration: Sets up the Express server, including JSON parsing and CORS settings.
- Redis Integration: Connects to a Redis server for data storage and retrieval operations.
- Authentication Management: Implements magic link authentication, token verification, and protected routes.
- API Endpoints: Defines RESTful APIs for creating and retrieving statements, managing post trees, and fetching feed items.
- Logging: Utilizes a custom logger for tracking server activities and errors.
- Rate Limiting: Applies rate limiting to sensitive routes to prevent abuse.

### Aphorist/backend/mailer.js

**Purpose:**  
Handles email functionalities within the backend, primarily responsible for sending emails such as magic links for user authentication.

**Key Responsibilities:**
- Nodemailer Configuration: Sets up the Nodemailer transporter using SMTP settings defined in environment variables.
- Email Sending: Provides the sendEmail function to dispatch emails with specified recipients, subjects, and HTML content.
- Transporter Verification: Ensures that the Nodemailer transporter is correctly configured and ready to send emails.
- Error Handling: Logs and throws errors encountered during the email sending process.

### Aphorist/backend/seed.js

**Purpose:**  
Used for seeding the Redis database with initial data. This script populates the database with sample authors, titles, and predefined post trees to facilitate development and testing.

**Key Responsibilities:**
- Redis Connection: Establishes and manages a connection to the Redis server.
- Data Seeding: Clears existing feed items and adds new posts with unique UUIDs (uuidv7obj as Uuid25) and structured post trees.
- Recursive PostTree Creation: Implements functions to create nested post nodes recursively, ensuring each node is correctly linked and stored in Redis.
- Feed Population: Adds feed items corresponding to each seeded post to the Redis feed list.
- Logging: Tracks the progress and any issues encountered during the seeding process.
- Random Data Generation: Utilizes random UUIDs (uuidv7obj as Uuid25) and selects random authors and titles from predefined lists to ensure uniqueness and variability in seeded data.

## Database Access Patterns for Replies

Below is a list of the key database patterns used for handling replies:

1. **Global Replies Feed**: `replies:feed:mostRecent`  
   - **Purpose:** Stores reply IDs for the global replies feed, enabling retrieval of the most recent replies across posts.

2. **Replies by Quote (General)**: `replies:quote:<quoteKey>:mostRecent`  
   - **Structure:** `<quoteKey>` is constructed from the reply's quote data (combining `quote.text`, `quote.sourcePostId`, and `quote.selectionRange` formatted as `start-end` when provided).  
   - **Purpose:** Indexes replies associated with a specific quote object, sorted by timestamp for recent activity.

3. **Replies by Parent ID and Detailed Quote**: `replies:uuid:<parentId>:quote:<quoteKey>:mostRecent`  
   - **Structure:** Utilizes the parent post's UUID (`<parentId>`) in addition to the detailed `<quoteKey>`.  
   - **Purpose:** Facilitates retrieval of replies for a specific parent post and associated quote, ensuring that reply queries are efficient and sorted by recency.

4. **Replies by Parent ID and Quote Text**: `replies:<actualParentId>:<quoteText>:mostRecent`  
   - **Purpose:** Provides an alternative lookup mechanism keyed only by the parent identifier (`<actualParentId>`) and the raw text of the quote (`<quoteText>`), sorted by timestamp. This pattern supports scenarios where a simplified index is beneficial.

5. **Dynamic Replies Retrieval with Sorting**: `replies:uuid:<uuid>:quote:<quoteKey>:<sortingCriteria>`  
   - **Structure:** Contains the node's UUID, the detailed `<quoteKey>`, and a dynamic `<sortingCriteria>` (e.g., "mostRecent", "oldest", etc.).  
   - **Purpose:** Supports cursor-based pagination and custom sorting options when retrieving replies associated with a given post and quote.

6. **Conditional Replies by Quote Text Only**: `replies:quote:<quote.text>:mostRecent`  
   - **Purpose:** When a reply includes a quote with text, it is conditionally indexed under this key to offer an additional means of retrieval based solely on the quote text.

Conclusion
The Aphorist backend is structured to provide robust and secure APIs for frontend interactions, leveraging Redis for efficient data storage and retrieval. With clear separation of concerns across its various files and comprehensive authentication mechanisms, the backend is well-equipped to support the application's functionalities. Future developments may introduce backend-private APIs and additional services, which will be documented accordingly.

## Backend Data Model
The fundamental problem with your current backend implementation (FirebaseClient) is the hashing of keys/paths. Firebase Security Rules operate directly on the path of the data. If your code writes to hash('users:userId123')/hash('data') but your rules expect /users/userId123, the rules for /users/$userId will never be triggered for that write operation. This completely bypasses your security and validation logic.   

Therefore, the primary recommendation is: Abandon the path/key hashing strategy used in FirebaseClient and adopt the clear, hierarchical paths defined in your database.rules.json.

Here’s a recommended data model based on this principle, incorporating RTDB best practices:

Core Principles:

Flat Structure: Keep data relatively flat. Avoid deep nesting where possible.
Denormalization: Duplicate data where necessary for efficient reads, especially for list views or displaying related info (e.g., author username alongside a post).
Predictable Paths: Use clear, human-readable path segments.
Use Native Keys: Use UUIDs (uuidv7obj as Uuid25) directly as keys under the appropriate nodes (e.g., /posts/<postId>).
Index for Queries: Create specific index nodes to query relationships efficiently (e.g., posts by user, replies by post).
Maps over Lists: Use JSON objects (maps) with unique keys instead of arrays/lists for collections where items might be added/removed frequently or where the collection size can grow large. RTDB handles maps much more efficiently.
Recommended Data Model Structure:

JSON

{
  // 1. User Data
  "users": {
    "$userId": {
      "id": "$userId",                   // Matches key for convenience
      "email": "user@example.com",
      "username": "someUsername",      
      "createdAt": { timestamp } // Use Backend server timestamp
      // other profile data (TBD)
    }
  },

  // 2. Post Data (Top-level posts)
  "posts": {
    "$postId": {
      "id": "$postId",                   // Matches key for convenience
      "authorId": "$userId",
      "authorUsername": "someUsername",  
      "content": "Text of the post...",
      "createdAt": { "timestamp" }, // use backend server timestamp
      "replyCount": 15,                  
    }
  },

  // 3. Reply Data
  "replies": {
    "$replyId": {
      "id": "$replyId",                   // Matches key for convenience
      "authorId": "$userId",
      "text": "Text of the reply...",
      "parentId": "$parentPostOrReplyId", // ID of the direct parent (post or reply)
      "parentType": "post" | "reply",   // Explicitly state parent type
      "rootPostId": "$postId",           // ID of the original post tree root (useful for fetching whole thread)
      "quote": {                         // Optional quote info
        "text": "Quoted text snippet",
        "sourceId": "$quotedPostOrReplyId",
        "selectionRange": { 
          "start": number,
          "end": number
        }
      },
      "createdAt": { "timestamp" } // use backend server timestamp
    }
  },

  // 4. Feed Items (Using a Map, ordered by key or timestamp)
  // Option A: Chronological Feed using Push IDs (naturally sortable)
  "feedItems": {
    "$feedItemId_pushKey": { // Firebase push keys sort chronologically
      "postId": "$postId",             // Reference to the original post
      "authorId": "$userId",
      "authorUsername": "someUsername",
      "textSnippet": "First N chars of post...", // Denormalized snippet
      "createdAt": { ".sv": "timestamp" } // Can be used for secondary sorting/filtering. Can use firebase timestamp here

    }
  },

  // 5. Metadata and Indexes (Aligns well with your rules structure)
  "userMetadata": {
    "emailToId": {
      "$escapedEmail": "$userId" // Key MUST be escaped (replace '.' with ',' etc.)
    },
    "userIds": {
      "$userId": true // Simple map to track existing user IDs
    },
    "userPosts": {
      "$userId": {
        "$postId": true // Map of posts created by this user
      }
    },
    "userReplies": {
      "$userId": {
        "$replyId": true // Map of replies created by this user
      }
    }
  },

  "postMetadata": {
    "allPostTreeIds": {
       "$postId": true // Map of all root post IDs
    },
    "postReplies": { // Index replies directly under their root post
      "$postId": {
        "$replyId": true // Or store timestamp for sorting: createdAtTimestamp
      }
    }
    // Could also add postRepliesCount here if needed separate from post data
  },

  "replyMetadata": {
    "parentReplies": { // Index replies under their direct parent (post or reply)
      "$parentPostOrReplyId": {
        "$replyId": true // Or store timestamp for sorting: createdAtTimestamp
      }
    },
    "quoteCounts": {
      "$parentPostOrReplyId": {
        // Use a safe key representation of the quote object
        // Option 1: Hash the quote object (consistent hash needed)
        "$hashedQuoteKey": {
          "quote": { /* full quote object */ },
          "count": 5
        }
    }
    // Add other indexes as needed, matching rules paths
  },

  "replyIndexes": { // For specialized reply lookups
     "byQuoteSource": {
       "$quotedSourceId": {
         "$replyId": true // or timestamp
       }
     },
     "byParentAndQuoteSource": {
       "$parentId":{
         "$quotedSourceId": {
           "$replyId": true // or timestamp
         }
       }
     }
     // Add other indexes corresponding to your zAdd needs
     // For sorted sets (like 'mostRecent'), consider using ordered queries
     // on nodes like `postMetadata/postReplies/$postId` ordered by timestamp,
     // or potentially a dedicated flat index if global sorting is critical.
  }
}
Key Construction and Dynamic Values:

Primary Keys: Use UUIDs (uuidv7obj as Uuid25) or Firebase Push IDs (.push().key) for $userId, $postId, $replyId, $feedItemId_pushKey. These become the direct key under the main data nodes (e.g., /posts/$postId).
Index Keys: Use the relevant IDs (like $userId, $postId, $replyId) as keys within the index nodes. The value is often true (to indicate presence) or a timestamp/score for ordering.
Dynamic/User-Input Keys: For keys based on dynamic values like email addresses (emailToId) or potentially parts of quotes (quoteCounts), you must sanitize/escape them. Firebase keys cannot contain ., $, #, [, ], or /.
Escaping: Create a utility function (like your _escapeFirebaseKey) that reliably replaces forbidden characters with allowed alternatives (e.g., . becomes ,, $ becomes _ S _, etc.) and can be reliably reversed if needed. Apply this consistently anywhere user data forms a key.
Hashing (for Keys, NOT Paths): For complex keys like the quote object in quoteCounts, using a stable hash (e.g., SHA-1 or MD5 hex digest) of the canonical representation of the quote object can create a safe and unique key ($hashedQuoteKey). Store the full quote object alongside the count as the value.
  
Values:
Use standard JSON types.
Use { ".sv": "timestamp" } for reliable, server-generated timestamps for indexes only. Use backend timestamps for important write operaitons.
Store denormalized counts (replyCount) and update them using Firebase Transactions to avoid race conditions.
Store denormalized data like authorUsername directly where needed for reads. Remember to update this if the source data (e.g., username in /users/$userId) changes (this is the cost of denormalization).
Implementation Changes Needed:

Refactor FirebaseClient / CompressedDatabaseClient:
Remove the path/key hashing logic.
Use direct, clear paths corresponding to the model above (and your rules).
Ensure methods like hSet, sAdd, lPush, zAdd are mapped correctly to RTDB operations on the new structure:
hSet on /posts/$postId likely becomes .ref('/posts/' + postId).set(postObject) or .update(updates).
sAdd to user:id:posts becomes .ref('/userMetadata/userPosts/' + userId + '/' + postId).set(true).
lPush to feedItems becomes .ref('/feedItems').push(feedItemObject). Reading requires .orderByKey().limitToLast(N).
zAdd needs careful mapping to storing data in an index node, possibly with a timestamp as the value or part of the key, then using .orderByValue() or .orderByChild().
Keep compression if needed, but apply it to the value being written, not the path.
Update Backend Logic (auth.ts, posts.ts, etc.): Modify all database read/write operations to use the new paths and structures. Update object shapes to include/remove fields as per the new model (e.g., add authorUsername, rootPostId). Use transactions for counter updates.
Align database.rules.json: Ensure your rules perfectly match this new structure, including paths and data validation for denormalized fields.
This approach gives you a data model that is idiomatic to Firebase RTDB, allows your security rules to function correctly, supports efficient querying through indexes, and uses best practices for key construction and data organization.

## Redis Schema

## API Endpoints

## Data Compression