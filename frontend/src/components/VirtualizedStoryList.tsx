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

import React, { useRef, useEffect, useState } from 'react';
import { VariableSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import { useStoryTree } from '../context/StoryTreeContext';
import { useReplyContext } from '../context/ReplyContext';
import { StoryTreeLevel } from '../types/types';
import storyTreeOperator from '../operators/StoryTreeOperator';
import Row from './Row';

interface VirtualizedStoryListProps {
  postRootId: string;
}

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = ({ postRootId }) => {
  const { state } = useStoryTree();
  const [isLocalLoading, setIsLocalLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<VariableSizeList>(null);
  const sizeMap = useRef<{ [key: number]: number }>({});
  const [levels, setLevels] = useState<StoryTreeLevel[]>([]);
  const { replyTarget } = useReplyContext();

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
  }, [postRootId, state?.storyTree?.levels]);
  // Set error
  useEffect(() => {
    if (state?.error) {
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
    return <div className="error" role="alert">Error: {error}</div>;
  }

  // Show content with potential loading more indicator
  return (
    <div style={{ height: '100%', overflow: 'visible' }} role="list" aria-label="Story tree content">
      <AutoSizer>
        {({ height, width }) => (
          <InfiniteLoader
            isItemLoaded={(index) => index < levels.length}
            itemCount={Number.MAX_SAFE_INTEGER} // TODO: we need to actually get the total number of levels
            loadMoreItems={storyTreeOperator.loadMoreLevels}
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
                  itemSize={(index) => sizeMap.current[index] || 50}
                  overscanCount={5}
                  ref={refSetter}
                  onItemsRendered={onItemsRendered}
                >
                  {({ index, style }) => {
                    const level = levels[index];
                    if (!level) return null;

                    return (
                      <Row
                        style={style}
                        levelData={level}
                        setSize={(height) => {
                          sizeMap.current[index] = height;
                          if (listRef.current) {
                            listRef.current.resetAfterIndex(index);
                          }
                        }}
                        shouldHide={!!(replyTarget?.levelNumber) && (replyTarget.levelNumber > level.levelNumber)}
                        index={index}
                      />
                    );
                  }}
                </VariableSizeList>
              );
            }}
          </InfiniteLoader>
        )}
      </AutoSizer>
      {isLocalLoading && levels.length > 0 && (
        <div className="loading-more" role="alert" aria-busy="true">
          <div className="loading-spinner"></div>
          Loading more...
        </div>
      )}
    </div>
  );
};

export default VirtualizedStoryList; 