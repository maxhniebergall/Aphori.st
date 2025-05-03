/**
 * Requirements:
 * - Create a custom hook for auto-scroll functionality in virtualized lists.
 * - Accept a target index and a ref to a react-window list.
 * - Automatically scroll to the target index whenever it changes.
 * - Allow configurable scroll alignment (e.g., 'auto', 'start', 'center', 'end').
 * - Use RAF for smooth scrolling.
 * - Ensure proper cleanup of any pending animations.
 * - Prevent unnecessary re-renders.
 */

import { useEffect, useRef } from 'react';
import { VariableSizeList } from 'react-window';

interface UseAutoScrollProps {
  /** Ref to the react-window list component; allow null initially */
  listRef: React.RefObject<VariableSizeList<any> | null>;
  /** The index of the target item to scroll to */
  targetIndex: number | undefined;
  /** Alignment option for scrolling: 'auto', 'start', 'center', or 'end' */
  alignment?: 'auto' | 'start' | 'center' | 'end';
  /** Additional dependencies that should trigger the auto-scroll effect */
  dependencies?: any[];
}

export default function useAutoScroll({
  listRef,
  targetIndex,
  alignment = 'end',
  dependencies = [],
}: UseAutoScrollProps) {
  // Keep track of the last scrolled index to prevent unnecessary scrolls
  const lastScrolledIndexRef = useRef<number | undefined>(undefined);
  
  useEffect(() => {
    // Skip if target index hasn't changed or is undefined
    if (targetIndex === undefined || targetIndex === lastScrolledIndexRef.current) {
      return;
    }

    if (listRef.current) {
      // Use requestAnimationFrame for smooth scrolling
      const rafId = requestAnimationFrame(() => {
        listRef.current?.scrollToItem(targetIndex, alignment);
        lastScrolledIndexRef.current = targetIndex;
      });

      // Cleanup function to cancel animation frame
      return () => {
        cancelAnimationFrame(rafId);
      };
    }
  }, [listRef, targetIndex, alignment, dependencies]);
} 