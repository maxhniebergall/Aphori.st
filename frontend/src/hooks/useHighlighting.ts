/*
 * Requirements:
 * - Encapsulate text highlighting logic into a re-usable hook
 * - Process quotes for highlighting based on selection ranges
 * - Support varying highlight intensity based on overlap count
 * - Handle existing quotes with associated counts
 * - Provide a way to handle clicks on highlighted segments
 */

import { useState, useEffect, useCallback, useMemo } from 'react';
import { Quote, areQuotesEqual } from '../types/quote';
import { QuoteCounts } from '../types/types';

interface UseHighlightingProps {
  text: string;
  selectedQuote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
  onSegmentClick?: (quote: Quote) => void;
}

interface UseHighlightingReturn {
  selections: Quote[];
  handleSegmentClick: (quote: Quote) => void;
  selectedQuote?: Quote | null;
}

/**
 * Manages text highlighting based on quotes and their selection ranges.
 * 
 * This hook processes quotes for highlighting, including:
 * - The currently selected quote (to highlight it in the main content)
 * - Existing quotes with associated counts (for popular selections)
 * 
 * IMPORTANT: This hook is ONLY used to display highlights in the main content,
 * not for active text selection - that's handled by the useTextSelection hook.
 * 
 * @param {Object} props - Configuration options for managing text highlighting.
 * @param {string} props.text - The text content to highlight.
 * @param {Quote} [props.selectedQuote] - A quote object representing pre-selected text to be highlighted.
 * @param {QuoteCounts} [props.existingSelectableQuotes] - A collection of quotes with associated counts.
 * @param {(quote: Quote) => void} [props.onSegmentClick] - Callback for when a highlighted segment is clicked.
 * 
 * @returns {{
 *   selections: Quote[],
 *   handleSegmentClick: (quote: Quote) => void,
 *   selectedQuote?: Quote | null
 * }} An object containing:
 *   - selections: array of quotes for rendering with HighlightedText.
 *   - handleSegmentClick: function to handle clicks on highlighted segments.
 *   - selectedQuote?: Quote | null
 */
export function useHighlighting({
  text,
  selectedQuote,
  existingSelectableQuotes,
  onSegmentClick
}: UseHighlightingProps): UseHighlightingReturn {
  // Remove useState for selections
  // const [selections, setSelections] = useState<Quote[]>([]);

  // Handle segment click (for existing highlights)
  const handleSegmentClick = useCallback((quote: Quote) => {
    if (onSegmentClick) {
      onSegmentClick(quote);
    }
  }, [onSegmentClick]);

  // Memoize the calculation of selections
  const selections = useMemo(() => {
    console.log('[useHighlighting] Recalculating selections...'); // Debug log
    let calculatedSelections: Quote[] = [];
    
    // Add quotes from existingSelectableQuotes
    if (existingSelectableQuotes?.quoteCounts) {
      // Sort quotes by reply count descending
      const sortedQuotes = existingSelectableQuotes.quoteCounts
        .sort(([, count1], [, count2]) => count2 - count1);
      
      const quoteSelections: Quote[] = sortedQuotes.map(([quoteObj, _]) => {
        // Ensure quote is a valid Quote instance or convert it
        let quote: Quote;
        if (quoteObj instanceof Quote) {
          quote = quoteObj;
        } else if (typeof quoteObj === 'object' && quoteObj !== null) {
          try {
            quote = new Quote(
              (quoteObj as any).text || "",
              (quoteObj as any).sourceId || "",
              (quoteObj as any).selectionRange || { start: 0, end: 0 }
            );
          } catch (e) {
            console.error('Failed to create Quote from object:', e, quoteObj);
            // Return a dummy quote that won't be rendered
            return new Quote("", "", { start: -1, end: -1 });
          }
        } else {
          console.error('useHighlighting: Invalid quote object:', quoteObj);
          // Return a dummy quote that won't be rendered
          return new Quote("", "", { start: -1, end: -1 });
        }
        
        return quote;
      }).filter(quote => 
        quote.selectionRange && quote.selectionRange.end > quote.selectionRange.start
      ); // Filter out invalid selections
      
      // Add unique quotes from the existing ones
      // Using areQuotesEqual for more robust comparison
      quoteSelections.forEach(quote => {
        if (!calculatedSelections.some(q => areQuotesEqual(q, quote))) {
          calculatedSelections.push(quote);
        }
      });
    }
    
    // The selections array should ONLY contain quotes made *by children* (from existingSelectableQuotes)
    // The quote the node makes of its parent (selectedQuote) is handled separately (e.g., blue underline).
    return calculatedSelections;
  // IMPORTANT: Add dependencies for useMemo. It should recalculate if existingSelectableQuotes changes.
  // Note: selectedQuote is NOT needed here because it doesn't affect the 'selections' list itself,
  // it's used for the separate blue underline logic in HighlightedText.
  }, [existingSelectableQuotes]);

  return {
    selections,
    handleSegmentClick,
    selectedQuote
  };
} 