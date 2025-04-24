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
import { VariableSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useStoryTree } from '../context/StoryTreeContext';
import { useReplyContext } from '../context/ReplyContext';
import { LastLevel, StoryTreeLevel } from '../types/types';
import storyTreeOperator from '../operators/StoryTreeOperator';
import Row from './Row';
import { getLevelNumber, isLastLevel } from '../utils/levelDataHelpers';
import RowFallback from './RowFallback';

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

// Memoize the Row component to prevent unnecessary re-renders
const MemoizedRow = React.memo(Row);

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = React.memo(({ postRootId }) => {
  const { state } = useStoryTree();
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<VariableSizeList>(null);
  const sizeMap = useRef<Map<number, number>>(new Map());
  const [levels, setLevels] = useState<Array<StoryTreeLevel | LastLevel>>([]);
  const [listSize, setListSize] = useState<number>(Number.MAX_SAFE_INTEGER);
  
  // Use our selective hook to prevent unnecessary re-renders
  const { replyTarget } = useReplyContextForList();

  // Reset size cache when levels change
  useEffect(() => {
    if (listRef.current) {
      sizeMap.current.clear();
      listRef.current.resetAfterIndex(0);
    }
  }, [levels]);

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

  // Load more levels
  useEffect(() => {
    if (!postRootId) return;
    setLevels(state?.storyTree?.levels || []);

    // check if we've loaded the last level
    const lastLevel = state?.storyTree?.levels?.[state?.storyTree?.levels?.length - 1];
    if (lastLevel && isLastLevel(lastLevel)) {
      const levelNumber = getLevelNumber(lastLevel);
      if (levelNumber !== undefined) {
        // console.log("VirtualizedStoryList: no more levels to load. Setting list size to [" + levelNumber+ "]");
        setListSize(levelNumber);
      } else {
        throw new Error("VirtualizedStoryList: Last Level has no level number");
      }
    }
  }, [postRootId, state?.storyTree?.levels]);

  // Set error
  useEffect(() => {
    if (state?.error) {
      // console.warn("VirtualizedStoryList: Error from state:", state.error);
      setError(state.error);
    }
  }, [state?.error]);

  // Show initial loading state
  if (isLocalLoading && !levels.length) {
    return (
      <div className="loading" role="alert" aria-busy="true">
        <div className="loading-spinner"></div>
        Loading story tree...
      </div>
    );
  }

  // Show error state
  if (error) {
    // console.warn("VirtualizedStoryList: Showing error state:", error);
    return <div className="error" role="alert">Error: {error}</div>;
  }

  // Memoize the item renderer function to prevent unnecessary re-renders
  const itemRenderer = useMemo(() => {
    return ({ index, style }: { index: number, style: React.CSSProperties }) => {
      const level = state?.storyTree?.levels?.[index];
      if (!level) {
        return <RowFallback style={style} index={index} />;
      }
      // Log the props passed to Row for debugging propagation
      // console.log('VirtualizedStoryList: Rendering Row', { index, levelData: level });
      return (
        <MemoizedRow
          levelData={level}
          style={style}
          setSize={(height) => {
            if (height > 0) {
              sizeMap.current.set(index, height);
            }
          }}
          shouldHide={!!(replyTarget?.levelNumber) && !!(getLevelNumber(level)) && replyTarget.levelNumber < getLevelNumber(level)!}
          index={index}
        />
      );
    };
  }, [state?.storyTree?.levels, replyTarget]);

  // Show content with potential loading more indicator
  return (
    <div style={{ height: '100%', overflow: 'visible' }} role="list" aria-label="Story tree content">
      <AutoSizer>
        {({ height, width }) => {
          return (
            <InfiniteLoader
              isItemLoaded={(index) => {
                const isLoaded = index < levels.length;
                return isLoaded;
              }}
              itemCount={listSize} 
              loadMoreItems={async (startIndex: number, stopIndex: number) => {
                return storyTreeOperator.loadMoreLevels(startIndex, stopIndex);
              }}
              minimumBatchSize={10}
              threshold={5}
            >
              {({ onItemsRendered, ref }) => {
                const refSetter = (list: VariableSizeList | null) => {
                  listRef.current = list;
                  if (typeof ref === 'function') {
                    ref(list);
                  }
                };

                return (
                  <VariableSizeList
                    height={height}
                    width={width}
                    itemCount={levels.length}
                    itemSize={(index) => {
                      const size = sizeMap.current.get(index) || 200;
                      return size;
                    }}
                    overscanCount={5}
                    ref={refSetter}
                    onItemsRendered={(props) => {
                      onItemsRendered(props);
                    }}
                  >
                    {itemRenderer}
                  </VariableSizeList>
                );
              }}
            </InfiniteLoader>
          );
        }}
      </AutoSizer>
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