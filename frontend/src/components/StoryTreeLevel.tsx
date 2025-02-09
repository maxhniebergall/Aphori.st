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
 */

import React, { useState, useCallback, useEffect, useMemo } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import InfiniteLoader from 'react-window-infinite-loader';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useReplyContext } from '../context/ReplyContext';
import { useInfiniteNodes } from '../hooks/useInfiniteNodes';
import { useSiblingNavigation } from '../hooks/useSiblingNavigation';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as IStoryTreeLevel } from '../context/types';
import { useStoryTree } from '../context/StoryTreeContext';
import { ACTIONS } from '../context/StoryTreeContext';

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
  parentId?: string[];
  node: IStoryTreeLevel;
  onSiblingChange?: (node: IStoryTreeLevel) => void;
}

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({ parentId, node, onSiblingChange }) => {
  const storyTree = node?.storyTree;
  const isQuoteMode = Boolean(storyTree?.metadata?.quote);

  // State declarations
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
  const { state: storyTreeState, dispatch } = useStoryTree();

  // Calculate total siblings count
  const totalSiblingsCount = useMemo(() => {
    if (isQuoteMode) {
      return replyPagination.numberOfRepliesToQuoteOfNode || 1;
    }
    return node?.storyTree?.nodes?.length || 1;
  }, [isQuoteMode, replyPagination.numberOfRepliesToQuoteOfNode, node?.storyTree?.nodes?.length]);

  const infiniteNodes = useInfiniteNodes<IStoryTreeLevel>(
    async (startIndex: number, stopIndex: number): Promise<IStoryTreeLevel[]> => {
      if (!storyTree?.id || isQuoteMode) return [];
      const itemsToLoad = storyTree.nodes.slice(startIndex, stopIndex + 1);
      console.log('Loading sibling nodes:', { startIndex, stopIndex, itemsToLoad });
      const loadedNodes = await Promise.all(
        itemsToLoad.map(async (sibling) => {
          if (!sibling?.id) return null;
          // Don't fetch the current node again
          if (sibling.id === storyTree.id) {
            const currentNode = { ...node };
            if (currentNode.storyTree) {
              currentNode.storyTree.siblings = storyTree.nodes
                .filter((n) => n?.id != null)
                .map(n => ({
                  id: n.id,
                  parentId: n.parentId,
                  content: currentNode.storyTree?.text || '',
                  storyTree: {
                    id: n.id,
                    text: currentNode.storyTree?.text || '',
                    nodes: [],
                    parentId: [n.parentId || ''],
                    metadata: currentNode.storyTree?.metadata
                  }
                }));
            }
            return currentNode;
          }
          const fetchedNode = await storyTreeOperator.fetchNode(sibling.id);
          if (fetchedNode?.storyTree) {
            fetchedNode.storyTree.siblings = storyTree.nodes
              .filter((n) => n?.id != null)
              .map(n => ({
                id: n.id,
                parentId: n.parentId,
                content: n.id === fetchedNode.storyTree?.id ? fetchedNode.storyTree?.text : '',
                storyTree: {
                  id: n.id,
                  text: n.id === fetchedNode.storyTree?.id ? fetchedNode.storyTree?.text : '',
                  nodes: [],
                  parentId: [n.parentId || ''],
                  metadata: fetchedNode.storyTree?.metadata
                }
              }));
          }
          return fetchedNode;
        })
      );
      const filteredNodes = loadedNodes.filter((n): n is IStoryTreeLevel => n !== null);
      console.log('Loaded sibling nodes:', filteredNodes);
      return filteredNodes;
    },
    storyTree?.nodes ? storyTree.nodes.length > 1 : false
  );

  // Use global "replies" as the siblings when in quote mode
  const siblingsToUse = useMemo(
    () => isQuoteMode ? storyTreeState.replies : (infiniteNodes?.nodes ?? []),
    [isQuoteMode, storyTreeState.replies, infiniteNodes?.nodes]
  );

  const { currentNode, siblings, currentIndex, loadNextSibling, loadPreviousSibling } = useSiblingNavigation<IStoryTreeLevel>({
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
      if (startIndex >= siblingsToUse.length && replyPage < replyPagination.totalPages) {
        await loadMoreReplies();
      }
    },
    [storyTree?.id, storyTree?.metadata?.quote, siblingsToUse.length, replyPage, replyPagination.totalPages, loadMoreReplies]
  );

  const handleTextSelectionCompleted = useCallback(
    (selection: SelectionState): void => {
      if (!storyTree?.id) {
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
    [currentIndex, setReplyTarget, setSelectionState, storyTree?.id, siblingsToUse, node]
  );

  const handleReplyButtonClick = useCallback((): void => {
    if (!siblingsToUse[currentIndex]?.storyTree?.id) {
      setReplyError('Invalid node for reply');
      return;
    }
    try {
      if (isReplyTarget(siblingsToUse[currentIndex].storyTree.id)) {
        clearReplyState();
      } else {
        setReplyTarget(siblingsToUse[currentIndex]);
        setSelectionState({
          start: 0,
          end: siblingsToUse[currentIndex].storyTree.text.length,
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

  const bind = useGesture(
    {
      onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
        if (!storyTree?.id) {
          console.log('Cannot handle drag: no story tree id');
          return;
        }

        console.log('Drag state:', { 
          down, 
          mx, 
          vx,
          currentIndex: validCurrentIndex,
          totalSiblings: validTotalSiblings,
          canGoNext: validCurrentIndex < validTotalSiblings - 1,
          canGoPrev: validCurrentIndex > 0,
          hasNextFn: Boolean(loadNextSibling),
          hasPrevFn: Boolean(loadPreviousSibling)
        });

        if (!down) {
          try {
            if (mx < -100 || (vx < -0.5 && mx < -50)) {
              if (loadNextSibling && validCurrentIndex < validTotalSiblings - 1) {
                console.log('Executing next sibling navigation');
                loadNextSibling();
              } else {
                console.log('Next navigation blocked:', {
                  hasNextFn: Boolean(loadNextSibling),
                  currentIndex: validCurrentIndex,
                  totalSiblings: validTotalSiblings
                });
              }
              cancel();
            } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
              if (loadPreviousSibling && validCurrentIndex > 0) {
                console.log('Executing previous sibling navigation');
                loadPreviousSibling();
              } else {
                console.log('Previous navigation blocked:', {
                  hasPrevFn: Boolean(loadPreviousSibling),
                  currentIndex: validCurrentIndex
                });
              }
              cancel();
            }
          } catch (error) {
            console.error('Navigation error:', error);
          }
        }
      },
    },
    useMemo(() => {
      const canNavigateNext = Boolean(loadNextSibling) && validCurrentIndex < validTotalSiblings - 1;
      const canNavigatePrev = Boolean(loadPreviousSibling) && validCurrentIndex > 0;
      
      console.log('Gesture enabled state:', {
        hasStoryTreeId: Boolean(storyTree?.id),
        canNavigateNext,
        canNavigatePrev
      });

      return {
        drag: {
          axis: 'x',
          enabled: Boolean(storyTree?.id) && (canNavigateNext || canNavigatePrev),
          threshold: 5, // Add a small threshold to prevent accidental drags
        },
      };
    }, [storyTree?.id, validCurrentIndex, validTotalSiblings, loadNextSibling, loadPreviousSibling])
  );

  const resetSiblings = useMemo(() => infiniteNodes?.reset ?? (() => {}), [infiniteNodes?.reset]);

  const infiniteLoaderProps = useMemo(() => 
    isQuoteMode
      ? {
          itemCount: totalSiblingsCount,
          loadMoreItems: loadMoreItemsOld,
          isItemLoaded: (index: number) => Boolean(siblingsToUse[index]),
          minimumBatchSize: 3,
          threshold: 2,
        }
      : {
          itemCount: node?.storyTree?.nodes?.length || 1,
          loadMoreItems: infiniteNodes?.loadMoreItems ?? (async () => {}),
          isItemLoaded: infiniteNodes?.isItemLoaded ?? (() => true),
          minimumBatchSize: 3,
          threshold: 2,
        },
    [isQuoteMode, totalSiblingsCount, loadMoreItemsOld, siblingsToUse, node?.storyTree?.nodes?.length, infiniteNodes]
  );

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
          // Instead of using setLoadedSiblings, dispatch to update the global state
          dispatch({ type: ACTIONS.SET_REPLIES, payload: response.replies });
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
  }, [storyTree?.id, storyTree?.parentId, storyTree?.metadata?.quote, isQuoteMode, resetSiblings, node, dispatch]);

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
          // Dispatch the fetched replies to the global state
          dispatch({ type: ACTIONS.SET_REPLIES, payload: replyPage === 1 ? response.replies : [...storyTreeState.replies, ...response.replies] });
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
  }, [isQuoteMode, replyPage, storyTree, node, dispatch, storyTreeState.replies]);

  // Now we can do the early return
  if (!storyTree?.id) {
    console.warn('StoryTreeLevel received invalid node:', node);
    return null;
  }

  const renderError = () => {
    if (!replyError) return null;
    return <div className="reply-error">{replyError}</div>;
  };

  return (
    <motion.div
      className={`story-tree-node ${
        isReplyTarget(siblingsToUse[validCurrentIndex]?.storyTree?.id || '') ? 'reply-target' : ''
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
            style={{ touchAction: 'none' }}
            className={`story-tree-node-content ${validTotalSiblings > 1 ? 'has-siblings' : ''} ${validCurrentIndex > 0 || validCurrentIndex < validTotalSiblings - 1 ? 'swipeable' : ''}`}
            id={siblingsToUse[validCurrentIndex]?.storyTree?.id}
            ref={ref}
            onTouchStart={() => console.log('Touch start')}
            onTouchMove={(e) => console.log('Touch move', e.touches[0])}
            onTouchEnd={() => console.log('Touch end')}
          >
            <NodeContent
              node={siblingsToUse[validCurrentIndex] || node}
              replyTargetId={replyTarget?.id}
              selectionState={
                isReplyTarget(siblingsToUse[validCurrentIndex]?.storyTree?.id || '')
                  ? selectionState
                  : null
              }
              onSelectionComplete={handleTextSelectionCompleted}
            />
            <NodeFooter
              currentIndex={validCurrentIndex}
              totalSiblings={validTotalSiblings}
              onReplyClick={handleReplyButtonClick}
              isReplyTarget={isReplyTarget(siblingsToUse[validCurrentIndex]?.storyTree?.id || '')}
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