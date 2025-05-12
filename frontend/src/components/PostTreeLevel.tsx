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
import { motion, AnimatePresence, PanInfo } from 'framer-motion';
import { debounce } from 'lodash';
import { useReplyContext } from '../context/ReplyContext';
import NodeContent from './NodeContent';
import NodeFooter from './NodeFooter';
import { PostTreeLevel as LevelData, Pagination, ACTIONS, PostTreeNode, Siblings } from '../types/types';
import { areQuotesEqual, Quote } from '../types/quote';
import postTreeOperator from '../operators/PostTreeOperator';
import { usePostTree } from '../context/PostTreeContext';
import { useUser } from '../context/UserContext';
import { 
  getSelectedQuoteInThisLevel,
  getSiblings, 
  getSelectedNodeHelper, 
  getLevelNumber,
  getPagination,
  isMidLevel,
} from '../utils/levelDataHelpers';
import { findLatestDraftForParent } from '../utils/replyPersistence';
import { ReplyContextType } from '../context/ReplyContext';

interface PostTreeLevelProps {
  levelData: LevelData;
  reportHeight?: (height: number) => void;
}

// Create a memoized NodeFooterWrapper component to prevent unnecessary re-renders
const MemoizedNodeFooter = React.memo(NodeFooter,
  (prevProps, nextProps) => {
    return prevProps.currentIndex === nextProps.currentIndex &&
      prevProps.totalSiblings === nextProps.totalSiblings &&
      prevProps.isReplyTarget === nextProps.isReplyTarget &&
      prevProps.isReplyActive === nextProps.isReplyActive &&
      prevProps.replyError === nextProps.replyError;
  }
);

// Memoize NodeContent using the comparison function defined within NodeContent.tsx
const MemoizedNodeContent = React.memo(NodeContent);

