/**
 * Requirements:
 * - Break StoryTreeNode into sub-components for clear separation of concerns
 * - useGesture for detecting swipe gestures
 * - framer-motion for fade-in animations
 * - InfiniteLoader for infinite scrolling/loading of siblings
 * - Maintains reply, infinite-loading, and sibling navigation functionality
 * - Integrates NodeContent, NodeFooter, and passes down reply/selection logic
 * - Use useInfiniteNodes and useSiblingNavigation hooks for node fetching and navigation
 * - Yarn for package management
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import { useReplyContext } from '../context/ReplyContext';
import useInfiniteNodes from '../hooks/useInfiniteNodes';
import useSiblingNavigation from '../hooks/useSiblingNavigation';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeNode as IStoryTreeNode } from '../context/types';

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

interface StoryTreeNodeProps {
  parentId?: string;
  node: IStoryTreeNode;
  onSiblingChange?: (node: IStoryTreeNode) => void;
}

function StoryTreeNode({ parentId, node, onSiblingChange }: StoryTreeNodeProps) {
  // ─── HOOKS & STATE ─────────────────────────────────────────────
  const isQuoteMode = Boolean(node?.storyTree?.metadata?.quote);

  const {
    items: siblings,
    loadMoreItems: fetchMoreSiblings,
    isItemLoaded: siblingIsLoaded,
    isLoading: siblingsLoading,
    reset: resetSiblings,
  } = !isQuoteMode
    ? useInfiniteNodes<IStoryTreeNode>(
        [node],
        async (startIndex: number, stopIndex: number): Promise<IStoryTreeNode[]> => {
          const itemsToLoad = node.storyTree.nodes.slice(startIndex, stopIndex + 1);
          const loadedNodes = await Promise.all(
            itemsToLoad.map(async (sibling) => {
              if (!sibling?.id) return null;
              if (sibling.id === node.storyTree.id) return node;
              const fetchedNode = await storyTreeOperator.fetchNode(sibling.id);
              if (fetchedNode) {
                fetchedNode.storyTree.siblings = node.storyTree.nodes.filter((n) => n?.id);
              }
              return fetchedNode;
            })
          );
          return loadedNodes.filter((n): n is IStoryTreeNode => n !== null);
        },
        node?.storyTree?.nodes ? (node.storyTree.nodes.length > 1) : false
      )
    : undefined;

  // For quote mode handling
  const [loadedSiblings, setLoadedSiblings] = useState<IStoryTreeNode[]>([]);
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

  const siblingsToUse = isQuoteMode ? loadedSiblings : (siblings || []);

  const { state } = useStoryTree();
  const { setReplyTarget, replyTarget, setSelectionState, selectionState, clearReplyState } =
    useReplyContext();
  const nodeRef = useRef<HTMLDivElement>(null);

  const { currentSiblingIndex, loadNextSibling, loadPreviousSibling } = useSiblingNavigation<IStoryTreeNode>({
    node,
    siblings: siblingsToUse,
    isQuoteMode,
    siblingsLoading,
    isLoadingReplies,
    fetchMoreSiblings,
    onSiblingChange,
  });

  // ─── CALLBACKS ─────────────────────────────────────────────────
  const isReplyTarget = useCallback(
    (id: string): boolean => replyTarget?.id === id,
    [replyTarget]
  );

  const loadMoreItemsOld = useCallback(
    async (startIndex: number, stopIndex: number): Promise<void> => {
      if (!node?.storyTree?.id) return;
      // In quote mode, load more replies if needed
      if (node?.storyTree?.metadata?.quote) {
        if (startIndex >= loadedSiblings.length && replyPage < replyPagination.totalPages) {
          await loadMoreReplies();
        }
        return;
      }
    },
    [node, loadedSiblings.length, replyPage, replyPagination.totalPages]
  );

  const loadMoreReplies = useCallback(async (): Promise<void> => {
    if (!node?.storyTree?.id || isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;
    setIsLoadingMoreReplies(true);
    try {
      setReplyPage((prev) => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [node?.storyTree?.id, isLoadingMoreReplies, replyPage, replyPagination.totalPages]);

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

  // ─── GESTURE HANDLING ───────────────────────────────────────────
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

  // ─── SIDE EFFECTS ───────────────────────────────────────────────
  useEffect(() => {
    if (!node?.storyTree?.id) return;
    const refreshSiblings = async () => {
      if (isQuoteMode) {
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

  useEffect(() => {
    if (!node?.storyTree?.id || !isQuoteMode) return;
    const loadReplySiblings = async () => {
      setIsLoadingReplies(true);
      try {
        const response = await storyTreeOperator.fetchReplies(
          node.storyTree.metadata.quote.sourcePostId,
          node.storyTree.metadata.quote.text,
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
  }, [node, replyPage, isQuoteMode]);

  useEffect(() => {
    if (isQuoteMode) {
      if (!node?.storyTree?.id || loadedSiblings.length !== 0) return;
      setLoadedSiblings([node]);
      loadMoreItemsOld(0, Math.min(2, node.storyTree.nodes.length - 1));
      window.dispatchEvent(new Event('resize'));
    }
  }, [node, loadedSiblings.length, loadMoreItemsOld, isQuoteMode]);

  if (!node?.storyTree?.id) {
    console.warn('StoryTreeNode received invalid node:', node);
    return null;
  }
  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeNode requires a valid operator with fetchNode method');
    return null;
  }

  const totalSiblingsCount = isQuoteMode
    ? replyPagination.numberOfRepliesToQuoteOfNode || 1
    : node?.storyTree?.nodes?.length || 1;

  // Render error if present
  const renderError = () => {
    if (!replyError) return null;
    return <div className="reply-error">{replyError}</div>;
  };

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
        loadMoreItems: fetchMoreSiblings,
        isItemLoaded: siblingIsLoaded,
        minimumBatchSize: 3,
        threshold: 2,
      };

  // ─── RENDERING ───────────────────────────────────────────────────
  return (
    <motion.div
      className={`story-tree-node ${
        isReplyTarget(siblingsToUse[currentSiblingIndex].storyTree.id) ? 'reply-target' : ''
      } ${siblingsLoading || isLoadingReplies ? 'loading' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      ref={nodeRef}
    >
      <InfiniteLoader {...infiniteLoaderProps}>
        {({ onItemsRendered, ref }) => (
          <div
            {...bind()}
            className={`story-tree-node-content ${totalSiblingsCount > 1 ? 'has-siblings' : ''}`}
            id={siblingsToUse[currentSiblingIndex].storyTree.id}
            ref={ref}
          >
            <NodeContent
              node={siblingsToUse[currentSiblingIndex]}
              replyTargetId={replyTarget?.id}
              selectionState={
                isReplyTarget(siblingsToUse[currentSiblingIndex].storyTree.id)
                  ? selectionState
                  : null
              }
              onSelectionCompleted={handleTextSelectionCompleted}
            />
            <NodeFooter
              currentIndex={currentSiblingIndex}
              totalSiblings={totalSiblingsCount}
              onReplyClick={handleReplyButtonClick}
              isReplyTarget={isReplyTarget(siblingsToUse[currentSiblingIndex].storyTree.id)}
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

export default StoryTreeNode; 