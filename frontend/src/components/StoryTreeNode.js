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
 */

function StoryTreeNode({
  postRootId, 
  node, 
  onSiblingChange,
}) {
  // 1. All useState declarations
  const [currentSiblingIndex, setCurrentSiblingIndex] = useState(0);
  const [loadedSiblings, setLoadedSiblings] = useState([]);
  const [isLoadingSibling, setIsLoadingSibling] = useState(false);
  const [selectAll, setSelectAll] = useState(false);
  const [isLoadingReplies, setIsLoadingReplies] = useState(false);
  const [replyPage, setReplyPage] = useState(1);
  const [replyPagination, setReplyPagination] = useState({
    page: 1,
    limit: 10,
    totalItems: 0,
    totalPages: 0
  });
  const [isLoadingMoreReplies, setIsLoadingMoreReplies] = useState(false);

  // 2. All useContext and useRef
  const { state, dispatch } = useStoryTree();
  const { setReplyTarget, replyTarget, setSelectionState, selectionState } = useReplyContext();
  const nodeRef = useRef(null);
  const isReplyTarget = replyTarget?.id === node?.storyTree?.id;

  // Update currentSibling definition to use only loadedSiblings
  const currentSibling = loadedSiblings[currentSiblingIndex] || node;
  console.log('Current sibling:', { 
    currentSibling, 
    loadedSiblings,
    currentSiblingIndex,
    hasSiblings: node?.storyTree?.nodes?.length > 0 
  });

  // 3. First define loadMoreReplies since it's used in loadMoreItems
  const loadMoreReplies = useCallback(async () => {
    if (isLoadingMoreReplies || replyPage >= replyPagination.totalPages) return;

    setIsLoadingMoreReplies(true);
    try {
      setReplyPage(prev => prev + 1);
    } finally {
      setIsLoadingMoreReplies(false);
    }
  }, [replyPage, replyPagination.totalPages, isLoadingMoreReplies]);

  // Now we can define loadMoreItems which uses loadMoreReplies
  const loadMoreItems = useCallback(async (startIndex, stopIndex) => {
    console.log('Loading items:', { node, startIndex, stopIndex });
    
    if (node?.storyTree?.metadata?.quote) {
      if (startIndex >= loadedSiblings.length && replyPage < replyPagination.totalPages) {
        await loadMoreReplies();
      }
      return;
    }

    if (!Array.isArray(node?.storyTree?.nodes)) {
      console.warn('No nodes array:', node?.storyTree);
      return;
    }
    
    setIsLoadingSibling(true);
    try {
      const itemsToLoad = node.storyTree.nodes.slice(startIndex, stopIndex + 1);
      console.log('Items to load:', itemsToLoad);

      const loadedNodes = await Promise.all(
        itemsToLoad.map(async (sibling) => {
          if (!sibling?.id) {
            console.warn('Invalid sibling node:', sibling);
            return null;
          }
          if (sibling.id === node.storyTree.id) return node;
          const fetchedNode = await storyTreeOperator.fetchNode(sibling.id);
          if (fetchedNode) {
            fetchedNode.storyTree.siblings = node.storyTree.nodes.filter(n => n?.id);
          }
          return fetchedNode;
        })
      );

      const validNodes = loadedNodes.filter(node => node !== null);
      console.log('Loaded valid nodes:', validNodes);

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

  const isItemLoaded = useCallback(index => {
    return loadedSiblings[index] != null;
  }, [loadedSiblings]);

  const loadNextSibling = useCallback(async () => {
    if (isLoadingSibling || isLoadingReplies) return;

    if (node?.storyTree?.metadata?.quote) {
      if (currentSiblingIndex >= loadedSiblings.length - 1) return;
      
      setCurrentSiblingIndex(prev => prev + 1);
      onSiblingChange?.(loadedSiblings[currentSiblingIndex + 1]);
      return;
    }

    // Load next sibling through operator
    setIsLoadingSibling(true);
    try {
      const nextIndex = currentSiblingIndex + 1;
      if (nextIndex >= node.storyTree.nodes.length) {
        console.log('No more siblings to load');
        return;
      }

      const nextNodeId = node.storyTree.nodes[nextIndex]?.id;
      if (!nextNodeId) {
        console.warn('Invalid next node ID');
        return;
      }

      const nextNode = await storyTreeOperator.fetchNode(nextNodeId);
      if (nextNode) {
        nextNode.storyTree.siblings = node.storyTree.nodes.filter(n => n?.id);
        setLoadedSiblings(prev => {
          const newSiblings = [...prev];
          newSiblings[nextIndex] = nextNode;
          return newSiblings;
        });
        setCurrentSiblingIndex(nextIndex);
        onSiblingChange?.(nextNode);
      }
    } catch (error) {
      console.error('Error loading sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [currentSiblingIndex, isLoadingSibling, isLoadingReplies, node?.storyTree?.metadata?.quote, node?.storyTree?.nodes, loadedSiblings, onSiblingChange]);

  const loadPreviousSibling = useCallback(async () => {
    if (isLoadingSibling || isLoadingReplies) return;

    if (currentSiblingIndex <= 0) {
      console.log('Cannot go back: at first sibling or loading');
      return;
    }

    if (node?.storyTree?.metadata?.quote) {
      // For replies, we already have all siblings loaded
      setCurrentSiblingIndex(prev => prev - 1);
      onSiblingChange?.(loadedSiblings[currentSiblingIndex - 1]);
      return;
    }

    // Load previous sibling through operator
    setIsLoadingSibling(true);
    try {
      const previousNode = await storyTreeOperator.fetchPreviousSibling(node.storyTree.id);
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
  }, [currentSiblingIndex, isLoadingSibling, isLoadingReplies, node?.storyTree?.metadata?.quote, node?.storyTree?.id, loadedSiblings, onSiblingChange]);

  const handleTextSelectionCompleted = useCallback((selection) => {
    setSelectAll(false);
    setReplyTarget(currentSibling);
    setSelectionState(selection);
  }, [currentSibling, setReplyTarget, setSelectionState]);

  // 4. All useEffect declarations - BEFORE any conditional returns
  useEffect(() => {
    const refreshSiblings = async () => {
      if (!node?.storyTree?.id) return;
      
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
    storyTreeOperator.updateContext(state, dispatch);
  }, [state, dispatch]);

  useEffect(() => {
    if (Array.isArray(node?.storyTree?.nodes) && node?.storyTree?.id) {
      const index = node.storyTree.nodes.findIndex(sibling => sibling?.id === node.storyTree.id);
      setCurrentSiblingIndex(index !== -1 ? index : 0);
    }
  }, [node?.storyTree?.id, node?.storyTree?.nodes]);

  // Reply loading effect
  useEffect(() => {
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

  // Add effect to initialize loadedSiblings
  useEffect(() => {
    if (node?.storyTree?.nodes?.length > 0 && loadedSiblings.length === 0) {
      console.log('Initializing loadedSiblings with first node');
      setLoadedSiblings([node]);
      loadMoreItems(0, Math.min(2, node.storyTree.nodes.length - 1));
      
      // Force a resize event after siblings are loaded
      window.dispatchEvent(new Event('resize'));
    }
  }, [node, loadedSiblings.length, loadMoreItems]);

  // 5. useGesture declaration
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
      enabled: currentSiblingIndex > 0 || (node?.storyTree?.metadata?.quote ? currentSiblingIndex < loadedSiblings.length - 1 : true)
    },
  });

  // Now we can have our validation checks
  if (!node?.storyTree?.id) {
    console.warn('StoryTreeNode received invalid node:', node);
    return null;
  }

  if (!storyTreeOperator?.fetchNode) {
    console.error('StoryTreeNode requires a valid operator with fetchNode method');
    return null;
  }

  // Update sibling indicators
  const hasSiblings = node?.storyTree?.metadata?.quote 
    ? replyPagination.totalItems > 1 
    : loadedSiblings.length > 1;
    
  const hasNextSibling = node?.storyTree?.metadata?.quote
    ? currentSiblingIndex < replyPagination.totalItems - 1
    : true;
    
  const hasPreviousSibling = currentSiblingIndex > 0;
  const isRootNode = node?.storyTree?.id === postRootId;

  const renderQuote = () => {
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

  const handleReplyButtonClick = () => {
    if (isReplyTarget) {
      setReplyTarget(null);
      setSelectionState(null);
      setSelectAll(false);
    } else {
      setReplyTarget(currentSibling);
      setSelectionState({
        start: 0,
        end: currentSibling.storyTree.text.length
      });
      setSelectAll(true);
    }
  };

  const renderContent = () => {
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
          selectionState={isReplyTarget ? selectionState : null}
          quotes={node?.quoteReplyCounts || {}}
        >
          {currentSibling.storyTree.text}
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
        itemCount={node?.storyTree?.nodes?.length || 1}
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
                  {isReplyTarget ? 'Cancel Reply' : 'Reply'}
                </button>
              </div>
              <div className="footer-right">
                {node?.storyTree?.nodes?.length > 0 && (
                  <div className="sibling-indicator">
                    {currentSiblingIndex + 1} / {node.storyTree.nodes.length}
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