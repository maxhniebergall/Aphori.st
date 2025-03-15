/*
 * Requirements:
 * - Encapsulate text selection logic into a re-usable hook
 * - Use lodash throttle for efficient animation (60fps, ~16ms)
 * - Manage DOM event listeners (mousemove/touchmove) on the container element
 * - Provide event handlers for mouse and touch events
 * - Use DOM manipulation during active selection for better performance
 * - Use state-driven rendering for displaying existing quote highlights
 * - Perform proper cleanup of added event listeners on unmount
 * - Support integration with a supplied onSelectionCompleted callback
 * - Respond to external state via `selectAll`, `selectionState`, and highlight `quotes`
 * - Handle null safety for DOM operations
 */

import { useRef, useCallback, useEffect, useState, useMemo } from 'react';
import { throttle } from 'lodash';
import { getCurrentOffset, getWordBoundaries } from '../utils/selectionUtils';
import { Quote } from '../types/quote';
import { QuoteCounts } from '../types/types';

interface UseTextSelectionProps {
  onSelectionCompleted: (quote: Quote) => void;
  selectAll?: boolean;
  selectedQuote?: Quote;
  existingSelectableQuotes?: QuoteCounts;
}

interface UseTextSelectionReturn {
  containerRef: React.RefObject<HTMLDivElement> & ((node: HTMLDivElement | null) => void);
  eventHandlers: {
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
    onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void;
    onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void;
  };
  selections: Quote[];
  containerText: string;
  handleSegmentClick: (quote: Quote) => void;
  isSelecting: boolean;
}

// Helper functions for DOM manipulation during active selection
const removeTemporaryHighlights = (element: HTMLElement): void => {
  const temporaryHighlights = element.querySelectorAll('span.temporary-highlight');
  temporaryHighlights.forEach((highlight) => {
    const parent = highlight.parentNode;
    if (parent) {
      parent.replaceChild(document.createTextNode(highlight.textContent || ''), highlight);
      parent.normalize(); // Merge adjacent text nodes
    }
  });
};

const findNodeAndOffset = (element: HTMLElement, offset: number) => {
  let currentOffset = 0;
  const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    const length = node.textContent ? node.textContent.length : 0;
    if (currentOffset + length >= offset) {
      return {
        node,
        offset: offset - currentOffset,
      };
    }
    currentOffset += length;
  }
  return null;
};

const highlightTemporarySelection = (element: HTMLElement, startOffset: number, endOffset: number): void => {
  // Remove any existing temporary highlights
  removeTemporaryHighlights(element);

  const minOffset = Math.min(startOffset, endOffset);
  const maxOffset = Math.max(startOffset, endOffset);
  const start = findNodeAndOffset(element, minOffset);
  const end = findNodeAndOffset(element, maxOffset);

  if (!start || !end) return;

  const range = document.createRange();
  range.setStart(start.node, start.offset);
  range.setEnd(end.node, end.offset);

  const span = document.createElement('span');
  span.style.backgroundColor = 'yellow';
  span.className = 'temporary-highlight'; // Mark as temporary for easy cleanup

  try {
    range.surroundContents(span);
  } catch (e) {
    console.warn('Could not highlight selection:', e);
    // Even if DOM manipulation fails, we'll continue with the selection process
    // The user will still be able to complete the selection, just without visual feedback
  }
};

// Throttled animation loop used during mouse/touch move
const throttledAnimationLoop = throttle(
  (
    event: Event, 
    container: React.RefObject<HTMLDivElement | null>, 
    startOffset: number, 
    mouseDownRef: React.MutableRefObject<boolean>
  ) => {
    if (!mouseDownRef.current || !container.current) {
      if (container.current) {
        removeTemporaryHighlights(container.current);
      }
      return;
    }
    
    const endOffset = getCurrentOffset(container.current, event);
    if (endOffset !== null) {
      const minOffset = Math.min(startOffset, endOffset);
      const maxOffset = Math.max(startOffset, endOffset);
      
      // Use DOM manipulation for active selection
      highlightTemporarySelection(container.current, minOffset, maxOffset);
    }
  },
  16
);