export const PostTreeLevelComponent: React.FC<PostTreeLevelProps> = ({
  levelData,
  reportHeight,
}) => {
  const { dispatch } = usePostTree();
  const { state: userState } = useUser();

  // Debounce the navigation actions
  const debouncedNavigateNext = useMemo(
    () => debounce(() => {
      const levelNumber = getLevelNumber(levelData);
      const currentNodeId = getSelectedNodeHelper(levelData)?.id ?? null;
      if (levelNumber !== undefined && currentNodeId !== null) { 
        console.log(`[PostTreeLevel] Dispatching NAVIGATE_NEXT_SIBLING for level ${levelNumber}, expecting node ${currentNodeId}`);
        dispatch({ 
          type: ACTIONS.NAVIGATE_NEXT_SIBLING, 
          payload: { levelNumber, expectedCurrentNodeId: currentNodeId }
        });
      } else {
        console.log(`[PostTreeLevel] Navigation dispatch skipped (Next). Level: ${levelNumber}, CurrentNodeId: ${currentNodeId}`);
      }
    }, 100, { leading: true, trailing: false }),
    [dispatch, levelData]
  );
  const debouncedNavigatePrev = useMemo(
    () => debounce(() => {
      const levelNumber = getLevelNumber(levelData);
      const currentNodeId = getSelectedNodeHelper(levelData)?.id ?? null;
      if (levelNumber !== undefined && currentNodeId !== null) { 
        console.log(`[PostTreeLevel] Dispatching NAVIGATE_PREV_SIBLING for level ${levelNumber}, expecting node ${currentNodeId}`);
        dispatch({ 
          type: ACTIONS.NAVIGATE_PREV_SIBLING, 
          payload: { levelNumber, expectedCurrentNodeId: currentNodeId }
        });
      } else {
        console.log(`[PostTreeLevel] Navigation dispatch skipped (Prev). Level: ${levelNumber}, CurrentNodeId: ${currentNodeId}`);
      }
    }, 100, { leading: true, trailing: false }),
    [dispatch, levelData]
  );

  // Log the props received by PostTreeLevelComponent for debugging propagation

  // Core state hooks moved to top
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const containerRef = useRef<HTMLDivElement>(null);
  // Use a custom hook to extract only the reply context values we need
  // This prevents re-renders when replyContent changes but doesn't affect this component
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
    isReplyActive,
    setReplyContent,
    rootUUID
  } = useReplyContextSelective();
  const initialPagination = getPagination(levelData); // Moved calculation before useState
  const [pagination, setPagination] = useState<Pagination>(initialPagination || { hasMore: false, totalCount: 0, nextCursor: undefined }); // Ensure initial value is always valid Pagination
  const [animationDirection, setAnimationDirection] = useState<1 | -1>(1); // 1 for next, -1 for prev. Initial direction.

  // Calculate dimensions based on viewport - moved up
  const dimensions = useMemo(() => {
    const viewportHeight = window.innerHeight;
    const viewportWidth = window.innerWidth;
    return {
      height: Math.max(viewportHeight * 0.8, 400),
      width: Math.max(viewportWidth * 0.8, 600),
      defaultItemSize: Math.max(viewportHeight * 0.3, 200)
    };
  }, []);

  // Update dimensions on window resize - moved up
  const [dimensionValues, setDimensionValues] = useState(dimensions);
  useMemo(() => {
    const handleResize = () => {
      setDimensionValues({
        height: Math.max(window.innerHeight * 0.8, 400),
        width: Math.max(window.innerWidth * 0.8, 600),
        defaultItemSize: Math.max(window.innerHeight * 0.3, 200),
      });
    };
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []); // Dependency array kept empty as intended

  // Get siblings from levelData - Refactored to use the new structure
  const siblings: Siblings = useMemo(() => {
    if (!isMidLevel(levelData)) { 
      return { nodes: [] };
    }
    // getSiblings now directly returns PostTreeNode[] | undefined
    return getSiblings(levelData) || { nodes: [] }; 
    // Removed the old logic that tried to filter based on selectedQuoteInParent and levelsMap
  }, [levelData]);

  // Get the current node to render - moved up
  const nodeToRender = useMemo(() => {
    const selectedNode = getSelectedNodeHelper(levelData);
    if (selectedNode) {
      return selectedNode;
    }
    if (siblings.nodes.length > 0) {
      return siblings.nodes[0];
    }
    return undefined;
  }, [levelData, siblings]); // Dependencies restored

  // Extract the currently selected quote *for this level*, applying default logic - FIXED
  const currentLevelSelectedQuote = useMemo(() => {
    // 1. Get the explicitly selected quote for the level from the state
    const explicitLevelQuote = getSelectedQuoteInThisLevel(levelData);
    const quotesMap: [Quote, number][] | undefined = nodeToRender?.quoteCounts?.quoteCounts;

    // 2. Check if the explicit level quote exists AND is present in the current node's quotes
    if (explicitLevelQuote && quotesMap) {
      const quoteExistsInNode = quotesMap.some(([quote]) => areQuotesEqual(quote, explicitLevelQuote));
      if (quoteExistsInNode) {
        // Use the explicitly selected level quote if it applies to this node
        return explicitLevelQuote;
      }
    }

    // 3. If no valid explicit quote for *this node*, find the default (highest count) for *this node*
    if (quotesMap && quotesMap.length > 0) {
      // Sort by count descending ONLY.
      // Tuple is [Quote, number]
      const sortedQuotes = [...quotesMap].sort((entryA, entryB) => { // entryA = [quoteA, countA]
        const countA = entryA[1];
        const countB = entryB[1];
        const countDiff = countB - countA; // Descending count
        return countDiff;
      });
      // Return the Quote object (index 0) from the highest count entry
      return sortedQuotes[0]?.[0] ?? null; // Safely access quote at index 0
    }

    // 4. If no explicit selection applicable and no quotes available on this node, return null
    return null;

  }, [levelData, nodeToRender, levelData.midLevel?.selectedNode]); // Dependencies correct

   // Handle text selection for replies with improved error handling - moved up
  const handleExistingQuoteSelectionCompleted = useCallback(
    async (quote: Quote): Promise<void> => {
      try {
        if (!nodeToRender) {
          throw new Error('Cannot create reply: no valid node selected');
        }
        await postTreeOperator.setSelectedQuoteForNodeInLevel(quote, nodeToRender, levelData);
        window.dispatchEvent(new Event('resize'));
      } catch (error) {
        setReplyError(error instanceof Error ? error.message : 'Failed to set reply target'); // TODO: why is this a reply error?
      }
    },
    [nodeToRender, levelData, setReplyError] // Dependencies updated
  );

  // Handle reply button click - checks for draft first
  const handleReplyButtonClick = useCallback(async () => {
    // Check if user is logged in BEFORE attempting to start a new reply
    const isStartingNewReply = !isReplyActive || (nodeToRender && replyTarget?.id !== nodeToRender.id);
    if (isStartingNewReply && (!userState.user || !userState.verified)) {
      window.alert("Please sign in to comment.");
      return; // Prevent reply editor from opening
    }

    // Add detailed logging here
    console.log(`[handleReplyButtonClick] Clicked. Node ID: ${nodeToRender?.id}, isReplyActive: ${isReplyActive}, replyTarget ID: ${replyTarget?.id}`);
    
    if (!nodeToRender) {
      console.error('[handleReplyButtonClick] Error: nodeToRender is null/undefined.');
      setReplyError('Cannot create reply: no valid node selected');
      return;
    }
    const isCurrentlyReplyTarget = replyTarget?.id === nodeToRender?.id; // Local check

    try {
      if (isReplyActive && isCurrentlyReplyTarget) {
        // User clicked "Cancel Reply"
        clearReplyState(); // Clears target, quote, content, and localStorage entry
      } else {
        
        // Check for existing draft for this parent node
        let loadedDraft = null;
        if (rootUUID) { // Ensure rootUUID is available
          loadedDraft = findLatestDraftForParent(rootUUID, nodeToRender.id);
        }

        if (loadedDraft) {
          // Draft found - load its state into context
          setReplyTarget(nodeToRender);
          setReplyQuote(loadedDraft.quote); // Set the quote from the draft
          setReplyContent(loadedDraft.content); // Set the content from the draft
          setReplyError(null);
          setIsReplyOpen(true); // Ensure reply editor opens
        } else {
          // No draft found - start fresh reply, selecting entire node text as the default quote
          setReplyTarget(nodeToRender);
          const nodeText = nodeToRender.textContent?.trim();
          if (!nodeText || nodeText.length === 0) {
            console.error('[handleReplyButtonClick] Error: Cannot create quote: node has no text content.');
            // Set an error state instead of throwing, or handle gracefully
            setReplyError('Cannot start reply: Node has no content to quote.');
            return; // Stop execution if no text content
          }
          // Create the default quote spanning the entire text
          const defaultQuote = new Quote(
            nodeText, // Use the full trimmed text
            nodeToRender.id, // Provide the sourceId
            { start: 0, end: nodeText.length } // Range covering the whole text
          );
          setReplyQuote(defaultQuote); // Set the default quote
          setReplyContent(''); // Start with empty content for the new reply
          setReplyError(null); // Clear any previous errors
          setIsReplyOpen(true); // Ensure reply editor opens
        }
        // After setting state (either from draft or default), dispatch resize
        window.dispatchEvent(new Event('resize'));
      }
    } catch (error) {
      console.error('[handleReplyButtonClick] Error:', error);
      const errorMessage = error instanceof Error ? error.message : 'An unknown error occurred while handling the reply action.';
      setReplyError(errorMessage);
    }
  }, [
    nodeToRender, 
    replyTarget, 
    isReplyActive, 
    clearReplyState, 
    setReplyError, 
    setReplyTarget, 
    setReplyQuote, 
    setIsReplyOpen,
    rootUUID, // Add rootUUID dependency
    setReplyContent, // Add setReplyContent dependency
    userState // Add userState dependency
  ]);

  // Navigation functions with pagination - FIXED
  const navigateToNextSibling = useCallback(async () => {
    if (replyTarget?.id === nodeToRender?.id) { return; }
    if (!nodeToRender) { return; }
    const currentIndex = siblings.nodes.findIndex((sibling: PostTreeNode) => sibling.id === getSelectedNodeHelper(levelData)?.id);
    if (currentIndex < siblings.nodes.length - 1) {
      setAnimationDirection(1);
      debouncedNavigateNext(); // Call debounced action
    } else if (pagination.hasMore) {
      // ** Temporarily removed loadMoreItems call **
      // The logic for pagination needs rethinking with the new client-side sorting.
      // setIsLoading(true);
      // try {
      //   const parentIdArr = getParentId(levelData);
      //   const levelNum = getLevelNumber(levelData);
      //   // We don't use selQuoteParent for fetching anymore
      //   if (!parentIdArr || parentIdArr.length === 0 || levelNum === undefined) {
      //       console.warn("Missing data needed to load more items.", { parentIdArr, levelNum });
      //       setIsLoading(false);
      //       return;
      //   }
      //   // Call to loadMoreItems needs redesign
      //   // await postTreeOperator.loadMoreItems(...);
      //   debouncedNavigateNext(); 
      // } catch (error) {
      //   console.error("Failed to load more items:", error);
      // } finally {
      //   setIsLoading(false);
      // }
      console.log("Load more logic needs implementation for new sorting.");
    } else {
      console.log("No next sibling action taken (already at end or no more pages).");
    }
  }, [
    siblings, pagination, levelData, debouncedNavigateNext, nodeToRender, 
    replyTarget, // Removed setIsLoading as loadMoreItems is commented out
  ]);

  const navigateToPreviousSibling = useCallback(async () => {
    if (replyTarget?.id === nodeToRender?.id) { return; }
    if (!nodeToRender) { return; }
    const currentIndex = siblings.nodes.findIndex((sibling: PostTreeNode) => sibling.id === getSelectedNodeHelper(levelData)?.id);
    if (currentIndex > 0) {
      setAnimationDirection(-1);
      debouncedNavigatePrev(); // Call debounced action
    } else {
        console.log("No previous sibling action taken.");
    }
  }, [
    siblings, debouncedNavigatePrev, levelData, nodeToRender, replyTarget 
  ]);

  // Gesture handling with Framer Motion's drag
  const handleDragEnd = (
    event: MouseEvent | TouchEvent | PointerEvent,
    info: PanInfo
  ) => {
    const { offset, velocity } = info;
    const swipeThreshold = 100; // Minimum distance for a swipe
    const velocityThreshold = 0.3; // Minimum velocity for a swipe

    if (offset.x < -swipeThreshold || (velocity.x < -velocityThreshold && offset.x < -50)) {
      navigateToNextSibling();
    } else if (offset.x > swipeThreshold || (velocity.x > velocityThreshold && offset.x > 50)) {
      navigateToPreviousSibling();
    }
  };

  // Report height to parent virtualized list when container size changes - moved up
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

  // Update pagination state based on levelData - moved up
  useMemo(() => {
    const newPagination = getPagination(levelData);
    if (newPagination) {
      // Add a check to prevent unnecessary state updates if pagination hasn't changed
      if (newPagination.nextCursor !== pagination.nextCursor ||
          newPagination.hasMore !== pagination.hasMore ||
          newPagination.totalCount !== pagination.totalCount) {
            setPagination(newPagination);
          }
    }
  }, [levelData, pagination]); // Added pagination to dependency array

  // Memoize quote counts based on the node ID. If the node ID is the same,
  // assume its quote counts haven't fundamentally changed for highlighting purposes.
  const memoizedQuoteCounts = useMemo(() => {
    return nodeToRender?.quoteCounts ?? undefined;
  // Depend only on the node ID. If the node changes, recalculate.
  }, [nodeToRender?.id]);

  // --- Conditional logic starts here ---

  // Skip rendering if not a MidLevel
  if (!isMidLevel(levelData)) {
    return (
      <div ref={containerRef} className="post-tree-level-container">
        <div className="last-level-indicator">
          End of thread
        </div>
      </div>
    );
  }

  // This specific check for initialPagination must happen *after* hooks are defined
  // but before pagination state is used extensively if the component *could* render
  // without valid initial pagination derived from a non-MidLevel.
  // However, the hook itself is already moved up. The check here is for logic flow.
  if (!initialPagination) {
    console.error("PostTreeLevelComponent: Rendered without valid initial pagination, this might indicate an issue.", levelData);
    return null; // Or return some placeholder/error state
  }

  // Determine if the current node is the target for a reply
  const isReplyTarget = replyTarget?.id === nodeToRender?.id;


  // Early return if we don't have a valid node
  if (!nodeToRender?.rootNodeId) {
    console.warn("PostTreeLevelComponent: nodeToRender or its rootNodeId is missing. Rendering null.", { nodeToRender, levelData });
    return null;
  }

  // Log the props passed to NodeContent for debugging propagation
  
  return (
    <div
      ref={containerRef}
      className="post-tree-level-container"
    >
      <AnimatePresence custom={animationDirection} initial={false} mode="wait">
        <motion.div
          style={{ touchAction: 'pan-y' }}
          className={`post-tree-node ${isReplyTarget ? 'reply-target' : ''}`}
          key={nodeToRender?.rootNodeId + (levelData.midLevel?.levelNumber ?? '') + (nodeToRender?.id ?? '')}
          drag="x"
          dragConstraints={{ left: 0, right: 0 }}
          dragElastic={0.5}
          onDragEnd={handleDragEnd}
          initial={{
            opacity: 0,
            x: animationDirection * 300,
          }}
          animate={{
            opacity: 1,
            x: 0,
            transition: {
              delay: 0.1,
              type: "spring",
              stiffness: 260,
              damping: 25,
            },
          }}
          exit={{
            opacity: 0,
            x: animationDirection * -300,
            transition: {
              duration: 0.2,
            },
          }}
          role="article"
        >
          {nodeToRender && (
            <MemoizedNodeContent
              node={nodeToRender}
              onExistingQuoteSelectionComplete={handleExistingQuoteSelectionCompleted}
              isReplyTargetNode={isReplyTarget}
              existingSelectableQuotes={memoizedQuoteCounts}
              currentLevelSelectedQuote={currentLevelSelectedQuote ?? undefined}
              initialQuoteForReply={isReplyTarget ? replyQuote : null}
            />
          )}
          <MemoizedNodeFooter
            nodeData={nodeToRender}
            currentIndex={nodeToRender ? siblings.nodes.findIndex((sibling: PostTreeNode) => sibling.id === nodeToRender.id) : -1} 
            totalSiblings={siblings.nodes.length}
            onReplyClick={handleReplyButtonClick}
            isReplyTarget={isReplyTarget}
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
        </motion.div>
      </AnimatePresence>
    </div>
  );
};

