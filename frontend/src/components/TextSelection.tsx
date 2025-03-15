/*
 * Requirements:
 * - Delegate text selection logic to useTextSelection hook
 * - Render children within a container that disables native text selection
 * - Maintain integration with ReplyContext via onSelectionCompleted
 * - Use proper styling for text selection (via TextSelection.css)
 * - Use HighlightedText component for rendering overlapping highlights
 * - Hide existing highlights during active selection
 */

import React, { useMemo, CSSProperties } from 'react';
import { useTextSelection } from '../hooks/useTextSelection';
import './TextSelection.css';
import { Quote } from '../types/quote';
import { QuoteCounts, StoryTreeNode } from '../types/types';
import HighlightedText from './HighlightedText';

interface TextSelectionProps {
  node: StoryTreeNode;
  children: React.ReactNode;
  onSelectionCompleted: (quote: Quote) => void;
  selectAll?: boolean;
  selectedQuote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
  [key: string]: any; // For additional props like aria attributes
}

const TextSelection: React.FC<TextSelectionProps> = ({
  node,
  children,
  onSelectionCompleted,
  selectAll = false,
  selectedQuote,
  existingSelectableQuotes,
  ...restProps
}) => {
  // Memoize the props to prevent unnecessary re-renders
  const memoizedProps = useMemo(() => ({
    onSelectionCompleted,
    selectAll,
    selectedQuote,
    existingSelectableQuotes,
  }), [onSelectionCompleted, selectAll, selectedQuote, existingSelectableQuotes]);
  
  const { 
    containerRef, 
    eventHandlers, 
    selections, 
    containerText, 
    handleSegmentClick,
    isSelecting
  } = useTextSelection(memoizedProps);

  // Memoize styles to prevent re-renders - use proper TypeScript CSSProperties
  const containerStyle = useMemo((): CSSProperties => ({ 
    userSelect: 'none' as const, 
    WebkitUserSelect: 'none' as const, 
    touchAction: 'none' as const 
  }), []);

  // Determine whether to render children directly or use HighlightedText
  const shouldUseHighlightedText = useMemo(() => {
    // If we have selections and we're not in active selection mode
    return !isSelecting && (selections.length > 0 || typeof children === 'string');
  }, [selections, children, isSelecting]);

  return (
    <div
      ref={containerRef}
      className="selection-container"
      id={node.id}
      style={containerStyle}
      {...eventHandlers}
      {...restProps}
    >
      {shouldUseHighlightedText ? (
        <HighlightedText
          text={containerText || (typeof children === 'string' ? children : '')}
          selections={selections}
          onSegmentClick={handleSegmentClick}
        />
      ) : (
        children
      )}
    </div>
  );
};

// Export as memoized component to prevent unnecessary re-renders from parent
export default React.memo(TextSelection); 