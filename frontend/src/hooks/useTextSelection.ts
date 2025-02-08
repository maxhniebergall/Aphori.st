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
 */

import { useRef, useCallback, useEffect } from 'react';
import { throttle } from 'lodash';
import { getCurrentOffset, getWordBoundaries } from '../utils/selectionUtils';

interface Selection {
  start: number;
  end: number;
}

interface UseTextSelectionProps {
  onSelectionCompleted: (selection: Selection) => void;
  selectAll?: boolean;
  selectionState?: Selection | null;
  quotes?: Record<string, number>;
}

interface UseTextSelectionReturn {
  containerRef: React.RefObject<HTMLDivElement>;
  eventHandlers: {
    onMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void;
    onTouchStart: (event: React.TouchEvent<HTMLDivElement>) => void;
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

const highlightText = (element: HTMLElement, startOffset: number, endOffset: number): void => {
  removeExistingHighlights(element);

  const findNodeAndOffset = (offset: number) => {
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

  const minOffset = Math.min(startOffset, endOffset);
  const maxOffset = Math.max(startOffset, endOffset);
  const start = findNodeAndOffset(minOffset);
  const end = findNodeAndOffset(maxOffset);
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

const highlightQuotes = (element: HTMLElement, quotes: Record<string, number>): void => {
  removeExistingHighlights(element);

  // Sort quotes by reply count descending and process top 10 only
  const sortedQuotes = Object.entries(quotes)
    .sort(([, count1], [, count2]) => count2 - count1)
    .slice(0, 10);

  sortedQuotes.forEach(([quoteRange, count]) => {
    try {
      const { start, end } = JSON.parse(quoteRange);
      const findNodeAndOffset = (offset: number) => {
        let currentOffset = 0;
        const walker = document.createTreeWalker(element, NodeFilter.SHOW_TEXT);
        while (walker.nextNode()) {
          const node = walker.currentNode;
          const length = node.textContent ? node.textContent.length : 0;
          if (currentOffset + length >= offset) {
            return { node, offset: offset - currentOffset };
          }
          currentOffset += length;
        }
        return null;
      };

      const startPos = findNodeAndOffset(start);
      const endPos = findNodeAndOffset(end);
      if (!startPos || !endPos) return;

      const range = document.createRange();
      range.setStart(startPos.node, startPos.offset);
      range.setEnd(endPos.node, endPos.offset);

      const span = document.createElement('span');
      span.style.backgroundColor = `rgba(0, 255, 0, ${Math.min(0.1 + count * 0.05, 0.5)})`;
      span.dataset.quoteRange = quoteRange;
      span.dataset.replyCount = count.toString();

      try {
        range.surroundContents(span);
      } catch (e) {
        console.warn('Could not highlight quote:', e);
      }
    } catch (err) {
      console.warn('Error parsing quote range:', err);
    }
  });
};

// Throttled animation loop used during mouse/touch move
const throttledAnimationLoop = throttle(
  (event: Event, container: React.RefObject<HTMLDivElement>, startOffset: number, mouseDownRef: React.MutableRefObject<boolean>) => {
    if (!mouseDownRef.current || !container.current) {
      removeExistingHighlights(container.current!);
      return;
    }
    const endOffset = getCurrentOffset(container.current, event);
    highlightText(container.current, startOffset, endOffset);
  },
  16
);

export function useTextSelection({
  onSelectionCompleted,
  selectAll = false,
  selectionState = null,
  quotes,
}: UseTextSelectionProps): UseTextSelectionReturn {
  const containerRef = useRef<HTMLDivElement>(null);
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
    (event: MouseEvent | TouchEvent): Selection | null => {
      event.preventDefault();
      event.stopPropagation();
      mouseIsDownRef.current = false;
      isDraggingRef.current = false;
      cleanupEventListeners();
      if (!containerRef.current) return null;
      finalOffsetRef.current = getCurrentOffset(containerRef.current, event);
      return {
        start: initialOffsetRef.current ?? 0,
        end: finalOffsetRef.current ?? 0,
      };
    },
    [cleanupEventListeners]
  );

  const handleMouseUp = useCallback(
    (event: MouseEvent | TouchEvent) => {
      if (!mouseIsDownRef.current || !containerRef.current) return;

      if (!isDraggingRef.current) {
        // If click occurred on a quote highlight (data attribute on target)
        const target = event.target as HTMLElement;
        if (target.dataset.quoteRange) {
          try {
            const quoteRange = JSON.parse(target.dataset.quoteRange);
            onSelectionCompleted(quoteRange);
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
          onSelectionCompleted({ start, end });
          mouseIsDownRef.current = false;
          return;
        }
      }
      const selection = endAnimationLoop(event);
      if (selection) {
        onSelectionCompleted(selection);
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
      } else if (selectionState) {
        highlightText(containerRef.current, selectionState.start, selectionState.end);
      } else {
        removeExistingHighlights(containerRef.current);
      }
    }
  }, [selectAll, selectionState]);

  // Effect: highlight quotes if provided (e.g. based on reply counts)
  useEffect(() => {
    if (containerRef.current && quotes) {
      highlightQuotes(containerRef.current, quotes);
    }
  }, [quotes]);

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

  return {
    containerRef,
    eventHandlers: {
      onMouseDown: onMouseDownHandler,
      onTouchStart: onTouchStartHandler,
      onMouseUp: onMouseUpHandler,
      onTouchEnd: onTouchEndHandler,
    },
  };
} 