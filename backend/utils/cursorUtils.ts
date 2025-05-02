/**
 * Requirements:
 * - Provide cursor encoding/decoding utilities
 * - Support both post and reply type cursors
 * - Maintain type safety with TypeScript
 * - Use base64 encoding for cursor strings
 */

import { Buffer } from 'buffer';

export interface Cursor {
    id: string;
    timestamp: number;
    type: 'post' | 'reply';
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

// Define the structure of the decoded cursor
interface DecodedCursor {
  id: string;
  timestamp: number;
  type: 'post' | 'reply';
}

export function createCursor(id: string, timestamp: number, type: 'post' | 'reply'): string {
  const cursorData: DecodedCursor = { id, timestamp, type };
  const jsonString = JSON.stringify(cursorData);
  return encodeCursor({ id, timestamp, type });
} 