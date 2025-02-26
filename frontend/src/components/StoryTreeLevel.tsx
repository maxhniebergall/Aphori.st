/**
 * Requirements:
 * - Display the current sibling node for a given level
 * - Support horizontal swipe gestures between siblings
 * - Maintain pagination for loading more siblings
 * - Preserve reply mode functionality
 * - Support node selection and quote selection
 * - Communicate height changes to parent components for proper virtualization
 */

import React, { useState, useCallback, useMemo, useRef, useEffect } from 'react';
import { useGesture } from '@use-gesture/react';
import { motion, AnimatePresence } from 'framer-motion';
import { useReplyContext } from '../context/ReplyContext';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { StoryTreeLevel as LevelData, StoryTreeNode, Pagination } from '../types/types';
import { Quote } from '../types/quote';
import storyTreeOperator from '../operators/StoryTreeOperator';

interface StoryTreeLevelProps {
  levelData: LevelData;
  reportHeight?: (height: number) => void;
}

export const StoryTreeLevelComponent: React.FC<StoryTreeLevelProps> = ({ 
  levelData,
  reportHeight 
}) => {
  // Core state
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [currentNode, setCurrentNode] = useState<StoryTreeNode | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  
  // Pagination state - directly use the Pagination type from our types
  const [pagination, setPagination] = useState<Pagination>(levelData.pagination);
  
  // Destructure all needed properties from ReplyContext
  const { 
    setReplyTarget, 
    replyTarget, 
    setReplyQuote, 
    replyQuote, 
    clearReplyState,
    replyError,
    setReplyError,
    isReplyOpen,
    setIsReplyOpen,
    isReplyActive
  } = useReplyContext();

  // Report height to parent virtualized list when container size changes
  useEffect(() => {
    if (containerRef.current && reportHeight) {
      const resizeObserver = new ResizeObserver((entries) => {
        for (const entry of entries) {
          reportHeight(entry.contentRect.height);
        }
      });
      
      resizeObserver.observe(containerRef.current);
      return () => resizeObserver.disconnect();
    }
  }, [reportHeight]);

  // Calculate dimensions based on viewport
  const dimensions = useMemo(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    return {
      height: Math.max(viewportHeight * 0.8, 400), 
      width: Math.max(viewportWidth * 0.8, 600),
      defaultItemSize: Math.max(viewportHeight * 0.3, 200)
    };
  }, []);

  // Update dimensions on window resize
  const [dimensionValues, setDimensionValues] = useState(dimensions);
  useEffect(() => {
    const handleResize = () => {
      setDimensionValues({
        height: Math.max(window.innerHeight * 0.8, 400),
        width: Math.max(window.innerWidth * 0.8, 600),
        defaultItemSize: Math.max(window.innerHeight * 0.3, 200),
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Update StoryTreeOperator when current node changes
  useEffect(() => {
    if (currentNode) {
      storyTreeOperator.setSelectedNode(currentNode);
    }
  }, [currentNode]);

  // Get siblings from levelData using the correct key
  const siblings = useMemo(() => {
    return levelData.siblings.levelsMap.get(levelData.selectedQuote) || [];
  }, [levelData.siblings.levelsMap, levelData.selectedQuote]);

  // Update pagination state based on levelData
  useEffect(() => {
    setPagination(levelData.pagination);
  }, [levelData.pagination]);

  // Update current node when siblings or currentIndex changes
  useEffect(() => {
    // Update currentIndex if it's out of bounds
    if (currentIndex >= siblings.length && siblings.length > 0) {
      setCurrentIndex(Math.max(0, siblings.length - 1));
      return;
    }
    
    const node = siblings[currentIndex];
    
    // Handle case when there are no siblings but we have a root node
    if (!node && levelData.levelNumber === 0 && levelData.rootNodeId) {
      setCurrentNode(null);
      return;
    }
    
    // Handle case when there is no valid node
    if (!node?.rootNodeId) {
      setCurrentNode(null);
      return;
    }
    
    setCurrentNode(node);
  }, [siblings, currentIndex, levelData.rootNodeId, levelData.levelNumber, levelData.parentId]);

  // Get the current node to render
  const nodeToRender = useMemo(() => {
    // If we have a selected node from the current data, use it directly
    if (currentNode) {
      return currentNode;
    }
    
    // If we don't have a current node but the levelData has a selectedNode, use that
    if (levelData.selectedNode) {
      return levelData.selectedNode;
    }
    
    // Fallback to the first sibling from the map
    return siblings[0] || levelData.siblings.levelsMap.get(null)?.[0];
  }, [currentNode, levelData.selectedNode, siblings, levelData.siblings.levelsMap]);

  // Check if a node is the reply target more efficiently
  const isReplyTarget = useCallback(
    (id: string): boolean => {
      if (!replyTarget) return false;
      return replyTarget.rootNodeId === id || replyTarget.id === id;
    },
    [replyTarget]
  );

  // Handle text selection for replies with improved error handling
  const handleTextSelectionCompleted = useCallback(
    (quote: Quote): void => {
      try {
        if (!nodeToRender) {
          throw new Error('Cannot create reply: no valid node selected');
        }
        
        // Clear any previous errors
        setReplyError(null);
        
        // Set the reply target and quote
        setReplyTarget(nodeToRender);
        setReplyQuote(quote);
        
        // Open the reply interface
        setIsReplyOpen(true);
        
        // Trigger resize to ensure UI updates correctly
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        setReplyError(error instanceof Error ? error.message : 'Failed to set reply target');
        console.error('Selection error:', error);
      }
    },
    [nodeToRender, setReplyTarget, setReplyQuote, setReplyError, setIsReplyOpen]
  );

  // Handle reply button click with improved functionality
  const handleReplyButtonClick = useCallback((): void => {
    if (!nodeToRender) {
      setReplyError('Cannot create reply: no valid node selected');
      return;
    }
    
    try {
      // Check if we're already in reply mode for this node
      if (isReplyActive && isReplyTarget(nodeToRender.rootNodeId)) {
        // If already in reply mode, exit reply mode
        clearReplyState();
      } else {
        // If not in reply mode, enter reply mode
        setReplyTarget(nodeToRender);
        
        // Only create quote if we have valid content
        if (!nodeToRender.textContent || nodeToRender.textContent.trim().length === 0) {
          throw new Error('Cannot create quote: node has no text content');
        }

        // Create a quote that encompasses the entire node content
        const quote: Quote = new Quote(
          nodeToRender.textContent.trim(),
          nodeToRender.rootNodeId,
          {
            start: 0,
            end: nodeToRender.textContent.trim().length
          }
        );

        if (!quote.isValid()) {
          throw new Error('Failed to create valid quote for reply');
        }

        // Set the quote and open the reply interface
        setReplyQuote(quote);
        setReplyError(null);
        setIsReplyOpen(true);
        
        // Trigger resize to ensure UI updates correctly
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      setReplyError(error instanceof Error ? error.message : 'Failed to handle reply action');
      console.error('Reply error:', error);
    }
  }, [
    clearReplyState,
    setReplyTarget,
    setReplyQuote,
    isReplyTarget,
    nodeToRender,
    setReplyError,
    isReplyActive,
    setIsReplyOpen
  ]);

  // Navigation functions with pagination
  const navigateToNextSibling = useCallback(async () => {
    if (currentIndex < siblings.length - 1) {
      // We have the next sibling loaded already
      setCurrentIndex(currentIndex + 1);
    } else if (pagination.hasMore) {
      // Need to load more siblings
      setIsLoading(true);
      try {
        // Use loadMoreItems instead of the non-existent loadMoreSiblings
        await storyTreeOperator.loadMoreItems(
          levelData.parentId[0],
          levelData.levelNumber,
          levelData.selectedQuote,
          siblings.length,  // startIndex
          siblings.length + 5  // stopIndex (load 5 more)
        );
        // StoryTreeOperator will update the levelData, which will update siblings
        // We'll increment the index to show the newly loaded sibling
        setCurrentIndex(currentIndex + 1);
      } catch (error) {
        console.error('Failed to load more siblings:', error);
      } finally {
        setIsLoading(false);
      }
    }
  }, [
    currentIndex, siblings.length, pagination.hasMore,
    levelData.parentId, levelData.levelNumber, levelData.selectedQuote
  ]);

  const navigateToPreviousSibling = useCallback(async () => {
    if (currentIndex > 0) {
      // We have the previous sibling loaded already
      setCurrentIndex(currentIndex - 1);
    } else if (pagination.prevCursor !== undefined) {
      // Need to load more siblings
      setIsLoading(true);
      try {
        // For previous siblings, we don't have a direct way to load them with the current API
        // This is a placeholder - in a real implementation, you'd need to implement a method
        // to load previous siblings using the prevCursor
        console.warn('Loading previous siblings is not fully implemented');
        
        // Simulate loading previous by just resetting to the first available sibling
        // In a real implementation, you'd load the previous page of siblings
        setCurrentIndex(0);
      } catch (error) {
        console.error('Failed to load more siblings:', error);
      } finally {
        setIsLoading(false);
      }
    }
  }, [
    currentIndex, pagination.prevCursor,
    levelData.parentId, levelData.levelNumber, levelData.selectedQuote
  ]);

  // Setup gesture handling for swipe navigation
  const bind = useGesture({
    onDrag: ({ down, movement: [mx], cancel, velocity: [vx] }) => {
      if (!down) {
        try {
          if (mx < -100 || (vx < -0.5 && mx < -50)) {
            if ((currentIndex < siblings.length - 1) || pagination.hasMore) {
              navigateToNextSibling();
            }
            cancel?.();
          } else if (mx > 100 || (vx > 0.5 && mx > 50)) {
            if ((currentIndex > 0) || pagination.prevCursor !== undefined) {
              navigateToPreviousSibling();
            }
            cancel?.();
          }
        } catch (error) {
          console.error('Navigation error:', error);
        }
      }
    }
  }, {
    drag: {
      axis: 'x',
      enabled: Boolean(nodeToRender?.rootNodeId) && (
        (currentIndex < siblings.length - 1 || pagination.hasMore) ||
        (currentIndex > 0 || pagination.prevCursor !== undefined)
      ),
      threshold: 5,
    }
  });

  // Early return if we don't have a valid node
  if (!nodeToRender?.rootNodeId) {
    return null;
  }

  return (
    <div
      ref={containerRef}
      className="story-tree-level-container"
      style={{
        position: 'relative',
        width: '100%'
      }}
    >
      <AnimatePresence mode="wait">
        <div {...bind()}>
          <motion.div
            className={`story-tree-node ${isReplyTarget(nodeToRender.rootNodeId) ? 'reply-target' : ''}`}
            initial={{ opacity: 0, x: currentIndex === 0 ? -50 : 50 }}
            animate={{ opacity: 1, x: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2 }}
            role="article"
            style={{
              width: '100%',
              padding: '16px',
              position: 'relative'
            }}
          >
            <NodeContent
              node={nodeToRender}
              quote={(isReplyTarget(nodeToRender.id) && replyQuote) ? replyQuote : undefined}
              existingSelectableQuotes={nodeToRender.quoteCounts || {quoteCounts: new Map()}}
              onSelectionComplete={handleTextSelectionCompleted}
            />
            <NodeFooter
              currentIndex={currentIndex}
              totalSiblings={pagination.matchingRepliesCount}
              onReplyClick={handleReplyButtonClick}
              isReplyTarget={isReplyTarget(nodeToRender.rootNodeId)}
              onNextSibling={navigateToNextSibling}
              onPreviousSibling={navigateToPreviousSibling}
              isReplyActive={isReplyActive}
              replyError={replyError}
            />
            {replyError && (
              <div className="reply-error" role="alert" aria-live="polite">
                {replyError}
              </div>
            )}
            {isLoading && (
              <div className="loading-indicator" aria-live="polite">
                Loading...
              </div>
            )}
            
            {/* Navigation indicators */}
            {(currentIndex > 0 || pagination.prevCursor !== undefined) && (
              <div className="nav-indicator prev-indicator" aria-hidden="true">
                ←
              </div>
            )}
            {(currentIndex < siblings.length - 1 || pagination.hasMore) && (
              <div className="nav-indicator next-indicator" aria-hidden="true">
                →
              </div>
            )}
          </motion.div>
        </div>
      </AnimatePresence>
    </div>
  );
};

export default StoryTreeLevelComponent; 