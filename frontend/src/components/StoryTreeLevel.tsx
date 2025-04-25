/**
 * Requirements:
 * - Display the current sibling node for a given level
 * - Support horizontal swipe gestures between siblings
 * - Maintain pagination for loading more siblings
 * - Preserve reply mode functionality
 * - Support node selection and quote selection
 * - Communicate height changes to parent components for proper virtualization
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReplyContext } from '../context/ReplyContext';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as LevelData, StoryTreeNode, Pagination } from '../types/types';
import { areQuotesEqual, Quote } from '../types/quote';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { 
  getSelectedQuote, 
  getSiblings, 
  getSelectedNodeHelper, 
  getLevelNumber,
  getParentId,
  getPagination,
  isMidLevel,
  getSelectedQuote as getLevelSelectedQuote 
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

// Create a memoized NodeContent component to prevent unnecessary re-renders
const MemoizedNodeContent = React.memo(NodeContent, (prevProps, nextProps) => {
  // Check if nodes are the same reference or have the same ID
  const nodeChanged = prevProps.node !== nextProps.node && prevProps.node?.id !== nextProps.node?.id;
  
  // Use areQuotesEqual for quote comparison, handling undefined cases
  const quoteChanged = prevProps.quote && nextProps.quote && !areQuotesEqual(prevProps.quote, nextProps.quote);
  const levelSelectedQuoteChanged = prevProps.levelSelectedQuote && nextProps.levelSelectedQuote && !areQuotesEqual(prevProps.levelSelectedQuote, nextProps.levelSelectedQuote);

  // Simple comparison for existingSelectableQuotes (can be refined if needed)
  const existingQuotesChanged = prevProps.existingSelectableQuotes !== nextProps.existingSelectableQuotes;

  // Return true if none of the relevant props have changed
  return !nodeChanged && !quoteChanged && !levelSelectedQuoteChanged && !existingQuotesChanged;
});

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({
  levelData,
  navigateToNextSiblingCallback,
  navigateToPreviousSiblingCallback,
  reportHeight,
}) => {
  // Log the props received by StoryTreeLevelComponent for debugging propagation
  
  // Core state
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
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
  
  // Pagination state - directly use the Pagination type from our types
  const initialPagination = getPagination(levelData);
  if (!initialPagination) {
    
    return null;
  }
  
  const [pagination, setPagination] = useState<Pagination>(initialPagination);
  
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

  // Report height to parent virtualized list when container size changes
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
  }, [reportHeight]);

  // Calculate dimensions based on viewport
  const dimensions = useMemo(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    return {
      height: Math.max(viewportHeight * 0.8, 400), 
      width: Math.max(viewportWidth * 0.8, 600),
      defaultItemSize: Math.max(viewportHeight * 0.3, 200)
    };
  }, []);

  // Update dimensions on window resize
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
  }, []);

  // Get siblings from levelData using the correct key
  const siblings = useMemo(() => {
    // Skip if not a MidLevel
    if (!isMidLevel(levelData)) {
      return [];
    }
    
    const siblings = getSiblings(levelData);
    if (!siblings) {
      return [];
    }
    
    const selectedQuote = getSelectedQuote(levelData);
    
    if (!selectedQuote) {
      return [];
    }
    
    // Find the entry in the levelsMap array that matches the selectedQuote
    const entry = siblings.levelsMap.find(
      ([quote]) => quote && selectedQuote && areQuotesEqual(quote, selectedQuote)
    );
    return entry ? entry[1] : [];
  }, [levelData, levelData.midLevel?.selectedQuote]);

  // Update pagination state based on levelData
  useMemo(() => {
    const newPagination = getPagination(levelData);
    if (newPagination) {
      setPagination(newPagination);
    }
  }, [levelData]);

  // Get the current node to render
  const nodeToRender = useMemo(() => {    
    // If we don't have a current node but the levelData has a selectedNode, use that
    const selectedNode = getSelectedNodeHelper(levelData);
    if (selectedNode) {
      return selectedNode;
    }
    
    // Skip if not a MidLevel
    if (!isMidLevel(levelData)) {
      return undefined;
    }
    
    const siblings = getSiblings(levelData);
    if (!siblings) {
      return undefined;
    }
    
    // Fallback to the first sibling from the map
    const nullEntry = siblings.levelsMap.find(([quote]) => quote === null);
    return siblings.levelsMap[0]?.[1]?.[0] || (nullEntry ? nullEntry[1][0] : undefined);
  }, [levelData]);

  // Check if a node is the reply target more efficiently
  const isReplyTarget = useCallback(
    (node: StoryTreeNode | undefined): boolean => {
      if (!node) return false;
      
      if (!replyTarget) return false;
      return replyTarget.rootNodeId === node.rootNodeId && replyTarget.id === node.id && replyTarget.levelNumber === node.levelNumber;
    },
    [replyTarget]
  );

  // Handle text selection for replies with improved error handling
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
    [nodeToRender, levelData, setReplyError]
  );

  // Handle reply button click with improved functionality
  const handleReplyButtonClick = useCallback((): void => {
    if (!nodeToRender) {
      setReplyError('Cannot create reply: no valid node selected');
      return;
    }
    
    try {
      // Check if we're already in reply mode for this node
      if (isReplyActive && isReplyTarget(nodeToRender)) {
        // If already in reply mode, exit reply mode
        clearReplyState();
      } else {
        // If not in reply mode, enter reply mode
        setReplyTarget(nodeToRender);
        
        // Only create quote if we have valid content
        if (!nodeToRender.textContent || nodeToRender.textContent.trim().length === 0) {
          throw new Error('Cannot create quote: node has no text content');
        }

        // Create a quote that encompasses the entire node content
        const quote: Quote = new Quote(
          nodeToRender.textContent.trim(),
          nodeToRender.rootNodeId,
          {
            start: 0,
            end: nodeToRender.textContent.trim().length
          }
        );

        if (Quote.isValid(quote) === false) {
          throw new Error('Failed to create valid quote for reply');
        }

        // Set the quote and open the reply interface
        setReplyQuote(quote);
        setReplyError(null);
        setIsReplyOpen(true);
        
        // Trigger resize to ensure UI updates correctly
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : 'Failed to handle reply action');
      
    }
  }, [
    clearReplyState,
    setReplyTarget,
    setReplyQuote,
    isReplyTarget,
    nodeToRender,
    setReplyError,
    isReplyActive,
    setIsReplyOpen
  ]);

  // Navigation functions with pagination
  const navigateToNextSibling = useCallback(async () => {
    if (isReplyTarget(nodeToRender)) { return; } // Disable navigation if node is reply target
    
    if (!nodeToRender) {
      
      return;
    }
    
    const currentIndex = siblings.findIndex(sibling => sibling.id === getSelectedNodeHelper(levelData)?.id);
    let didNavigate = false;

    if (currentIndex < siblings.length - 1) {
      // We have the next sibling loaded already
      navigateToNextSiblingCallback();
      didNavigate = true;
    } else if (pagination.hasMore) {
      // We need to load more siblings
      setIsLoading(true);
      try {
        const parentId = getParentId(levelData);
        const levelNumber = getLevelNumber(levelData);
        const selectedQuote = getSelectedQuote(levelData);
        
        if (!parentId || !levelNumber || !selectedQuote) {
          
          return;
        }
        
        await storyTreeOperator.loadMoreItems(
          parentId[0],
          levelNumber,
          selectedQuote,
          siblings.length,  
          siblings.length + 3 
        );
        // After loading, the callback will be called by the parent component
        didNavigate = true;
      } catch (error) {
        
      } finally {
        setIsLoading(false);
      }
    }

    if (!didNavigate) {
      
    }
  }, [
    siblings,
    pagination.hasMore,
    levelData,
    navigateToNextSiblingCallback,
    nodeToRender,
    isReplyTarget
  ]);

  const navigateToPreviousSibling = useCallback(async () => {
    if (isReplyTarget(nodeToRender)) { return; } // Disable navigation if node is reply target
    
    if (!nodeToRender) {
      
      return;
    }
    
    const currentIndex = siblings.findIndex(sibling => sibling.id === getSelectedNodeHelper(levelData)?.id);

    if (currentIndex > 0) {
      // We have the previous sibling loaded already because we always start loading from zero
      navigateToPreviousSiblingCallback();
    }
  }, [
    siblings,
    navigateToPreviousSiblingCallback,
    levelData,
    isReplyTarget,
    nodeToRender
  ]);

  // Setup gesture handling for swipe navigation
  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx], event }) => {
      // If the event originated within the TextSelection container, disable navigation
      if (event && (event.target instanceof HTMLElement) && event.target.closest('.selection-container')) {
        return;
      }
      if (!down) {
        try {
          if (mx < -100 || (vx < -0.5 && mx < -50)) {
            navigateToNextSibling();
            cancel?.();
          } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
            navigateToPreviousSibling();
            cancel?.();
          }
        } catch (error) {
          
        }
      }
    }
  }, {
    drag: {
      axis: 'x',
      enabled: Boolean(nodeToRender?.rootNodeId),
      threshold: 5,
    }
  });

  // Get the actual selected quote for this level
  const levelSelectedQuote = useMemo(() => getLevelSelectedQuote(levelData), [levelData]);

  // Early return if we don't have a valid node
  if (!nodeToRender?.rootNodeId) {
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
            className={`story-tree-node ${isReplyTarget(nodeToRender) ? 'reply-target' : ''}`}
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
            <MemoizedNodeContent
              node={nodeToRender}
              levelSelectedQuote={levelSelectedQuote}
              quote={(isReplyTarget(nodeToRender) && replyQuote) ? replyQuote : undefined}
              existingSelectableQuotes={nodeToRender?.quoteCounts ?? undefined}
              onExistingQuoteSelectionComplete={handleExistingQuoteSelectionCompleted}
            />
            <MemoizedNodeFooter
              currentIndex={siblings.findIndex(sibling => sibling.id === getSelectedNodeHelper(levelData)?.id)}
              totalSiblings={pagination.totalCount}
              onReplyClick={handleReplyButtonClick}
              isReplyTarget={isReplyTarget(nodeToRender)}
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
function useReplyContextSelective() {
  const context = useReplyContext();
  
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