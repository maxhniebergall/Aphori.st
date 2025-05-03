/**
 * Requirements:
 * - Encapsulate dynamic height calculation for variable-sized rows
 * - Use ResizeObserver to react to DOM size changes and trigger height recalculation
 * - Support hidden nodes by setting the height to 0
 * - Provide a clean API for updating row sizes in VirtualizedPostList
 */

import { useEffect } from 'react';

interface UseDynamicRowHeightProps {
  rowRef: React.MutableRefObject<HTMLElement | null>;
  setSize: (_visualHeight: number) => void;
  shouldHide?: boolean;
}

const useDynamicRowHeight = ({
  rowRef,
  setSize,
  shouldHide = false,
}: UseDynamicRowHeightProps): void => {
  useEffect(() => {
    const element = rowRef.current;
    if (!element) return;

    const calculateHeight = () => {
      if (shouldHide) {
        setSize(0);
        return;
      }

      // Get the actual height of the entire element
      const totalHeight = Math.max(element.scrollHeight, element.offsetHeight);
      
      // Ensure a minimum height of 100px for visibility
      const finalHeight = Math.max(totalHeight, 100);
      
      setSize(finalHeight);
    };

    // Initial calculation
    calculateHeight();

    // Set up a ResizeObserver for element changes
    let resizeTimeout: number | null = null;
    const resizeObserver = new ResizeObserver(() => {
      if (!shouldHide) {
        if (resizeTimeout) {
          cancelAnimationFrame(resizeTimeout);
        }
        resizeTimeout = requestAnimationFrame(() => {
          calculateHeight();
          resizeTimeout = null;
        });
      }
    });
    resizeObserver.observe(element);

    // Set up a MutationObserver to detect dynamic addition/removal of children
    let mutationTimeout: number | null = null;
    const mutationObserver = new MutationObserver(() => {
      if (mutationTimeout) {
        cancelAnimationFrame(mutationTimeout);
      }
      mutationTimeout = requestAnimationFrame(() => {
        calculateHeight();
        mutationTimeout = null;
      });
    });
    mutationObserver.observe(element, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [rowRef, setSize, shouldHide]);
};

export default useDynamicRowHeight;