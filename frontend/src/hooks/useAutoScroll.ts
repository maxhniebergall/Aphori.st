/**
 * Requirements:
 * - Create a custom hook for auto-scroll functionality in virtualized lists.
 * - Accept a target index and a ref to a react-window list.
 * - Automatically scroll to the target index whenever it changes.
 * - Allow configurable scroll alignment (e.g., 'auto', 'start', 'center', 'end').
 * - Use a timeout to defer the scroll action until after layout recalculations.
 * - Ensure proper cleanup of the timeout.
 */

import { useEffect } from 'react';
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
  useEffect(() => {
    if (targetIndex !== undefined && listRef.current) {
      const timer = setTimeout(() => {
        listRef.current?.scrollToItem(targetIndex, alignment);
      }, 0);

      return () => clearTimeout(timer);
    }
  // Include targetIndex, alignment, and additional dependencies.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [targetIndex, alignment, ...dependencies]);
} 