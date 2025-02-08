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
 */

import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import TextSelection from './TextSelection';
import { useReplyContext } from '../context/ReplyContext';
import InfiniteLoader from 'react-window-infinite-loader';
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

function StoryTreeNode({
  parentId,
  node,
  onSiblingChange,
}: StoryTreeNodeProps) {
  // ─── ALL HOOKS DECLARATIONS FIRST ───────────────────────────
  const [currentSiblingIndex, setCurrentSiblingIndex] = useState<number>(0);
  const [loadedSiblings, setLoadedSiblings] = useState<IStoryTreeNode[]>([]);
  const [isLoadingSibling, setIsLoadingSibling] = useState<boolean>(false);
  const [selectAll, setSelectAll] = useState<boolean>(false);
  const [isLoadingReplies, setIsLoadingReplies] = useState<boolean>(false);
  const [replyPage, setReplyPage] = useState<number>(1);
  const [replyPagination, setReplyPagination] = useState<ReplyPagination>({
    page: 1,
    limit: 10,
    numberOfRepliesToQuoteOfNode: 0,
    totalPages: 0
  });
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState<boolean>(false);
  const [replyError, setReplyError] = useState<string | null>(null);

  const { state, dispatch } = useStoryTree();
  const { setReplyTarget, replyTarget, setSelectionState, selectionState, clearReplyState } = useReplyContext();
  const nodeRef = useRef<HTMLDivElement>(null);
  
  // Define these variables before they are used in callbacks
  const isReplyTarget = (id: string): boolean => replyTarget?.id === id;
  const currentSibling: IStoryTreeNode = loadedSiblings[currentSiblingIndex] || node;

  // Move all useCallback definitions here, before any conditional logic
  const loadMoreReplies = useCallback(async (): Promise<void> => {
    if (!node?.storyTree?.id || isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;
    setIsLoadingMoreReplies(true);
    try {
      setReplyPage(prev => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [replyPage, replyPagination.totalPages, isLoadingMoreReplies, node?.storyTree?.id]);

  const loadMoreItems = useCallback(async (startIndex: number, stopIndex: number): Promise<void> => {
    if (!node?.storyTree?.id) return;
    
    console.log('Loading items:', { node, startIndex, stopIndex });
    
    if (node?.storyTree?.metadata?.quote) {
      if (startIndex >= loadedSiblings.length && replyPage < replyPagination.totalPages) {
        await loadMoreReplies();
      }
      return;
    }
    
    setIsLoadingSibling(true);
    try {
      const itemsToLoad = node.storyTree.nodes.slice(startIndex, stopIndex + 1);
      console.log('Items to load:', itemsToLoad);

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

      const validNodes = loadedNodes.filter((node): node is IStoryTreeNode => node !== null);
      setLoadedSiblings(prev => {
        const newSiblings = [...prev];
        validNodes.forEach((loadedNode, idx) => {
          if (loadedNode) {
            newSiblings[startIndex + idx] = loadedNode;
          }
        });
        return newSiblings;
      });
    } catch (error) {
      console.error('Error loading siblings:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [node, replyPage, replyPagination.totalPages, loadedSiblings.length, loadMoreReplies]);

  const isItemLoaded = useCallback((index: number): boolean => {
    return Boolean(loadedSiblings[index]);
  }, [loadedSiblings]);

  const loadNextSibling = useCallback(async (): Promise<void> => {
    if (!node?.storyTree?.id || isLoadingSibling || isLoadingReplies) return;
    
    const nextIndex = currentSiblingIndex + 1;
    if (nextIndex >= loadedSiblings.length) {
      setIsLoadingSibling(true);
      try {
        // Load more siblings if needed
        await loadMoreItems(nextIndex, nextIndex + 2);
      } finally {
        setIsLoadingSibling(false);
      }
    }
    
    setCurrentSiblingIndex(nextIndex);
    if (onSiblingChange && loadedSiblings[nextIndex]) {
      onSiblingChange(loadedSiblings[nextIndex]);
    }
  }, [node?.storyTree?.id, currentSiblingIndex, loadedSiblings, loadMoreItems, onSiblingChange, isLoadingSibling, isLoadingReplies]);

  const loadPreviousSibling = useCallback(async (): Promise<void> => {
    if (!node?.storyTree?.id || currentSiblingIndex <= 0 || isLoadingSibling || isLoadingReplies) return;
    
    const prevIndex = currentSiblingIndex - 1;
    setCurrentSiblingIndex(prevIndex);
    if (onSiblingChange && loadedSiblings[prevIndex]) {
      onSiblingChange(loadedSiblings[prevIndex]);
    }
  }, [node?.storyTree?.id, currentSiblingIndex, loadedSiblings, onSiblingChange, isLoadingSibling, isLoadingReplies]);

  const handleTextSelectionCompleted = useCallback((selection: SelectionState): void => {
    if (!node?.storyTree?.id) {
      setReplyError('Invalid node for reply');
      return;
    }

    try {
      setSelectAll(false);
      setReplyTarget(currentSibling);
      setSelectionState(selection);
      setReplyError(null);
    } catch (error) {
      setReplyError('Failed to set reply target');
      console.error('Selection error:', error);
    }
  }, [currentSibling, setReplyTarget, setSelectionState, setReplyError, node?.storyTree?.id]);

  const handleReplyButtonClick = useCallback((): void => {
    if (!currentSibling?.storyTree?.id) {
      setReplyError('Invalid node for reply');
      return;
    }

    try {
      if (isReplyTarget(currentSibling.storyTree.id)) {
        clearReplyState();
      } else {
        setReplyTarget(currentSibling);
        setSelectionState({
          start: 0,
          end: currentSibling.storyTree.text.length
        });
        setSelectAll(true);
        setReplyError(null);

        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError('Failed to handle reply action');
      console.error('Reply error:', error);
    }
  }, [currentSibling, clearReplyState, setReplyTarget, setSelectionState, isReplyTarget]);

  // Move useGesture before any conditional returns
  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
      if (!node?.storyTree?.id) return;
      if (!down) {
        if (mx < -100 || (vx < -0.5 && mx < -50)) {
          loadNextSibling();
          cancel();
        }
        else if (mx > 100 || (vx > 0.5 && mx > 50)) {
          loadPreviousSibling();
          cancel();
        }
      }
    },
  }, {
    drag: {
      axis: 'x',
      enabled: Boolean(node?.storyTree?.id) && (currentSiblingIndex > 0 || (node?.storyTree?.metadata?.quote ? currentSiblingIndex < loadedSiblings.length - 1 : true))
    },
  });

  // Move all useEffect declarations here
  useEffect(() => {
    if (!node?.storyTree?.id) return;
    const refreshSiblings = async () => {
      if (node?.storyTree?.metadata?.quote) {
        // Refresh replies
        const response = await storyTreeOperator.fetchReplies(
          node.storyTree.metadata.quote.sourcePostId,
          node.storyTree.metadata.quote.text,
          'mostRecent',
          1  // Reset to first page
        );
        
        if (response?.replies && response?.pagination) {
          setLoadedSiblings(response.replies);
          setReplyPagination(response.pagination);
          setReplyPage(1);
        }
      } else {
        // Refresh regular siblings
        setLoadedSiblings([]);  // Clear existing
        const startIndex = 0;
        const stopIndex = 2;  // Load first few siblings
        await loadMoreItems(startIndex, stopIndex);
      }
    };

    const parentId = node?.storyTree?.parentId?.[0] || node?.storyTree?.id;
    const unsubscribe = storyTreeOperator.subscribeToReplySubmission(parentId, refreshSiblings);
    
    return () => unsubscribe();
  }, [node?.storyTree?.id, node?.storyTree?.parentId, node?.storyTree?.metadata?.quote, loadMoreItems]);

  useEffect(() => {
    if (!node?.storyTree?.id) return;
    storyTreeOperator.updateContext(state, dispatch);
  }, [state, dispatch, node?.storyTree?.id]);

  useEffect(() => {
    if (!node?.storyTree?.id) return;
    const loadReplySiblings = async () => {
      setIsLoadingReplies(true);
      try {
        let response;
        if (!node?.storyTree?.metadata?.quote) {
          // some nodes may not have a quote. When that is the case, we load the siblings based on the entire parent node text as the quote
          response = await storyTreeOperator.fetchReplies(
            node.storyTree.parentId[0],
            node.storyTree.text,
            'mostRecent',
            replyPage
          );
        } else {
          response = await storyTreeOperator.fetchReplies(
            node.storyTree.metadata.quote.sourcePostId,
            node.storyTree.metadata.quote.text,
            'mostRecent',
            replyPage
          );
        }

        if (response?.replies && response?.pagination) {
          setLoadedSiblings(prev =>  
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
  }, [node, replyPage]);

  useEffect(() => {
    if (!node?.storyTree?.id || loadedSiblings.length !== 0) return;
    console.log('Initializing loadedSiblings with first node');
    setLoadedSiblings([node]);
    loadMoreItems(0, Math.min(2, node.storyTree.nodes.length - 1));
    
    // Force a resize event after siblings are loaded
    window.dispatchEvent(new Event('resize'));
  }, [node, loadedSiblings.length, loadMoreItems]);

  // ─── EARLY VALIDATIONS AFTER ALL HOOKS ARE CALLED ─────────────────────────
  if (!node?.storyTree?.id) {
    console.warn('StoryTreeNode received invalid node:', node);
    return null;
  }
  
  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeNode requires a valid operator with fetchNode method');
    return null;
  }

  const hasSiblings = node?.storyTree?.metadata?.quote 
    ? replyPagination.numberOfRepliesToQuoteOfNode > 1 
    : loadedSiblings.length > 1;
    
  const hasNextSibling = node?.storyTree?.metadata?.quote
    ? currentSiblingIndex < replyPagination.numberOfRepliesToQuoteOfNode - 1
    : true;
    
  const hasPreviousSibling = currentSiblingIndex > 0;

  const renderQuote = (): React.ReactNode => {
    if (!currentSibling?.storyTree?.metadata?.quote) return null;

    const { quote } = currentSibling.storyTree.metadata;
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
    if (!currentSibling?.storyTree?.text) {
      console.warn('No text in currentSibling:', currentSibling);
      return null;
    }
    return (
      <div className="story-tree-node-text">
        {renderQuote()} 
        <TextSelection 
          onSelectionCompleted={handleTextSelectionCompleted}
          selectAll={selectAll}
          selectionState={isReplyTarget(currentSibling.storyTree.id) ? selectionState : null}
          quotes={node?.quoteReplyCounts || {}}
        >
          {currentSibling.storyTree.text}
        </TextSelection>
      </div>
    );
  };

  const renderSiblingIndicator = (): React.ReactNode => {
    const total = replyPagination.numberOfRepliesToQuoteOfNode || 1;

    return total > 1 ? (
      <div className="sibling-indicator">
        {currentSiblingIndex + 1} / {total}
        {(hasNextSibling || hasPreviousSibling) && (
          <span className="swipe-hint">
            {hasPreviousSibling && (
              <span 
                className="swipe-hint-previous" 
                onClick={loadPreviousSibling}
              >
                (Swipe right for previous)
              </span>
            )}
            {hasPreviousSibling && hasNextSibling && ' |'}
            {hasNextSibling && (
              <span 
                className="swipe-hint-next" 
                onClick={loadNextSibling}
              >
                (Swipe left for next)
              </span>
            )}
          </span>
        )}
      </div>
    ) : null;
  };

  return (
    <motion.div
      className={`story-tree-node ${isReplyTarget(currentSibling.storyTree.id) ? 'reply-target' : ''} ${
        isLoadingSibling || isLoadingReplies ? 'loading' : ''
      }`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      ref={nodeRef}
    >
      <InfiniteLoader
        isItemLoaded={isItemLoaded}
        itemCount={replyPagination.numberOfRepliesToQuoteOfNode || 1}
        loadMoreItems={loadMoreItems}
        minimumBatchSize={3}
        threshold={2}
      >
        {({ onItemsRendered, ref }) => (
          <div 
            {...bind()} 
            className={`story-tree-node-content ${hasSiblings ? 'has-siblings' : ''}`}
            id={currentSibling.storyTree.id}
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
                  {isReplyTarget(currentSibling.storyTree.id) ? 'Cancel Reply' : 'Reply'}
                </button>
              </div>
              <div className="footer-right">
                {renderSiblingIndicator()}
              </div>
            </div>
            {renderError()}
          </div>
        )}
      </InfiniteLoader>
    </motion.div>
  );
}

export default StoryTreeNode; 