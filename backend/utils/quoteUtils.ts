import { Quote } from "../types/index.js";
import { createHash } from 'crypto';



export function getQuoteKey(quote: Quote): string {
    if (!quote.sourcePostId || !quote.selectionRange) {
        throw new Error("Invalid quote object: missing sourcePostId or selectionRange.");
    }
    const input = `${quote.text}|${quote.sourcePostId}|${quote.selectionRange.start}-${quote.selectionRange.end}`;
    return `quotes:${createHash('sha256').update(input).digest('base64')}`;
}