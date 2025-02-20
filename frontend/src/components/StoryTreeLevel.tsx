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
 *
 * UPDATED:
 * - Updated InfiniteLoader and VariableSizeList usage to follow react-window documentation.
 *   * VariableSizeList now uses a render function that receives { index, style }.
 *   * The InfiniteLoader's provided ref is forwarded directly rather than using a custom refSetter.
 *   * itemCount is made consistent (using totalSiblingsCount) between both components.
 *   * loadMoreItems is now a placeholder that must return a promise.
 * - Moved totalSiblingsCount, siblingsToUse, validCurrentIndex, and infiniteNodes to useState
 * - Kept sizeMap as useRef to minimize re-renders.
 * 
 * - TODO:
 * - Verify that the quoteCounts are being passed down correctly to the NodeContent component.
 * --                       existingSelectableQuotes={currentNode.quoteCounts || {quoteCounts: new Map()}}
 * -- verify that the NodeContent rerenders when quoteCounts change
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { VariableSizeList } from 'react-window';
import { useReplyContext } from '../context/ReplyContext';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import {StoryTreeLevel as LevelData, StoryTreeNode } from '../types/types';
import  StoryTreeOperator  from '../operators/StoryTreeOperator';
import { Quote } from '../types/quote';
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
  const [replyError, setReplyError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [siblings, setSiblings] = useState<StoryTreeNode[]>([]);
  const [currentNode, setCurrentNode] = useState<StoryTreeNode | null>(null);
  // Keeping sizeMap as a ref for performance reasons (frequent updates do not trigger re-renders)
  const sizeMap = useRef<{ [key: number]: number }>({});
  const { setReplyTarget, replyTarget, setReplyQuote, replyQuote, clearReplyState } = useReplyContext();

  // useEffects to update state based on props
  useEffect(() => {
    const siblingsArray = levelData.siblings.levelsMap.get(levelData.selectedQuote) || [];
    console.log('StoryTreeLevel: Got siblings array:', {
      selectedQuote: levelData.selectedQuote.toString(),
      siblingsLength: siblingsArray.length,
      siblings: siblingsArray
    });
    setSiblings(siblingsArray);
    
    // Only reset currentIndex if it's out of bounds
    if (currentIndex >= siblingsArray.length) {
      setCurrentIndex(Math.max(0, siblingsArray.length - 1));
    }
  }, [levelData.siblings.levelsMap, currentIndex, levelData.selectedQuote]);
  
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
    [setReplyTarget, setReplyQuote, levelData]
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
    levelData,
    currentNode,
    setReplyError
  ]);

  const navigateToNextSibling = () => { 
    if (currentIndex < (levelData.siblings.levelsMap.get(levelData.selectedQuote)?.length || 1) - 1) {
      setCurrentIndex(currentIndex + 1);
    }
  };
  const navigateToPreviousSibling = () => {
    if (currentIndex > 0) {
      setCurrentIndex(currentIndex - 1);
    }
  };
  
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
      return StoryTreeOperator.loadMoreItems(
        levelData.parentId[0], 
        levelData.levelNumber, 
        levelData.selectedQuote, 
        startIndex, 
        stopIndex
      );
    };

    const currentNodes = levelData.siblings.levelsMap.get(levelData.selectedQuote) || [];
    const isItemLoaded = (index: number): boolean => {
      console.log("InfiniteLoader: Checking if item is loaded:", {
        index,
        currentNodesLength: currentNodes.length,
        hasMore: levelData.pagination.hasMore,
        matchingRepliesCount: levelData.pagination.matchingRepliesCount,
        nextCursor: levelData.pagination.nextCursor,
        prevCursor: levelData.pagination.prevCursor
      });
      return index < currentNodes.length;
    };
    
    const calculatedItemCount = levelData.pagination.hasMore 
      ? Math.max((currentNodes.length || 0) + 1, levelData.pagination.matchingRepliesCount)
      : (currentNodes.length || 0);
      
    console.log("InfiniteLoader: Calculated props:", {
      calculatedItemCount,
      currentNodesLength: currentNodes.length,
      matchingRepliesCount: levelData.pagination.matchingRepliesCount,
      hasMore: levelData.pagination.hasMore,
      nextCursor: levelData.pagination.nextCursor,
      prevCursor: levelData.pagination.prevCursor,
      levelNumber: levelData.levelNumber
    });
    
    return {
      itemCount: calculatedItemCount,
      loadMoreItems,
      isItemLoaded,
      minimumBatchSize: 3,
      threshold: 2,
    };
  }, [levelData]);

  // Setup gesture handling for swipe navigation
  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
      if (!down) {
        try {
          if (mx < -100 || (vx < -0.5 && mx < -50)) {
            if (navigateToNextSibling && currentIndex < (levelData.siblings.levelsMap.get(levelData.selectedQuote)?.length || 0) - 1) {
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
    },
  }, {
    drag: {
      axis: 'x',
      enabled: Boolean(currentNode?.rootNodeId) && (
        (Boolean(navigateToNextSibling) && currentIndex < (levelData.siblings.levelsMap.get(levelData.selectedQuote)?.length || 0) - 1) ||
        (Boolean(navigateToPreviousSibling) && currentIndex > 0)
      ),
      threshold: 5,
    },
  });

  if (!currentNode && levelData.levelNumber !== 0) {
    // Only warn if we have siblings but no current node, and it's not the root level
    return null;
  }

  // Ensure currentNode is not null before rendering
  const node = currentNode || {
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

  // Early return if we don't have a valid node
  if (!node?.rootNodeId) {
    return null;
  }

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
              height={200}
              width={200}
              itemCount={levelData.pagination.matchingRepliesCount}
              itemSize={(index) => sizeMap.current[index] || 50}
              overscanCount={5}
              onItemsRendered={onItemsRendered}
              ref={ref}
            >
              {({ index, style }) => (
                <div
                  style={style}
                  {...bind()}
                  className={`story-tree-node-content ${levelData.pagination.matchingRepliesCount > 1 ? 'has-siblings' : ''} ${
                    currentIndex > 0 || currentIndex < levelData.pagination.matchingRepliesCount - 1 ? 'swipeable' : ''
                  }`}
                  id={node.rootNodeId}
                  role="region"
                  aria-label={`Story content ${index + 1} of ${levelData.pagination.matchingRepliesCount}`}
                >
                  <NodeContent
                    node={node}
                    quote={
                      (isReplyTarget(node.id) && replyQuote) ? replyQuote : undefined
                    }
                    existingSelectableQuotes={node.quoteCounts || {quoteCounts: new Map()}}
                    onSelectionComplete={handleTextSelectionCompleted}
                  />
                  <NodeFooter
                    currentIndex={index}
                    totalSiblings={levelData.pagination.matchingRepliesCount}
                    onReplyClick={handleReplyButtonClick}
                    isReplyTarget={isReplyTarget(node.rootNodeId)}
                    onNextSibling={navigateToNextSibling}
                    onPreviousSibling={navigateToPreviousSibling}
                  />
                  {replyError && (
                    <div className="reply-error" role="alert" aria-live="polite">
                      {replyError}
                    </div>
                  )}
                </div>
              )}
            </VariableSizeList>
          )}
        </InfiniteLoader>
      </motion.div>
    </AnimatePresence>
  );
};

export default StoryTreeLevelComponent; 