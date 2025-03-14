/*
 * Requirements:
 * - Encapsulate text selection logic into a re-usable hook
 * - Use lodash throttle for efficient animation (60fps, ~16ms)
 * - Manage DOM event listeners (mousemove/touchmove) on the container element
 * - Provide event handlers for mouse and touch events
 * - Update text highlights dynamically using throttled animations
 * - Perform proper cleanup of added event listeners on unmount
 * - Support integration with a supplied onSelectionCompleted callback
 * - Respond to external state via `selectAll`, `selectionState`, and highlight `quotes`
 * - Handle null safety for DOM operations
 */

import { useRef, useCallback, useEffect, useState } from 'react';
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
}

// Helper functions for DOM manipulations

const removeExistingHighlights = (element: HTMLElement): void => {
  const existingHighlights = element.querySelectorAll('span[style*="background-color"]');
  existingHighlights.forEach((highlight) => {
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

const highlightText = (element: HTMLElement, startOffset: number, endOffset: number): void => {
  removeExistingHighlights(element);

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

  try {
    range.surroundContents(span);
  } catch (e) {
    console.warn('Could not highlight selection:', e);
  }
};

const highlightQuotes = (element: HTMLElement, quotes: QuoteCounts, storeQuote: (quote: Quote) => number) => {
  // Skip if no quotes or no quoteCounts
  if (!quotes || !quotes.quoteCounts) {
    console.log('useTextSelection: No quotes to highlight', {
      hasQuotes: !!quotes,
      hasQuoteCounts: !!quotes?.quoteCounts
    });
    return;
  }

  removeExistingHighlights(element);

  // Sort quotes by reply count descending and process top 10 only
  const sortedQuotes = quotes.quoteCounts
    .sort(([, count1], [, count2]) => count2 - count1)
    .slice(0, 10);

  console.log('useTextSelection: Highlighting quotes', {
    JSON: JSON.stringify(sortedQuotes),
    elementId: element.id,
  });

  sortedQuotes.forEach(([quoteObj, count], index) => {
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
        return;
      }
    } else {
      console.error('useTextSelection: Invalid quote object:', quoteObj);
      return;
    }

    // Here, 'quote' should already be a Quote object that contains the selectionRange.
    const { start, end } = quote.selectionRange;
    const startPos = findNodeAndOffset(element, start);
    const endPos = findNodeAndOffset(element, end);
    
    if (!startPos || !endPos) {
      console.warn('useTextSelection: Could not find start or end position for quote', {
        start,
        end,
        hasStartPos: !!startPos,
        hasEndPos: !!endPos,
        elementLength: element.textContent?.length || 0
      });
      return;
    }

    const range = document.createRange();
    range.setStart(startPos.node, startPos.offset);
    range.setEnd(endPos.node, endPos.offset);

    const span = document.createElement('span');
    // Make highlights more visible with a stronger color and border
    span.style.backgroundColor = `rgba(50, 205, 50, ${Math.min(0.2 + count * 0.1, 0.7)})`;
    span.style.borderBottom = '2px solid #228B22';
    span.style.padding = '0 2px';
    span.style.borderRadius = '2px';
    span.dataset.quoteId = storeQuote(quote).toString();
    // Add the reply count as a data attribute for potential styling
    span.dataset.replyCount = count.toString();
    // TODO add styling to display the reply count
    try {
      range.surroundContents(span);
    } catch (e) {
      console.warn('Could not highlight quote:', e);
    }
  });
};

// Throttled animation loop used during mouse/touch move
const throttledAnimationLoop = throttle(
  (event: Event, container: React.RefObject<HTMLDivElement | null>, startOffset: number, mouseDownRef: React.MutableRefObject<boolean>) => {
    if (!mouseDownRef.current || !container.current) {
      if (container.current) {
        removeExistingHighlights(container.current);
      }
      return;
    }
    const endOffset = getCurrentOffset(container.current, event);
    if (endOffset !== null) {
      highlightText(container.current, startOffset, endOffset);
    }
  },
  16
);

/**
 * Manages text selection and dynamic highlighting on a DOM container via mouse and touch interactions.
 *
 * This hook encapsulates the logic for:
 * - Tracking text selection and word boundaries.
 * - Rendering highlights with a throttled animation ensuring smooth visual updates (~60fps).
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
 *     onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void,
 *     onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void,
 *     onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void,
 *   }
 * }} An object containing:
 *   - containerRef: a React ref to be attached to the container DOM element.
 *   - eventHandlers: event handler functions to manage text selection interactions.
 *
 * @example
 * // Example usage in a React component
 * function TextSelectionComponent() {
 *   const { containerRef, eventHandlers } = useTextSelection({
 *     onSelectionCompleted: (quote) => {
 *       console.log('Selected text:', quote.text);
 *     },
 *   });
 *
 *   return (
 *     <div ref={containerRef} {...eventHandlers}>
 *       This is a sample text that you can select to highlight.
 *     </div>
 *   );
 * }
 */
export function useTextSelection({  
  onSelectionCompleted,
  selectAll = false,
  selectedQuote,
  existingSelectableQuotes,
}: UseTextSelectionProps): UseTextSelectionReturn {
  const nextQuoteIdRef = useRef<number>(0);
  const [quoteIdToQuoteMap, setQuoteIdToQuoteMap] = useState<Map<number, Quote>>(new Map());

  const storeQuote = useCallback((quote: Quote): number => {
    const currentQuoteId = nextQuoteIdRef.current;
    setQuoteIdToQuoteMap(prevMap => {
      const newMap = new Map(prevMap);
      newMap.set(currentQuoteId, quote);
      return newMap;
    });
    nextQuoteIdRef.current = currentQuoteId + 1;
    return currentQuoteId;
  }, []);

  const containerRef = useRef<HTMLDivElement | null>(null);
  const boundThrottledAnimationRef = useRef<((e: Event) => void) | null>(null);
  const mouseIsDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const initialOffsetRef = useRef<number | null>(null);
  const finalOffsetRef = useRef<number | null>(null);

  const cleanupEventListeners = useCallback(() => {
    if (boundThrottledAnimationRef.current && containerRef.current) {
      containerRef.current.removeEventListener('mousemove', boundThrottledAnimationRef.current);
      containerRef.current.removeEventListener('touchmove', boundThrottledAnimationRef.current, { capture: true });
      boundThrottledAnimationRef.current = null;
    }
  }, []);

  const handleMouseDown = useCallback((event: MouseEvent | TouchEvent) => {
    if (!containerRef.current) return;
    event.preventDefault();

    mouseIsDownRef.current = true;
    isDraggingRef.current = false;
    initialOffsetRef.current = getCurrentOffset(containerRef.current, event);

    boundThrottledAnimationRef.current = (e: Event) => {
      if (e.cancelable) e.preventDefault();
      isDraggingRef.current = true;
      // Safe to use non-null here because we set it above
      throttledAnimationLoop(e, containerRef, initialOffsetRef.current!, mouseIsDownRef);
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
        // If click occurred on a quote highlight 
        const target = event.target as HTMLElement;
        if (target.dataset.quoteId) {
          try {
            const quoteId = parseInt(target.dataset.quoteId);
            const quote = quoteIdToQuoteMap.get(quoteId);
            if (quote) {
              onSelectionCompleted(quote);
            }
          } catch (err) {
            console.warn('Error parsing quote range', err);
          }
          mouseIsDownRef.current = false;
          return;
        }
        
        // Otherwise do a word selection based on the initial offset
        const offset = initialOffsetRef.current;
        if (offset !== null) {
          const text = containerRef.current.textContent || '';
          const { start, end } = getWordBoundaries(text, offset);
          removeExistingHighlights(containerRef.current);
          highlightText(containerRef.current, start, end);
          onSelectionCompleted(new Quote(
            text.slice(start, end),
            containerRef.current.id,
            { start, end }
          ));
          mouseIsDownRef.current = false;
          return;
        }
      }
      const quote = endAnimationLoop(event);
      if (quote) {
        onSelectionCompleted(quote);
      }
    },
    [endAnimationLoop, onSelectionCompleted]
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

  // Effect: update highlighting based on external selectAll / selectionState
  useEffect(() => {
    if (containerRef.current) {
      if (selectAll) {
        highlightText(containerRef.current, 0, containerRef.current.textContent?.length || 0);
      } else if (selectedQuote) {
        highlightText(containerRef.current, selectedQuote.selectionRange.start, selectedQuote.selectionRange.end);
      } else {
        removeExistingHighlights(containerRef.current);
      }
    }
  }, [selectAll, selectedQuote]);

  // Effect: highlight quotes if provided (e.g. based on reply counts)
  useEffect(() => {
    if (containerRef.current && existingSelectableQuotes) {
      highlightQuotes(containerRef.current, existingSelectableQuotes, storeQuote);
    }
  }, [existingSelectableQuotes, storeQuote]);

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
    }
  };

  return {
    containerRef: setContainerRef as React.RefObject<HTMLDivElement> & ((node: HTMLDivElement | null) => void),
    eventHandlers: {
      onMouseDown: onMouseDownHandler,
      onMouseUp: onMouseUpHandler,
      onTouchEnd: onTouchEndHandler,
    },
  };
} 