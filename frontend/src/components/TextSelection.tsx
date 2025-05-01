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
import { PostTreeNode } from '../types/types';

interface TextSelectionProps {
  node: PostTreeNode;
  children: React.ReactNode;
  selectAll?: boolean;
  selectedQuote?: Quote;
  initialQuote?: Quote;
  ['aria-label']?: string;
}

/**
 * TextSelection component - used ONLY for the quote container to allow text selection
 * The main content highlighting is handled separately by HighlightedText component
 * 
 * IMPORTANT: This component has NO INFLUENCE on the HighlightedText display.
 * It only creates new text selections within the quote container.
 */
const TextSelection: React.FC<TextSelectionProps> = ({
  node,
  children,
  selectAll = false,
  selectedQuote,
  initialQuote,
  'aria-label': ariaLabel
}) => {
  // Memoize the props for the hook
  const hookProps = useMemo(() => ({
    selectAll,
    selectedQuote: initialQuote,
  }), [selectAll, initialQuote]);
  
  // Use the text selection hook, passing the initial quote
  const { 
    containerRef, 
    eventHandlers, 
    containerText,
    isSelecting
  } = useTextSelection(hookProps);

  // Memoize styles to prevent re-renders - use proper TypeScript CSSProperties
  const containerStyle = useMemo((): CSSProperties => ({ 
    position: 'relative' as const,
    // We'll let the browser handle the text selection visually
    // The useTextSelection hook will manage the programmatic selection
  }), []);

  // Extract event handlers safely
  const { onMouseDown, onMouseUp, onTouchStart } = eventHandlers || {};

  // Get the text content to display
  const displayText = useMemo(() => {
    // First priority: children as string
    if (typeof children === 'string') return children;
    
    // Second priority: containerText from the hook
    if (containerText) return containerText;
    
    // Fallback: empty string
    return '';
  }, [containerText, children]);

  // For quote container, we simply display the text with selection functionality
  return (
    <div
      ref={containerRef}
      className={`selection-container quote-text ${isSelecting ? 'is-selecting' : ''}`}
      id={node.id}
      style={containerStyle}
      onMouseDown={onMouseDown}
      onMouseUp={onMouseUp}
      onTouchStart={onTouchStart}
      aria-label={ariaLabel}
    >
      {displayText}
    </div>
  );
};

// Export as memoized component to prevent unnecessary re-renders
export default React.memo(TextSelection); 