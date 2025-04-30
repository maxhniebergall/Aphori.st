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
    onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
    onTouchEnd: (event: React.TouchEvent<HTMLDivElement>) => void;
  };
  containerText: string;
  isSelecting: boolean;
}

// --- START: Helper Functions --- 

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
  // No need to highlight here anymore, the effect handles it based on context changes
  // highlightTemporarySelection(container, quote.selectionRange.start, quote.selectionRange.end)
  setReplyQuote(quote);
}

// Helper function to get coordinates for a specific text offset
const getCoordsForOffset = (
  container: HTMLElement,
  offset: number
): { x: number; y: number } | null => {
  // --- START: Special handling for offset 0 ---
  if (offset === 0) {
    try {
      const style = window.getComputedStyle(container);
      const paddingLeft = parseFloat(style.paddingLeft) || 0;
      const paddingTop = parseFloat(style.paddingTop) || 0;
      // Estimate half line height (adjust if needed, e.g., from computed style)
      const approxHalfLineHeight = 10; 
      const coords = { x: paddingLeft, y: paddingTop + approxHalfLineHeight };
      return coords;
    } catch (e) {
        console.error("[getCoordsForOffset] Error getting padding for offset 0:", e);
        // Fallback if padding calculation fails for some reason
        return { x: 8, y: 18 }; // Use fallback values
    }
  }
  // --- END: Special handling for offset 0 ---
  
  try {
    const range = document.createRange();
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let currentNode: Node | null = null; // Type explicitly
    let currentOffset = 0;
    let found = false;

    // Find the text node and the specific offset within it
    while ((currentNode = walker.nextNode())) { // Assign within loop condition
      // Ensure it's a Text node before proceeding
      if (currentNode.nodeType !== Node.TEXT_NODE) continue;

      const node = currentNode as Text;
      const length = node.textContent?.length ?? 0;

      if (currentOffset + length >= offset) {
        const nodeOffset = offset - currentOffset;
        // Clamp nodeOffset to be within the current node's bounds
        const clampedNodeOffset = Math.min(Math.max(0, nodeOffset), length);

        // --- Revised Range Setting --- 
        if (offset === 0) {
          // Special case for the very beginning
          range.setStart(node, 0);
          range.collapse(true); // Collapse to the start
        } else if (offset > 0 && offset === (container.textContent?.length ?? 0)) {
          // Special case for the very end
          range.setStart(node, clampedNodeOffset);
          range.collapse(false); // Collapse to the end
        } 
        else {
           // For middle points, collapse at the specific offset
           range.setStart(node, clampedNodeOffset);
           range.collapse(true); // Collapse to the start of the offset point
        }
        // --- End Revised Range Setting --- 

        found = true;
        break;
      }
      currentOffset += length;
    }

    if (!found) {
        console.warn(`[getCoordsForOffset] Could not find text node for offset ${offset}`);
        // Attempt fallback: try placing at the end of the container
        range.selectNodeContents(container);
        range.collapse(false); // Collapse to the end
    }

    const rect = range.getBoundingClientRect();
    if (!rect) {
      console.warn(`[getCoordsForOffset] getBoundingClientRect failed for offset ${offset}`);
      return null;
    }
    
    const containerRect = container.getBoundingClientRect();
    if (!containerRect) {
        console.warn(`[getCoordsForOffset] Container getBoundingClientRect failed`);
        return null; // Cannot calculate relative position
    }

    const resultCoords = {
      x: rect.left - containerRect.left,
      y: rect.top - containerRect.top + rect.height / 2, // Center vertically relative to the line height at that point
    };

    // Calculate position relative to the container
    return resultCoords;

  } catch (e) {
    console.error("Error calculating coordinates for offset:", offset, e);
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
    // Ensure point is within container AND not directly on a handle span itself
    if (!caretPos || !container.contains(caretPos.offsetNode)) {
      return null; 
    }
    // Check if the caret is directly on a handle element
    if (caretPos.offsetNode.nodeType === Node.ELEMENT_NODE && (caretPos.offsetNode as HTMLElement).classList.contains('selection-handle')) {
      return null; 
    }

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

  // --- START: Check if click target IS a handle (Alternative check) ---
  // This checks the element directly under the point, which might be more robust
  // if caretPositionFromPoint sometimes returns the text node *next* to the handle
  const targetElement = document.elementFromPoint(clientX, clientY);
  if (targetElement && container.contains(targetElement) && targetElement.classList.contains('selection-handle')) {
      return null; // Ignore clicks/drags starting directly on handles
  }
  // --- END: Check if click target IS a handle ---

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
      const finalOffset = Math.min(Math.max(0, currentOffset), maxOffset);
      return finalOffset;

  } catch (e) {
      console.error("Error calculating offset from range:", e);
      return null;
  }
};

