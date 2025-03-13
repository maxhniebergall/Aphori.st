/*
 * Requirements:
 * - Delegate text selection logic to useTextSelection hook
 * - Render children within a container that disables native text selection
 * - Maintain integration with ReplyContext via onSelectionCompleted
 * - Use proper styling for text selection (via TextSelection.css)
 */

import React, { useMemo, CSSProperties } from 'react';
import { useTextSelection } from '../hooks/useTextSelection';
import './TextSelection.css';
import { Quote } from '../types/quote';
import { QuoteCounts } from '../types/types';
import { StoryTreeNode } from '../types/storyTreeNode';

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
  
  const { containerRef, eventHandlers } = useTextSelection(memoizedProps);

  // Memoize styles to prevent re-renders - use proper TypeScript CSSProperties
  const containerStyle = useMemo((): CSSProperties => ({ 
    userSelect: 'none' as const, 
    WebkitUserSelect: 'none' as const, 
    touchAction: 'none' as const 
  }), []);

  // Get the appropriate ID based on node type
  const nodeId = useMemo(() => {
    return node.isLeafNode ? node.leafNode?.id : node.branchNode?.id;
  }, [node]);

  return (
    <div
      ref={containerRef}
      className="selection-container"
      id={nodeId}
      style={containerStyle}
      {...eventHandlers}
      {...restProps}
    >
      {children}
    </div>
  );
};

// Export as memoized component to prevent unnecessary re-renders from parent
export default React.memo(TextSelection); 