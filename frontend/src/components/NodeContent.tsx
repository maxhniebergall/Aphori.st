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

import React, { useMemo, useCallback, useRef, useEffect, useState } from 'react';
import TextSelection from './TextSelection';
import HighlightedText from './HighlightedText';
import { QuoteCounts, StoryTreeNode } from '../types/types';
import { Quote, areQuotesEqual } from '../types/quote';
import { useHighlighting } from '../hooks/useHighlighting';

interface NodeContentProps {
  node: StoryTreeNode;
  onExistingQuoteSelectionComplete?: (quote: Quote) => void;
  quote?: Quote;
  levelSelectedQuote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
}

/**
 * NodeContent has a clear separation of concerns between two distinct areas:
 * 
 * 1. Main Content Area (non-selectable):
 *    - Uses HighlightedText to display static highlights of existing quotes
 *    - Managed by useHighlighting hook
 *    - Shows most popular quotes and current selection
 *    - No user text selection allowed (non-selectable)
 *
 * 2. Quote Container (selectable):
 *    - Uses TextSelection to allow the user to create new selections
 *    - Managed by useTextSelection hook (internal to TextSelection)
 *    - Only shown when a quote is being displayed/edited
 *    - Allows user text selection for creating new quotes
 *
 * These two areas are completely separate and don't influence each other.
 * TextSelection doesn't affect the highlights shown in HighlightedText.
 */

// Memoize the TextSelection component to prevent unnecessary re-renders
const MemoizedTextSelection = React.memo(TextSelection);
// Memoize the HighlightedText component to prevent unnecessary re-renders
const MemoizedHighlightedText = React.memo(HighlightedText);

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  onExistingQuoteSelectionComplete: onExistingQuoteSelectionComplete = () => {},
  quote,
  levelSelectedQuote,
  existingSelectableQuotes
}) => {
  // Log the props received by NodeContent for debugging propagation
  
  // Memoize the text content to prevent unnecessary re-renders
  const textContent = useMemo(() => {
    return node.textContent || '';
  }, [node.textContent]);

  // Reference to the main content container
  const mainContentRef = useRef<HTMLDivElement>(null);
  const [containerText, setContainerText] = useState<string>('');

  // Update container text when the ref changes
  useEffect(() => {
    if (mainContentRef.current) {
      setContainerText(mainContentRef.current.textContent || '');
    }
  }, [textContent]);

  // Memoize the callback passed down from StoryTreeLevelComponent
  const memoizedOnExistingQuoteSelectionComplete = useCallback((selectedQuote: Quote) => {
    // This log confirms what NodeContent passes up to StoryTreeLevelComponent
    
    onExistingQuoteSelectionComplete(selectedQuote);
  }, [onExistingQuoteSelectionComplete]);

  // Memoize the existingSelectableQuotes to prevent unnecessary re-renders
  const memoizedExistingSelectableQuotes = useMemo(() => {
    return existingSelectableQuotes ?? node.quoteCounts ?? { quoteCounts: [] };
  }, [existingSelectableQuotes, node.quoteCounts, node.id]);

  // Use the highlighting hook ONLY for managing highlights in the main content
  const {
    selections,
    handleSegmentClick // This is the function passed *down* to HighlightedText
  } = useHighlighting({
    text: containerText || textContent,
    selectedQuote: levelSelectedQuote,
    existingSelectableQuotes: memoizedExistingSelectableQuotes,
    // Wrap the callback passed *to* the hook to log the quote received from HighlightedText/useHighlighting
    onSegmentClick: useCallback((quoteFromHighlighting: Quote) => {
      // This log shows what quote useHighlighting's handleSegmentClick received
      
      // Pass it up to the next level callback
      memoizedOnExistingQuoteSelectionComplete(quoteFromHighlighting);
    }, [memoizedOnExistingQuoteSelectionComplete]) // Add dependency
  });

  // Log the selections array passed to HighlightedText whenever it changes
  useEffect(() => {
    
  }, [selections]);

  // Safely handle the quote text
  const quoteText = useMemo(() => {
    return quote?.text || '';
  }, [quote]);

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={quote ? 'Content being replied to' : 'Story content'}
    >
      {/* Main content area - ONLY for displaying highlights, never selectable */}
      <div 
        className="text-content non-selectable" 
        role="region" 
        aria-label="Main content"
        ref={mainContentRef}
        id={node.id}
      >
        <MemoizedHighlightedText
          text={containerText || textContent}
          selections={selections}
          onSegmentClick={handleSegmentClick}
        />
      </div>

      {/* Quote container area - ALWAYS selectable */}
      {/* This renders the quote being actively replied to, if any */}
      {quote && (
        <div className="quote-container" role="region" aria-label="Quoted content for reply">
          <blockquote className="story-tree-node-quote">
            <MemoizedTextSelection
              node={node}
              selectedQuote={quote}
              selectAll={true}
              aria-label="Selectable text for reply"
            >
              {quoteText}
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