// --- END: Helper Functions ---

// --- START: Throttled Animation Loop --- 

// Define throttled loop AFTER helper functions it uses
const throttledAnimationLoop = throttle(
  (
    event: MouseEvent | TouchEvent, 
    container: React.RefObject<HTMLDivElement | null>, 
    startOffsetRef: React.RefObject<number>, // Pass refs explicitly
    endOffsetRef: React.RefObject<number>,   // Pass refs explicitly
    startHandleRef: React.RefObject<HTMLSpanElement | null>,
    endHandleRef: React.RefObject<HTMLSpanElement | null>,
    activeHandleRef: React.RefObject<'start' | 'end' | null>
  ) => {
    if (!container.current) return;
    
    const clientX = 'touches' in event ? event.touches[0].clientX : event.clientX;
    const clientY = 'touches' in event ? event.touches[0].clientY : event.clientY;

    const currentOffset = getOffsetFromCoordinates( // <-- Now defined before use
      container.current, 
      clientX, 
      clientY
    );
    
    if (currentOffset !== null) {
      // Update the appropriate offset based on which handle is being dragged
      // Or update endOffset if initiating a new selection (activeHandleRef.current is null)
      if (activeHandleRef.current === 'start') {
        startOffsetRef.current = currentOffset;
      } else {
        // Default to updating end offset during initial drag or when dragging end handle
        endOffsetRef.current = currentOffset; 
      }

      // Read the potentially updated refs
      const startOffset = startOffsetRef.current ?? 0;
      const endOffset = endOffsetRef.current ?? 0;
      const minOffset = Math.min(startOffset, endOffset);
      const maxOffset = Math.max(startOffset, endOffset);

      // Update visual highlight and handle positions
      highlightTemporarySelection(container.current, minOffset, maxOffset);
      updateHandlePositions(container.current, startHandleRef.current, endHandleRef.current, startOffset, endOffset); // <-- Now defined before use
    }
  },
  16, // 16ms throttle for ~60fps
  { leading: true, trailing: true } // Ensure it runs immediately and after the last event
);

