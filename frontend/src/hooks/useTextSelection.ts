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

// Helper function to get coordinates for a specific text offset
const getCoordsForOffset = (
  container: HTMLElement,
  offset: number
): { x: number; y: number } | null => {
  const nodeAndOffset = findNodeAndOffset(container, offset);
  if (!nodeAndOffset) return null;

  const { node, offset: nodeOffset } = nodeAndOffset;

  try {
    const range = document.createRange();
    // Ensure the offset is within the node's bounds
    const clampedOffset = Math.min(nodeOffset, node.textContent?.length ?? 0);
    range.setStart(node, clampedOffset);
    range.setEnd(node, clampedOffset); // Use the same point for start and end to get a collapsed range

    const rect = range.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();

    // Calculate position relative to the container
    // Adjust slightly to position the handle nicely (e.g., center it vertically)
    return {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top + rect.height / 2, // Center vertically on the line
    };
  } catch (e) {
    console.error("Error calculating coordinates for offset:", e);
    return null;
  }
};

// Function to update the visual positions of the handles
const updateHandlePositions = (
  container: HTMLElement,
  startHandle: HTMLSpanElement | null,
  endHandle: HTMLSpanElement | null,
  startOffset: number,
  endOffset: number
) => {
  if (!startHandle || !endHandle) return;

  const startCoords = getCoordsForOffset(container, startOffset);
  const endCoords = getCoordsForOffset(container, endOffset);

  // Get container dimensions for clamping
  const containerWidth = container.clientWidth;
  const containerHeight = container.clientHeight; // Might not be strictly necessary if text flows only horizontally, but good practice
  const handleRadius = 8; // Half of the 16px width/height

  if (startCoords) {
    // Clamp coordinates to stay within container bounds, accounting for handle radius
    const clampedX = Math.max(handleRadius, Math.min(startCoords.x, containerWidth - handleRadius));
    const clampedY = Math.max(handleRadius, Math.min(startCoords.y, containerHeight - handleRadius));

    startHandle.style.left = `${clampedX}px`;
    startHandle.style.top = `${clampedY}px`;
    startHandle.style.display = 'block';
  } else {
    startHandle.style.display = 'none';
  }

  if (endCoords) {
    // Clamp coordinates
    const clampedX = Math.max(handleRadius, Math.min(endCoords.x, containerWidth - handleRadius));
    const clampedY = Math.max(handleRadius, Math.min(endCoords.y, containerHeight - handleRadius));

    endHandle.style.left = `${clampedX}px`;
    endHandle.style.top = `${clampedY}px`;
    endHandle.style.display = 'block';
  } else {
    endHandle.style.display = 'none';
  }
};

