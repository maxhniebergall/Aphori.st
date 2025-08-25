import { Request } from 'express';

// User Types
export interface User {
    id: string;
    email: string;
}

export interface ExistingUser extends User {
    createdAt: string;
}

export interface UserResult {
    success: boolean;
    error?: string;
    data?: ExistingUser;
}
export interface Quote {
    text: string;
    sourceId: string;
    selectionRange: {
        start: number;
        end: number;
    };
}

// Reply Types
export interface Reply {
    id: string;
    text: string;
    parentId: string;
    rootPostId: string;
    quote: Quote;
    authorId: string;
    createdAt: string;
}

// Define ReplyData structure based on backend_architecture.md
export interface ReplyData {
    id: string;
    authorId: string;
    // authorUsername?: string; // Optional field
    text: string;
    parentId: string; // Direct parent ID
    parentType: "post" | "reply"; // Type of direct parent
    rootPostId: string; // ID of the root post
    quote: Quote; // Re-use existing Quote interface
    createdAt: string; // ISO 8601 Timestamp String
}

export interface Replies {
    replies: Reply[]; // Keep this for now, maybe refactor later if needed
}

export enum SortingCriteria {
    MOST_RECENT = 'MOST_RECENT'
    // TODO add other sorting criteria when needed
}

// Feed Types
export interface FeedItem {
    id: string;
    textSnippet: string;
    authorId: string;
    createdAt: string;
}

// Express Request Types
export interface AuthenticatedRequest extends Request {
    user: User;
}

export interface Compressed<_T> {
    v: number;
    c: boolean;
    d: string;
  }
  

// API Response Types
export interface CompressedApiResponse<T = any> {
    success: boolean;
    error?: string;
    message?: string;
    compressedData?: T;
}

export interface ApiResponse<T = any> {
    success: boolean;
    error?: string;
    message?: string;
    data?: T;
}

// Specific response type for createReply endpoint
export interface CreateReplyResponse {
    success: boolean;
    error?: string;
    data?: {
        id: string;
    };
}

export interface FeedItemsResponse{
    data: FeedItem[];
    pagination: Pagination;
}

export interface RepliesFeedResponse{
    data: Reply[];
    pagination: Pagination;
}

// Token Types
export interface TokenPayload {
    email: string;
}

export interface AuthTokenPayload extends User {
    iat?: number;
    exp?: number;
}

// Post Types
export interface Post {
    id: string;
    content: string;
    authorId: string;
    createdAt: string;
    replyCount?: number;
}

export interface PostCreationRequest {
    content: string;
}

// Quote Counts Types
// Existing Selectable Quotes Types - Consistent with frontend QuoteCounts
export interface ExistingSelectableQuotes {
    quoteCounts: Array<[Quote, number]>;
}

// Cursor-based Pagination Types
export interface CursorPaginationRequest {
    cursor?: string;
    limit: number;
    direction: 'forward' | 'backward';
}

export interface Pagination {
    nextCursor?: string;
    prevCursor?: string;
    hasMore: boolean;
    totalCount: number;
}

export interface CursorPaginatedResponse<T> {
  success: boolean;
  error?: string;
  message?: string;
  pagination: Pagination;
  data: T[];
}

// Redis Types
export interface RedisSortedSetItem<T> {
    score: number;
    value: T;
}

export interface CreateReplyRequest {
    text: string;
    parentId: string;
    quote: Quote;
}

// Minimal vector types for existing FirebaseClient methods (not used by search functionality)
export interface VectorIndexEntry {
    vector: number[];
    type: "post" | "reply";
    createdAt: string;
}

export interface VectorIndexMetadata {
    activeWriteShard: string;
    shardCapacity: number;
    totalVectorCount: number;
    shards: Record<string, { count: number, createdAt: string }>;
}

export interface VectorDataForFaiss {
    id: string;
    vector: number[];
    type: 'post' | 'reply';
}

export interface ApiError {
  error: string;
  message: string;
  code?: string;
  details?: unknown;
}

// PostData interface
export interface PostData {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
  replyCount: number;
}

// Vector Search Response Types
export interface VectorSearchResult {
  id: string;
  score: number;
  type: 'post' | 'reply';
  data: PostData | ReplyData;
}

export interface VectorSearchResponse {
  success: boolean;
  error?: string;
  results: VectorSearchResult[];
  pagination?: {
    total: number;
    limit: number;
    offset: number;
    hasMore: boolean;
  };
}
