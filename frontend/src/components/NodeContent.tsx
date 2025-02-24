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

import React, { useMemo } from 'react';
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

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={quote ? 'Selected content for reply' : 'Story content'}
    >
      <div className="text-content" role="region" aria-label="Main content">
        <TextSelection
          onSelectionCompleted={onSelectionComplete}
          selectedQuote={quote}
          existingSelectableQuotes={existingSelectableQuotes}
          aria-label={quote ? 'Selectable text for reply' : 'Story text'}
        >
          {textContent}
        </TextSelection>
      </div>
      {quote && (
        <div className="quote-container" role="region" aria-label="Quoted content">
          <QuoteRenderer quote={quote} />
        </div>
      )}
    </div>
  );
};

// Add display name for better debugging
NodeContent.displayName = 'NodeContent';

export default NodeContent;