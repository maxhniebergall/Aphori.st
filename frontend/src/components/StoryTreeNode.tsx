/*
 * Requirements:
 * - @use-gesture/react: For gesture handling
 * - framer-motion: For animations
 * - react: Core React functionality
 * - react-window-infinite-loader: For efficient sibling loading
 * - Proper null checking for node and node.storyTree?.id
 * - Safe handling of undefined siblings
 * - Proper state management for sibling navigation
 * - Gesture handling for sibling navigation
 * - Hooks must be called in the same order every render
 * - Use StoryTreeOperator for node fetching
 * - Markdown rendering support with GitHub-flavored markdown
 * - Text selection support for replies
 * - Selection persistence via DOM
 * - Selection handles
 * - Render story title if node is root
 * - Use ReplyContext for selection state
 * - Handle replies as siblings when appropriate
 * - Support reply-based navigation
 * - Support quote-based filtering of replies
 * - TypeScript support
 * - All React Hooks must be called unconditionally on every render
 * - Proper cleanup of subscriptions and event listeners
 * - Accessibility support for keyboard navigation
 * - Error boundaries for component failures
 * - Performance optimization with useMemo and useCallback
 * - Proper touch event handling for mobile devices
 * - Use useInfiniteNodes hook for infinite sibling fetching in non-quote mode
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import TextSelection from './TextSelection';
import { useReplyContext } from '../context/ReplyContext';
import InfiniteLoader from 'react-window-infinite-loader';
import useInfiniteNodes from '../hooks/useInfiniteNodes';
import { StoryTreeNode as IStoryTreeNode } from '../context/types';
import useSiblingNavigation from '../hooks/useSiblingNavigation';

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

function StoryTreeNode({
  parentId,
  node,
  onSiblingChange,
}: StoryTreeNodeProps) {
  // ─── HOOKS & STATE ─────────────────────────────────────────────

  // Determine whether we're in "quote/reply" mode (which uses different loading)
  const isQuoteMode = Boolean(node?.storyTree?.metadata?.quote);

  // For non-quote (sibling) mode we use our new infinite node fetching hook…
  const {
    items: siblings,
    loadMoreItems: fetchMoreSiblings,
    isItemLoaded: siblingIsLoaded,
    isLoading: siblingsLoading,
    error: siblingError,
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
                fetchedNode.storyTree.siblings = node.storyTree.nodes.filter(n => n?.id);
              }
              return fetchedNode;
            })
          );
          return loadedNodes.filter((n): n is IStoryTreeNode => n !== null);
        },
        node?.storyTree?.nodes ? (node.storyTree.nodes.length > 1) : false
      )
    : undefined;

  // For quote mode, we continue to manage siblings (replies) using existing state
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

  // Determine the set of siblings we'll use: hook-driven in sibling mode or our own state in quote mode.
  const siblingsToUse = isQuoteMode ? loadedSiblings : (siblings || []);

  const { state, dispatch } = useStoryTree();
  const { setReplyTarget, replyTarget, setSelectionState, selectionState, clearReplyState } =
    useReplyContext();
  const nodeRef = useRef<HTMLDivElement>(null);

  // Instead, use the new hook:
  const { currentSiblingIndex, loadNextSibling, loadPreviousSibling } = useSiblingNavigation<IStoryTreeNode>({
    node,
    siblings: siblingsToUse, // siblingsToUse is defined based on quote mode or infinite hook.
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

  // In quote mode, use the old loadMoreItems callback (which calls loadMoreReplies)
  const loadMoreItemsOld = useCallback(
    async (startIndex: number, stopIndex: number): Promise<void> => {
      if (!node?.storyTree?.id) return;

      console.log('Loading items (quote mode):', { node, startIndex, stopIndex });

      // In quote mode, load more replies if needed
      if (node?.storyTree?.metadata?.quote) {
        if (startIndex >= loadedSiblings.length && replyPage < replyPagination.totalPages) {
          await loadMoreReplies();
        }
        return;
      }
      // (Non-quote branch should not run here.)
    },
    [node, loadedSiblings.length, replyPage, replyPagination.totalPages]
  );

  // Function to load more replies (used only in quote mode)
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
        // Trigger a window resize so that any layout recalculations occur.
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
        enabled: Boolean(node?.storyTree?.id) &&
          (currentSiblingIndex > 0 ||
            (isQuoteMode ? currentSiblingIndex < replyPagination.numberOfRepliesToQuoteOfNode - 1 : true)),
      },
    }
  );

  // ─── SIDE EFFECTS ───────────────────────────────────────────────

  // Subscribe to reply submission; in quote mode we refresh replies,
  // in non-quote mode, we simply reset our infinite loader.
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

  // For quote mode: load reply siblings when replyPage changes.
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

  // For quote mode: initialize loadedSiblings with the first node.
  useEffect(() => {
    if (isQuoteMode) {
      if (!node?.storyTree?.id || loadedSiblings.length !== 0) return;
      console.log('Initializing loadedSiblings with first node');
      setLoadedSiblings([node]);
      loadMoreItemsOld(0, Math.min(2, node.storyTree.nodes.length - 1));
      window.dispatchEvent(new Event('resize'));
    }
  }, [node, loadedSiblings.length, loadMoreItemsOld, isQuoteMode]);

  // ─── EARLY VALIDATIONS ──────────────────────────────────────────
  if (!node?.storyTree?.id) {
    console.warn('StoryTreeNode received invalid node:', node);
    return null;
  }
  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeNode requires a valid operator with fetchNode method');
    return null;
  }

  // Determine if there are multiple siblings to allow swipe indicators.
  const hasSiblings = isQuoteMode
    ? replyPagination.numberOfRepliesToQuoteOfNode > 1
    : node?.storyTree?.nodes
    ? node.storyTree.nodes.length > 1
    : false;

  const renderQuote = (): React.ReactNode => {
    if (!siblingsToUse[currentSiblingIndex]?.storyTree?.metadata?.quote) return null;
    const { quote } = siblingsToUse[currentSiblingIndex].storyTree.metadata;
    return (
      <div className="story-tree-node-quote">
        {quote.text}
        <div className="story-tree-node-quote-source">
          Quoted from <a href={`/storyTree/${quote.sourcePostId}`}>original post</a>
        </div>
      </div>
    );
  };

  const renderError = () => {
    if (!replyError) return null;
    return <div className="reply-error">{replyError}</div>;
  };

  const renderContent = (): React.ReactNode => {
    if (!siblingsToUse[currentSiblingIndex]?.storyTree?.text) {
      console.warn('No text in currentSibling:', siblingsToUse[currentSiblingIndex]);
      return null;
    }
    return (
      <div className="story-tree-node-text">
        {renderQuote()}
        <TextSelection
          onSelectionCompleted={handleTextSelectionCompleted}
          selectAll={false}
          selectionState={isReplyTarget(siblingsToUse[currentSiblingIndex].storyTree.id) ? selectionState : null}
          quotes={node?.quoteReplyCounts || {}}
        >
          {siblingsToUse[currentSiblingIndex].storyTree.text}
        </TextSelection>
      </div>
    );
  };

  // Set up InfiniteLoader props conditionally based on quote mode.
  const infiniteLoaderProps = isQuoteMode
    ? {
        itemCount: replyPagination.numberOfRepliesToQuoteOfNode || 1,
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
            className={`story-tree-node-content ${hasSiblings ? 'has-siblings' : ''}`}
            id={siblingsToUse[currentSiblingIndex].storyTree.id}
            ref={ref}
          >
            {renderContent()}
            <div className="story-tree-node-footer">
              <div className="footer-left">
                <button
                  className="reply-button"
                  onClick={handleReplyButtonClick}
                  aria-label="Reply to this message"
                >
                  {isReplyTarget(siblingsToUse[currentSiblingIndex].storyTree.id) ? 'Cancel Reply' : 'Reply'}
                </button>
              </div>
              <div className="footer-right">{/* Sibling navigation indicators */}</div>
              {hasSiblings && (
                <div className="sibling-indicator">
                  {currentSiblingIndex + 1} /{' '}
                  {isQuoteMode
                    ? replyPagination.numberOfRepliesToQuoteOfNode || 1
                    : node.storyTree.nodes.length}
                  {(currentSiblingIndex > 0 || true) && (
                    <span className="swipe-hint">
                      {currentSiblingIndex > 0 && (
                        <span className="swipe-hint-previous" onClick={loadPreviousSibling}>
                          (Swipe right for previous)
                        </span>
                      )}
                      {(currentSiblingIndex > 0 && true) && ' |'}
                      <span className="swipe-hint-next" onClick={loadNextSibling}>
                        (Swipe left for next)
                      </span>
                    </span>
                  )}
                </div>
              )}
            </div>
            {renderError()}
          </div>
        )}
      </InfiniteLoader>
    </motion.div>
  );
}

export default StoryTreeNode; 