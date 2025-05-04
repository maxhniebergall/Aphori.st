
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

/**
 * Decodes a base64-encoded cursor string and returns a Cursor object.
 *
 * Throws an Error with message 'Invalid cursor format' if the input is not valid base64 or not valid JSON.
 * Throws an Error with message 'Decoded cursor is missing required fields' if the decoded object
 * is missing required properties (id, timestamp, type).
 *
 * @param {string} encodedCursor - Base64 encoded JSON cursor
 * @returns {Cursor} The decoded cursor object
 * @throws {Error} 'Invalid cursor format' | 'Decoded cursor is missing required fields'
 */
export function decodeCursor(encodedCursor: string): Cursor {
    try {
        const obj: unknown = JSON.parse(
            Buffer.from(encodedCursor, 'base64').toString()
        );
        if (
            typeof obj === 'object' &&
            obj !== null &&
            typeof (obj as any).id === 'string' &&
            typeof (obj as any).timestamp === 'number' &&
            ((obj as any).type === 'post' || (obj as any).type === 'reply')
        ) {
            return obj as Cursor;
        }
        throw new Error('Decoded cursor is missing required fields');
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