/**
 * Manages text selection and dynamic highlighting on a DOM container via mouse and touch interactions.
 *
 * This hook encapsulates the logic for:
 * - Tracking text selection and word boundaries.
 * - Using direct DOM manipulation during active selection for better performance.
 * - Managing selection ranges in state for rendering existing highlights with HighlightedText.
 * - Handling both full container ("select all") and partial text selections.
 * - Applying dynamic quote-based highlights based on external counts.
 * - Cleaning up event listeners to prevent memory leaks.
 *
 * @param {Object} props - Configuration options for managing text selection.
 * @param {(quote: Quote) => void} props.onSelectionCompleted - Callback invoked after a selection is finalized,
 *   receiving a Quote object that holds the selected text, container ID, and selection range.
 * @param {boolean} [props.selectAll=false] - If true, automatically selects and highlights the entire container text.
 * @param {Quote} [props.selectedQuote] - A quote object representing pre-selected text to be highlighted.
 * @param {QuoteCounts} [props.existingSelectableQuotes] - A collection of quotes with associated counts used to highlight
 *   the top quotes dynamically.
 *
 * @returns {{
 *   containerRef: React.RefObject<HTMLDivElement>,
 *   eventHandlers: {
 *     onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void,
 *     onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void,
 *     onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void,
 *   },
 *   selections: Quote[],
 *   containerText: string,
 *   handleSegmentClick: (quote: Quote) => void,
 *   isSelecting: boolean
 * }} An object containing:
 *   - containerRef: a React ref to be attached to the container DOM element.
 *   - eventHandlers: event handler functions to manage text selection interactions.
 *   - selections: array of quotes for rendering with HighlightedText.
 *   - containerText: the text content of the container.
 *   - handleSegmentClick: function to handle clicks on highlighted segments.
 *   - isSelecting: boolean indicating if a selection is in progress.
 */
