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

    let totalHeight = 0;
    const contentSection = element.querySelector('.story-content-section') as HTMLElement | null;
    const replySection = element.querySelector('.story-reply-section') as HTMLElement | null;

    if (contentSection) totalHeight += contentSection.offsetHeight;
    if (replySection) totalHeight += replySection.offsetHeight;

    setSize(totalHeight);

    // Set up a ResizeObserver to handle dynamic content changes.
    const resizeObserver = new ResizeObserver(() => {
      if (!shouldHide) {
        requestAnimationFrame(() => {
          let totalHeight = 0;
          const contentSection = element.querySelector('.story-content-section') as HTMLElement | null;
          const replySection = element.querySelector('.story-reply-section') as HTMLElement | null;

          if (contentSection) totalHeight += contentSection.offsetHeight;
          if (replySection) totalHeight += replySection.offsetHeight;

          setSize(totalHeight);
        });
      }
    });
    resizeObserver.observe(element);
    const contentElement = element.querySelector('.story-tree-node-content');
    if (contentElement) {
      resizeObserver.observe(contentElement);
    }

    return () => {
      resizeObserver.disconnect();
    };
  }, [rowRef, setSize, shouldHide]);
};

export default useDynamicRowHeight; 