/**
 * Requirements:
 * - React-window for virtualized list rendering
 * - Efficient row height management
 * - Support for infinite loading
 * - Support for reply mode
 * - TypeScript support
 * - Utilize PostTreeContext for state management
 * - Yarn for package management
 * - Proper error handling
 * - Loading state management
 * - Responsive design support
 * - Accessibility compliance
 * - Performance optimization
 * - Memory leak prevention
 * - Clear loading state after data is loaded
 */

import React, { useEffect, useState, useMemo, useCallback, useImperativeHandle, forwardRef, useRef } from 'react';
import { Virtuoso, VirtuosoHandle } from 'react-virtuoso';
import { usePostTree } from '../context/PostTreeContext';
import { useReplyContext } from '../context/ReplyContext';
import { PostTreeLevel } from '../types/types';
import postTreeOperator from '../operators/PostTreeOperator';
import { MemoizedRow } from './Row';
import { getLevelNumber } from '../utils/levelDataHelpers';

interface VirtualizedPostListProps {
  postRootId: string;
}

export interface VirtualizedPostListRef {
  scrollToItem: (itemId: string) => void;
}

// Custom hook to selectively extract only the reply context values we need
// This prevents re-renders when replyContent changes
function useReplyContextForList() {
  const context = useReplyContext();
  
  return useMemo(() => ({
    replyTarget: context.replyTarget,
  }), [
    context.replyTarget
    // Intentionally NOT including replyContent which changes with every keystroke
  ]);
}

const VirtualizedPostList = React.memo(forwardRef<VirtualizedPostListRef, VirtualizedPostListProps>(({ postRootId }, ref) => {
  const { state } = usePostTree();
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<PostTreeLevel[]>([]);
  const virtuosoRef = useRef<VirtuosoHandle>(null);
  
  const { replyTarget } = useReplyContextForList();
  const { isLoadingMore } = state;

  // --- HOOKS MUST BE CALLED UNCONDITIONALLY BEFORE EARLY RETURNS ---

  // Expose scrollToItem method via ref
  useImperativeHandle(ref, () => ({
    scrollToItem: (itemId: string) => {
      // Find the index of the item with the given ID
      const itemIndex = levels.findIndex(level => {
        // Check if this level contains the item with the given ID
        // The item could be the root node, selected node, or one of the sibling nodes
        if (level.midLevel?.rootNodeId === itemId) return true;
        if (level.lastLevel?.rootNodeId === itemId) return true;
        if (level.midLevel?.selectedNode?.id === itemId) return true;
        if (level.midLevel?.siblings?.nodes?.some((node: any) => node.id === itemId)) return true;
        return false;
      });
      
      if (itemIndex !== -1 && virtuosoRef.current) {
        virtuosoRef.current.scrollToIndex({
          index: itemIndex,
          align: 'center',
          behavior: 'smooth'
        });
      }
    }
  }), [levels]);

  // UPDATE: Effect syncs context levels AND triggers initial loading up to 5 levels
  useEffect(() => {
    // Check if postTree exists before trying to access levels or load more
    if (!postRootId || !state.postTree) { 
      // Clear local state if postRootId is invalid or postTree isn't ready
      setLevels([]);
      setError(null); 
      return;
    }

    const contextLevels = state.postTree.levels || [];
    setLevels(contextLevels); // Sync local state

    // Initial loading logic
    const targetInitialLevels = 5;
    const loadedLevelCount = contextLevels.length;
    const currentlyLoading = state.isLoadingMore;

    // Determine if the last loaded level indicated the end of the post tree
    const hasMoreLevels = loadedLevelCount === 0 || !contextLevels[loadedLevelCount - 1].isLastLevel;

    // Check if we need more levels, are not loading, AND the last loaded level wasn't the final one
    if (state.postTree && loadedLevelCount < targetInitialLevels && !currentlyLoading && hasMoreLevels) {
      postTreeOperator.requestLoadNextLevel();
    }

  // Depend on postRootId, levels array reference, isLoadingMore, and postTree existence
  }, [postRootId, state?.postTree, state?.postTree?.levels, state.isLoadingMore]);

  // Set error
  useEffect(() => {
    // Check for error from state, ensuring it doesn't overwrite an existing local error inappropriately
    if (state?.error && !error) { 
      // console.warn("VirtualizedPostList: Error from state:", state.error);
      setError(state.error);
    }
  // Depend on state.error and the local error state
  }, [state?.error, error]); 

  // UPDATE: Define Virtuoso's itemContent function (Moved before returns)
  const itemContent = useCallback((index: number, level: PostTreeLevel) => {
    if (!level) {
      console.warn(`Virtuoso itemContent: Received null/undefined level data for index ${index}, rendering placeholder.`);
      return <div style={{ height: '1px' }} />; 
    }
    const shouldHide = !!(replyTarget?.levelNumber) && 
                       !!(getLevelNumber(level)) && 
                       replyTarget.levelNumber < getLevelNumber(level)!;
    return (
      <MemoizedRow
        levelData={level}
        shouldHide={shouldHide}
        index={index}
      />
    );
  }, [replyTarget]);

  // Restore the original loadMore callback (Moved before returns)
  const loadMore = useCallback(() => {
    if (isLoadingMore || !state.postTree) { // Add check for postTree
      return;
    }
    postTreeOperator.requestLoadNextLevel();
  }, [isLoadingMore, state.postTree]); // Add state.postTree dependency

  // UPDATE: Define computeItemKey (Moved before returns)
  const computeItemKey = useCallback((index: number, level: PostTreeLevel): React.Key => {
    const levelNum = getLevelNumber(level);
    const rootId = level?.midLevel?.rootNodeId ?? level?.lastLevel?.rootNodeId ?? `fallback-${index}`;
    return `${rootId}-level-${levelNum ?? index}`;
  }, []);

  // --- CONDITIONAL RETURNS MOVED AFTER ALL HOOKS ---

  // Show initial loading state: inferred if no levels, isLoadingMore is true, and no error
  // Add check for !state.postTree as well, maybe the operator isn't ready because of this
  if ((!state.postTree || !levels.length) && isLoadingMore && !error) {
    return (
      <div className="loading" role="alert" aria-busy="true">
        <div className="loading-spinner"></div>
        Loading post tree...
      </div>
    );
  }

  // Show error state
  if (error) {
    return <div className="error" role="alert">Error: {error}</div>;
  }

  // --- RENDER THE LIST --- 
  // Ensure we only render Virtuoso if we actually have levels to show
  if (!levels || levels.length === 0) {
      // Optional: Render a placeholder or different loading state if needed
      // Or return null if nothing should be shown yet
      return (
        <div className="loading" role="alert" aria-busy="true">
          <div className="loading-spinner"></div>
          Preparing list...
        </div>
      );
  }

  return (
    <div style={{ height: '100%' }} role="list" aria-label="Post tree content">
      <Virtuoso
        ref={virtuosoRef}
        style={{ height: '100%' }}
        data={levels}
        itemContent={itemContent}
        computeItemKey={computeItemKey}
        endReached={loadMore}
        overscan={5}
        increaseViewportBy={{ top: 200, bottom: 200 }}
      />
      {/* Loading more indicator: shown if levels exist and isLoadingMore is true */}
      {levels.length > 0 && isLoadingMore && (
        <div className="loading-more" role="alert" aria-busy="true">
          <div className="loading-spinner"></div>
          Loading more...
        </div>
      )}
    </div>
  );
}));

// Add display name for better debugging
VirtualizedPostList.displayName = 'VirtualizedPostList';

export default VirtualizedPostList; 