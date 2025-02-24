import { Quote } from "../types/index.js";

export function getQuoteKey(quote: Quote): string {
    if (!quote.sourcePostId || !quote.selectionRange) {
        throw new Error("Invalid quote object: missing sourcePostId or selectionRange.");
    }

    // TODO we should use a fixed size hash function to generate a key
    // we should look into which hash function is best for our use case
    // it doesn't need to be secure, we can use a simple hash function
    return btoa(`${quote.sourcePostId}|${quote.text}|${quote.selectionRange.start}-${quote.selectionRange.end}`);
} 