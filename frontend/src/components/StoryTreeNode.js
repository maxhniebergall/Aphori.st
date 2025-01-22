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
 */

function StoryTreeNode({
  postRootId, 
  node, 
  siblings, 
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

  // Replace the loadInitialSiblings effect with InfiniteLoader logic
  const isItemLoaded = useCallback(index => {
    return loadedSiblings[index] != null;
  }, [loadedSiblings]);

  const loadMoreItems = useCallback(async (startIndex, stopIndex) => {
    if (!Array.isArray(siblings)) return;
    
    setIsLoadingSibling(true);
    try {
      const itemsToLoad = siblings.slice(startIndex, stopIndex + 1);
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
  }, [siblings, node]);

  // Define currentSibling based on loadedSiblings
  const currentSibling = loadedSiblings[currentSiblingIndex] || node;

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
    if (Array.isArray(siblings) && node?.id) {
      const index = siblings.findIndex(sibling => sibling?.id === node.id);
      setCurrentSiblingIndex(index !== -1 ? index : 0);
    }
  }, [node?.id, siblings]);

  const loadNextSibling = useCallback(async () => {
    if (isLoadingSibling || !siblings || currentSiblingIndex >= siblings.length - 1) return;
    
    setIsLoadingSibling(true);
    try {
      const nextSibling = siblings[currentSiblingIndex + 1];
      if (!nextSibling?.id) {
        console.warn('Invalid next sibling:', nextSibling);
        return;
      }
      
      const nextNode = await storyTreeOperator.fetchNode(nextSibling.id);
      if (nextNode) {
        nextNode.siblings = siblings; // Preserve siblings information
        setLoadedSiblings(prev => [...prev, nextNode]);
        setCurrentSiblingIndex(prev => prev + 1);
        onSiblingChange?.(nextNode);
      }
    } catch (error) {
      console.error('Error loading sibling:', error);
    } finally {
      setIsLoadingSibling(false);
    }
  }, [siblings, currentSiblingIndex, isLoadingSibling, onSiblingChange]);

  const loadPreviousSibling = useCallback(async () => {
    if (isLoadingSibling || !siblings || currentSiblingIndex <= 0) {
      console.log('Cannot go back: at first sibling or loading');
      return;
    }

    setIsLoadingSibling(true);
    try {
      const previousSibling = siblings[currentSiblingIndex - 1];
      if (!previousSibling?.id) {
        console.warn('Invalid previous sibling:', previousSibling);
        return;
      }

      const previousNode = await storyTreeOperator.fetchNode(previousSibling.id);
      if (previousNode) {
        previousNode.siblings = siblings;
        
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
  }, [currentSiblingIndex, siblings, isLoadingSibling, onSiblingChange]);

  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
      if (!down) {
        // Swipe left to see next sibling (negative movement)
        if ((mx < -100 || (vx < -0.5 && mx < -50)) && siblings && currentSiblingIndex < siblings.length - 1) {
          loadNextSibling();
          cancel();
        }
        // Swipe right to see previous sibling (positive movement)
        else if ((mx > 100 || (vx > 0.5 && mx > 50)) && currentSiblingIndex > 0) {
          loadPreviousSibling();
          cancel();
        }
      }
    },
  }, {
    drag: {
      axis: 'x',
      enabled: siblings && (currentSiblingIndex > 0 || currentSiblingIndex < siblings.length - 1)
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

  const hasSiblings = siblings && siblings.length > 1;
  const hasNextSibling = siblings && currentSiblingIndex < siblings.length - 1;
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
        itemCount={siblings?.length || 1}
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
                    {currentSiblingIndex + 1} / {siblings.length}
                    {(hasNextSibling || hasPreviousSibling) && (
                      <span className="swipe-hint">
                        {hasPreviousSibling && <span className="swipe-hint-previous" onClick={loadPreviousSibling}> (Swipe right for previous)</span>}
                        {hasPreviousSibling && hasNextSibling && ' |'}
                        {hasNextSibling && <span className="swipe-hint-next" onClick={loadNextSibling}>   (Swipe left for next)</span>}
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