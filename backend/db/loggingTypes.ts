// backend/db/loggingTypes.ts

// Interface for logging context passed to methods
export interface LogContext {
    requestId?: string;
    operationId?: string;
}

// Options for read operations (can be extended)
export interface ReadOptions {
    returnCompressed?: boolean;
}

// Options for zRange/zRevRange/zRangeByScore (adjust based on actual usage)
export interface RangeOptions {
    BY?: 'SCORE' | 'LEX';
    REV?: boolean;
    LIMIT?: { offset: number; count: number };
    WITHSCORES?: boolean;
}

// Options for zscan
export interface ScanOptions {
    MATCH?: string;
    COUNT?: number;
    TYPE?: string; // For SCAN command, not directly for ZSCAN in ioredis typings
} 