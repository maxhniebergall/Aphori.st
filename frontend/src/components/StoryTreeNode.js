import React, { useState, useCallback, useEffect, useRef } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion } from 'framer-motion';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { useStoryTree } from '../context/StoryTreeContext';
import TextSelection from './TextSelection';
import { useReplyContext } from '../context/ReplyContext';
import InfiniteLoader from 'react-window-infinite-loader';

/*
 * Requirements:
 * - @use-gesture/react: For gesture handling
 * - framer-motion: For animations
 * - react: Core React functionality
 * - react-window-infinite-loader: For efficient sibling loading
 * - Proper null checking for node and node.id
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
 */

function StoryTreeNode({
  postRootId, 
  node, 
  onSiblingChange,
}) {
  console.log('StoryTreeNode rendering:', { 
    nodeId: node?.id });

  const [currentSiblingIndex, setCurrentSiblingIndex] = useState(0);
  const [loadedSiblings, setLoadedSiblings] = useState([]);
  const [isLoadingSibling, setIsLoadingSibling] = useState(false);
  const { state, dispatch } = useStoryTree();
  const [selectAll, setSelectAll] = useState(false);
  const nodeRef = useRef(null);
  const { setReplyTarget, replyTarget, setSelectionState, selectionState } = useReplyContext();
  const isReplyTarget = replyTarget?.id === node?.id;

  // Update to use replies for siblings when appropriate
  const [replySiblings, setReplySiblings] = useState([]);
  const [isLoadingReplies, setIsLoadingReplies] = useState(false);

  const [replyPage, setReplyPage] = useState(1);
  const [replyPagination, setReplyPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 0
  });
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState(false);

  // Update reply loading to handle pagination
  useEffect(() => {
    const loadReplySiblings = async () => {
      if (!node?.metadata?.quote) return;

      setIsLoadingReplies(true);
      try {
        const response = await storyTreeOperator.fetchReplies(
          node.metadata.quote.sourcePostId,
          node.metadata.quote.text,
          'mostRecent',
          replyPage
        );

        if (response?.replies && response?.pagination) {
          setReplySiblings(prev => 
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
  }, [node?.metadata?.quote, replyPage]);

  // Add function to load more replies
  const loadMoreReplies = useCallback(async () => {
    if (isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;

    setIsLoadingMoreReplies(true);
    try {
      setReplyPage(prev => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [replyPage, replyPagination.totalPages, isLoadingMoreReplies]);

  // Update isItemLoaded for paginated replies
  const isItemLoaded = useCallback(index => {
    if (node?.metadata?.quote) {
      return index < replySiblings.length;
    }
    return loadedSiblings[index] != null;
  }, [loadedSiblings, replySiblings, node?.metadata?.quote]);

  // Update loadMoreItems to handle reply pagination
  const loadMoreItems = useCallback(async (startIndex, stopIndex) => {
    if (node?.metadata?.quote) {
      if (startIndex >= replySiblings.length && replyPage < replyPagination.totalPages) {
        await loadMoreReplies();
      }
      return;
    }

    if (!Array.isArray(node.siblings)) return;
    
    setIsLoadingSibling(true);
    try {
      const itemsToLoad = node.siblings.slice(startIndex, stopIndex + 1);
      const loadedNodes = await Promise.all(
        itemsToLoad.map(async (sibling) => {
          if (sibling.id === node.id) return node;
          return await storyTreeOperator.fetchNode(sibling.id);
        })
      );

      setLoadedSiblings(prev => {
        const newSiblings = [...prev];
        loadedNodes.forEach((loadedNode, idx) => {
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
  }, [node.siblings, node, loadMoreReplies, replySiblings.length, replyPage, replyPagination.totalPages]);

  // Update currentSibling to handle both types
  const currentSibling = node?.metadata?.quote 
    ? replySiblings[currentSiblingIndex] || node
    : loadedSiblings[currentSiblingIndex] || node;

  // Now we can use currentSibling in our hook
  const handleTextSelectionCompleted = useCallback((selection) => {
    setSelectAll(false);
    setReplyTarget(currentSibling);
    setSelectionState(selection);
  }, [currentSibling, setReplyTarget, setSelectionState]);

  // Update the operator's context whenever state or dispatch changes
  useEffect(() => {
    storyTreeOperator.updateContext(state, dispatch);
  }, [state, dispatch]);

  // Find the current index in siblings array
  useEffect(() => {
    if (Array.isArray(node.siblings) && node?.id) {
      const index = node.siblings.findIndex(sibling => sibling?.id === node.id);
      setCurrentSiblingIndex(index !== -1 ? index : 0);
    }
  }, [node?.id, node.siblings]);

  const loadNextSibling = useCallback(async () => {
    if (isLoadingSibling || isLoadingReplies) return;

    if (node?.metadata?.quote) {
      if (currentSiblingIndex >= replySiblings.length - 1) return;
      
      setCurrentSiblingIndex(prev => prev + 1);
      onSiblingChange?.(replySiblings[currentSiblingIndex + 1]);
      return;
    }

    // Load next sibling through operator
    setIsLoadingSibling(true);
    try {
      const nextNode = await storyTreeOperator.fetchNextSibling(node.id);
      if (nextNode) {
        setLoadedSiblings(prev => [...prev, nextNode]);
        setCurrentSiblingIndex(prev => prev + 1);
        onSiblingChange?.(nextNode);
      }
    } catch (error) {
      console.error('Error loading sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [currentSiblingIndex, isLoadingSibling, isLoadingReplies, node?.metadata?.quote, node?.id, replySiblings, onSiblingChange]);

  // Update loadPreviousSibling similarly
  const loadPreviousSibling = useCallback(async () => {
    if (isLoadingSibling || isLoadingReplies) return;

    if (currentSiblingIndex <= 0) {
      console.log('Cannot go back: at first sibling or loading');
      return;
    }

    if (node?.metadata?.quote) {
      // For replies, we already have all siblings loaded
      setCurrentSiblingIndex(prev => prev - 1);
      onSiblingChange?.(replySiblings[currentSiblingIndex - 1]);
      return;
    }

    // Load previous sibling through operator
    setIsLoadingSibling(true);
    try {
      const previousNode = await storyTreeOperator.fetchPreviousSibling(node.id);
      if (previousNode) {
        setLoadedSiblings(prev => {
          const newLoadedSiblings = [...prev];
          newLoadedSiblings[currentSiblingIndex - 1] = previousNode;
          return newLoadedSiblings;
        });
        
        setCurrentSiblingIndex(prev => prev - 1);
        onSiblingChange?.(previousNode);
      }
    } catch (error) {
      console.error('Error loading previous sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [currentSiblingIndex, isLoadingSibling, isLoadingReplies, node?.metadata?.quote, node?.id, replySiblings, onSiblingChange]);

  // Update bind gesture to not rely on siblings prop
  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
      if (!down) {
        // Swipe left to see next sibling (negative movement)
        if (mx < -100 || (vx < -0.5 && mx < -50)) {
          loadNextSibling();
          cancel();
        }
        // Swipe right to see previous sibling (positive movement)
        else if (mx > 100 || (vx > 0.5 && mx > 50)) {
          loadPreviousSibling();
          cancel();
        }
      }
    },
  }, {
    drag: {
      axis: 'x',
      enabled: currentSiblingIndex > 0 || (node?.metadata?.quote ? currentSiblingIndex < replySiblings.length - 1 : true)
    },
  });

  // Early return if node is not properly defined
  if (!node?.id) {
    console.warn('StoryTreeNode received invalid node:', node);
    return null;
  }

  // Early return if operator is not provided
  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeNode requires a valid operator with fetchNode method');
    return null;
  }

  // Update sibling indicators
  const hasSiblings = node?.metadata?.quote 
    ? replyPagination.totalItems > 1 
    : loadedSiblings.length > 1;
    
  const hasNextSibling = node?.metadata?.quote
    ? currentSiblingIndex < replyPagination.totalItems - 1
    : true; // We won't know until we try to fetch the next sibling
    
  const hasPreviousSibling = currentSiblingIndex > 0;
  const isRootNode = node?.id === postRootId;

  const renderQuote = () => {
    if (!currentSibling?.metadata?.quote) return null;

    const { quote } = currentSibling.metadata;
    return (
      <div className="story-tree-node-quote">
        {quote.text}
        <div className="story-tree-node-quote-source">
          Quoted from <a href={`/storyTree/${quote.sourcePostId}`}>original post</a>
        </div>
      </div>
    );
  };

  const handleReplyButtonClick = () => {
    if (isReplyTarget) {
      setReplyTarget(null);
      setSelectionState(null);
      setSelectAll(false);
    } else {
      setReplyTarget(currentSibling);
      setSelectionState({
        start: 0,
        end: currentSibling.text.length
      });
      setSelectAll(true);
    }
  };

  const renderContent = () => {
    if (!currentSibling?.text) {
      return null;
    }
    return (
      <div className="story-tree-node-text">
        {renderQuote()} 
        <TextSelection 
          onSelectionCompleted={handleTextSelectionCompleted}
          selectAll={selectAll}
          selectionState={isReplyTarget ? selectionState : null}
        >
          {currentSibling.text}
        </TextSelection>
      </div>
    );
  };

  return (
    <motion.div
      className={`story-tree-node ${isReplyTarget ? 'reply-target' : ''}`}
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.2 }}
      ref={nodeRef}
    >
      <InfiniteLoader
        isItemLoaded={isItemLoaded}
        itemCount={node?.metadata?.quote ? replyPagination.totalItems : (node.siblings?.length || 1)}
        loadMoreItems={loadMoreItems}
        minimumBatchSize={3}
        threshold={2}
      >
        {({ onItemsRendered, ref }) => (
          <div 
            {...bind()} 
            className={`story-tree-node-content ${hasSiblings ? 'has-siblings' : ''}`}
            id={currentSibling.id}
            ref={ref}
          >
            {isRootNode && currentSibling?.metadata?.title && (
              <div className="story-title-section">
                <h1>{currentSibling.metadata.title}</h1>
                {currentSibling.metadata.author && <h2 className="story-subtitle">by {currentSibling.metadata.author}</h2>}
              </div>
            )}
            {renderContent()}
            <div className="story-tree-node-footer">
              <div className="footer-left">
                <button 
                  className="reply-button"
                  onClick={handleReplyButtonClick}
                  aria-label="Reply to this message"
                >
                  {isReplyTarget ? 'Cancel Reply' : 'Reply'}
                </button>
              </div>
              <div className="footer-right">
                {hasSiblings && (
                  <div className="sibling-indicator">
                    {currentSiblingIndex + 1} / {node?.metadata?.quote ? replyPagination.totalItems : node.siblings.length}
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
                    {node?.metadata?.quote && replyPage < replyPagination.totalPages && (
                      <div className="load-more-replies">
                        <button 
                          onClick={loadMoreReplies}
                          disabled={isLoadingMoreReplies}
                        >
                          {isLoadingMoreReplies ? 'Loading...' : 'Load More Replies'}
                        </button>
                      </div>
                    )}
                  </div>
                )}
              </div>
            </div>
          </div>
        )}
      </InfiniteLoader>
    </motion.div>
  );
}

export default StoryTreeNode; 