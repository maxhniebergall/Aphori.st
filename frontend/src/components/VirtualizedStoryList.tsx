/**
 * Requirements:
 * - React-window for virtualized list rendering
 * - Efficient row height management
 * - Support for infinite loading
 * - Support for reply mode
 * - TypeScript support
 * - Utilize StoryTreeContext for state management
 * - Yarn for package management
 * - Proper error handling
 * - Loading state management
 * - Responsive design support
 * - Accessibility compliance
 * - Performance optimization
 * - Memory leak prevention
 * - Clear loading state after data is loaded
 */

import React, { useRef, useEffect, useState, useMemo, useCallback } from 'react';
import { Virtuoso } from 'react-virtuoso';
import { useStoryTree } from '../context/StoryTreeContext';
import { useReplyContext } from '../context/ReplyContext';
import { LastLevel, StoryTreeLevel } from '../types/types';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { MemoizedRow } from './Row';
import { getLevelNumber, isLastLevel } from '../utils/levelDataHelpers';

interface VirtualizedStoryListProps {
  postRootId: string;
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

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = React.memo(({ postRootId }) => {
  const { state } = useStoryTree();
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [levels, setLevels] = useState<Array<StoryTreeLevel>>([]);
  
  const { replyTarget } = useReplyContextForList();

  // useEffects
  // Load initial data
  useEffect(() => {
    if (!postRootId) {
      setIsLocalLoading(true);
      return;
    } else {
      setIsLocalLoading(false);
    }
  }, [postRootId]);

  // UPDATE: Effect only syncs context levels to local state
  useEffect(() => {
    if (!postRootId) return;
    const contextLevels = state?.storyTree?.levels || [];
    setLevels(prevLevels => {
      if (prevLevels !== contextLevels) {
         console.log("VirtualizedStoryList: Context levels reference changed, updating local levels state.", { prevLength: prevLevels.length, newLength: contextLevels.length });
         return contextLevels;
      }
      return prevLevels;
    });
  }, [postRootId, state?.storyTree?.levels]);

  // Set error
  useEffect(() => {
    if (state?.error) {
      // console.warn("VirtualizedStoryList: Error from state:", state.error);
      setError(state.error);
    }
  }, [state?.error]);

  // Update logging
  console.log(`VirtualizedStoryList Check: isLocalLoading: ${isLocalLoading}, levels.length: ${levels.length}, error: ${error}`);

  // Show initial loading state
  if (isLocalLoading && !levels.length) {
    console.log("VirtualizedStoryList: Rendering LOADING state");
    return (
      <div className="loading" role="alert" aria-busy="true">
        <div className="loading-spinner"></div>
        Loading story tree...
      </div>
    );
  }

  // Show error state
  if (error) {
    console.log("VirtualizedStoryList: Rendering ERROR state:", error);
    // console.warn("VirtualizedStoryList: Showing error state:", error);
    return <div className="error" role="alert">Error: {error}</div>;
  }

  // UPDATE: Define Virtuoso's itemContent function
  const itemContent = useCallback((index: number, level: StoryTreeLevel) => {
    // level is now provided by Virtuoso from the `data` prop (local levels state)
    if (!level) {
      // This case might still happen if the levels array somehow contains null/undefined
      console.warn(`Virtuoso itemContent: Received null/undefined level data for index ${index}, rendering placeholder.`);
      return <div style={{ height: '1px' }} />; 
    }

    // Determine if the row should be hidden based on reply context
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
  // UPDATE dependency array - now depends on replyTarget only, as level comes from Virtuoso
  }, [replyTarget]);

  // UPDATE: Define the endReached callback for Virtuoso
  const loadMore = useCallback(() => {
    // Use local levels.length for startIndex
    const startIndex = levels.length;
    console.log(`Virtuoso endReached: loading more from index ${startIndex}`);
    // Call loadSingleLevel with only startIndex
    storyTreeOperator.loadSingleLevel(startIndex)
  // UPDATE dependency array
  }, [levels.length]); // Depend on local levels state length

  console.log(`VirtualizedStoryList: Rendering CONTENT state with Virtuoso (count: ${levels.length})`);
  
  return (
    <div style={{ height: '100%' }} role="list" aria-label="Story tree content">
      <Virtuoso
        style={{ height: '100%' }}
        data={levels}
        itemContent={itemContent}
        endReached={loadMore}
        overscan={5}
        increaseViewportBy={{ top: 200, bottom: 200 }}
      />
      {/* Keep loading indicator, check levels.length */}
      {isLocalLoading && levels.length > 0 && (
        <div className="loading-more" role="alert" aria-busy="true">
          <div className="loading-spinner"></div>
          Loading more...
        </div>
      )}
    </div>
  );
});

// Add display name for better debugging
VirtualizedStoryList.displayName = 'VirtualizedStoryList';

export default VirtualizedStoryList; 