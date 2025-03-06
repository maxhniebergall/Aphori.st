/*
 * Requirements:
 * - Provides a standalone definition of the Quote interface for the story tree application.
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
  constructor(
    public text: string,
    public sourcePostId: string,
    public selectionRange: SelectionState
  ) {
    if (selectionRange.start > selectionRange.end) {
      const end = selectionRange.end;
      selectionRange.end = selectionRange.start;
      selectionRange.start = end;
    }

    if (!Quote.isValid(this)) {
      throw new Error('Invalid Quote created:' + JSON.stringify({
        text: this.text,
        sourcePostId: this.sourcePostId,
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
    if (!quote.sourcePostId){
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
    if (quote.selectionRange.end <= quote.selectionRange.start){
      console.error('Invalid selection range:', quote.selectionRange);
      return false;
    }
    
    return true;
  }

  /**
   * A custom toString method that serializes the quote object.
   * We use encodeURIComponent and JSON.stringify to ensure that the resulting string
   * can be safely used in a URL if required.
   */
  public static toEncodedString(quote: Quote): string {
    if (!Quote.isValid(quote)) {
      console.error('Attempting to serialize invalid Quote:', {
        text: quote.text,
        sourcePostId: quote.sourcePostId,
        selectionRange: quote.selectionRange
      });
      throw new Error('Cannot serialize invalid Quote');
    }

    return encodeURIComponent(
      JSON.stringify({
        text: quote.text,
        sourcePostId: quote.sourcePostId,
        selectionRange: quote.selectionRange,
      })
    );
  }
}

export function compareQuotes(q1: Quote, q2: Quote): boolean {
  return (
    q1.text === q2.text &&
    q1.sourcePostId === q2.sourcePostId &&
    q1.selectionRange.start === q2.selectionRange.start &&
    q1.selectionRange.end === q2.selectionRange.end
  );
} 