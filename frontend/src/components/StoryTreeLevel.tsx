/**
 * Requirements:
 * - Display the current sibling node for a given level
 * - Support horizontal swipe gestures between siblings
 * - Maintain pagination for loading more siblings
 * - Preserve reply mode functionality
 * - Support node selection and quote selection
 * - Communicate height changes to parent components for proper virtualization
 */

import React, { useState, useCallback, useMemo, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReplyContext } from '../context/ReplyContext';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as LevelData, Pagination, StoryTreeNode, QuoteCounts } from '../types/types';
import { areQuotesEqual, Quote } from '../types/quote';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { 
  getSelectedQuoteInParent,
  getSelectedQuoteInThisLevel,
  getSiblings, 
  getSelectedNodeHelper, 
  getLevelNumber,
  getParentId,
  getPagination,
  isMidLevel,
} from '../utils/levelDataHelpers';

interface StoryTreeLevelProps {
  levelData: LevelData;
  navigateToNextSiblingCallback: () => void;
  navigateToPreviousSiblingCallback: () => void;
  reportHeight?: (height: number) => void;
}

// Create a memoized NodeFooterWrapper component to prevent unnecessary re-renders
const MemoizedNodeFooter = React.memo(NodeFooter,
  (prevProps, nextProps) => {
    return prevProps.currentIndex === nextProps.currentIndex &&
      prevProps.totalSiblings === nextProps.totalSiblings &&
      prevProps.isReplyTarget === nextProps.isReplyTarget &&
      prevProps.isReplyActive === nextProps.isReplyActive &&
      prevProps.replyError === nextProps.replyError;
  }
);

