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
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useReplyContext } from '../context/ReplyContext';
import { useInfiniteNodes } from '../hooks/useInfiniteNodes';
import { useSiblingNavigation } from '../hooks/useSiblingNavigation';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as IStoryTreeLevel, Quote, SelectionState } from '../context/types';
import { useStoryTree } from '../context/StoryTreeContext';
import { ACTIONS } from '../context/types';

interface ReplyPagination {
  page: number;
  limit: number;
  totalCount: number;
  totalPages: number;
}

interface StoryTreeLevelProps {
  parentId?: string[];
  node: IStoryTreeLevel;
  onSiblingChange?: (node: IStoryTreeLevel) => void;
}

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({ parentId, node, onSiblingChange }) => {
  // State declarations
  const [isLoadingReplies, setIsLoadingReplies] = useState<boolean>(false);
  const [replyPage, setReplyPage] = useState<number>(1);
  const [replyPagination, setReplyPagination] = useState<ReplyPagination>({
    page: 1,
    limit: 10,
    totalCount: 0,
    totalPages: 0,
  });
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState<boolean>(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const { setReplyTarget, replyTarget, setSelectionState, selectionState, clearReplyState } = useReplyContext();
  const { state: storyTreeState, dispatch } = useStoryTree();

  // Determine if we're in quote mode
  const isQuoteMode = Boolean(node.siblings.levelsMap.size > 0);

  // Calculate total siblings count
  const totalSiblingsCount = useMemo(() => {
    if (isQuoteMode) {
      return replyPagination.totalCount || 1;
    }
    return node.siblings.levelsMap.size || 1;
  }, [isQuoteMode, replyPagination.totalCount, node.siblings.levelsMap.size]);

  // Use infinite nodes hook for loading siblings
  const infiniteNodes = useInfiniteNodes<IStoryTreeLevel>(
    async (startIndex: number, stopIndex: number): Promise<IStoryTreeLevel[]> => {
      if (!node.rootNodeId || isQuoteMode) return [];
      
      const siblings: IStoryTreeLevel[] = [];
      node.siblings.levelsMap.forEach((siblingNodes, quote) => {
        const nodesToLoad = siblingNodes.slice(startIndex, stopIndex + 1);
        siblings.push(...nodesToLoad.map(sibling => ({
          rootNodeId: node.rootNodeId,
          levelNumber: node.levelNumber + 1,
          textContent: sibling.textContent,
          siblings: { levelsMap: new Map() }
        })));
      });

      const loadedNodes = await Promise.all(
        siblings.map(async (sibling) => {
          if (!sibling.rootNodeId) return null;
          const fetchedNode = await storyTreeOperator.fetchNode(sibling.rootNodeId);
          return fetchedNode;
        })
      );

      return loadedNodes.filter((n): n is IStoryTreeLevel => n !== null);
    },
    node.siblings.levelsMap.size > 0
  );

  // Use global "replies" as the siblings when in quote mode
  const siblingsToUse = useMemo(
    () => isQuoteMode ? storyTreeState.levels : (infiniteNodes?.nodes ?? []),
    [isQuoteMode, storyTreeState.levels, infiniteNodes?.nodes]
  );

  // Use sibling navigation hook
  const { currentNode, siblings, currentIndex, navigateToNextSibling, navigateToPreviousSibling } = useSiblingNavigation<IStoryTreeLevel>({
    node,
    siblings: siblingsToUse,
    isQuoteMode,
    siblingsLoading: infiniteNodes?.isLoading ?? false,
    isLoadingReplies,
    fetchMoreSiblings: infiniteNodes?.loadMoreItems ?? (async () => {}),
    onSiblingChange,
    initialIndex: 0
  });

  // Ensure we have valid values for sibling navigation
  const validCurrentIndex = Number.isFinite(currentIndex) ? currentIndex : 0;
  const validTotalSiblings = Number.isFinite(totalSiblingsCount) ? totalSiblingsCount : 1;

  // Check if a node is the reply target
  const isReplyTarget = useCallback(
    (id: string): boolean => replyTarget?.rootNodeId === id,
    [replyTarget]
  );

  // Load more replies in quote mode
  const loadMoreReplies = useCallback(async (): Promise<void> => {
    if (!node.rootNodeId || isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;
    
    setIsLoadingMoreReplies(true);
    try {
      setReplyPage(prev => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [node.rootNodeId, isLoadingMoreReplies, replyPage, replyPagination.totalPages]);

  // Handle text selection for replies
  const handleTextSelectionCompleted = useCallback(
    (selection: SelectionState): void => {
      if (!node.rootNodeId) {
        setReplyError('Invalid node for reply');
        return;
      }
      try {
        setReplyError(null);
        setReplyTarget(siblingsToUse[currentIndex] || node);
        setSelectionState(selection);
      } catch (error) {
        setReplyError('Failed to set reply target');
        console.error('Selection error:', error);
      }
    },
    [currentIndex, setReplyTarget, setSelectionState, node, siblingsToUse]
  );

  // Handle reply button click
  const handleReplyButtonClick = useCallback((): void => {
    const currentNode = siblingsToUse[currentIndex];
    if (!currentNode?.rootNodeId) {
      setReplyError('Invalid node for reply');
      return;
    }

    try {
      if (isReplyTarget(currentNode.rootNodeId)) {
        clearReplyState();
      } else {
        setReplyTarget(currentNode);
        setSelectionState({
          start: 0,
          end: currentNode.textContent.length,
        });
        setReplyError(null);
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError('Failed to handle reply action');
      console.error('Reply error:', error);
    }
  }, [
    currentIndex,
    clearReplyState,
    setReplyTarget,
    setSelectionState,
    isReplyTarget,
    siblingsToUse
  ]);

  // Setup gesture handling for swipe navigation
  const bind = useGesture(
    {
      onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
        if (!node.rootNodeId) return;

        if (!down) {
          try {
            if (mx < -100 || (vx < -0.5 && mx < -50)) {
              if (navigateToNextSibling && validCurrentIndex < validTotalSiblings - 1) {
                navigateToNextSibling();
              }
              cancel();
            } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
              if (navigateToPreviousSibling && validCurrentIndex > 0) {
                navigateToPreviousSibling();
              }
              cancel();
            }
          } catch (error) {
            console.error('Navigation error:', error);
          }
        }
      },
    },
    {
      drag: {
        axis: 'x',
        enabled: Boolean(node.rootNodeId) && (
          (Boolean(navigateToNextSibling) && validCurrentIndex < validTotalSiblings - 1) ||
          (Boolean(navigateToPreviousSibling) && validCurrentIndex > 0)
        ),
        threshold: 5,
      },
    }
  );

  // Reset siblings when needed
  const resetSiblings = useMemo(() => infiniteNodes?.reset ?? (() => {}), [infiniteNodes?.reset]);

  // Setup infinite loader props
  const infiniteLoaderProps = useMemo(() => ({
    itemCount: totalSiblingsCount,
    loadMoreItems: isQuoteMode ? loadMoreReplies : (infiniteNodes?.loadMoreItems ?? (async () => {})),
    isItemLoaded: (index: number) => Boolean(siblingsToUse[index]),
    minimumBatchSize: 3,
    threshold: 2,
  }), [isQuoteMode, totalSiblingsCount, loadMoreReplies, siblingsToUse, infiniteNodes]);

  // Subscribe to reply updates
  useEffect(() => {
    if (!node.rootNodeId) return;

    const unsubscribe = storyTreeOperator.subscribeToReplySubmission(node.rootNodeId, resetSiblings);
    return () => unsubscribe();
  }, [node.rootNodeId, resetSiblings]);

  // Load initial replies in quote mode
  useEffect(() => {
    const loadReplies = async (): Promise<void> => {
      if (!isQuoteMode) return;

      setIsLoadingReplies(true);
      try {
        const firstQuote = Array.from(node.siblings.levelsMap.keys())[0];
        if (!firstQuote) return;

        const response = await storyTreeOperator.fetchReplies(
          firstQuote.sourcePostId,
          firstQuote.quoteLiteral,
          'mostRecent',
          replyPage
        );

        if (response?.replies && response?.pagination) {
          dispatch({ 
            type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
            payload: replyPage === 1 ? response.replies : [...storyTreeState.levels, ...response.replies]
          });
          setReplyPagination(response.pagination);
        }
      } catch (error) {
        console.error('Failed to load replies:', error);
        setReplyError('Failed to load replies');
      } finally {
        setIsLoadingReplies(false);
      }
    };

    loadReplies();
  }, [isQuoteMode, replyPage, node, dispatch, storyTreeState.levels]);

  if (!node.rootNodeId) {
    console.warn('StoryTreeLevel received invalid node:', node);
    return null;
  }

  return (
    <AnimatePresence mode="wait">
      <motion.div
        className={`story-tree-node ${
          isReplyTarget(siblingsToUse[validCurrentIndex]?.rootNodeId || '') ? 'reply-target' : ''
        } ${(infiniteNodes?.isLoading || isLoadingReplies) ? 'loading' : ''}`}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.2 }}
        role="article"
      >
        <InfiniteLoader {...infiniteLoaderProps}>
          {({ onItemsRendered, ref }) => (
            <div
              {...bind()}
              style={{ touchAction: 'none' }}
              className={`story-tree-node-content ${validTotalSiblings > 1 ? 'has-siblings' : ''} ${
                validCurrentIndex > 0 || validCurrentIndex < validTotalSiblings - 1 ? 'swipeable' : ''
              }`}
              id={siblingsToUse[validCurrentIndex]?.rootNodeId}
              ref={ref}
              role="region"
              aria-label={`Story content ${validCurrentIndex + 1} of ${validTotalSiblings}`}
            >
              <NodeContent
                node={siblingsToUse[validCurrentIndex] || node}
                replyTargetId={replyTarget?.rootNodeId}
                selectionState={
                  isReplyTarget(siblingsToUse[validCurrentIndex]?.rootNodeId || '')
                    ? selectionState
                    : null
                }
                onSelectionComplete={handleTextSelectionCompleted}
              />
              <NodeFooter
                currentIndex={validCurrentIndex}
                totalSiblings={validTotalSiblings}
                onReplyClick={handleReplyButtonClick}
                isReplyTarget={isReplyTarget(siblingsToUse[validCurrentIndex]?.rootNodeId || '')}
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
        </InfiniteLoader>
      </motion.div>
    </AnimatePresence>
  );
};

export default StoryTreeLevelComponent; 