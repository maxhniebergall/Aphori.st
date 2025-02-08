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

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
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
  const storyTree = node?.storyTree;
  const isQuoteMode = Boolean(storyTree?.metadata?.quote);

  // Move all hooks to the top level
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

  const { setReplyTarget, replyTarget, setSelectionState, selectionState, clearReplyState } = useReplyContext();

  const infiniteNodes = useInfiniteNodes<IStoryTreeLevel>(
    node ? [node] : [],
    async (startIndex: number, stopIndex: number): Promise<IStoryTreeLevel[]> => {
      if (!storyTree?.id || isQuoteMode) return [];
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
  );

  const siblings = infiniteNodes?.items ?? [];
  const siblingsToUse = isQuoteMode ? loadedSiblings : siblings;

  const { currentSiblingIndex, loadNextSibling, loadPreviousSibling } = useSiblingNavigation<IStoryTreeLevel>({
    node,
    siblings: siblingsToUse,
    isQuoteMode,
    siblingsLoading: infiniteNodes?.isLoading ?? false,
    isLoadingReplies,
    fetchMoreSiblings: infiniteNodes?.loadMoreItems ?? (async () => {}),
    onSiblingChange,
  });

  // Rest of the hooks and callbacks
  const isReplyTarget = useCallback(
    (id: string): boolean => replyTarget?.id === id,
    [replyTarget]
  );

  const loadMoreReplies = useCallback(async (): Promise<void> => {
    if (!storyTree?.id || isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;
    setIsLoadingMoreReplies(true);
    try {
      setReplyPage((prev) => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [storyTree?.id, isLoadingMoreReplies, replyPage, replyPagination.totalPages]);

  const loadMoreItemsOld = useCallback(
    async (startIndex: number, stopIndex: number): Promise<void> => {
      if (!storyTree?.id || !storyTree?.metadata?.quote) return;
      if (startIndex >= loadedSiblings.length && replyPage < replyPagination.totalPages) {
        await loadMoreReplies();
      }
    },
    [storyTree?.id, storyTree?.metadata?.quote, loadedSiblings.length, replyPage, replyPagination.totalPages, loadMoreReplies]
  );

  const handleTextSelectionCompleted = useCallback(
    (selection: SelectionState): void => {
      if (!storyTree?.id) {
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
    [currentSiblingIndex, setReplyTarget, setSelectionState, storyTree?.id, siblingsToUse, node]
  );

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
  }, [
    currentSiblingIndex,
    clearReplyState,
    setReplyTarget,
    setSelectionState,
    isReplyTarget,
    siblingsToUse
  ]);

  const bind = useGesture(
    {
      onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
        if (!storyTree?.id) return;
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
          Boolean(storyTree?.id) &&
          (currentSiblingIndex > 0 ||
            (isQuoteMode
              ? currentSiblingIndex < replyPagination.numberOfRepliesToQuoteOfNode - 1
              : true)),
      },
    }
  );

  const resetSiblings = useMemo(() => infiniteNodes?.reset ?? (() => {}), [infiniteNodes?.reset]);

  useEffect(() => {
    const refreshSiblings = async () => {
      if (isQuoteMode) {
        if (!storyTree?.metadata?.quote) {
          console.error('Missing quote metadata for node:', node);
          return;
        }
        const response = await storyTreeOperator.fetchReplies(
          storyTree.metadata.quote.sourcePostId,
          storyTree.metadata.quote.text,
          'mostRecent',
          1
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
    const parentIdentifier = storyTree?.parentId?.[0] || storyTree?.id;
    if (parentIdentifier) {
      const unsubscribe = storyTreeOperator.subscribeToReplySubmission(parentIdentifier, refreshSiblings);
      return () => unsubscribe();
    }
  }, [storyTree?.id, storyTree?.parentId, storyTree?.metadata?.quote, isQuoteMode, resetSiblings, node]);

  useEffect(() => {
    const loadReplySiblings = async (): Promise<void> => {
      if (!storyTree || !storyTree.metadata?.quote) {
        console.error('Missing metadata or quote data for node:', node);
        return;
      }

      const { sourcePostId, text } = storyTree.metadata.quote;
      setIsLoadingReplies(true);
      try {
        const response = await storyTreeOperator.fetchReplies(sourcePostId, text, 'mostRecent', replyPage);
        if (response?.replies && response?.pagination) {
          setLoadedSiblings((prev) =>
            replyPage === 1 ? response.replies : [...prev, ...response.replies]
          );
          setReplyPagination(response.pagination);
        }
      } catch (error) {
        console.error('Failed to load reply siblings:', error);
        setReplyError('Failed to load replies');
      } finally {
        setIsLoadingReplies(false);
      }
    };

    if (isQuoteMode) {
      loadReplySiblings();
    }
  }, [isQuoteMode, replyPage, storyTree, node]);

  // Early return after all hooks
  if (!storyTree?.id) {
    console.warn('StoryTreeLevel received invalid node:', node);
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
              node={siblingsToUse[currentSiblingIndex] || node}
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