// Memoize NodeContent using the comparison function defined within NodeContent.tsx
const MemoizedNodeContent = React.memo(NodeContent);

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({
  levelData,
  navigateToNextSiblingCallback,
  navigateToPreviousSiblingCallback,
  reportHeight,
}) => {
  // Log the props received by StoryTreeLevelComponent for debugging propagation

  // Core state hooks moved to top
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Use a custom hook to extract only the reply context values we need
  // This prevents re-renders when replyContent changes but doesn't affect this component
  const {
    setReplyTarget,
    replyTarget,
    setReplyQuote,
    replyQuote,
    clearReplyState,
    replyError,
    setReplyError,
    isReplyOpen,
    setIsReplyOpen,
    isReplyActive
  } = useReplyContextSelective();
  const initialPagination = getPagination(levelData); // Moved calculation before useState
  const [pagination, setPagination] = useState<Pagination>(initialPagination || { hasMore: false, totalCount: 0, nextCursor: undefined }); // Ensure initial value is always valid Pagination

  // Calculate dimensions based on viewport - moved up
  const dimensions = useMemo(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    return {
      height: Math.max(viewportHeight * 0.8, 400),
      width: Math.max(viewportWidth * 0.8, 600),
      defaultItemSize: Math.max(viewportHeight * 0.3, 200)
    };
  }, []);

  // Update dimensions on window resize - moved up
  const [dimensionValues, setDimensionValues] = useState(dimensions);
  useMemo(() => {
    const handleResize = () => {
      setDimensionValues({
        height: Math.max(window.innerHeight * 0.8, 400),
        width: Math.max(window.innerWidth * 0.8, 600),
        defaultItemSize: Math.max(window.innerHeight * 0.3, 200),
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []); // Dependency array kept empty as intended

  // Get siblings from levelData using the correct key (parent's selected quote) - RESTORED LOGIC
  const siblings = useMemo(() => {
    if (!isMidLevel(levelData)) { 
      return [];
    }
    const siblingsData = getSiblings(levelData);
    const relevantQuoteKey = getSelectedQuoteInParent(levelData); // Use helper

    if (!siblingsData || siblingsData.levelsMap.length === 0) {
      console.warn("No siblings data or map found in StoryTreeLevel:", levelData);
      return [];
    }

    // Find the siblings list in the map that matches the relevant quote
    const siblingsEntry = siblingsData.levelsMap.find(([quoteKey]) => {
      // Handle null/undefined cases explicitly before calling areQuotesEqual
      if ((relevantQuoteKey === null || relevantQuoteKey === undefined) && (quoteKey === null || quoteKey === undefined)) {
        return true; // Both are null/undefined, they match
      }
      if ((relevantQuoteKey === null || relevantQuoteKey === undefined) || (quoteKey === null || quoteKey === undefined)) {
        return false; // One is null/undefined, the other isn't, they don't match
      }
      // Both are non-null/undefined Quotes, now we can safely compare them
      return areQuotesEqual(quoteKey, relevantQuoteKey);
    });

    // Extract the list if found, otherwise return empty
    return siblingsEntry ? siblingsEntry[1] : [];

  }, [levelData]); // Dependency is levelData

  // Get the current node to render - moved up
  const nodeToRender = useMemo(() => {
    const selectedNode = getSelectedNodeHelper(levelData);
    if (selectedNode) {
      return selectedNode;
    }
    if (siblings.length > 0) {
      return siblings[0];
    }
    return undefined;
  }, [levelData, siblings]); // Dependencies restored

  // Extract the currently selected quote *for this level*, applying default logic - FIXED
  const currentLevelSelectedQuote = useMemo(() => {
    // 1. Check for explicitly selected quote in the state for this level/node
    const explicitQuote = getSelectedQuoteInThisLevel(levelData);
    if (explicitQuote) {
      return explicitQuote;
    }

    // 2. If no explicit quote, find the default (highest count)
    // Ensure nodeToRender and quoteCounts exist
    const quotesMap: [Quote, number][] | undefined = nodeToRender?.quoteCounts?.quoteCounts;
    if (quotesMap && quotesMap.length > 0) {
        // Sort by count descending ONLY.
        // Tuple is [Quote, number]
        const sortedQuotes = [...quotesMap].sort((entryA, entryB) => { // entryA = [quoteA, countA]
          // const quoteA = entryA[0]; // No longer needed for tie-breaker
          const countA = entryA[1];
          // const quoteB = entryB[0]; // No longer needed for tie-breaker
          const countB = entryB[1];
          
          const countDiff = countB - countA; // Descending count
          return countDiff;
          
          // Tie-breaker logic removed due to uncertainty about Quote type properties
          /*
          if (countDiff !== 0) return countDiff;
          const startA = quoteA?.position?.start ?? 0; 
          const startB = quoteB?.position?.start ?? 0;
          return startA - startB;
          */
        });
        // Return the Quote object (index 0) from the highest count entry
        return sortedQuotes[0]?.[0] ?? null; // Safely access quote at index 0
      }

    // 3. If no explicit selection and no quotes available, return null
    return null;

  }, [levelData, nodeToRender]); // Dependencies correct

   // Handle text selection for replies with improved error handling - moved up
  const handleExistingQuoteSelectionCompleted = useCallback(
    async (quote: Quote): Promise<void> => {
      try {
        if (!nodeToRender) {
          throw new Error('Cannot create reply: no valid node selected');
        }
        await storyTreeOperator.setSelectedQuoteForNodeInLevel(quote, nodeToRender, levelData);
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        setReplyError(error instanceof Error ? error.message : 'Failed to set reply target');
      }
    },
    [nodeToRender, levelData, setReplyError] // Dependencies updated
  );

  // Handle reply button click with improved functionality - moved up
  const handleReplyButtonClick = useCallback((): void => {
    if (!nodeToRender) {
      setReplyError('Cannot create reply: no valid node selected');
      return;
    }
    const isCurrentlyReplyTarget = replyTarget?.id === nodeToRender?.id; // Local check
    try {
      if (isReplyActive && isCurrentlyReplyTarget) {
        clearReplyState();
      } else {
        setReplyTarget(nodeToRender);
        if (!nodeToRender.textContent || nodeToRender.textContent.trim().length === 0) {
          throw new Error('Cannot create quote: node has no text content');
        }
        const quote: Quote = new Quote(
          nodeToRender.textContent.trim(),
          nodeToRender.rootNodeId,
          { start: 0, end: nodeToRender.textContent.trim().length }
        );
        if (Quote.isValid(quote) === false) {
          throw new Error('Failed to create valid quote for reply');
        }
        setReplyQuote(quote);
        setReplyError(null);
        setIsReplyOpen(true);
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : 'Failed to handle reply action');
    }
  }, [
    clearReplyState, setReplyTarget, setReplyQuote, nodeToRender, setReplyError,
    isReplyActive, setIsReplyOpen, replyTarget // Added replyTarget dependency
  ]);

  // Navigation functions with pagination - FIXED
  const navigateToNextSibling = useCallback(async () => {
    if (replyTarget?.id === nodeToRender?.id) { return; }
    if (!nodeToRender) { return; }
    const currentIndex = siblings.findIndex(sibling => sibling.id === getSelectedNodeHelper(levelData)?.id);
    if (currentIndex < siblings.length - 1) {
      navigateToNextSiblingCallback();
    } else if (pagination.hasMore) {
      setIsLoading(true);
      try {
        const parentIdArr = getParentId(levelData);
        const levelNum = getLevelNumber(levelData);
        // Pass the PARENT'S selected quote to loadMoreItems - RESTORED
        const selQuoteParent = getSelectedQuoteInParent(levelData); 
        
        if (!parentIdArr || parentIdArr.length === 0 || levelNum === undefined || !selQuoteParent) {
            console.warn("Missing data needed to load more items.", { parentIdArr, levelNum, selQuoteParent });
            setIsLoading(false);
            return;
        }
        await storyTreeOperator.loadMoreItems(
          parentIdArr[0], levelNum, selQuoteParent, siblings.length, siblings.length + 3 // Use parent's quote
        );
        navigateToNextSiblingCallback();
      } catch (error) {
        console.error("Failed to load more items:", error);
      } finally {
        setIsLoading(false);
      }
    } else {
      console.log("No next sibling action taken (already at end or no more pages).");
    }
  }, [
    siblings, pagination, levelData, navigateToNextSiblingCallback, nodeToRender,
    replyTarget, setIsLoading // Keep dependencies
  ]);

  const navigateToPreviousSibling = useCallback(async () => {
    if (replyTarget?.id === nodeToRender?.id) { return; }
    if (!nodeToRender) { return; }
    const currentIndex = siblings.findIndex(sibling => sibling.id === getSelectedNodeHelper(levelData)?.id);
    if (currentIndex > 0) {
      navigateToPreviousSiblingCallback();
    } else {
        console.log("No previous sibling action taken.");
    }
  }, [
    siblings, navigateToPreviousSiblingCallback, levelData, nodeToRender, replyTarget
  ]);

   // Setup gesture handling for swipe navigation - moved up
  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx], event }) => {
      if (event && (event.target instanceof HTMLElement) && event.target.closest('.selection-container')) { return; }
      if (!down) {
        try {
          if (mx < -100 || (vx < -0.5 && mx < -50)) {
            navigateToNextSibling();
            cancel?.();
          } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
            navigateToPreviousSibling();
            cancel?.();
          }
        } catch (error) { console.error("Gesture navigation error:", error); }
      }
    }
  }, {
    drag: { axis: 'x', enabled: Boolean(nodeToRender?.rootNodeId), threshold: 5 }
  });

  // Report height to parent virtualized list when container size changes - moved up
  useMemo(() => {
    if (containerRef.current && reportHeight) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          reportHeight(entry.contentRect.height);
        }
      });
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [reportHeight, containerRef.current]); // Added containerRef.current dependency


  // Update pagination state based on levelData - moved up
  useMemo(() => {
    const newPagination = getPagination(levelData);
    if (newPagination) {
      // Add a check to prevent unnecessary state updates if pagination hasn't changed
      if (newPagination.nextCursor !== pagination.nextCursor ||
          newPagination.hasMore !== pagination.hasMore ||
          newPagination.totalCount !== pagination.totalCount) {
            setPagination(newPagination);
          }
    }
  }, [levelData, pagination]); // Added pagination to dependency array


  // --- Conditional logic starts here ---

  // Skip rendering if not a MidLevel
  if (!isMidLevel(levelData)) {
    return (
      <div ref={containerRef} className="story-tree-level-container">
        <div className="last-level-indicator">
          End of thread
        </div>
      </div>
    );
  }

  // This specific check for initialPagination must happen *after* hooks are defined
  // but before pagination state is used extensively if the component *could* render
  // without valid initial pagination derived from a non-MidLevel.
  // However, the hook itself is already moved up. The check here is for logic flow.
  if (!initialPagination) {
    console.error("StoryTreeLevelComponent: Rendered without valid initial pagination, this might indicate an issue.", levelData);
    return null; // Or return some placeholder/error state
  }

  // Determine if the current node is the target for a reply
  const isReplyTarget = replyTarget?.id === nodeToRender?.id;


  // Early return if we don't have a valid node
  if (!nodeToRender?.rootNodeId) {
    console.warn("StoryTreeLevelComponent: nodeToRender or its rootNodeId is missing. Rendering null.", { nodeToRender, levelData });
    return null;
  }

  // Log the props passed to NodeContent for debugging propagation
  
  return (
    <div
      ref={containerRef}
      className="story-tree-level-container"
      style={{
        position: 'relative',
        width: '100%'
      }}
    >
      <AnimatePresence mode="wait">
        <div {...bind()} style={{ touchAction: 'none' }}>
          <motion.div
            className={`story-tree-node ${isReplyTarget ? 'reply-target' : ''}`}
            key={nodeToRender?.rootNodeId + levelData.midLevel?.levelNumber}
            initial={{ opacity: 0, x: 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="article"
            style={{
              width: '100%',
              padding: '16px',
              position: 'relative'
            }}
          >
            {nodeToRender && (
              <MemoizedNodeContent
                node={nodeToRender}
                onExistingQuoteSelectionComplete={handleExistingQuoteSelectionCompleted}
                quote={isReplyTarget ? (replyQuote ?? undefined) : undefined}
                existingSelectableQuotes={nodeToRender.quoteCounts ?? undefined}
                currentLevelSelectedQuote={currentLevelSelectedQuote ?? undefined}
              />
            )}
            <MemoizedNodeFooter
              currentIndex={nodeToRender ? siblings.findIndex(sibling => sibling.id === nodeToRender.id) : -1} 
              totalSiblings={siblings.length}
              onReplyClick={handleReplyButtonClick}
              isReplyTarget={isReplyTarget}
              onNextSibling={navigateToNextSibling}
              onPreviousSibling={navigateToPreviousSibling}
              isReplyActive={isReplyActive}
              replyError={replyError}
            />
            {replyError && (
              <div className="reply-error" role="alert" aria-live="polite">
                {replyError}
              </div>
            )}
          </motion.div>
        </div>
      </AnimatePresence>
    </div>
  );
};

// Custom hook to selectively extract only the reply context values we need
// This prevents re-renders when replyContent changes
// NOTE: This function itself is NOT a hook, but it CALLS hooks (useMemo, useContext).
// The convention is to name functions starting with 'use' if they call hooks inside.
function useReplyContextSelective() {
  const context = useReplyContext(); // useContext is a hook

  // useMemo is a hook
  return useMemo(() => ({
    setReplyTarget: context.setReplyTarget,
    replyTarget: context.replyTarget,
    setReplyQuote: context.setReplyQuote,
    replyQuote: context.replyQuote,
    clearReplyState: context.clearReplyState,
    replyError: context.replyError,
    setReplyError: context.setReplyError,
    isReplyOpen: context.isReplyOpen,
    setIsReplyOpen: context.setIsReplyOpen,
    isReplyActive: context.isReplyActive
  }), [
    context.replyTarget,
    context.replyQuote,
    context.clearReplyState,
    context.replyError,
    context.isReplyOpen,
    context.isReplyActive
    // Intentionally NOT including replyContent which changes with every keystroke
  ]);
}

// Use React.memo to memoize the entire component
export default React.memo(StoryTreeLevelComponent); 