// --- END: Throttled Animation Loop --- 

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
 *     onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void,
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
  const startOffsetRef = useRef<number>(0);
  const endOffsetRef = useRef<number>(0);
  const mouseDownRef = useRef<boolean>(false); // Still useful to track overall down state
  const isDraggingHandleRef = useRef<boolean>(false); // Track if a handle drag is active
  const [containerText, setContainerText] = useState<string>('');
  const [isSelecting, setIsSelecting] = useState<boolean>(false); // Tracks general selection activity
  const { setReplyQuote, replyTarget } = useReplyContext(); // Get replyTarget to read its ID

  const startHandleRef = useRef<HTMLSpanElement | null>(null);
  const endHandleRef = useRef<HTMLSpanElement | null>(null);
  const activeHandleRef = useRef<'start' | 'end' | null>(null);

  // --- START: Handle Creation/Cleanup Effect ---
  useEffect(() => {
    const containerElement = containerRef.current;
    if (!containerElement) return;

    // Create Start Handle if it doesn't exist
    if (!startHandleRef.current) {
      startHandleRef.current = document.createElement('span');
      startHandleRef.current.className = 'selection-handle start';
      startHandleRef.current.style.display = 'none'; // Initially hidden
      containerElement.appendChild(startHandleRef.current);
    }

    // Create End Handle if it doesn't exist
    if (!endHandleRef.current) {
      endHandleRef.current = document.createElement('span');
      endHandleRef.current.className = 'selection-handle end';
      endHandleRef.current.style.display = 'none'; // Initially hidden
      containerElement.appendChild(endHandleRef.current);
    }

    // Cleanup function to remove handles on unmount or container change
    return () => {
      if (startHandleRef.current && startHandleRef.current.parentNode === containerElement) {
        containerElement.removeChild(startHandleRef.current);
        startHandleRef.current = null; // Clear ref
      }
      if (endHandleRef.current && endHandleRef.current.parentNode === containerElement) {
        containerElement.removeChild(endHandleRef.current);
        endHandleRef.current = null; // Clear ref
      }
    };
  }, []); // Run only once when the component mounts and containerRef is potentially set
  // --- END: Handle Creation/Cleanup Effect ---

  // Define handlers with dependencies
  const handleMouseMove = useCallback((event: MouseEvent) => {
    if (!mouseDownRef.current) return; // Only run if mouse is down

    // Don't need to update endOffsetRef here anymore, throttled loop handles it
    throttledAnimationLoop(
      event, 
      containerRef, 
      startOffsetRef, // Pass refs
      endOffsetRef, 
      startHandleRef, 
      endHandleRef,
      activeHandleRef
    );
  }, []); // Remove refs from deps, throttle uses them directly

  const handleGlobalMouseUp = useCallback(() => {
    if (!mouseDownRef.current) return;
    const container = containerRef.current;
    mouseDownRef.current = false;
    isDraggingHandleRef.current = false; // Reset handle drag state
    activeHandleRef.current = null;      // Reset active handle
    setIsSelecting(false);
    document.removeEventListener('mousemove', handleMouseMove);
    document.removeEventListener('mouseup', handleGlobalMouseUp);
    throttledAnimationLoop.cancel(); // Cancel any pending throttle calls

    if (container) {
      // Final offsets are now correctly set in the refs by the move handler/throttle
      const finalStart = startOffsetRef.current ?? 0;
      const finalEnd = endOffsetRef.current ?? 0;
      
      // Word boundary adjustment should only happen if it was NOT a drag
      // We need a way to differentiate click vs drag vs handle drag.
      // Let's assume for now if start and end are still very close, it was likely a click.
      // A more robust way might involve tracking mouse movement distance.
      let adjustedStart = Math.min(finalStart, finalEnd);
      let adjustedEnd = Math.max(finalStart, finalEnd);
      
      // Simple click detection (adjust threshold as needed)
      const wasLikelyClick = Math.abs(finalStart - finalEnd) <= 2;

      if (wasLikelyClick) {
        const { start, end } = getWordBoundaries(container.textContent || '', adjustedStart); // Use start pos for word find
        adjustedStart = start;
        adjustedEnd = end;
      }

      const adjustedText = container.textContent?.slice(adjustedStart, adjustedEnd) ?? '';

      if (adjustedText.trim().length > 0) {
        // Use replyTarget.id from context if available, otherwise fallback
        const rootNodeId = replyTarget?.rootNodeId || 'unknown-root'; 
        const quote = new Quote(adjustedText, rootNodeId, { start: adjustedStart, end: adjustedEnd });
        if (Quote.isValid(quote)) {
          onSelectionCompleted(quote, container, setReplyQuote);
          // Final visual state
          highlightTemporarySelection(container, adjustedStart, adjustedEnd);
          updateHandlePositions(container, startHandleRef.current, endHandleRef.current, adjustedStart, adjustedEnd);
        } else {
          removeTemporaryHighlights(container);
          updateHandlePositions(container, startHandleRef.current, endHandleRef.current, 0, 0);
        }
      } else {
        // If selection is empty, clear visuals
        removeTemporaryHighlights(container);
        updateHandlePositions(container, startHandleRef.current, endHandleRef.current, 0, 0);
      }
    }
  }, [setReplyQuote, handleMouseMove, replyTarget]); // Removed refs, added replyTarget

  // Forward declare native touch handlers
  const handleTouchMoveNativeRef = useRef<((event: TouchEvent) => void) | null>(null);
  const handleTouchEndNativeRef = useRef<((event: TouchEvent) => void) | null>(null);

  handleTouchMoveNativeRef.current = (event: TouchEvent) => {
     if (!mouseDownRef.current) return;
     event.preventDefault(); // Prevent scrolling while dragging selection/handle

     // Don't need to update endOffsetRef here
     throttledAnimationLoop(
       event, 
       containerRef, 
       startOffsetRef, 
       endOffsetRef, 
       startHandleRef, 
       endHandleRef,
       activeHandleRef
     );
  };

  handleTouchEndNativeRef.current = (event: TouchEvent) => {
    // Mostly mirrors handleGlobalMouseUp logic
    if (!mouseDownRef.current) return;
    const container = containerRef.current;
    mouseDownRef.current = false;
    isDraggingHandleRef.current = false;
    activeHandleRef.current = null;
    setIsSelecting(false);
    if (handleTouchMoveNativeRef.current) {
      document.removeEventListener('touchmove', handleTouchMoveNativeRef.current);
    }
    if (handleTouchEndNativeRef.current) {
      document.removeEventListener('touchend', handleTouchEndNativeRef.current);
    }
    throttledAnimationLoop.cancel();

    if (container) {
      const finalStart = startOffsetRef.current ?? 0;
      const finalEnd = endOffsetRef.current ?? 0;
      let adjustedStart = Math.min(finalStart, finalEnd);
      let adjustedEnd = Math.max(finalStart, finalEnd);

      // Simple tap detection
      const wasLikelyTap = Math.abs(finalStart - finalEnd) <= 2;

      if (wasLikelyTap) {
        const { start, end } = getWordBoundaries(container.textContent || '', adjustedStart);
        adjustedStart = start;
        adjustedEnd = end;
      }

      const adjustedText = container.textContent?.slice(adjustedStart, adjustedEnd) ?? '';
      if (adjustedText.trim().length > 0) {
         const rootNodeId = replyTarget?.rootNodeId || 'unknown-root'; 
         const quote = new Quote(adjustedText, rootNodeId, { start: adjustedStart, end: adjustedEnd });
         if (Quote.isValid(quote)) {
             onSelectionCompleted(quote, container, setReplyQuote);
             highlightTemporarySelection(container, adjustedStart, adjustedEnd);
             updateHandlePositions(container, startHandleRef.current, endHandleRef.current, adjustedStart, adjustedEnd);
         } else { 
             removeTemporaryHighlights(container);
             updateHandlePositions(container, startHandleRef.current, endHandleRef.current, 0, 0);
         }
      } else {
          removeTemporaryHighlights(container);
          updateHandlePositions(container, startHandleRef.current, endHandleRef.current, 0, 0);
      }
    }
  };

  // Common logic for starting selection (mouse or touch)
  const startSelection = useCallback((event: MouseEvent | TouchEvent) => {
    const container = containerRef.current;
    if (!container) return;

    // Check if the target is a handle
    const target = event.target as HTMLElement;
    let handleType: 'start' | 'end' | null = null;
    if (target === startHandleRef.current) {
      handleType = 'start';
    } else if (target === endHandleRef.current) {
      handleType = 'end';
    }
    
    activeHandleRef.current = handleType;
    isDraggingHandleRef.current = !!handleType;
    mouseDownRef.current = true;
    setIsSelecting(true);

    // If not dragging a handle, calculate initial start/end from event position
    if (!isDraggingHandleRef.current) {
      const offset = getOffsetFromCoordinates(
        container,
        'touches' in event ? event.touches[0].clientX : event.clientX,
        'touches' in event ? event.touches[0].clientY : event.clientY
      ) ?? 0;
      startOffsetRef.current = offset;
      endOffsetRef.current = offset;
    } 
    // If dragging a handle, the offsets are already set, don't reset them
    
    // Initial visual update
    highlightTemporarySelection(container, startOffsetRef.current, endOffsetRef.current);
    updateHandlePositions(container, startHandleRef.current, endHandleRef.current, startOffsetRef.current, endOffsetRef.current);
    
    // Add global listeners
    if ('touches' in event) {
      if (handleTouchMoveNativeRef.current) {
        document.addEventListener('touchmove', handleTouchMoveNativeRef.current, { passive: false });
      }
      if (handleTouchEndNativeRef.current) {
        document.addEventListener('touchend', handleTouchEndNativeRef.current);
      }
    } else {
      document.addEventListener('mousemove', handleMouseMove);
      document.addEventListener('mouseup', handleGlobalMouseUp);
    }
  }, [handleMouseMove, handleGlobalMouseUp]); // Add handle refs?

  // --- Effects --- 

  // Effect to initialize selection based on the passed selectedQuote prop
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Always update based on the prop, regardless of mouse state
    if (selectedQuote?.selectionRange) {
      const { start, end } = selectedQuote.selectionRange;
      startOffsetRef.current = start;
      endOffsetRef.current = end;
      highlightTemporarySelection(container, start, end);
      updateHandlePositions(container, startHandleRef.current, endHandleRef.current, start, end);
    } else {
      removeTemporaryHighlights(container);
      startOffsetRef.current = 0;
      endOffsetRef.current = 0;
      updateHandlePositions(container, startHandleRef.current, endHandleRef.current, 0, 0);
    }
  }, [selectedQuote]); // Keep dependency only on selectedQuote

  // Effect to handle selectAll prop (Simplified)
  useEffect(() => {
    const container = containerRef.current;
    // Only act if mouse is not down
    if (selectAll && container && !mouseDownRef.current) {
      const textLength = container.textContent?.length ?? 0;
      if (textLength > 0) {
        startOffsetRef.current = 0;
        endOffsetRef.current = textLength;
        highlightTemporarySelection(container, 0, textLength);
        updateHandlePositions(container, startHandleRef.current, endHandleRef.current, 0, textLength);
        
        // Also trigger onSelectionCompleted for selectAll
        const rootNodeId = replyTarget?.rootNodeId || 'unknown-root'; 
        const quote = new Quote(container.textContent ?? '', rootNodeId, { start: 0, end: textLength });
        if (Quote.isValid(quote)) {
            onSelectionCompleted(quote, container, setReplyQuote);
        }
      }
    }
    // No explicit clearing needed here, handled by the selectedQuote effect
  }, [selectAll, selectedQuote, setReplyQuote, replyTarget]); // Added dependencies

  // --- Container Ref Setter --- 

  const setContainerRef = useCallback((node: HTMLDivElement | null) => {
    // Cleanup previous node's listeners first
    const oldNode = containerRef.current;
    if (oldNode) {
        // Remove handle listeners if they were attached
        if (startHandleRef.current) {
            startHandleRef.current.removeEventListener('touchstart', startSelection as EventListener);
            startHandleRef.current.removeEventListener('mousedown', startSelection as EventListener);
        }
        if (endHandleRef.current) {
            endHandleRef.current.removeEventListener('touchstart', startSelection as EventListener);
            endHandleRef.current.removeEventListener('mousedown', startSelection as EventListener);
        }
        // It's safer to remove global listeners on unmount/node change
        document.removeEventListener('mousemove', handleMouseMove);
        document.removeEventListener('mouseup', handleGlobalMouseUp);
        if (handleTouchMoveNativeRef.current) {
          document.removeEventListener('touchmove', handleTouchMoveNativeRef.current);
        }
        if (handleTouchEndNativeRef.current) {
          document.removeEventListener('touchend', handleTouchEndNativeRef.current);
        }
    }

    // Set the new node
    containerRef.current = node;

    if (node) {
      setContainerText(node.textContent || '');
      // Create/append handles if they don't exist
      if (!startHandleRef.current) {
          startHandleRef.current = document.createElement('span');
          startHandleRef.current.className = 'selection-handle start';
          startHandleRef.current.style.display = 'none'; // Initially hidden
          startHandleRef.current.addEventListener('touchstart', startSelection as EventListener, { passive: false });
          startHandleRef.current.addEventListener('mousedown', startSelection as EventListener);
          node.appendChild(startHandleRef.current);
      }
      if (!endHandleRef.current) {
          endHandleRef.current = document.createElement('span');
          endHandleRef.current.className = 'selection-handle end';
          endHandleRef.current.style.display = 'none'; // Initially hidden
          endHandleRef.current.addEventListener('touchstart', startSelection as EventListener, { passive: false });
          endHandleRef.current.addEventListener('mousedown', startSelection as EventListener);
          node.appendChild(endHandleRef.current);
      }
      // Update positions based on current refs (might be 0 initially)
      updateHandlePositions(node, startHandleRef.current, endHandleRef.current, startOffsetRef.current, endOffsetRef.current);
    } else {
      // Clear refs if node is null
      startHandleRef.current?.remove();
      endHandleRef.current?.remove();
      startHandleRef.current = null;
      endHandleRef.current = null;
    }
  }, [startSelection, handleMouseMove, handleGlobalMouseUp]); // Add startSelection dependency

  // Cleanup global listeners on unmount
  useEffect(() => {
    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleGlobalMouseUp);
      if (handleTouchMoveNativeRef.current) {
        document.removeEventListener('touchmove', handleTouchMoveNativeRef.current);
      }
      if (handleTouchEndNativeRef.current) {
        document.removeEventListener('touchend', handleTouchEndNativeRef.current);
      }
      throttledAnimationLoop.cancel();
      // Ensure handles are removed from DOM if component unmounts
      startHandleRef.current?.remove();
      endHandleRef.current?.remove();
    };
  }, [handleMouseMove, handleGlobalMouseUp]); // Correct dependencies

  // --- Event Handlers for Component --- 

  const handleMouseDown = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
     startSelection(event.nativeEvent); // Pass native event
  }, [startSelection]);

  const handleMouseUp = useCallback((event: React.MouseEvent<HTMLDivElement>) => {
    // The global mouse up handles finalization, this one might not be needed
    // or could be used for specific container-level logic if mouseDown originated here.
    // For simplicity, let global handler manage it.
  }, []);

  const handleTouchStart = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    // This handler is NOT attached via setContainerRef anymore
    // It should be attached via the onTouchStart prop from eventHandlers
    startSelection(event.nativeEvent);
  }, [startSelection]);

  const handleTouchEnd = useCallback((event: React.TouchEvent<HTMLDivElement>) => {
    // Similar to mouseup, let the global handler manage finalization.
    // handleTouchEndNativeRef.current?.(event.nativeEvent); 
  }, []);

  return {
    containerRef: setContainerRef as React.RefObject<HTMLDivElement> & ((node: HTMLDivElement | null) => void),
    eventHandlers: {
      onMouseDown: handleMouseDown,
      onMouseUp: handleMouseUp, 
      // Need onTouchStart here instead of onTouchEnd for initiation
      onTouchStart: handleTouchStart, 
      onTouchEnd: handleTouchEnd, // Keep onTouchEnd for completeness, though global handles it
    },
    containerText,
    isSelecting
  };
} 