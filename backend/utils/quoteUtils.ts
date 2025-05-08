import { Quote } from "../types/index.js";
import { createHash } from 'crypto';

/**
 * Generates a stable, unique key for a given Quote object based on its content and source.
 * Used for indexing replies associated with a specific quote.
 * @param quote The Quote object.
 * @returns A string key suitable for database indexing (e.g., "quotes:<hash>").
 * @throws {Error} If the Quote object is invalid (missing sourceId or selectionRange).
 *                 (Handled: Caught by try/catch in calling code).
 */
export function getQuoteKey(quote: Quote): string {
    if (!quote.sourceId || !quote.selectionRange) {
        // Handled: Validation error caught by try/catch blocks in calling code (server.ts routes, seed.ts).
        throw new Error("Invalid quote object: missing sourceId or selectionRange.");
    }
    const input = `${quote.text}|${quote.sourceId}|${quote.selectionRange.start}-${quote.selectionRange.end}`;
    return `quotes:${createHash('sha256').update(input).digest('base64')}`;
}