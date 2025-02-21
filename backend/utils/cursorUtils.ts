/**
 * Requirements:
 * - Provide cursor encoding/decoding utilities
 * - Support both story and reply type cursors
 * - Maintain type safety with TypeScript
 * - Use base64 encoding for cursor strings
 */

import { Buffer } from 'buffer';

export interface Cursor {
    id: string;
    timestamp: number;
    type: 'story' | 'reply';
}

export function encodeCursor(cursor: Cursor): string {
    return Buffer.from(JSON.stringify(cursor)).toString('base64');
}

export function decodeCursor(encodedCursor: string): Cursor {
    try {
        return JSON.parse(Buffer.from(encodedCursor, 'base64').toString());
    } catch (error) {
        throw new Error('Invalid cursor format');
    }
}

export function createCursor(id: string, timestamp: number, type: 'story' | 'reply'): string {
    return encodeCursor({ id, timestamp, type });
} 