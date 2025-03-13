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
import { QuoteCounts } from '../types/types';
import { StoryTreeNode } from '../types/storyTreeNode';
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
  quote}) => {

  // Memoize the text content to prevent unnecessary re-renders
  const textContent = useMemo(() => {
    // Only branch nodes have textContent
    if (node.isLeafNode) {
      throw new Error('Cannot create quote: leaf node has no text content');
    }
    return node.branchNode?.textContent || '';
  }, [node.isLeafNode, node.branchNode?.textContent]);

  // Memoize the callback to prevent unnecessary re-renders
  const memoizedOnSelectionComplete = useCallback((selectedQuote: Quote) => {
    onSelectionComplete(selectedQuote);
  }, [onSelectionComplete]);

  // Memoize the existingSelectableQuotes to prevent unnecessary re-renders
  const memoizedExistingSelectableQuotes = useMemo(() => {
    // Log the node's quote counts for debugging
    // Only branch nodes have quoteCounts
    if (node.isLeafNode) {
      throw new Error('Cannot create quote: leaf node has no quote counts');
    }
    return node.branchNode?.quoteCounts || { quoteCounts: [] };
  }, [node.isLeafNode, node.branchNode?.quoteCounts]);

  // If it's a leaf node, we don't render content
  if (node.isLeafNode) {
    return null;
  }

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={quote ? 'Selected content for reply' : 'Story content'}
    >
      <div className="text-content" role="region" aria-label="Main content">
        <MemoizedTextSelection
          node={node}
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