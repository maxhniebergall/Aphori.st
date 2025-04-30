import { Request } from 'express';

// Database Types
export interface DatabaseClient {
    connect: () => Promise<void>;
    disconnect?: () => Promise<void>;
    isConnected: () => Promise<boolean>;
    isReady: () => Promise<boolean>;
    hGet: <T = any>(key: string, field: string, options?: { returnCompressed: boolean }) => Promise<T>;
    hGetAll: <T = any>(key: string, options?: { returnCompressed: boolean }) => Promise<Record<string, T>>;
    hSet: (key: string, field: string, value: any) => Promise<number>;
    hIncrBy: (key: string, field: string, increment: number) => Promise<number>;
    get: <T = any>(key: string) => Promise<T>;
    set: (key: string, value: any) => Promise<string | null>;
    lPush: (key: string, value: any) => Promise<number>;
    lRange: <T = any>(key: string, start: number, end: number, options?: { returnCompressed: boolean }) => Promise<T[]>;
    lSet: (key: string, index: number, value: any) => Promise<void>;
    sAdd: (key: string, value: string) => Promise<number>;
    sMembers: (key: string) => Promise<string[]>;
    zAdd: (key: string, score: number, value: string) => Promise<number>;
    zRange: <T = any>(key: string, start: number, end: number, options?: { returnCompressed: boolean }) => Promise<T[]>;
    zCard: (key: string) => Promise<number>;
    encodeKey: (id: string, prefix: string) => string;
    compress: <T = any>(data: T) => Promise<Compressed<T>>;
    decompress: <T = any>(data: T) => Promise<T>;
    zRevRangeByScore: <T = string>(key: string, max: number, min: number, options?: { limit?: number }) => Promise<RedisSortedSetItem<T>[]>;
    zscan: (key: string, cursor: string, options?: { match?: string; count?: number }) => Promise<{ cursor: string; items: RedisSortedSetItem<string>[] }>;
    keys: (pattern: string) => Promise<string[]>;
    lLen: (key: string) => Promise<number>;
    del: (key: string) => Promise<number>;
    hIncrementQuoteCount: (key: string, field: string, quoteValue: any) => Promise<number>;
}

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
    parentId: string[];
    quote: Quote;
    authorId: string;
    createdAt: string;
}

export interface Replies {
    replies: Reply[];
}

export enum SortingCriteria {
    MOST_RECENT = 'mostRecent'
    // TODO add other sorting criteria
}

// Feed Types
export interface FeedItem {
    id: string;
    text: string;
    authorId: string;
    createdAt: string;
}

// Express Request Types
export interface AuthenticatedRequest extends Request {
    user: User;
}

export interface Compressed<T> {
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

export interface CursorPaginatedResponse<T> extends CompressedApiResponse<T[]> {
    pagination: Pagination;
    data: T[];
}

// Redis Types
export interface RedisSortedSetItem<T> {
    score: number;
    value: T;
}
