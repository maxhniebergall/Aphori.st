Aphorist Backend Architecture Document
This document provides an overview of the Aphorist backend architecture, detailing the frontend APIs exposed by the backend server, including their request and response structures using TypeScript interfaces. Additionally, it outlines any backend-private APIs and provides descriptions of each backend file within the project.
Table of Contents
Frontend APIs
Authentication APIs
POST /api/auth/send-magic-link
POST /api/auth/verify-magic-link
POST /api/auth/verify-token
GET /api/profile
Statement APIs
POST /api/createStatement
GET /api/getStatement/:key
POST /api/setvalue
GET /api/getValue/:key
StoryTree APIs
GET /api/storyTree/:uuid
Feed APIs
GET /api/feed
Backend-Private APIs
Backend Files Overview
Aphorist/backend/server.js
Aphorist/backend/mailer.js
Aphorist/backend/seed.js
Frontend APIs
The backend server exposes several APIs that the frontend interacts with. Below are the details of each API, including their endpoints, purposes, and the associated TypeScript interfaces for requests and responses.
Authentication APIs
POST /api/auth/send-magic-link
Description:
Sends a magic link to the user's email for authentication purposes. This link allows the user to sign in without a password.
Request Interface:
"""typescript
interface SendMagicLinkRequest {
email: string;
}
"""
Response Interface:
"""typescript
interface SendMagicLinkResponse {
message: string;
}
"""
POST /api/auth/verify-magic-link
Description:
Verifies the magic link token received by the user and authenticates them, issuing an authentication token upon successful verification.
Request Interface:
"""typescript
interface VerifyMagicLinkRequest {
token: string;
}
"""
Response Interface:
"""typescript
interface VerifyMagicLinkResponse {
token: string;
user: {
id: string;
email: string;
};
}
"""
POST /api/auth/verify-token
Description:
Verifies the provided authentication token to ensure its validity and extracts the user information.
Request Interface:
"""typescript
interface VerifyTokenRequest {
token: string;
}
"""
Response Interface:
"""typescript
interface VerifyTokenResponse {
id: string;
email: string;
}
"""
GET /api/profile
Description:
Retrieves the authenticated user's profile information. This is a protected route that requires a valid authentication token.
Request Headers:
Authorization: Bearer <token>
Response Interface:
"""typescript
interface ProfileResponse {
id: string;
email: string;
}
"""
Statement APIs
POST /api/createStatement
Description:
Creates a new statement by storing a uuid and its corresponding value in Redis.
Request Interface:
"""typescript
interface CreateStatementRequest {
uuid: string;
value: string;
}
"""
Response:
No content on success.
GET /api/getStatement/:key
Description:
Retrieves the value associated with the specified key from Redis.
URL Parameters:
key: string
Response Interface:
"""typescript
interface GetStatementResponse {
value: string | null;
}
"""
POST /api/setvalue
Description:
Sets a key-value pair in Redis. This endpoint functions similarly to /api/createStatement but is generalized for any key.
Request Interface:
"""typescript
interface SetValueRequest {
key: string;
value: string;
}
"""
Response:
No content on success.
GET /api/getValue/:key
Description:
Fetches the value associated with the specified key from Redis. Similar to /api/getStatement/:key.
URL Parameters:
key: string
Response Interface:
"""typescript
interface GetValueResponse {
value: string | null;
}
"""
StoryTree APIs
GET /api/storyTree/:uuid
Description:
Fetches the story tree data associated with the given uuid from Redis. The story tree contains nested story nodes.
URL Parameters:
uuid: string
Response Interface:
"""typescript
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
totalNodes: number;
}
interface GetStoryTreeResponse extends StoryTreeNode {}
"""
Feed APIs
GET /api/feed
Description:
Retrieves a paginated list of feed items. Each feed item represents a story added to the feed.
Query Parameters:
page?: number (defaults to 1 if not provided)
Response Interface:
"""typescript
interface FeedItem {
id: string;
text: string;
}
interface GetFeedResponse {
page: number;
items: FeedItem[];
}
"""
Backend-Private APIs
Currently, all exposed APIs are intended for frontend consumption. However, any future private APIs intended solely for backend operations should be documented in this section. These APIs are not exposed to the frontend and are used internally for tasks such as data migration, analytics, or administrative functions.
As of the current implementation, there are no backend-private APIs.
Backend Files Overview
The Aphorist backend consists of several key files, each responsible for specific functionalities within the server. Below is a description of each backend file and its purpose.
Aphorist/backend/server.js
Purpose:
This is the main server file that sets up and configures the Express.js server. It handles route definitions, middleware configurations (such as CORS and rate limiting), connects to the Redis database, and initializes various API endpoints for authentication, data management, and content retrieval.
Key Responsibilities:
Server Configuration: Sets up the Express server, including JSON parsing and CORS settings.
Redis Integration: Connects to a Redis server for data storage and retrieval operations.
Authentication Management: Implements magic link authentication, token verification, and protected routes.
API Endpoints: Defines RESTful APIs for creating and retrieving statements, managing story trees, and fetching feed items.
Logging: Utilizes a custom logger for tracking server activities and errors.
Rate Limiting: Applies rate limiting to sensitive routes to prevent abuse.
Aphorist/backend/mailer.js
Purpose:
Handles email functionalities within the backend, primarily responsible for sending emails such as magic links for user authentication.
Key Responsibilities:
Nodemailer Configuration: Sets up the Nodemailer transporter using SMTP settings defined in environment variables.
Email Sending: Provides the sendEmail function to dispatch emails with specified recipients, subjects, and HTML content.
Transporter Verification: Ensures that the Nodemailer transporter is correctly configured and ready to send emails.
Error Handling: Logs and throws errors encountered during the email sending process.
Aphorist/backend/seed.js
Purpose:
Used for seeding the Redis database with initial data. This script populates the database with sample authors, titles, and predefined story trees to facilitate development and testing.
Key Responsibilities:
Redis Connection: Establishes and manages a connection to the Redis server.
Data Seeding: Clears existing feed items and adds new stories with unique UUIDs and structured story trees.
Recursive StoryTree Creation: Implements functions to create nested story nodes recursively, ensuring each node is correctly linked and stored in Redis.
Feed Population: Adds feed items corresponding to each seeded story to the Redis feed list.
Logging: Tracks the progress and any issues encountered during the seeding process.
Random Data Generation: Utilizes random UUIDs and selects random authors and titles from predefined lists to ensure uniqueness and variability in seeded data.
Conclusion
The Aphorist backend is structured to provide robust and secure APIs for frontend interactions, leveraging Redis for efficient data storage and retrieval. With clear separation of concerns across its various files and comprehensive authentication mechanisms, the backend is well-equipped to support the application's functionalities. Future developments may introduce backend-private APIs and additional services, which will be documented accordingly.