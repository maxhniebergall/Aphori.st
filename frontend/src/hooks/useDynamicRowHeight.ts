/**
 * Requirements:
 * - Encapsulate dynamic height calculation for variable-sized rows
 * - Use ResizeObserver to react to DOM size changes and trigger height recalculation
 * - Support hidden nodes by setting the height to 0
 * - Provide a clean API for updating row sizes in VirtualizedStoryList
 */

import { useEffect } from 'react';

interface UseDynamicRowHeightProps {
  rowRef: React.MutableRefObject<HTMLElement | null>;
  setSize: (visualHeight: number) => void;
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
      console.log("useDynamicRowHeight: Calculated height:", {
        scrollHeight: element.scrollHeight,
        offsetHeight: element.offsetHeight,
        finalHeight
      });
      
      setSize(finalHeight);
    };

    // Initial calculation
    calculateHeight();

    // Set up a ResizeObserver for element changes
    const resizeObserver = new ResizeObserver(() => {
      if (!shouldHide) {
        requestAnimationFrame(calculateHeight);
      }
    });
    resizeObserver.observe(element);

    // Set up a MutationObserver to detect dynamic addition/removal of children
    const mutationObserver = new MutationObserver(() => {
      requestAnimationFrame(calculateHeight);
    });
    mutationObserver.observe(element, { childList: true, subtree: true });

    return () => {
      resizeObserver.disconnect();
      mutationObserver.disconnect();
    };
  }, [rowRef, setSize, shouldHide]);
};

export default useDynamicRowHeight; 