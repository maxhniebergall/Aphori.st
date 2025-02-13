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

    const updateSize = () => {
      if (shouldHide) {
        setSize(0);  
        return;
      }

      // Calculate height based on various child elements.
      const titleSection = element.querySelector('.story-title-section') as HTMLElement | null;
      const content = element.querySelector('.story-tree-node-content') as HTMLElement | null;
      const sibling = element.querySelector('.story-tree-node-content.has-siblings') as HTMLElement | null;
      const replySection = element.querySelector('.reply-section') as HTMLElement | null;

      let totalHeight = 0;
      if (titleSection) totalHeight += titleSection.offsetHeight;
      if (content) totalHeight += content.offsetHeight;
      if (replySection) totalHeight += replySection.offsetHeight;
      if (sibling) totalHeight += sibling.offsetHeight + 64;
      totalHeight += 24;
      totalHeight = Math.max(totalHeight, 100);

      setSize(totalHeight);
    };

    // Initial calculation and a delayed update to ensure proper measurement.
    updateSize();
    const timeoutId = setTimeout(updateSize, 100);

    // Set up a ResizeObserver to handle dynamic content changes.
    const resizeObserver = new ResizeObserver(() => {
      if (!shouldHide) {
        requestAnimationFrame(updateSize);
      }
    });
    resizeObserver.observe(element);
    const contentElement = element.querySelector('.story-tree-node-content');
    if (contentElement) {
      resizeObserver.observe(contentElement);
    }

    return () => {
      resizeObserver.disconnect();
      clearTimeout(timeoutId);
    };
  }, [rowRef, setSize, shouldHide]);
};

export default useDynamicRowHeight; 