// Helper to get text offset from viewport coordinates
const getOffsetFromCoordinates = (
  container: HTMLElement,
  clientX: number,
  clientY: number
): number | null => {
  let range: Range | null = null;
  // Modern approach
  if (document.caretPositionFromPoint) {
    const caretPos = document.caretPositionFromPoint(clientX, clientY);
    if (!caretPos || !container.contains(caretPos.offsetNode)) return null; // Ensure point is within container
    range = document.createRange();
    range.setStart(caretPos.offsetNode, caretPos.offset);
    range.collapse(true); // Collapse to a single point
  }
  // Fallback for older browsers (less common now)
  else if ((document as any).caretRangeFromPoint) {
      range = (document as any).caretRangeFromPoint(clientX, clientY) as Range;
       if (!range || !container.contains(range.startContainer)) return null; // Check containment
  } else {
    console.warn("Browser does not support caretPositionFromPoint or caretRangeFromPoint.");
    return null;
  }

  if (!range) return null;

  // Calculate offset relative to the container's start
  const containerRange = document.createRange();
  containerRange.selectNodeContents(container);
  containerRange.setEnd(range.startContainer, range.startOffset); // Set end to the caret position

  // The length of the containerRange is the offset
  // Need to be careful with different node types potentially?
  // textContent.length might be simpler/safer if performance allows
  // return containerRange.toString().length; // toString() can be slow

  // Alternative: Walk the tree (similar to findNodeAndOffset but in reverse) - more complex
  // For simplicity and reasonable performance, let's stick to the range length for now.
  // Test this carefully with complex nested elements if they exist.
  try {
      // This seems most reliable for offset calculation within the container
      const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
      let currentOffset = 0;
      let node;
      while (node = walker.nextNode()) {
          if (node === range.startContainer) {
              currentOffset += range.startOffset;
              break; // Found the node
          }
          currentOffset += node.textContent?.length ?? 0;
      }
      // Clamp offset to container text length
      const maxOffset = container.textContent?.length ?? 0;
      return Math.min(Math.max(0, currentOffset), maxOffset);

  } catch (e) {
      console.error("Error calculating offset from range:", e);
      return null;
  }
};

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
  
  // Replace useState with useRef
  // const [handlesVisible, setHandlesVisible] = useState<boolean>(false);
  const handlesVisibleRef = useRef<boolean>(false);
  // const [draggingHandle, setDraggingHandle] = useState<'start' | 'end' | null>(null);
  const draggingHandleRef = useRef<'start' | 'end' | null>(null);

  // Refs for listener functions to ensure correct removal
  const handleGlobalDragMoveRef = useRef<((event: MouseEvent | TouchEvent) => void) | null>(null);
  const handleGlobalDragEndRef = useRef<((event: MouseEvent | TouchEvent) => void) | null>(null);

  const boundThrottledAnimationRef = useRef<((e: Event) => void) | null>(null);
  const mouseIsDownRef = useRef(false);
  const isDraggingRef = useRef(false);

  // Refs for selection offsets - replacing initialOffsetRef and finalOffsetRef for live updates
  const selectionStartOffsetRef = useRef<number>(0);
  const selectionEndOffsetRef = useRef<number>(0);

  // Refs for handle DOM elements (we'll create/manage these)
  const startHandleRef = useRef<HTMLSpanElement | null>(null);
  const endHandleRef = useRef<HTMLSpanElement | null>(null);

  const { 
    setReplyQuote 
  } = useReplyContext();

  // Track the ID for which the initial quote was set
  const initialQuoteSetForIdRef = useRef<string | null>(null);

  // Forward declare handleMouseDownOnHandle because addHandles needs it
  const handleMouseDownOnHandle = useRef<((event: MouseEvent | TouchEvent, handleType: 'start' | 'end') => void) | null>(null);

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

  const removeHandles = useCallback(() => {
    if (startHandleRef.current) {
        startHandleRef.current.remove();
        startHandleRef.current = null;
    }
    if (endHandleRef.current) {
        endHandleRef.current.remove();
        endHandleRef.current = null;
    }
    handlesVisibleRef.current = false;
    if (containerRef.current) {
        removeTemporaryHighlights(containerRef.current);
    }
  }, []);

  const addHandles = useCallback((container: HTMLElement, startOffset: number, endOffset: number) => {
      if (getComputedStyle(container).position === 'static') {
          container.style.position = 'relative';
      }
      const onHandleMouseDown = handleMouseDownOnHandle.current; // Get current ref value
      if (!onHandleMouseDown) return; // Should not happen if initialized correctly

      if (!startHandleRef.current) {
          startHandleRef.current = document.createElement('span');
          startHandleRef.current.className = 'selection-handle start';
          // Use the captured onHandleMouseDown
          startHandleRef.current.addEventListener('mousedown', (e) => onHandleMouseDown(e, 'start'));
          startHandleRef.current.addEventListener('touchstart', (e) => onHandleMouseDown(e, 'start'), { passive: false });
          container.appendChild(startHandleRef.current);
      }
      if (!endHandleRef.current) {
          endHandleRef.current = document.createElement('span');
          endHandleRef.current.className = 'selection-handle end';
          // Use the captured onHandleMouseDown
          endHandleRef.current.addEventListener('mousedown', (e) => onHandleMouseDown(e, 'end'));
          endHandleRef.current.addEventListener('touchstart', (e) => onHandleMouseDown(e, 'end'), { passive: false });
          container.appendChild(endHandleRef.current);
      }
      updateHandlePositions(container, startHandleRef.current, endHandleRef.current, startOffset, endOffset);
      handlesVisibleRef.current = true;
  // Depend only on the ref container, not the function itself
  }, [handleMouseDownOnHandle]);

  // Now define handleMouseDownOnHandle and assign it to the ref
  handleMouseDownOnHandle.current = (event: MouseEvent | TouchEvent, handleType: 'start' | 'end') => {
       event.stopPropagation();
       if (!containerRef.current) return;
       draggingHandleRef.current = handleType;
       const container = containerRef.current;

       // Define and store listener functions in refs
       handleGlobalDragMoveRef.current = (moveEvent: MouseEvent | TouchEvent) => {
           moveEvent.preventDefault();
           if (!containerRef.current) return; // Re-check container
           const container = containerRef.current; // Re-get container

           const newOffset = getCurrentOffset(container, moveEvent);
           // console.log("Offset from getCurrentOffset:", newOffset); // Keep for debugging if needed

           if (newOffset !== null) {
                let currentStart = selectionStartOffsetRef.current;
                let currentEnd = selectionEndOffsetRef.current;
                let nextStart = currentStart;
                let nextEnd = currentEnd;

                if (draggingHandleRef.current === 'start') { nextStart = newOffset; }
                else { nextEnd = newOffset; }

                if (nextStart > nextEnd) { [nextStart, nextEnd] = [nextEnd, nextStart]; }

                selectionStartOffsetRef.current = nextStart;
                selectionEndOffsetRef.current = nextEnd;

                // --- FIX 2: Uncomment highlighting ---
                highlightTemporarySelection(container, nextStart, nextEnd);
                // --- Update handle positions ---
                updateHandlePositions(container, startHandleRef.current, endHandleRef.current, nextStart, nextEnd);
           } else {
               // console.log("getCurrentOffset returned null during handle drag"); // Keep if needed
           }
       };

       handleGlobalDragEndRef.current = (endEvent: MouseEvent | TouchEvent) => {
            endEvent.preventDefault();

            // --- FIX 1: Implement listener removal ---
            if (handleGlobalDragMoveRef.current) {
                window.removeEventListener('mousemove', handleGlobalDragMoveRef.current);
                window.removeEventListener('touchmove', handleGlobalDragMoveRef.current);
            }
            // Remove self (mouseup/touchend) listener
            if (handleGlobalDragEndRef.current) {
                window.removeEventListener('mouseup', handleGlobalDragEndRef.current);
                window.removeEventListener('touchend', handleGlobalDragEndRef.current);
            }
            // --- End Fix 1 ---

            // Clear refs AFTER removing listeners that use them
            handleGlobalDragMoveRef.current = null;
            handleGlobalDragEndRef.current = null;

            // Check container AFTER clearing refs, as we re-get it if needed
            const currentContainer = containerRef.current;
            if (!currentContainer) {
                draggingHandleRef.current = null;
                return;
            }

            // Final position update
            updateHandlePositions(
                currentContainer, // Use variable
                startHandleRef.current,
                endHandleRef.current,
                selectionStartOffsetRef.current,
                selectionEndOffsetRef.current
            );

            const startOffset = selectionStartOffsetRef.current;
            const endOffset = selectionEndOffsetRef.current;

            if (startOffset <= endOffset && currentContainer.id) {
                 const selectedText = currentContainer.textContent?.slice(startOffset, endOffset) || '';
                 const quote = new Quote(selectedText, currentContainer.id, { start: startOffset, end: endOffset });
                 setReplyQuote(quote);
            } else {
                 removeTemporaryHighlights(currentContainer); // Use variable
            }
            draggingHandleRef.current = null;
       };

       // Add listeners using the refs (ensure refs are assigned first)
       if (handleGlobalDragMoveRef.current) {
           window.addEventListener('mousemove', handleGlobalDragMoveRef.current, { passive: false });
           window.addEventListener('touchmove', handleGlobalDragMoveRef.current, { passive: false });
       }
       if (handleGlobalDragEndRef.current) {
           window.addEventListener('mouseup', handleGlobalDragEndRef.current);
           window.addEventListener('touchend', handleGlobalDragEndRef.current);
       }
  }; // End of handleMouseDownOnHandle.current assignment

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
    const container = containerRef.current;
    removeHandles(); // Now defined
    event.preventDefault();
    setIsSelecting(true);
    mouseIsDownRef.current = true;
    isDraggingRef.current = false;
    const startOffset = getCurrentOffset(container, event);
    selectionStartOffsetRef.current = startOffset ?? 0;

    boundThrottledAnimationRef.current = (e: Event) => {
      if (e.cancelable) e.preventDefault();
      isDraggingRef.current = true;
      // Safe to use non-null here because we set it above
      throttledAnimationLoop(
        e, 
        containerRef, 
        selectionStartOffsetRef.current, 
        mouseIsDownRef
      );
    };

    if (event.type === 'touchstart') {
      containerRef.current.addEventListener('touchmove', boundThrottledAnimationRef.current, { passive: false, capture: true });
    } else {
      containerRef.current.addEventListener('mousemove', boundThrottledAnimationRef.current);
    }
  }, [removeHandles]);

  const endAnimationLoop = useCallback(
    (event: MouseEvent | TouchEvent): Quote | null => {
      event.preventDefault();
      event.stopPropagation();
      mouseIsDownRef.current = false;
      isDraggingRef.current = false;
      cleanupEventListeners();
      
      if (!containerRef.current) return null;
      
      const endOffsetValue = getCurrentOffset(containerRef.current, event);
      selectionEndOffsetRef.current = endOffsetValue ?? 0; // Default to 0 if null
      let startOffset = selectionStartOffsetRef.current;
      let endOffset = selectionEndOffsetRef.current; // Use the updated ref value
      
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

  const handleMouseUp = useCallback((event: MouseEvent | TouchEvent) => {
    if (!mouseIsDownRef.current || !containerRef.current) return;
    const container = containerRef.current;
    let finalStartOffset: number | null = null;
    let finalEndOffset: number | null = null;
    let quote: Quote | null = null;

    if (!isDraggingRef.current) {
      // Click -> Word Selection
      const offset = selectionStartOffsetRef.current;
      if (offset !== null && container.id) {
        const text = container.textContent || '';
        const { start, end } = getWordBoundaries(text, offset);
        finalStartOffset = start;
        finalEndOffset = end;
        const selectedText = text.slice(start, end);
        quote = new Quote(selectedText, container.id, { start, end });
      }
    } else {
      // Drag -> Finalize drag offsets
      event.preventDefault();
      event.stopPropagation();

      const endOffsetValue = getCurrentOffset(container, event);
      selectionEndOffsetRef.current = endOffsetValue ?? selectionStartOffsetRef.current;

      if (selectionStartOffsetRef.current > selectionEndOffsetRef.current) {
        const temp = selectionStartOffsetRef.current;
        selectionStartOffsetRef.current = selectionEndOffsetRef.current;
        selectionEndOffsetRef.current = temp;
      }
      finalStartOffset = selectionStartOffsetRef.current;
      finalEndOffset = selectionEndOffsetRef.current;

      if (container.id) {
          const selectedText = container.textContent?.slice(finalStartOffset, finalEndOffset) || '';
          quote = new Quote(selectedText, container.id, { start: finalStartOffset, end: finalEndOffset });
      }
    }

    cleanupEventListeners();
    mouseIsDownRef.current = false;
    isDraggingRef.current = false;
    setIsSelecting(false);

    if (finalStartOffset !== null && finalEndOffset !== null && finalStartOffset <= finalEndOffset && quote) {
      selectionStartOffsetRef.current = finalStartOffset;
      selectionEndOffsetRef.current = finalEndOffset;

      highlightTemporarySelection(container, finalStartOffset, finalEndOffset);
      addHandles(container, finalStartOffset, finalEndOffset);
      setReplyQuote(quote);
    } else {
      removeTemporaryHighlights(container);
    }
  }, [cleanupEventListeners, setReplyQuote, addHandles]);

  // Global cleanup in case of lost mouseup/touchend events
  useEffect(() => {
    const handleGlobalMouseUp = () => {
      if (mouseIsDownRef.current) {
        mouseIsDownRef.current = false;
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
    if (containerRef.current && containerRef.current.id) {
      const currentContainerId = containerRef.current.id;
      
      if (selectedQuote && initialQuoteSetForIdRef.current !== currentContainerId) {
        
        if (selectedQuote.sourceId === currentContainerId) {
          highlightTemporarySelection(containerRef.current, selectedQuote.selectionRange.start, selectedQuote.selectionRange.end);
          
          initialQuoteSetForIdRef.current = currentContainerId;
        } else {
          console.warn("useTextSelection: selectedQuote sourceId does not match container id. Initial highlight skipped.", {
            quoteSourceId: selectedQuote.sourceId,
            containerId: currentContainerId
          });
          initialQuoteSetForIdRef.current = null; 
        }
      } 
      else if (!selectedQuote && initialQuoteSetForIdRef.current === currentContainerId) {
        removeTemporaryHighlights(containerRef.current);
        initialQuoteSetForIdRef.current = null;
      }
    }
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