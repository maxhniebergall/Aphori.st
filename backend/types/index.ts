import { Request } from 'express';

// Database Types
export interface DatabaseClient {
    connect: () => Promise<void>;
    disconnect?: () => Promise<void>;
    isConnected?: () => boolean;
    isReady?: () => boolean;
    hGet: (key: string, field: string, options?: { returnCompressed: boolean }) => Promise<any>;
    hGetAll: (key: string, options?: { returnCompressed: boolean }) => Promise<Record<string, any>>;
    hSet: (key: string, field: string, value: any) => Promise<void>;
    hIncrBy: (key: string, field: string, increment: number) => Promise<number>;
    get: (key: string) => Promise<any>;
    set: (key: string, value: any) => Promise<void>;
    lPush: (key: string, value: any) => Promise<void>;
    lRange: (key: string, start: number, end: number, options?: { returnCompressed: boolean }) => Promise<any[]>;
    lSet: (key: string, index: number, value: any) => Promise<void>;
    sAdd: (key: string, value: string) => Promise<void>;
    zAdd: (key: string, score: number, value: string) => Promise<void>;
    zRange: (key: string, start: number, end: number, options?: { returnCompressed: boolean }) => Promise<any[]>;
    zCard: (key: string) => Promise<number>;
    encodeKey: (id: string, prefix: string) => string;
    compress: (data: any) => Promise<any>;
    decompress: (data: any) => Promise<any>;
    zRevRangeByScore: (key: string, max: number, min: number, options?: { limit?: number }) => Promise<any[]>;
    keys: (pattern: string) => Promise<string[]>;
}

// User Types
export interface User {
    id: string;
    email: string;
}

export interface ExistingUser extends User {
    id: string;
    email: string;
    createdAt: string;
}

export interface UserResult {
    success: boolean;
    error?: string;
    data?: ExistingUser;
}

// Story Types
export interface StoryTree {
    // this is the old story tree type
    // use UnifiedNode instead
    id: string;
    text: string;
    parentId: string[] | null;
    metadata: StoryMetadata;
}

export interface StoryMetadata {
    author?: string;
    createdAt: string;
    quote: Quote | null;
}

export interface Quote {
    text: string;
    sourcePostId?: string;
    selectionRange?: {
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
    metadata: {
        author: string;
        authorId: string;
        authorEmail: string;
        createdAt: number;
    };
}

export interface Replies {
    replies: Reply[];
}

// Feed Types
export interface FeedItem {
    id: string;
    text: string;
    author: {
        id: string;
        email: string;
    };
    createdAt: string;
}

// Express Request Types
export interface AuthenticatedRequest extends Request {
    user: User;
}

// API Response Types
export interface ApiResponse<T = any> {
    success: boolean;
    error?: string;
    message?: string;
    compressedData?: T;
}

// Token Types
export interface TokenPayload {
    email: string;
}

export interface AuthTokenPayload extends User {
    iat?: number;
    exp?: number;
}
// Unified Node Types
export interface UnifiedNode {
    id: string;
    type: 'story' | 'reply';
    content: string;
    metadata: UnifiedNodeMetadata;
}

export interface UnifiedNodeMetadata {
    parentId: string[] | null;
    quote?: Quote;
    author: string;
    createdAt: string;
}

// Existing Selectable Quotes Types
export interface ExistingSelectableQuotes {
    quoteCounts: Map<Quote, number>;
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
    matchingRepliesCount: number;
}

export interface CursorPaginatedResponse<T> extends ApiResponse {
    data: T[];
    pagination: Pagination;
}