export function useTextSelection({  
  onSelectionCompleted,
  selectAll = false,
  selectedQuote,
  existingSelectableQuotes,
}: UseTextSelectionProps): UseTextSelectionReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerText, setContainerText] = useState<string>('');
  const [selections, setSelections] = useState<Quote[]>([]);
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  
  const boundThrottledAnimationRef = useRef<((e: Event) => void) | null>(null);
  const mouseIsDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const initialOffsetRef = useRef<number | null>(null);
  const finalOffsetRef = useRef<number | null>(null);

  // Update container text when the ref changes
  useEffect(() => {
    if (containerRef.current) {
      setContainerText(containerRef.current.textContent || '');
    }
  }, []);

  // Handle segment click (for existing highlights)
  const handleSegmentClick = useCallback((quote: Quote) => {
    onSelectionCompleted(quote);
  }, [onSelectionCompleted]);

  const cleanupEventListeners = useCallback(() => {
    if (boundThrottledAnimationRef.current && containerRef.current) {
      containerRef.current.removeEventListener('mousemove', boundThrottledAnimationRef.current);
      containerRef.current.removeEventListener('touchmove', boundThrottledAnimationRef.current, { capture: true });
      boundThrottledAnimationRef.current = null;
    }
    
    // Also clean up any temporary highlights
    if (containerRef.current) {
      removeTemporaryHighlights(containerRef.current);
    }
    
    // End selection mode
    setIsSelecting(false);
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent | TouchEvent) => {
    if (!containerRef.current) return;
    event.preventDefault();

    // Start selection mode - this will hide existing highlights
    setIsSelecting(true);
    mouseIsDownRef.current = true;
    isDraggingRef.current = false;
    initialOffsetRef.current = getCurrentOffset(containerRef.current, event);

    boundThrottledAnimationRef.current = (e: Event) => {
      if (e.cancelable) e.preventDefault();
      isDraggingRef.current = true;
      // Safe to use non-null here because we set it above
      throttledAnimationLoop(
        e, 
        containerRef, 
        initialOffsetRef.current!, 
        mouseIsDownRef
      );
    };

    if (event.type === 'touchstart') {
      containerRef.current.addEventListener('touchmove', boundThrottledAnimationRef.current, { passive: false, capture: true });
    } else {
      containerRef.current.addEventListener('mousemove', boundThrottledAnimationRef.current);
    }
  }, []);

  const endAnimationLoop = useCallback(
    (event: MouseEvent | TouchEvent): Quote | null => {
      event.preventDefault();
      event.stopPropagation();
      mouseIsDownRef.current = false;
      isDraggingRef.current = false;
      cleanupEventListeners();
      
      if (!containerRef.current) return null;
      
      finalOffsetRef.current = getCurrentOffset(containerRef.current, event);
      let startOffset = initialOffsetRef.current ?? 0;
      let endOffset = finalOffsetRef.current ?? 0;
      
      if (startOffset > endOffset) {
        const temp = startOffset;
        startOffset = endOffset;
        endOffset = temp;
      }
      
      const quote: Quote = new Quote(
        containerRef.current.textContent?.slice(startOffset, endOffset) || '',
        containerRef.current.id, 
        {
          start: startOffset,
          end: endOffset
        },
      );
      
      return quote;
    },
    [cleanupEventListeners]
  );

  const handleMouseUp = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!mouseIsDownRef.current || !containerRef.current) return;

      if (!isDraggingRef.current) {
        // If no dragging occurred, we'll do a word selection based on the initial offset
        const offset = initialOffsetRef.current;
        if (offset !== null) {
          const text = containerRef.current.textContent || '';
          const { start, end } = getWordBoundaries(text, offset);
          
          const quote = new Quote(
            text.slice(start, end),
            containerRef.current.id,
            { start, end }
          );
          
          onSelectionCompleted(quote);
          mouseIsDownRef.current = false;
          cleanupEventListeners(); // This will also set isSelecting to false
          return;
        }
      }
      
      const quote = endAnimationLoop(event);
      if (quote) {
        onSelectionCompleted(quote);
      }
    },
    [endAnimationLoop, onSelectionCompleted, cleanupEventListeners]
  );

  // Global cleanup in case of lost mouseup/touchend events
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (mouseIsDownRef.current) {
        mouseIsDownRef.current = false;
        cleanupEventListeners();
      }
    };
    window.addEventListener('mouseup', handleGlobalMouseUp);
    window.addEventListener('touchend', handleGlobalMouseUp);
    return () => {
      window.removeEventListener('mouseup', handleGlobalMouseUp);
      window.removeEventListener('touchend', handleGlobalMouseUp);
    };
  }, [cleanupEventListeners]);

  // Effect: update selections based on external selectAll / selectedQuote
  useEffect(() => {
    if (containerRef.current) {
      const text = containerRef.current.textContent || '';
      setContainerText(text);
      
      let newSelections: Quote[] = [];
      
      if (selectAll) {
        const quote = new Quote(text, containerRef.current.id, { start: 0, end: text.length });
        newSelections.push(quote);
      } else if (selectedQuote) {
        newSelections.push(selectedQuote);
      }
      
      setSelections(newSelections);
    }
  }, [selectAll, selectedQuote]);

  // Effect: add quotes from existingSelectableQuotes to selections
  useEffect(() => {
    if (containerRef.current && existingSelectableQuotes?.quoteCounts) {
      // Sort quotes by reply count descending and process top 10 only
      const sortedQuotes = existingSelectableQuotes.quoteCounts
        .sort(([, count1], [, count2]) => count2 - count1)
        .slice(0, 10);
      
      const quoteSelections: Quote[] = sortedQuotes.map(([quoteObj, _]) => {
        // Ensure quote is a valid Quote instance or convert it
        let quote: Quote;
        if (quoteObj instanceof Quote) {
          quote = quoteObj;
        } else if (typeof quoteObj === 'object' && quoteObj !== null) {
          try {
            quote = new Quote(
              (quoteObj as any).text || "",
              (quoteObj as any).sourcePostId || "",
              (quoteObj as any).selectionRange || { start: 0, end: 0 }
            );
          } catch (e) {
            console.error('Failed to create Quote from object:', e, quoteObj);
            // Return a dummy quote that won't be rendered
            return new Quote("", "", { start: -1, end: -1 });
          }
        } else {
          console.error('useTextSelection: Invalid quote object:', quoteObj);
          // Return a dummy quote that won't be rendered
          return new Quote("", "", { start: -1, end: -1 });
        }
        
        return quote;
      }).filter(quote => 
        quote.selectionRange.start >= 0 && 
        quote.selectionRange.end > quote.selectionRange.start
      ); // Filter out invalid selections
      
      setSelections(prevSelections => {
        // Combine with any existing selections (from selectAll or selectedQuote)
        return [...prevSelections, ...quoteSelections];
      });
    }
  }, [existingSelectableQuotes]);

  // Wrap our internal handlers for React events
  const onMouseDownHandler = (event: React.MouseEvent<HTMLDivElement>) => {
    handleMouseDown(event.nativeEvent);
  };
  const onTouchStartHandler = (event: React.TouchEvent<HTMLDivElement>) => {
    handleMouseDown(event.nativeEvent);
  };
  const onMouseUpHandler = (event: React.MouseEvent<HTMLDivElement>) => {
    handleMouseUp(event.nativeEvent);
  };
  const onTouchEndHandler = (event: React.TouchEvent<HTMLDivElement>) => {
    handleMouseUp(event.nativeEvent);
  };

  // Define a native touchstart handler
  const handleTouchStartNative = (event: TouchEvent) => {
    event.preventDefault();
    handleMouseDown(event);
  };

  // Create a callback ref that attaches the native listener as soon as the container is set
  const setContainerRef = (node: HTMLDivElement | null) => {
    if (containerRef.current) {
      // Remove existing listener if containerRef was set before
      containerRef.current.removeEventListener('touchstart', handleTouchStartNative);
    }
    containerRef.current = node;
    if (node) {
      node.addEventListener('touchstart', handleTouchStartNative, { passive: false, capture: true });
      setContainerText(node.textContent || '');
    }
  };

  return {
    containerRef: setContainerRef as React.RefObject<HTMLDivElement> & ((node: HTMLDivElement | null) => void),
    eventHandlers: {
      onMouseDown: onMouseDownHandler,
      onMouseUp: onMouseUpHandler,
      onTouchEnd: onTouchEndHandler,
    },
    selections: selections,
    containerText,
    handleSegmentClick,
    isSelecting,
  };
} 