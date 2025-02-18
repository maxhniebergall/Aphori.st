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
    if (!this.isValid()) {
      console.error('Invalid Quote created:', {
        text: this.text,
        sourcePostId: this.sourcePostId,
        selectionRange: this.selectionRange
      });
    }
  }

  /**
   * Validates that the quote has all required fields with non-empty values
   */
  public isValid(): boolean {
    return Boolean(
      this.text &&
      this.sourcePostId &&
      this.selectionRange &&
      typeof this.selectionRange.start === 'number' &&
      typeof this.selectionRange.end === 'number' &&
      this.selectionRange.end > this.selectionRange.start
    );
  }

  /**
   * A custom toString method that serializes the quote object.
   * We use encodeURIComponent and JSON.stringify to ensure that the resulting string
   * can be safely used in a URL if required.
   */
  toString(): string {
    if (!this.isValid()) {
      console.error('Attempting to serialize invalid Quote:', {
        text: this.text,
        sourcePostId: this.sourcePostId,
        selectionRange: this.selectionRange
      });
      throw new Error('Cannot serialize invalid Quote');
    }
    if (this.text === 'rootQuote' && this.sourcePostId === 'rootQuote') {
      console.error('Should never serialize rootQuote:', {
        text: this.text,
        sourcePostId: this.sourcePostId,
        selectionRange: this.selectionRange
      });
      throw new Error('Cannot serialize rootQuote');
    }
    return encodeURIComponent(
      JSON.stringify({
        text: this.text,
        sourcePostId: this.sourcePostId,
        selectionRange: this.selectionRange,
      })
    );
  }
}

export interface QuoteMetadata {
  replyCounts: Map<Quote, number>;
}

export function compareQuotes(q1: Quote, q2: Quote): boolean {
  return (
    q1.text === q2.text &&
    q1.sourcePostId === q2.sourcePostId &&
    q1.selectionRange.start === q2.selectionRange.start &&
    q1.selectionRange.end === q2.selectionRange.end
  );
} 