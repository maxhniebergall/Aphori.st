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
  const [replyError, setReplyError] = useState<string | null>(null);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [siblings, setSiblings] = useState<StoryTreeNode[]>([]);
  const [currentNode, setCurrentNode] = useState<StoryTreeNode | null>(null);
  // Keeping sizeMap as a ref for performance reasons (frequent updates do not trigger re-renders)
  const sizeMap = useRef<{ [key: number]: number }>({});
  const { setReplyTarget, replyTarget, setReplyQuote, replyQuote, clearReplyState } = useReplyContext();

  // useEffects to update state based on props
  // TODO verify that this works correctly with respect to rerenders
  useEffect(() => {
    setSiblings(levelData.siblings.levelsMap.get(levelData.selectedQuote) || []);
  }, [levelData]);
  useEffect(() => {
    setCurrentNode(siblings[currentIndex] ||  null);
  }, [siblings, currentIndex]);

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
        setReplyTarget(levelData);
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
        setReplyTarget(levelData);
        const quote: Quote = {
          quoteLiteral: currentNode.textContent, // if the reply button is clicked, the quote is the whole text content of the current node
          sourcePostId: currentNode.rootNodeId,
          selectionRange: {
            start: 0,
            end: currentNode.textContent.length
          }
        };
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
    levelData
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
  
  const loadMoreItems = async (startIndex: number, stopIndex: number): Promise<void> => {
    // TODO account for multiple parentIds
    const promise = StoryTreeOperator.loadMoreItems(levelData.parentId[0], levelData.levelNumber, levelData.selectedQuote, startIndex, stopIndex);
    return promise;
  };

  // Setup InfiniteLoader properties
  const infiniteLoaderProps = useMemo(() => ({
    itemCount: levelData.siblings.levelsMap.get(levelData.selectedQuote)?.length || 1,
    loadMoreItems, 
    isItemLoaded: (index: number): boolean => Boolean(levelData.siblings.levelsMap.get(levelData.selectedQuote)?.[index]),
    minimumBatchSize: 3,
    threshold: 2,
  }), [levelData]);

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

  if (!currentNode?.rootNodeId) {
    console.warn('StoryTreeLevel received invalid node:', currentNode);
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className={`story-tree-node ${
          isReplyTarget(currentNode.rootNodeId) ? 'reply-target' : ''
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
              {({ index, style }) => {
                return (
                  <div
                    style={style}
                    {...bind()}
                    className={`story-tree-node-content ${levelData.pagination.matchingRepliesCount > 1 ? 'has-siblings' : ''} ${
                      currentIndex > 0 || currentIndex < levelData.pagination.matchingRepliesCount - 1 ? 'swipeable' : ''
                    }`}
                    id={currentNode.rootNodeId}
                    role="region"
                    aria-label={`Story content ${index + 1} of ${levelData.pagination.matchingRepliesCount}`}
                  >
                    <NodeContent
                      node={currentNode}
                      quote={
                        (isReplyTarget(currentNode.id) && replyQuote) ? replyQuote : undefined
                      }
                      existingSelectableQuotes={levelData.existingSelectableQuotes}
                      onSelectionComplete={handleTextSelectionCompleted}
                    />
                    <NodeFooter
                      currentIndex={index}
                      totalSiblings={levelData.pagination.matchingRepliesCount}
                      onReplyClick={handleReplyButtonClick}
                      isReplyTarget={isReplyTarget(currentNode.rootNodeId)}
                      onNextSibling={navigateToNextSibling}
                      onPreviousSibling={navigateToPreviousSibling}
                    />
                    {replyError && (
                      <div className="reply-error" role="alert" aria-live="polite">
                        {replyError}
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