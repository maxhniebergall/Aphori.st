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
import HighlightedText from './HighlightedText';
import { QuoteCounts, StoryTreeNode } from '../types/types';
import { Quote } from '../types/quote';
import { useTextSelection } from '../hooks/useTextSelection';

interface NodeContentProps {
  node: StoryTreeNode;
  onSelectionComplete?: (quote: Quote) => void;
  quote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
}

// Memoize the TextSelection component to prevent unnecessary re-renders
const MemoizedTextSelection = React.memo(TextSelection);
// Memoize the HighlightedText component to prevent unnecessary re-renders
const MemoizedHighlightedText = React.memo(HighlightedText);

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  onSelectionComplete = () => {},
  quote,
  existingSelectableQuotes
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
    // Log the node's quote counts for debugging
    return existingSelectableQuotes ?? node.quoteCounts ?? { quoteCounts: [] };
  }, [existingSelectableQuotes, node.quoteCounts, node.id]);

  // Use the text selection hook directly in NodeContent
  const { 
    containerRef, 
    eventHandlers, 
    selections, 
    containerText, 
    handleSegmentClick,
    isSelecting
  } = useTextSelection({
    onSelectionCompleted: memoizedOnSelectionComplete,
    existingSelectableQuotes: memoizedExistingSelectableQuotes
  });

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={quote ? 'Selected content for reply' : 'Story content'}
    >
      <div 
        className="text-content" 
        role="region" 
        aria-label="Main content"
        ref={containerRef}
        id={node.id}
        style={{ 
          userSelect: 'none', 
          WebkitUserSelect: 'none', 
          touchAction: 'none' 
        }}
        {...eventHandlers}
      >
        <MemoizedHighlightedText
          text={containerText || textContent}
          selections={selections}
          onSegmentClick={handleSegmentClick}
        />
      </div>
      {quote && (
        <div className="quote-container" role="region" aria-label="Quoted content">
          <blockquote className="story-tree-node-quote">
            <MemoizedTextSelection
              node={node}
              onSelectionCompleted={memoizedOnSelectionComplete}
              selectedQuote={quote}
              aria-label="Selectable text for reply"
            >
              {quote.text}
            </MemoizedTextSelection>
          </blockquote>
        </div>
      )}
    </div>
  );
};

// Add display name for better debugging
NodeContent.displayName = 'NodeContent';

// Export memoized component to prevent unnecessary re-renders
export default React.memo(NodeContent);