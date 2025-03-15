/*
 * Requirements:
 * - Delegate text selection logic to useTextSelection hook
 * - Render children within a container that disables native text selection
 * - Maintain integration with ReplyContext via onSelectionCompleted
 * - Use proper styling for text selection (via TextSelection.css)
 * - Used only for quote container display
 */

import React, { useMemo, CSSProperties } from 'react';
import { useTextSelection } from '../hooks/useTextSelection';
import './TextSelection.css';
import { Quote } from '../types/quote';
import { QuoteCounts, StoryTreeNode } from '../types/types';

interface TextSelectionProps {
  node: StoryTreeNode;
  children: React.ReactNode;
  onSelectionCompleted: (quote: Quote) => void;
  selectAll?: boolean;
  selectedQuote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
  [key: string]: any; // For additional props like aria attributes
}

/**
 * TextSelection component - now used only for the quote container
 * The main content highlighting is handled directly in NodeContent
 */
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
    containerText
  } = useTextSelection(memoizedProps);

  // Memoize styles to prevent re-renders - use proper TypeScript CSSProperties
  const containerStyle = useMemo((): CSSProperties => ({ 
    userSelect: 'none' as const, 
    WebkitUserSelect: 'none' as const, 
    touchAction: 'none' as const 
  }), []);

  return (
    <div
      ref={containerRef}
      className="selection-container"
      id={node.id}
      style={containerStyle}
      {...eventHandlers}
      {...restProps}
    >
      {containerText || (typeof children === 'string' ? children : '')}
    </div>
  );
};

// Export as memoized component to prevent unnecessary re-renders
export default React.memo(TextSelection); 