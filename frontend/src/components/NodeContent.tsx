/**
 * Requirements:
 * - Render node text including markdown and text selection using TextSelection
 * - If the node has a quote, render it via QuoteRenderer
 * - Provide callback support for text selection completed event
 * - TypeScript support for props, including PostTreeLevel type
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
import { QuoteCounts, PostTreeNode } from '../types/types';
import { Quote, areQuotesEqual } from '../types/quote';
import { useHighlighting } from '../hooks/useHighlighting';

interface NodeContentProps {
  node: PostTreeNode;
  onExistingQuoteSelectionComplete?: (quote: Quote) => void;
  isReplyTargetNode?: boolean;
  existingSelectableQuotes?: QuoteCounts;
  currentLevelSelectedQuote?: Quote | null;
  initialQuoteForReply?: Quote | null;
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

// Helper for comparing potentially null/undefined quotes
const compareNullableQuotes = (q1: Quote | null | undefined, q2: Quote | null | undefined): boolean => {
  if (!q1 && !q2) return true; // Both null/undefined
  if (!q1 || !q2) return false; // One is null/undefined, the other isn't
  return areQuotesEqual(q1, q2); // Both are valid Quotes, compare them
};

// Memoize the TextSelection component to prevent unnecessary re-renders
const MemoizedTextSelection = React.memo(TextSelection);
// Memoize the HighlightedText component to prevent unnecessary re-renders
const MemoizedHighlightedText = React.memo(HighlightedText,
  (prevProps, nextProps) => {
    // Compare all relevant props for HighlightedText
    return prevProps.text === nextProps.text &&
           prevProps.selections === nextProps.selections && // Assuming immutable array reference comparison is okay here
           compareNullableQuotes(prevProps.selectedReplyQuote, nextProps.selectedReplyQuote) && // Use helper function
           prevProps.nodeId === nextProps.nodeId && 
           prevProps.levelNumber === nextProps.levelNumber && // Add levelNumber comparison
           prevProps.onSegmentClick === nextProps.onSegmentClick; // Reference comparison for callback
  }
);

// Custom comparison function for React.memo
const areNodeContentPropsEqual = (prevProps: NodeContentProps, nextProps: NodeContentProps): boolean => {
  // Check if nodes are the same reference or have the same ID and text content
  const nodeChanged = prevProps.node !== nextProps.node ||
                      prevProps.node?.id !== nextProps.node?.id ||
                      prevProps.node?.textContent !== nextProps.node?.textContent ||
                      prevProps.node?.quoteCounts !== nextProps.node?.quoteCounts ||
                      prevProps.node?.repliedToQuote !== nextProps.node?.repliedToQuote;

  // Compare the new boolean prop
  const isReplyTargetChanged = prevProps.isReplyTargetNode !== nextProps.isReplyTargetNode;
  
  const currentLevelSelectedQuoteChanged = !compareNullableQuotes(prevProps.currentLevelSelectedQuote, nextProps.currentLevelSelectedQuote);

  // Simple comparison for existingSelectableQuotes (compare by reference, assuming immutability)
  const existingQuotesChanged = prevProps.existingSelectableQuotes !== nextProps.existingSelectableQuotes;

  // Compare callback function by reference
  const callbackChanged = prevProps.onExistingQuoteSelectionComplete !== nextProps.onExistingQuoteSelectionComplete;

  const initialQuoteChanged = !compareNullableQuotes(prevProps.initialQuoteForReply, nextProps.initialQuoteForReply);

  // Return true if none of the relevant props have changed
  return !nodeChanged && !isReplyTargetChanged && !existingQuotesChanged && !currentLevelSelectedQuoteChanged && !callbackChanged && !initialQuoteChanged;
};

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  onExistingQuoteSelectionComplete: onExistingQuoteSelectionComplete = () => {},
  isReplyTargetNode = false,
  existingSelectableQuotes,
  currentLevelSelectedQuote,
  initialQuoteForReply
}) => {
  // Reference to the main content container
  const mainContentRef = useRef<HTMLDivElement>(null);
  const quoteContainerRef = useRef<HTMLDivElement>(null); // Ref for the quote container

  // Memoize the callback passed down from PostTreeLevelComponent
  const memoizedOnExistingQuoteSelectionComplete = useCallback((selectedQuote: Quote) => {
    // This log confirms what NodeContent passes up to PostTreeLevelComponent
    
    onExistingQuoteSelectionComplete(selectedQuote);
  }, [onExistingQuoteSelectionComplete]);

  // Memoize the existingSelectableQuotes. 
  // Rely ONLY on the prop passed down, assuming it's correctly memoized upstream.
  const memoizedExistingSelectableQuotes = useMemo(() => {
    return existingSelectableQuotes ?? { quoteCounts: [] };
  // Only depend on the prop. Remove node.quoteCounts and node.id dependencies.
  }, [existingSelectableQuotes]);

  // Use the highlighting hook ONLY for managing highlights in the main content
  const {
    selections,
    handleSegmentClick,
    selectedQuote // Destructure selectedQuote from the hook's return
  } = useHighlighting({
    text: node.textContent || '',
    selectedQuote: currentLevelSelectedQuote ?? undefined,
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

  // Effect to scroll the quote container into view when it becomes the reply target
  useEffect(() => {
    if (isReplyTargetNode && quoteContainerRef.current) {
      // Timeout helps ensure rendering is complete before scrolling
      setTimeout(() => {
        quoteContainerRef.current?.scrollIntoView({
          behavior: 'smooth',
          block: 'center' // Center vertically
        });
      }, 50); // Small delay
    }
  }, [isReplyTargetNode]); // Dependency: run when reply target status changes

  // Safely handle the quote text for the blockquote display (use full text)
  const quoteContainerText = useMemo(() => {
    return node.textContent || '';
  }, [node.textContent]);

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={isReplyTargetNode ? 'Content being replied to' : 'Post content'}
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
          nodeId={node.id}
          text={node.textContent || ''}
          selections={selections}
          quoteCounts={memoizedExistingSelectableQuotes}
          onSegmentClick={handleSegmentClick}
          selectedReplyQuote={currentLevelSelectedQuote ?? undefined}
          levelNumber={node.levelNumber}
        />
      </div>

      {/* Quote container area - ALWAYS selectable if rendered */}
      {/* Render the quote container ONLY if this node is the reply target */}
      {isReplyTargetNode && (
        <div 
          ref={quoteContainerRef} // Attach the ref here
          className="quote-container" 
          role="region" 
          aria-label="Quoted content for reply"
        >
          <blockquote className="post-tree-node-quote">
            <MemoizedTextSelection
              node={node}
              aria-label="Selectable text for reply"
              initialQuote={initialQuoteForReply ?? undefined}
            >
              {quoteContainerText}
            </MemoizedTextSelection>
          </blockquote>
        </div>
      )}
    </div>
  );
};

// Add display name for better debugging
NodeContent.displayName = 'NodeContent';

// Export memoized component using the custom comparison function
export default React.memo(NodeContent, areNodeContentPropsEqual);