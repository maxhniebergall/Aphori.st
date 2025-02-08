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
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import { useReplyContext } from '../context/ReplyContext';
import useInfiniteNodes from '../hooks/useInfiniteNodes';
import { useSiblingNavigation } from '../hooks/useSiblingNavigation';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as IStoryTreeLevel } from '../context/types';

interface ReplyPagination {
  page: number;
  limit: number;
  numberOfRepliesToQuoteOfNode: number;
  totalPages: number;
}

interface SelectionState {
  start: number;
  end: number;
}

interface StoryTreeLevelProps {
  parentId?: string;
  node: IStoryTreeLevel;
  onSiblingChange?: (node: IStoryTreeLevel) => void;
}

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({ parentId, node, onSiblingChange }) => {
  // Guard: Check for a valid node before proceeding
  const storyTree = node?.storyTree;
  if (!storyTree?.id) {
    console.warn('StoryTreeLevel received invalid node:', node);
    return null;
  }
  
  // Determine if we are in quote mode based on node metadata
  const isQuoteMode = Boolean(storyTree?.metadata?.quote);

  // Use infinite nodes for non-quote mode:
  const infiniteNodes = !isQuoteMode
    ? useInfiniteNodes<IStoryTreeLevel>(
        [node],
        async (startIndex: number, stopIndex: number): Promise<IStoryTreeLevel[]> => {
          const itemsToLoad = storyTree.nodes.slice(startIndex, stopIndex + 1);
          const loadedNodes = await Promise.all(
            itemsToLoad.map(async (sibling) => {
              if (!sibling?.id) return null;
              if (sibling.id === storyTree.id) return node;
              const fetchedNode = await storyTreeOperator.fetchNode(sibling.id);
              if (fetchedNode) {
                fetchedNode.storyTree.siblings = storyTree.nodes.filter((n) => n?.id);
              }
              return fetchedNode;
            })
          );
          return loadedNodes.filter((n): n is IStoryTreeLevel => n !== null);
        },
        storyTree?.nodes ? storyTree.nodes.length > 1 : false
      )
    : undefined;

  // For quote mode, manage loaded siblings and reply state.
  const [loadedSiblings, setLoadedSiblings] = useState<IStoryTreeLevel[]>([]);
  const [isLoadingReplies, setIsLoadingReplies] = useState<boolean>(false);
  const [replyPage, setReplyPage] = useState<number>(1);
  const [replyPagination, setReplyPagination] = useState<ReplyPagination>({
    page: 1,
    limit: 10,
    numberOfRepliesToQuoteOfNode: 0,
    totalPages: 0,
  });
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState<boolean>(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const siblings = infiniteNodes?.items ?? [];
  const siblingsToUse = isQuoteMode ? loadedSiblings : siblings;

  // Extract full reply context (including setters) for managing reply state.
  const { setReplyTarget, replyTarget, setSelectionState, selectionState, clearReplyState } = useReplyContext();

  // Use the sibling navigation hook with the proper configuration.
  const { currentSiblingIndex, loadNextSibling, loadPreviousSibling } = useSiblingNavigation<IStoryTreeLevel>({
    node,
    siblings: siblingsToUse,
    isQuoteMode,
    siblingsLoading: infiniteNodes?.isLoading ?? false,
    isLoadingReplies,
    fetchMoreSiblings: infiniteNodes?.loadMoreItems ?? (async () => {}),
    onSiblingChange,
  });

  // Helper: Check if the provided id matches the current reply target.
  const isReplyTarget = useCallback(
    (id: string): boolean => replyTarget?.id === id,
    [replyTarget]
  );

  // Callback to load more replies when in quote mode.
  const loadMoreReplies = useCallback(async (): Promise<void> => {
    if (!storyTree?.id || isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;
    setIsLoadingMoreReplies(true);
    try {
      setReplyPage((prev) => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [node?.storyTree?.id, isLoadingMoreReplies, replyPage, replyPagination.totalPages]);

  // For quote mode: A callback for the InfiniteLoader to load additional items.
  const loadMoreItemsOld = useCallback(
    async (startIndex: number, stopIndex: number): Promise<void> => {
      if (!node?.storyTree?.id) return;
      if (node?.storyTree?.metadata?.quote) {
        if (startIndex >= loadedSiblings.length && replyPage < replyPagination.totalPages) {
          await loadMoreReplies();
        }
        return;
      }
    },
    [node, loadedSiblings.length, replyPage, replyPagination.totalPages, loadMoreReplies]
  );

  // Handle text selection completion for reply target setting.
  const handleTextSelectionCompleted = useCallback(
    (selection: SelectionState): void => {
      if (!node?.storyTree?.id) {
        setReplyError('Invalid node for reply');
        return;
      }
      try {
        setReplyError(null);
        setReplyTarget(siblingsToUse[currentSiblingIndex] || node);
        setSelectionState(selection);
      } catch (error) {
        setReplyError('Failed to set reply target');
        console.error('Selection error:', error);
      }
    },
    [currentSiblingIndex, setReplyTarget, setSelectionState, node?.storyTree?.id, siblingsToUse]
  );

  // Handle reply button click.
  const handleReplyButtonClick = useCallback((): void => {
    if (!siblingsToUse[currentSiblingIndex]?.storyTree?.id) {
      setReplyError('Invalid node for reply');
      return;
    }
    try {
      if (isReplyTarget(siblingsToUse[currentSiblingIndex].storyTree.id)) {
        clearReplyState();
      } else {
        setReplyTarget(siblingsToUse[currentSiblingIndex]);
        setSelectionState({
          start: 0,
          end: siblingsToUse[currentSiblingIndex].storyTree.text.length,
        });
        setReplyError(null);
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError('Failed to handle reply action');
      console.error('Reply error:', error);
    }
  }, [currentSiblingIndex, clearReplyState, setReplyTarget, setSelectionState, isReplyTarget, siblingsToUse]);

  // Set up gesture handling for swiping between siblings.
  const bind = useGesture(
    {
      onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
        if (!node?.storyTree?.id) return;
        if (!down) {
          if (mx < -100 || (vx < -0.5 && mx < -50)) {
            loadNextSibling();
            cancel();
          } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
            loadPreviousSibling();
            cancel();
          }
        }
      },
    },
    {
      drag: {
        axis: 'x',
        enabled:
          Boolean(node?.storyTree?.id) &&
          (currentSiblingIndex > 0 ||
            (isQuoteMode
              ? currentSiblingIndex < replyPagination.numberOfRepliesToQuoteOfNode - 1
              : true)),
      },
    }
  );

  // A helper to reset siblings (from infiniteNodes) or a no-op if not available.
  const resetSiblings = infiniteNodes?.reset ?? (() => {});

  // Side Effect: Subscribe to reply submission so that we can refresh siblings when needed.
  useEffect(() => {
    const refreshSiblings = async () => {
      if (isQuoteMode) {
        if (!node?.storyTree?.metadata?.quote) {
          console.error('Missing quote metadata for node:', node);
          return;
        }
        const response = await storyTreeOperator.fetchReplies(
          node.storyTree.metadata.quote.sourcePostId,
          node.storyTree.metadata.quote.text,
          'mostRecent',
          1 // Reset to first page
        );
        if (response?.replies && response?.pagination) {
          setLoadedSiblings(response.replies);
          setReplyPagination(response.pagination);
          setReplyPage(1);
        }
      } else {
        resetSiblings();
      }
    };
    const parentIdentifier = node?.storyTree?.parentId?.[0] || node?.storyTree?.id;
    const unsubscribe = storyTreeOperator.subscribeToReplySubmission(parentIdentifier, refreshSiblings);
    return () => unsubscribe();
  }, [node?.storyTree?.id, node?.storyTree?.parentId, isQuoteMode, resetSiblings]);

  // Side Effect: For quote mode, load reply siblings (paginated).
  useEffect(() => {
    const loadReplySiblings = async (): Promise<void> => {
      if (!storyTree || !storyTree.metadata?.quote) {
        console.error('Missing metadata or quote data for node:', node);
        return;
      }

      const { sourcePostId, text } = storyTree.metadata.quote;
      setIsLoadingReplies(true);
      try {
        const response = await storyTreeOperator.fetchReplies(
          sourcePostId,
          text,
          'mostRecent',
          replyPage
        );
        if (response?.replies && response?.pagination) {
          setLoadedSiblings((prev) =>
            replyPage === 1 ? response.replies : [...prev, ...response.replies]
          );
          setReplyPagination(response.pagination);
        }
      } catch (error) {
        console.error('Error loading reply siblings:', error);
      } finally {
        setIsLoadingReplies(false);
      }
    };
    loadReplySiblings();
  }, [node, replyPage, isQuoteMode, storyTree]);

  // Side Effect: For quote mode, initialize loaded siblings.
  useEffect(() => {
    if (isQuoteMode) {
      if (!node?.storyTree?.id || loadedSiblings.length !== 0) return;
      setLoadedSiblings([node]);
      loadMoreItemsOld(0, Math.min(2, node.storyTree.nodes.length - 1));
      window.dispatchEvent(new Event('resize'));
    }
  }, [node, loadedSiblings.length, loadMoreItemsOld, isQuoteMode]);

  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeLevel requires a valid operator with fetchNode method');
    return null;
  }

  const totalSiblingsCount = isQuoteMode
    ? replyPagination.numberOfRepliesToQuoteOfNode || 1
    : node?.storyTree?.nodes?.length || 1;

  const infiniteLoaderProps = isQuoteMode
    ? {
        itemCount: totalSiblingsCount,
        loadMoreItems: loadMoreItemsOld,
        isItemLoaded: (index: number) => Boolean(loadedSiblings[index]),
        minimumBatchSize: 3,
        threshold: 2,
      }
    : {
        itemCount: node?.storyTree?.nodes?.length || 1,
        loadMoreItems: infiniteNodes?.loadMoreItems ?? (async () => {}),
        isItemLoaded: infiniteNodes?.isItemLoaded ?? (() => true),
        minimumBatchSize: 3,
        threshold: 2,
      };

  const renderError = () => {
    if (!replyError) return null;
    return <div className="reply-error">{replyError}</div>;
  };

  return (
    <motion.div
      className={`story-tree-node ${
        isReplyTarget(siblingsToUse[currentSiblingIndex]?.storyTree?.id || '') ? 'reply-target' : ''
      } ${(infiniteNodes?.isLoading || isLoadingReplies) ? 'loading' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
    >
      <InfiniteLoader {...infiniteLoaderProps}>
        {({ onItemsRendered, ref }) => (
          <div
            {...bind()}
            className={`story-tree-node-content ${totalSiblingsCount > 1 ? 'has-siblings' : ''}`}
            id={siblingsToUse[currentSiblingIndex]?.storyTree?.id}
            ref={ref}
          >
            <NodeContent
              node={siblingsToUse[currentSiblingIndex]}
              replyTargetId={replyTarget?.id}
              selectionState={
                isReplyTarget(siblingsToUse[currentSiblingIndex]?.storyTree?.id || '')
                  ? selectionState
                  : null
              }
              onSelectionComplete={handleTextSelectionCompleted}
            />
            <NodeFooter
              currentIndex={currentSiblingIndex}
              totalSiblings={totalSiblingsCount}
              onReplyClick={handleReplyButtonClick}
              isReplyTarget={isReplyTarget(siblingsToUse[currentSiblingIndex]?.storyTree?.id || '')}
              onNextSibling={loadNextSibling}
              onPreviousSibling={loadPreviousSibling}
            />
            {renderError()}
          </div>
        )}
      </InfiniteLoader>
    </motion.div>
  );
}

export default StoryTreeLevelComponent; 