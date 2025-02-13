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
import { StoryTreeLevel, SelectionState } from '../types/types';

interface NodeContentProps {
  node: StoryTreeLevel;
  replyTargetId?: string;
  selectionState: SelectionState | null;
  onSelectionComplete?: (selection: SelectionState) => void;
}

const NodeContent: React.FC<NodeContentProps> = ({
  node,
  replyTargetId,
  selectionState,
  onSelectionComplete = () => {},
}) => {
  // Get the first quote from the node's siblings map
  const quote = useMemo(() => {
    const firstQuote = Array.from(node.siblings.levelsMap.keys())[0];
    return firstQuote || null;
  }, [node.siblings.levelsMap]);

  // Check if this node is the target of a reply
  const isQuoteTarget = replyTargetId === node.rootNodeId;

  // Memoize the text content to prevent unnecessary re-renders
  const textContent = useMemo(() => {
    return node.textContent || '';
  }, [node.textContent]);

  return (
    <div 
      className="node-content"
      role="article"
      aria-label={isQuoteTarget ? 'Selected content for reply' : 'Story content'}
    >
      {quote && (
        <div className="quote-container" role="region" aria-label="Quoted content">
          <QuoteRenderer quote={quote} />
        </div>
      )}
      <div className="text-content" role="region" aria-label="Main content">
        <TextSelection
          onSelectionCompleted={onSelectionComplete}
          selectionState={isQuoteTarget ? selectionState : null}
          aria-label={isQuoteTarget ? 'Selectable text for reply' : 'Story text'}
        >
          {textContent}
        </TextSelection>
      </div>
    </div>
  );
};

// Add display name for better debugging
NodeContent.displayName = 'NodeContent';

export default NodeContent;