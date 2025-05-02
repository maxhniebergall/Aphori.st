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
- Data Seeding: Clears existing feed items and adds new posts with unique UUIDs and structured post trees.
- Recursive PostTree Creation: Implements functions to create nested post nodes recursively, ensuring each node is correctly linked and stored in Redis.
- Feed Population: Adds feed items corresponding to each seeded post to the Redis feed list.
- Logging: Tracks the progress and any issues encountered during the seeding process.
- Random Data Generation: Utilizes random UUIDs and selects random authors and titles from predefined lists to ensure uniqueness and variability in seeded data.

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

## Redis Schema

## API Endpoints

## Data Compression