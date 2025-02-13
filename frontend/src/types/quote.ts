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

export interface Quote {
  quoteLiteral: string;
  sourcePostId: string;
  selectionRange: SelectionState;
}

export interface QuoteMetadata {
  replyCounts: Map<Quote, number>
}


export function compareQuotes(q1: Quote, q2: Quote): boolean {
  return (
    q1.quoteLiteral === q2.quoteLiteral &&
    q1.sourcePostId === q2.sourcePostId &&
    q1.selectionRange.start === q2.selectionRange.start &&
    q1.selectionRange.end === q2.selectionRange.end
  );
} 