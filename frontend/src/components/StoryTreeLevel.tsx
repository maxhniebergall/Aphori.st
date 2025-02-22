/**
 * Requirements:
 * - Break StoryTreeLevel into sub-components for clear separation of concerns
 * - useGesture for detecting swipe gestures
 * - framer-motion for fade-in animations
 * - InfiniteLoader for infinite scrolling/loading of siblings
 * - Maintains reply, infinite-loading, and sibling navigation functionality
 * - Integrates NodeContent and NodeFooter and passes down reply/selection logic
 * - Use useInfiniteNodes and useSiblingNavigation hooks for node fetching and navigation
 * - Supports quote mode with reply fetching and infinite-loader adjustments
 * - Properly handle sibling nodes and their text content
 * - TypeScript support with strict typing
 * - Yarn for package management
 * - Proper error handling
 * - Loading state management
 * - Accessibility compliance
 * - Performance optimization
 * - Uses usePagination hook for cursor-based pagination
 *
 * UPDATED:
 * - Updated InfiniteLoader and VariableSizeList usage to follow react-window documentation.
 *   * VariableSizeList now uses a render function that receives { index, style }.
 *   * The InfiniteLoader's provided ref is forwarded directly rather than using a custom refSetter.
 *   * itemCount is made consistent (using totalSiblingsCount) between both components.
 *   * loadMoreItems is now a placeholder that must return a promise.
 * - Moved totalSiblingsCount, siblingsToUse, validCurrentIndex, and infiniteNodes to useState
 * - Kept sizeMap as useRef to minimize re-renders.
 * - Added usePagination hook for better pagination state management
 * 
 * - TODO:
 * - Verify that the quoteCounts are being passed down correctly to the NodeContent component.
 * --                       existingSelectableQuotes={currentNode.quoteCounts || {quoteCounts: new Map()}}
 * -- verify that the NodeContent rerenders when quoteCounts change
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useGesture, FullGestureState } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { VariableSizeList } from 'react-window';
import { useReplyContext } from '../context/ReplyContext';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as LevelData, StoryTreeNode } from '../types/types';
import StoryTreeOperator from '../operators/StoryTreeOperator';
import { Quote } from '../types/quote';
import { usePagination, createPaginatedFetcher } from '../utils/pagination';

interface StoryTreeLevelProps {
  levelData: LevelData; 
}

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({ levelData }) => {
  // State declarations
  console.log("StoryTreeLevel: Initializing with levelData:", {
    rootNodeId: levelData.rootNodeId,
    levelNumber: levelData.levelNumber,
    siblings: levelData.siblings,
    pagination: levelData.pagination,
    selectedQuote: levelData.selectedQuote
  });

  // All hooks must be called before any conditional returns
  const [replyError, setReplyError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [currentNode, setCurrentNode] = useState<StoryTreeNode | null>(null);
  const sizeMap = useRef<{ [key: number]: number }>({});
  const { setReplyTarget, replyTarget, setReplyQuote, replyQuote, clearReplyState } = useReplyContext();

  // Calculate dimensions based on viewport - moved before any conditional logic
  const dimensions = useMemo(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    return {
      height: Math.max(viewportHeight * 0.8, 400), // At least 400px or 80% of viewport height
      width: Math.max(viewportWidth * 0.8, 600),   // At least 600px or 80% of viewport width
      defaultItemSize: Math.max(viewportHeight * 0.3, 200) // At least 200px or 30% of viewport height
    };
  }, []);

  // Update dimensions on window resize - moved before any conditional logic
  useEffect(() => {
    const handleResize = () => {
      const viewportHeight = window.innerHeight;
      const viewportWidth = window.innerWidth;
      dimensions.height = Math.max(viewportHeight * 0.8, 400);
      dimensions.width = Math.max(viewportWidth * 0.8, 600);
      dimensions.defaultItemSize = Math.max(viewportHeight * 0.3, 200);
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [dimensions]);

  // Get initial siblings from levelData
  const initialSiblings = useMemo(() => {
    const siblingsArray = levelData.siblings.levelsMap.get(levelData.selectedQuote) || [];
    console.log("StoryTreeLevel: Initial siblings from levelData:", {
      count: siblingsArray.length,
      siblings: siblingsArray
    });
    return siblingsArray;
  }, [levelData.siblings.levelsMap, levelData.selectedQuote]);

  // Create a paginated fetcher for this level's siblings
  const fetchSiblings = useMemo(() => createPaginatedFetcher<StoryTreeNode>(
    `${process.env.REACT_APP_API_URL}/api/getReplies/${levelData.parentId[0]}/${encodeURIComponent(levelData.selectedQuote.toString())}/mostRecent`
  ), [levelData.parentId, levelData.selectedQuote]);

  // Use the usePagination hook
  const {
    items: paginatedSiblings,
    hasMore,
    matchingItemsCount,
    isLoading,
    loadMore,
    reset,
    error
  } = usePagination(fetchSiblings, {
    limit: 10,
    initialCursor: levelData.pagination.nextCursor
  });

  // Combine initial siblings with paginated siblings
  const siblings = useMemo(() => {
    const combinedSiblings = [...initialSiblings];
    if (paginatedSiblings.length > 0) {
      // Add only new siblings that aren't already in the array
      paginatedSiblings.forEach(sibling => {
        if (!combinedSiblings.some(s => s.id === sibling.id)) {
          combinedSiblings.push(sibling);
        }
      });
    }
    return combinedSiblings;
  }, [initialSiblings, paginatedSiblings]);

  // useEffects to update state based on props and pagination
  useEffect(() => {
    console.log('StoryTreeLevel: Got siblings array:', {
      selectedQuote: levelData.selectedQuote.toString(),
      siblingsLength: siblings.length,
      siblings
    });
    
    // Only reset currentIndex if it's out of bounds
    if (currentIndex >= siblings.length) {
      setCurrentIndex(Math.max(0, siblings.length - 1));
    }
  }, [siblings, currentIndex, levelData.selectedQuote]);
  
  useEffect(() => {
    console.log('siblings', siblings);
    console.log('currentIndex', currentIndex);
    const node = siblings[currentIndex];
    console.log('node', node);
    
    // Handle case when there are no siblings but we have a root node
    if (!node && levelData.levelNumber === 0 && levelData.rootNodeId) {
      const node = {
        id: levelData.rootNodeId,
        rootNodeId: levelData.rootNodeId,
        parentId: levelData.parentId,
        levelNumber: levelData.levelNumber,
        textContent: '',  // This will be populated by the API
        quoteCounts: { quoteCounts: new Map() },
        metadata: {
          replyCounts: new Map()
        }
      } as StoryTreeNode;
      setCurrentNode(node);
      return;
    }
    
    // Handle case when there is no valid node
    if (!node?.rootNodeId) {
      setCurrentNode(null);
      return;
    }
    
    setCurrentNode(node);
  }, [siblings, currentIndex, levelData.rootNodeId, levelData.levelNumber, levelData.parentId]);

  // Check if a node is the reply target
  const isReplyTarget = useCallback(
    (id: string): boolean => replyTarget?.rootNodeId === id,
    [replyTarget]
  );

  // Handle text selection for replies
  const handleTextSelectionCompleted = useCallback(
    (quote: Quote): void => {
      try {
        setReplyError(null);
        setReplyTarget(currentNode);
        setReplyQuote(quote);
      } catch (error) {
        setReplyError('Failed to set reply target');
        console.error('Selection error:', error);
      }
    },
    [currentNode, setReplyTarget, setReplyQuote, setReplyError]
  );

  // Handle reply button click
  const handleReplyButtonClick = useCallback((): void => {
    if (!currentNode) {
      console.warn('clicked reply button on StoryTreeLevel with null currentNode');
      return;
    }
    try {
      if (isReplyTarget(levelData.rootNodeId)) {
        // if already in reply mode, exit reply mode
        clearReplyState();
      } else {
        // if not in reply mode, enter reply mode
        setReplyTarget(currentNode);
        
        // Only create quote if we have valid content
        if (!currentNode.textContent || currentNode.textContent.trim().length === 0) {
          console.error('Cannot create quote: node has no text content', currentNode);
          return;
        }

        const quote: Quote = new Quote(
          currentNode.textContent.trim(),
          currentNode.rootNodeId,
          {
            start: 0,
            end: currentNode.textContent.trim().length
          }
        );

        if (!quote.isValid()) {
          console.error('Failed to create valid quote for reply:', {
            node: currentNode,
            quote
          });
          return;
        }

        setReplyQuote(quote);
        setReplyError(null);
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError('Failed to handle reply action');
      console.error('Reply error:', error);
    }
  }, [
    clearReplyState,
    setReplyTarget,
    setReplyQuote,
    isReplyTarget,
    levelData.rootNodeId,
    currentNode,
    setReplyError
  ]);

  // Navigation callbacks
  const navigateToNextSibling = useCallback(() => { 
    if (currentIndex < siblings.length - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  }, [currentIndex, siblings.length, setCurrentIndex]);

  const navigateToPreviousSibling = useCallback(() => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  }, [currentIndex, setCurrentIndex]);
  
  // Memoize infinite loader props to prevent unnecessary recalculations
  const infiniteLoaderProps = useMemo(() => {
    const loadMoreItems = async (startIndex: number, stopIndex: number): Promise<void> => {
      console.log("InfiniteLoader: Loading more items:", {
        startIndex,
        stopIndex,
        parentId: levelData.parentId[0],
        levelNumber: levelData.levelNumber,
        selectedQuote: levelData.selectedQuote.toString(),
        currentPagination: levelData.pagination
      });
      return loadMore();
    };

    const isItemLoaded = (index: number): boolean => {
      console.log("InfiniteLoader: Checking if item is loaded:", {
        index,
        currentNodesLength: siblings.length,
        hasMore,
        matchingItemsCount,
        isLoading
      });
      return index < siblings.length;
    };
    
    const calculatedItemCount = hasMore 
      ? Math.max((siblings.length || 0) + 1, matchingItemsCount)
      : (siblings.length || 0);
      
    console.log("InfiniteLoader: Calculated props:", {
      calculatedItemCount,
      currentNodesLength: siblings.length,
      matchingItemsCount,
      hasMore,
      isLoading,
      levelNumber: levelData.levelNumber
    });
    
    return {
      itemCount: calculatedItemCount,
      loadMoreItems,
      isItemLoaded,
      minimumBatchSize: 3,
      threshold: 2,
    };
  }, [
    levelData.parentId,
    levelData.levelNumber,
    levelData.selectedQuote,
    levelData.pagination,
    siblings.length,
    hasMore,
    matchingItemsCount,
    isLoading,
    loadMore
  ]);

  // Setup gesture handling for swipe navigation
  const bind = useGesture({
    onDrag: useCallback((state: FullGestureState<'drag'>) => {
      const { down, movement: [mx], cancel, velocity: [vx] } = state;
      if (!down) {
        try {
          if (mx < -100 || (vx < -0.5 && mx < -50)) {
            if (navigateToNextSibling && currentIndex < siblings.length - 1) {
              navigateToNextSibling();
            }
            cancel();
          } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
            if (navigateToPreviousSibling && currentIndex > 0) {
              navigateToPreviousSibling();
            }
            cancel();
          }
        } catch (error) {
          console.error('Navigation error:', error);
        }
      }
    }, [navigateToNextSibling, navigateToPreviousSibling, currentIndex, siblings.length])
  }, {
    drag: useMemo(() => ({
      axis: 'x',
      enabled: Boolean(currentNode?.rootNodeId) && (
        (Boolean(navigateToNextSibling) && currentIndex < siblings.length - 1) ||
        (Boolean(navigateToPreviousSibling) && currentIndex > 0)
      ),
      threshold: 5,
    }), [currentNode?.rootNodeId, navigateToNextSibling, navigateToPreviousSibling, currentIndex, siblings.length])
  });

  // Get the current node to render
  const nodeToRender = useMemo(() => {
    if (!currentNode && levelData.levelNumber === 0 && levelData.rootNodeId) {
      return {
        id: levelData.rootNodeId,
        rootNodeId: levelData.rootNodeId,
        parentId: levelData.parentId,
        levelNumber: levelData.levelNumber,
        textContent: '',
        quoteCounts: { quoteCounts: new Map() },
        metadata: {
          replyCounts: new Map()
        }
      } as StoryTreeNode;
    }
    return currentNode;
  }, [currentNode, levelData]);

  // Early return if we don't have a valid node
  if (!nodeToRender?.rootNodeId && levelData.levelNumber !== 0) {
    return null;
  }

  // Ensure we have a valid node for rendering
  const node = nodeToRender || {
    id: levelData.rootNodeId,
    rootNodeId: levelData.rootNodeId,
    parentId: levelData.parentId,
    levelNumber: levelData.levelNumber,
    textContent: '',
    quoteCounts: { quoteCounts: new Map() },
    metadata: {
      replyCounts: new Map()
    }
  } as StoryTreeNode;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className={`story-tree-node ${
          isReplyTarget(node.rootNodeId) ? 'reply-target' : ''
        }}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="article"
      >
        <InfiniteLoader {...infiniteLoaderProps}>
          {({ onItemsRendered, ref }) => (
            <VariableSizeList
              height={dimensions.height}
              width={dimensions.width}
              itemCount={matchingItemsCount}
              itemSize={(index) => sizeMap.current[index] || dimensions.defaultItemSize}
              overscanCount={5}
              onItemsRendered={onItemsRendered}
              ref={ref}
            >
              {({ index, style }) => {
                const sibling = siblings[index] || null;
                if (!sibling || !sibling.rootNodeId) {
                  return null;
                }

                return (
                  <div
                    style={style}
                    {...bind()}
                    className={`story-tree-node-content ${matchingItemsCount > 1 ? 'has-siblings' : ''} ${
                      currentIndex > 0 || currentIndex < matchingItemsCount - 1 ? 'swipeable' : ''
                    }`}
                    id={sibling.rootNodeId}
                    role="region"
                    aria-label={`Story content ${index + 1} of ${matchingItemsCount}`}
                  >
                    <NodeContent
                      node={sibling}
                      quote={(isReplyTarget(sibling.id) && replyQuote) ? replyQuote : undefined}
                      existingSelectableQuotes={sibling.quoteCounts || {quoteCounts: new Map()}}
                      onSelectionComplete={handleTextSelectionCompleted}
                    />
                    <NodeFooter
                      currentIndex={index}
                      totalSiblings={matchingItemsCount}
                      onReplyClick={handleReplyButtonClick}
                      isReplyTarget={isReplyTarget(sibling.rootNodeId)}
                      onNextSibling={navigateToNextSibling}
                      onPreviousSibling={navigateToPreviousSibling}
                    />
                    {(replyError || error) && (
                      <div className="reply-error" role="alert" aria-live="polite">
                        {replyError || error}
                      </div>
                    )}
                  </div>
                );
              }}
            </VariableSizeList>
          )}
        </InfiniteLoader>
      </motion.div>
    </AnimatePresence>
  );
};

export default StoryTreeLevelComponent; 