/*
 * Requirements:
 * - Encapsulate text selection logic into a re-usable hook
 * - Use lodash throttle for efficient animation (60fps, ~16ms)
 * - Manage DOM event listeners (mousemove/touchmove) on the container element
 * - Provide event handlers for mouse and touch events
 * - Use DOM manipulation during active selection for better performance
 * - Perform proper cleanup of added event listeners on unmount
 * - Respond to external state via `selectAll` and `selectedQuote`
 * - Handle null safety for DOM operations
 */

import { useRef, useCallback, useEffect, useState } from 'react';
import { throttle } from 'lodash';
import { getCurrentOffset, getWordBoundaries } from '../utils/selectionUtils';
import { Quote } from '../types/quote';
import { useReplyContext } from '../context/ReplyContext';

interface UseTextSelectionProps {
  selectAll?: boolean;
  selectedQuote?: Quote;
}

interface UseTextSelectionReturn {
  containerRef: React.RefObject<HTMLDivElement> & ((node: HTMLDivElement | null) => void);
  eventHandlers: {
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
    onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void;
    onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void;
  };
  containerText: string;
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
  span.className = 'temporary-highlight'; // Mark as temporary for easy cleanup

  try {
    range.surroundContents(span);
  } catch (e) {
    console.warn('Could not highlight selection:', e);
    // Even if DOM manipulation fails, we'll continue with the selection process
    // The user will still be able to complete the selection, just without visual feedback
  }
};

function onSelectionCompleted(quote: Quote, container: HTMLElement, setReplyQuote: (quote: Quote) => void){
  highlightTemporarySelection(container, quote.selectionRange.start, quote.selectionRange.end)
  setReplyQuote(quote);
}

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
 * Manages text selection ONLY within the quote container for creating new selections.
 * 
 * IMPORTANT: This hook is completely separate from the useHighlighting hook.
 * - useTextSelection: Creates new text selections in the quote container
 * - useHighlighting: Displays existing highlights in the main content
 *
 * This hook encapsulates the logic for:
 * - Tracking text selection and word boundaries.
 * - Using direct DOM manipulation during active selection for better performance.
 * - Handling both full container ("select all") and partial text selections.
 * - Cleaning up event listeners to prevent memory leaks.
 *
 * @param {Object} props - Configuration options for managing text selection.
 * @param {(quote: Quote) => void} props.onSelectionCompleted - Callback invoked after a selection is finalized,
 *   receiving a Quote object that holds the selected text, container ID, and selection range.
 * @param {boolean} [props.selectAll=false] - If true, automatically selects the entire container text.
 * @param {Quote} [props.selectedQuote] - A quote object representing pre-selected text.
 *
 * @returns {{
 *   containerRef: React.RefObject<HTMLDivElement>,
 *   eventHandlers: {
 *     onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void,
 *     onMouseUp: (event: React.MouseEvent<HTMLDivElement>) => void,
 *     onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void,
 *   },
 *   containerText: string,
 *   isSelecting: boolean
 * }} An object containing:
 *   - containerRef: a React ref to be attached to the container DOM element.
 *   - eventHandlers: event handler functions to manage text selection interactions.
 *   - containerText: the text content of the container.
 *   - isSelecting: boolean indicating if a selection is in progress.
 */
export function useTextSelection({  
  selectAll = false,
  selectedQuote,
}: UseTextSelectionProps): UseTextSelectionReturn {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerText, setContainerText] = useState<string>('');
  const [isSelecting, setIsSelecting] = useState<boolean>(false);
  
  const boundThrottledAnimationRef = useRef<((e: Event) => void) | null>(null);
  const mouseIsDownRef = useRef(false);
  const isDraggingRef = useRef(false);
  const initialOffsetRef = useRef<number | null>(null);
  const finalOffsetRef = useRef<number | null>(null);

  const { 
    setReplyQuote 
  } = useReplyContext();

  // Track the ID for which the initial quote was set
  const initialQuoteSetForIdRef = useRef<string | null>(null);

  // Update container text when the ref changes
  useEffect(() => {
    if (containerRef.current) {
      setContainerText(containerRef.current.textContent || '');
      // Reset initial quote tracking if container ID changes
      if (containerRef.current.id !== initialQuoteSetForIdRef.current) {
        initialQuoteSetForIdRef.current = null; 
      }
    }
  }, []); // Keep dependencies minimal

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
          
          onSelectionCompleted(quote, containerRef.current, setReplyQuote);
          mouseIsDownRef.current = false;
          cleanupEventListeners(); // This will also set isSelecting to false
          return;
        }
      }
      
      const quote = endAnimationLoop(event);
      if (quote) {
        onSelectionCompleted(quote, containerRef.current, setReplyQuote);
      }
    },
    [endAnimationLoop, onSelectionCompleted, cleanupEventListeners]
  );

  // Global cleanup in case of lost mouseup/touchend events
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (mouseIsDownRef.current) {
        mouseIsDownRef.current = false;
        // Ensure temporary highlights are removed even if selection wasn't completed normally
        if (containerRef.current) {
          removeTemporaryHighlights(containerRef.current);
        }
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

  // Effect: handle INITIAL selectedQuote
  useEffect(() => {
    // Ensure container is available and has an ID
    if (containerRef.current && containerRef.current.id) {
      const currentContainerId = containerRef.current.id;
      
      // Only set initial quote if:
      // 1. A selectedQuote is provided.
      // 2. We haven't already set the initial quote for THIS container ID.
      if (selectedQuote && initialQuoteSetForIdRef.current !== currentContainerId) {
        
        // Check if the quote source matches the container ID - important safety check
        if (selectedQuote.sourceId === currentContainerId) {
          // Use a minimal version of onSelectionCompleted just for highlighting
          highlightTemporarySelection(containerRef.current, selectedQuote.selectionRange.start, selectedQuote.selectionRange.end);
          
          // Mark that the initial quote has been set for this container ID
          initialQuoteSetForIdRef.current = currentContainerId;
        } else {
          console.warn("useTextSelection: selectedQuote sourceId does not match container id. Initial highlight skipped.", {
            quoteSourceId: selectedQuote.sourceId,
            containerId: currentContainerId
          });
          // Reset tracking if quote doesn't match container
          initialQuoteSetForIdRef.current = null; 
        }
      } 
      // If selectedQuote becomes null/undefined after being set, clear the highlight and reset tracking
      else if (!selectedQuote && initialQuoteSetForIdRef.current === currentContainerId) {
        removeTemporaryHighlights(containerRef.current);
        initialQuoteSetForIdRef.current = null;
      }
    }
  // Dependencies: Only run when selectedQuote or the container ref itself changes.
  // Avoid dependency on onSelectionCompleted or setReplyQuote here.
  }, [selectedQuote, containerRef.current]); 

  // Wrap our internal handlers for React events
  const onMouseDownHandler = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    handleMouseDown(event.nativeEvent);
  }, [handleMouseDown]);
  
  const onTouchStartHandler = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    handleMouseDown(event.nativeEvent);
  }, [handleMouseDown]);
  
  const onMouseUpHandler = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    handleMouseUp(event.nativeEvent);
  }, [handleMouseUp]);
  
  const onTouchEndHandler = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    handleMouseUp(event.nativeEvent);
  }, [handleMouseUp]);

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
    containerText,
    isSelecting,
  };
} 