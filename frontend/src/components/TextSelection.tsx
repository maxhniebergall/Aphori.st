/*
 * Requirements:
 * - Delegate text selection logic to useTextSelection hook
 * - Render children within a container that disables native text selection
 * - Maintain integration with ReplyContext via onSelectionCompleted
 * - Use proper styling for text selection (via TextSelection.css)
 */

import React from 'react';
import { useTextSelection } from '../hooks/useTextSelection';
import './TextSelection.css';
import { Quote } from '../types/quote';

interface Selection {
  start: number;
  end: number;
}

interface TextSelectionProps {
  children: React.ReactNode;
  onSelectionCompleted: (quote: Quote) => void;
  selectAll?: boolean;
  selectedQuote?: Quote;
  existingSelectableQuotes?: Record<string, number>;
}

const TextSelection: React.FC<TextSelectionProps> = ({
  children,
  onSelectionCompleted,
  selectAll = false,
  selectedQuote,
  existingSelectableQuotes,
}) => {
  const { containerRef, eventHandlers } = useTextSelection({
    onSelectionCompleted,
    selectAll,
    selectedQuote,
    existingSelectableQuotes,
  });

  return (
    <div
      ref={containerRef}
      className="selection-container"
      style={{ userSelect: 'none', WebkitUserSelect: 'none', touchAction: 'none' }}
      {...eventHandlers}
    >
      {children}
    </div>
  );
};

export default TextSelection; 