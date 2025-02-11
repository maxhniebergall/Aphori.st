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

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { ListChildComponentProps, VariableSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import Row from './Row';
import { useReplyContext } from '../context/ReplyContext';
import { useStoryTree } from '../context/StoryTreeContext';
import { storyTreeOperator } from '../operators/StoryTreeOperator';
import { storyTreeActions } from '../context/StoryTreeActions';
import { StoryTreeLevel } from '../context/types';

interface VirtualizedStoryListProps {
  postRootId: string;
}

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = ({ postRootId }) => {
  const listRef = useRef<VariableSizeList | null>(null);
  const sizeMap = useRef<{ [index: number]: number }>({});
  const { state, dispatch } = useStoryTree();
  const { replyTarget } = useReplyContext();

  // Extract relevant state
  const { levels, error, isLoading, isInitialized } = state;
  const hasNextPage = levels.length > 0 && levels[levels.length - 1].siblings.levelsMap.size > 0;

  // Memoize replyTargetIndex calculation
  const replyTargetIndex = useMemo(() => 
    replyTarget?.rootNodeId 
      ? levels.findIndex(level => level?.rootNodeId === replyTarget.rootNodeId)
      : undefined,
    [replyTarget?.rootNodeId, levels]
  );

  const setSize = useCallback((index: number, size: number) => {
    if (sizeMap.current[index] === size) return;
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
  }, []);

  const getSize = useCallback((index: number): number => {
    if (replyTargetIndex !== undefined && index > replyTargetIndex) {
      return 0;
    }
    const level = levels[index];
    const baseHeight = Math.max(sizeMap.current[index] || 200, 100);
    
    // Add extra height for quotes and metadata
    if (level?.siblings.levelsMap.size) {
      const quotesCount = Array.from(level.siblings.levelsMap.keys()).length;
      return baseHeight + (quotesCount > 0 ? 24 + quotesCount * 48 : 0);
    }
    
    return baseHeight;
  }, [replyTargetIndex, levels]);

  // Reset sizes on window resize
  useEffect(() => {
    const handleResize = () => {
      Object.keys(sizeMap.current).forEach(index => {
        listRef.current?.resetAfterIndex(Number(index));
      });
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Scroll to reply target when it changes
  useEffect(() => {
    if (replyTargetIndex !== undefined && listRef.current) {
      requestAnimationFrame(() => {
        listRef.current?.scrollToItem(replyTargetIndex, 'end');
      });
    }
  }, [replyTargetIndex]);

  // Create a wrapper for fetchNode that returns StoryTreeLevel | null
  const fetchNodeForSiblingChange = useCallback(async (id: string): Promise<StoryTreeLevel | null> => {
    return await storyTreeOperator.fetchNode(id);
  }, []);

  // Create a wrapper for fetchNode that returns void
  const fetchNodeWrapper = useCallback(async (id: string): Promise<void> => {
    await storyTreeOperator.fetchNode(id);
  }, []);

  // Update handleSiblingChangeWrapper to use the correct fetchNode type
  const handleSiblingChangeWrapper = useCallback(
    (newNode: StoryTreeLevel, index: number) => {
      storyTreeActions.handleSiblingChange(dispatch, { 
        newNode, 
        index, 
        fetchNode: fetchNodeForSiblingChange 
      });
    },
    [dispatch, fetchNodeForSiblingChange]
  );

  // Memoize row rendering function
  const renderRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const level = levels[index];
      const parentId = index <= 0 ? postRootId : levels[index - 1]?.rootNodeId || postRootId;
      
      return (
        <Row
          index={index}
          style={style}
          node={level}
          setSize={setSize}
          isLoading={!storyTreeOperator.isItemLoaded(index)}
          postRootId={postRootId}
          replyTargetIndex={replyTargetIndex}
          parentId={parentId}
          handleSiblingChange={handleSiblingChangeWrapper}
          fetchNode={fetchNodeWrapper}
        />
      );
    },
    [levels, postRootId, setSize, replyTargetIndex, handleSiblingChangeWrapper, fetchNodeWrapper]
  );

  // Memoize list props
  const getListProps = useCallback((height: number, width: number) => ({
    height,
    itemCount: hasNextPage ? levels.length + 1 : levels.length,
    itemSize: getSize,
    width,
    className: "story-list",
    overscanCount: 3
  }), [hasNextPage, levels.length, getSize]);

  // Memoize InfiniteLoader props
  const infiniteLoaderProps = useMemo(() => ({
    isItemLoaded: (index: number) => storyTreeOperator.isItemLoaded(index),
    itemCount: hasNextPage ? levels.length + 1 : levels.length,
    loadMoreItems: async (startIndex: number, stopIndex: number) => {
      await storyTreeActions.loadMoreItems(dispatch, {
        items: levels,
        fetchNode: fetchNodeForSiblingChange,
        removedFromView: []
      });
    },
    threshold: 15,
    minimumBatchSize: 10
  }), [hasNextPage, levels, dispatch, fetchNodeForSiblingChange]);

  if (isLoading) {
    return <div className="loading" role="alert" aria-busy="true">Loading story tree...</div>;
  }

  if (error) {
    return <div className="error" role="alert">Error: {error}</div>;
  }

  if (!levels.length && !hasNextPage) {
    return <div className="empty" role="status">No content available</div>;
  }

  return (
    <div style={{ height: '100%', overflow: 'visible' }} role="list" aria-label="Story tree content">
      <AutoSizer>
        {({ height, width }) => (
          <InfiniteLoader {...infiniteLoaderProps}>
            {({ onItemsRendered, ref }) => {
              const refSetter = (list: VariableSizeList | null) => {
                listRef.current = list;
                if (typeof ref === 'function') {
                  ref(list);
                }
              };

              return (
                <VariableSizeList
                  {...getListProps(height, width)}
                  ref={refSetter}
                  onItemsRendered={onItemsRendered}
                >
                  {renderRow}
                </VariableSizeList>
              );
            }}
          </InfiniteLoader>
        )}
      </AutoSizer>
    </div>
  );
};

export default VirtualizedStoryList; 