/**
 * Requirements:
 * - Render node text including markdown and text selection using TextSelection
 * - If the node has a quote, render it via QuoteRenderer
 * - Provide callback support for text selection completed event
 * - TypeScript support for props, including StoryTreeLevel type
 * - Yarn for package management
 * - Proper error handling
 * - Loading state management
 * - Accessibility compliance
 * - Performance optimization
 * - Proper null checks and fallbacks
 * - Support for internationalization
 * - Proper markdown rendering
 */

import React, { useMemo, useCallback } from 'react';
import TextSelection from './TextSelection';
import QuoteRenderer from './QuoteRenderer';
import { QuoteCounts, StoryTreeNode } from '../types/types';
import { Quote } from '../types/quote';
interface NodeContentProps {
  node: StoryTreeNode;
  onSelectionComplete?: (quote: Quote) => void;
  quote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
}

// Memoize the TextSelection component to prevent unnecessary re-renders
const MemoizedTextSelection = React.memo(TextSelection);
// Memoize the QuoteRenderer component to prevent unnecessary re-renders
const MemoizedQuoteRenderer = React.memo(QuoteRenderer);

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  onSelectionComplete = () => {},
  quote,
  existingSelectableQuotes,
}) => {

  // Memoize the text content to prevent unnecessary re-renders
  const textContent = useMemo(() => {
    return node.textContent || '';
  }, [node.textContent]);

  // Memoize the callback to prevent unnecessary re-renders
  const memoizedOnSelectionComplete = useCallback((selectedQuote: Quote) => {
    onSelectionComplete(selectedQuote);
  }, [onSelectionComplete]);

  // Memoize the existingSelectableQuotes to prevent unnecessary re-renders
  const memoizedExistingSelectableQuotes = useMemo(() => {
    // Check if node has quoteCounts directly
    const nodeQuoteCounts = node.quoteCounts?.quoteCounts;
    
    // Log the node's quote counts for debugging
    console.log('NodeContent: Node quote counts details', {
      nodeId: node.id,
      hasQuoteCounts: !!node.quoteCounts,
      quotesCountsType: node.quoteCounts ? typeof node.quoteCounts.quoteCounts : 'undefined',
      isMap: node.quoteCounts?.quoteCounts instanceof Map,
      size: node.quoteCounts?.quoteCounts?.size || 0,
      entries: node.quoteCounts?.quoteCounts instanceof Map ? 
        Array.from(node.quoteCounts.quoteCounts.entries()).slice(0, 1).map(([q, c]) => ({
          text: q.text?.substring(0, 30) + '...',
          count: c
        })) : 'not a map'
    });
    
    // Use the node's quote counts if available, otherwise use the passed in existingSelectableQuotes
    const result = existingSelectableQuotes || (nodeQuoteCounts ? { quoteCounts: nodeQuoteCounts } : { quoteCounts: new Map() });
    
    // Safely get the first entry if it exists
    let firstEntryStr = 'none';
    if (result.quoteCounts instanceof Map && result.quoteCounts.size > 0) {
      try {
        const firstEntry = Array.from(result.quoteCounts.entries())[0];
        const [quote, count] = firstEntry;
        firstEntryStr = `Quote: ${quote.text.substring(0, 30)}..., Count: ${count}`;
      } catch (e) {
        console.error('Error getting first entry from quoteCounts', e);
      }
    }
    
    console.log('NodeContent: Memoizing existingSelectableQuotes', {
      hasExistingQuotes: !!existingSelectableQuotes,
      resultHasQuoteCounts: !!result.quoteCounts,
      quoteCountsSize: result.quoteCounts?.size || 0,
      isMap: result.quoteCounts instanceof Map,
      nodeId: node.id,
      nodeHasQuoteCounts: !!node.quoteCounts,
      nodeQuoteCountsSize: node.quoteCounts?.quoteCounts?.size || 0,
      nodeQuoteCountsEntries: firstEntryStr
    });
    
    return result;
  }, [existingSelectableQuotes, node.quoteCounts, node.id]);

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={quote ? 'Selected content for reply' : 'Story content'}
    >
      <div className="text-content" role="region" aria-label="Main content">
        <MemoizedTextSelection
          onSelectionCompleted={memoizedOnSelectionComplete}
          selectedQuote={quote}
          existingSelectableQuotes={memoizedExistingSelectableQuotes}
          aria-label={quote ? 'Selectable text for reply' : 'Story text'}
        >
          {textContent}
        </MemoizedTextSelection>
      </div>
      {quote && (
        <div className="quote-container" role="region" aria-label="Quoted content">
          <MemoizedQuoteRenderer quote={quote} />
        </div>
      )}
    </div>
  );
};

// Add display name for better debugging
NodeContent.displayName = 'NodeContent';

// Export memoized component to prevent unnecessary re-renders
export default React.memo(NodeContent);