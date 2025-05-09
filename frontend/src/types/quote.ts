/*
 * Requirements:
 * - Provides a standalone definition of the Quote interface for the post tree application.
 * - Enforces full TypeScript support with strict typings.
 * - Offers utility functions related to Quote operations.
 * - Contains a helper method, compareQuotes, to compare two Quote objects for equality.
 */

export interface SelectionState {
  start: number;
  end: number;
}
// Custom class implementation for Quote allowing custom toString() behavior
export class Quote {
  /**
   * Creates a new Quote instance.
   * @param text The quoted text.
   * @param sourceId The ID of the source node.
   * @param selectionRange The start/end character indices of the selection.
   * @throws {Error} If the created quote fails validation (e.g., missing fields).
   *                 (Handled - Depends on Caller).
   */
  constructor(
    public text: string,
    public sourceId: string,
    public selectionRange: SelectionState
  ) {
    if (selectionRange.start > selectionRange.end) {
      const end = selectionRange.end;
      selectionRange.end = selectionRange.start;
      selectionRange.start = end;
    }

    if (!Quote.isValid(this)) {
      // Handled - Depends on Caller: Internal validation. Callers creating Quote objects
      // are responsible for providing valid data or handling this exception.
      throw new Error('Invalid Quote created:' + JSON.stringify({
        text: this.text,
        sourceId: this.sourceId,
        selectionRange: this.selectionRange
      }));
    }
  }

  /**
   * Validates that the quote has all required fields with non-empty values
   */
  public static isValid(quote: Quote): boolean {
    if (!quote.text){
      console.error('Quote text is required');
      return false;
    }
    if (!quote.sourceId){
      console.error('Source post ID is required');
      return false;
    }
    if (!quote.selectionRange){
      console.error('Selection range is required');
      return false;
    }
    if (typeof quote.selectionRange.start !== 'number' || typeof quote.selectionRange.end !== 'number'){
      console.error('Invalid   selection range:', quote.selectionRange);
      return false;
    }
    if (quote.selectionRange.end < quote.selectionRange.start){
      console.error('Invalid selection range (end < start):', quote.selectionRange);
      return false;
    }
    
    return true;
  }

  /**
   * A custom toString method that serializes the quote object.
   * We use encodeURIComponent and JSON.stringify to ensure that the resulting string
   * can be safely used in a URL if required.
   * @param quote The Quote object to serialize.
   * @returns URL-encoded JSON string representation of the quote.
   * @throws {Error} If the input quote fails validation.
   *                 (Handled - Depends on Caller).
   */
  public static toEncodedString(quote: Quote): string {
    if (!Quote.isValid(quote)) {
      // Added back console.error
      console.error('Attempting to serialize invalid Quote:', {
        text: quote.text,
        sourceId: quote.sourceId,
        selectionRange: quote.selectionRange
      });
      throw new Error('Cannot serialize invalid Quote');
    }

    return encodeURIComponent(
      JSON.stringify({
        text: quote.text,
        sourceId: quote.sourceId,
        selectionRange: quote.selectionRange,
      })
    );
  }

  /**
   * Creates a placeholder quote object, often used when no real quote is selected.
   * @param {string} sourceId - The ID of the source post for context.
   * @returns {Quote} A placeholder Quote instance with empty text and an invalid range.
   */
  public static createPlaceholder(sourceId: string): Quote {
    // Use invalid range like start: -1, end: -1 or start: 0, end: 0 depending on downstream checks
    return new Quote("", sourceId, { start: -1, end: -1 });
  }
}

export function areQuotesEqual(q1: Quote | null, q2: Quote | null): boolean {
  if (q1 === null && q2 === null) {
    return true;
  } else if (q1 === null || q2 === null) {
    return false;
  }
  return (
    q1.text === q2.text &&
    q1.sourceId === q2.sourceId &&
    q1.selectionRange.start === q2.selectionRange.start &&
    q1.selectionRange.end === q2.selectionRange.end
  );
} 