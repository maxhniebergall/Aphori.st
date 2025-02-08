# Aphorist Backend Architecture Document
This document provides an overview of the Aphorist backend architecture, detailing the frontend APIs exposed by the backend server, including their request and response structures using TypeScript interfaces. Additionally, it outlines any backend-private APIs and provides descriptions of each backend file within the project.

## Table of Contents
- [Frontend APIs](#frontend-apis)
  - [Authentication APIs](#authentication-apis)
  - [User Management APIs](#user-management-apis)
  - [Reply APIs](#reply-apis)
  - [StoryTree APIs](#storytree-apis)
  - [Feed APIs](#feed-apis)
- [Backend-Private APIs](#backend-private-apis)
- [Backend Files Overview](#backend-files-overview)

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
Creates a new reply to a story or another reply.

**Request Interface:**
```typescript
interface CreateReplyRequest {
  parentId: string | string[];
  text: string;
  quote?: {
    text: string;
    range?: [number, number];
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

#### GET /api/getReply/:uuid

**Description:**  
Retrieves a single reply by its UUID.

**URL Parameters:**
uuid: string

**Response Interface:**
```typescript
interface Reply {
  id: string;
  text: string;
  parentId: string[];
  quote?: {
    text: string;
    range?: [number, number];
  };
  metadata: {
    author: string;
    authorId: string;
    authorEmail: string;
    createdAt: number;
  };
}
```

#### GET /api/getReplies/:uuid/:quote/:sortingCriteria

**Description:**  
Retrieves replies for a specific post and quote with sorting options.

**URL Parameters:**
uuid: the uuid of the parent post or reply
quote: the quote to be used for sorting
sortingCriteria: the criteria to sort the replies by (most recent, oldest, most liked, least liked)

**Query Parameters:**
page?: number
limit?: number

**Response Interface:**
```typescript
interface GetRepliesResponse {
  replies: string[];
  pagination: {
    page: number;
    limit: number;
    totalChildren: number;
    totalPages: number;
  };
}
```

#### GET /api/getRepliesFeed

**Description:**  
Retrieves a global feed of replies sorted by recency.

**Query Parameters:**
page?: number
limit?: number

**Response Interface:**
```typescript
interface GetRepliesFeedResponse {
  replies: string[];
  pagination: {
    page: number;
    limit: number;
    totalChildren: number;
    totalPages: number;
  };
}
```

### StoryTree APIs

#### GET /api/storyTree/:uuid

**Description:**  
Fetches the story tree data associated with the given uuid from Redis. The story tree contains nested story nodes.

**URL Parameters:**
uuid: string

**Response Interface:**
```typescript
interface StoryTreeNode {
id: string;
text: string;
nodes: Array<{
id: string;
parentId: string | null;
}>;
parentId: string | null;
metadata: {
title: string;
author: string;
};
totalChildren: number;
}
interface GetStoryTreeResponse extends StoryTreeNode {}
```

#### POST /api/createStoryTree

**Description:**  
Creates a new story tree with the provided content and metadata.

**Request Interface:**
```typescript
interface CreateStoryTreeRequest {
  storyTree: {
    content?: string;
    text?: string;
    title: string;
    author: string;
    nodes?: Array<any>;
  };
}
```

**Response Interface:**
```typescript
interface CreateStoryTreeResponse {
  id: string;
}
```

### Feed APIs

#### GET /api/feed

**Description:**  
Retrieves a paginated list of feed items. Each feed item represents a story added to the feed.

**Query Parameters:**
page?: number (defaults to 1 if not provided)

**Response Interface:**
```typescript
interface FeedItem {
id: string;
text: string;
}
interface GetFeedResponse {
page: number;
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
- API Endpoints: Defines RESTful APIs for creating and retrieving statements, managing story trees, and fetching feed items.
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
Used for seeding the Redis database with initial data. This script populates the database with sample authors, titles, and predefined story trees to facilitate development and testing.

**Key Responsibilities:**
- Redis Connection: Establishes and manages a connection to the Redis server.
- Data Seeding: Clears existing feed items and adds new stories with unique UUIDs and structured story trees.
- Recursive StoryTree Creation: Implements functions to create nested story nodes recursively, ensuring each node is correctly linked and stored in Redis.
- Feed Population: Adds feed items corresponding to each seeded story to the Redis feed list.
- Logging: Tracks the progress and any issues encountered during the seeding process.
- Random Data Generation: Utilizes random UUIDs and selects random authors and titles from predefined lists to ensure uniqueness and variability in seeded data.

Conclusion
The Aphorist backend is structured to provide robust and secure APIs for frontend interactions, leveraging Redis for efficient data storage and retrieval. With clear separation of concerns across its various files and comprehensive authentication mechanisms, the backend is well-equipped to support the application's functionalities. Future developments may introduce backend-private APIs and additional services, which will be documented accordingly.