// Custom hook to selectively extract only the reply context values we need
// This prevents re-renders when replyContent changes
// NOTE: This function itself is NOT a hook, but it CALLS hooks (useMemo, useContext).
// The convention is to name functions starting with 'use' if they call hooks inside.
function useReplyContextSelective(): Pick<
  ReplyContextType,
  | 'setReplyTarget'
  | 'replyTarget'
  | 'setReplyQuote'
  | 'replyQuote'
  | 'clearReplyState'
  | 'replyError'
  | 'setReplyError'
  | 'isReplyOpen'
  | 'setIsReplyOpen'
  | 'isReplyActive'
  | 'setReplyContent'
  | 'rootUUID'
> {
  const context = useReplyContext(); // Use the base hook

  return useMemo(() => ({
    setReplyTarget: context.setReplyTarget,
    replyTarget: context.replyTarget,
    setReplyQuote: context.setReplyQuote,
    replyQuote: context.replyQuote,
    clearReplyState: context.clearReplyState,
    replyError: context.replyError,
    setReplyError: context.setReplyError,
    isReplyOpen: context.isReplyOpen,
    setIsReplyOpen: context.setIsReplyOpen,
    isReplyActive: context.isReplyActive,
    setReplyContent: context.setReplyContent,
    rootUUID: context.rootUUID
  }), [
    context.setReplyTarget,
    context.replyTarget,
    context.setReplyQuote,
    context.replyQuote,
    context.clearReplyState,
    context.replyError,
    context.setReplyError,
    context.isReplyOpen,
    context.setIsReplyOpen,
    context.isReplyActive,
    context.setReplyContent,
    context.rootUUID
  ]);
}

// Use React.memo to memoize the entire component
export default React.memo(PostTreeLevelComponent); 