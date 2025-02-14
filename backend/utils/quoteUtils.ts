import { Quote } from "../types/index.js";

export function getQuoteKey(quote: Quote): string {
    if (!quote.sourcePostId || !quote.selectionRange) {
        throw new Error("Invalid quote object: missing sourcePostId or selectionRange.");
    }
    return `${quote.text}|${quote.sourcePostId}|${quote.selectionRange.start}-${quote.selectionRange.end}`;
} 