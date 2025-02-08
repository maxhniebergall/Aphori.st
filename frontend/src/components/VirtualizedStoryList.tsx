/**
 * Requirements:
 * - React-window for virtualized list rendering
 * - useRef for container reference management
 * - Dynamic height calculations for variable-sized rows using useDynamicRowHeight hook
 * - Infinite loading support with InfiniteLoader
 * - ResizeObserver for dynamic content updates encapsulated in useDynamicRowHeight
 * - Proper error handling for invalid nodes
 * - Memory efficient row rendering with React.memo
 * - Responsive height calculations based on window size
 * - Proper cleanup of resize observers done in useDynamicRowHeight hook
 * - Hide descendant nodes when in reply mode using row indices
 * - Dynamic height recalculation for hidden nodes via useDynamicRowHeight hook
 * - Implement minimumBatchSize and threshold for InfiniteLoader
 * - Implement overscanCount for react-window List
 * - Use AutoSizer for dynamic list sizing
 * - Display story title and subtitle in the root node
 * - Handle reply-based navigation
 * - Support quote-based filtering
 * - Support pagination for replies
 * - Auto-scroll to bottom when nodes are hidden during reply
 * - TypeScript support
 * - Proper type definitions for all props and state
 * - Type safety for context usage
 * - Proper interface definitions for component props
 * - Type checking for ref objects
 * - Type safety for event handlers
 * - Accessibility support for keyboard navigation
 * - Mobile-friendly touch interactions
 * - Performance optimization for large lists
 * - Proper memory management for large datasets
 * - Support for dynamic content updates
 * - Error boundary implementation
 * - Use useInfiniteNodes hook for infinite node fetching
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { 
  ListChildComponentProps, 
  VariableSizeList, 
  ListOnItemsRenderedProps 
} from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import StoryTreeNode from './StoryTreeNode';
import { useReplyContext } from '../context/ReplyContext';
import { useStoryTree } from '../context/StoryTreeContext';
import { StoryTreeNode as StoryTreeNodeType } from '../context/types';
import useDynamicRowHeight from '../hooks/useDynamicRowHeight';
import useInfiniteNodes, { InfiniteNodesResult } from '../hooks/useInfiniteNodes';
import Row from './Row';

interface VirtualizedStoryListProps {
  postRootId: string;
  items: StoryTreeNodeType[];
  hasNextPage: boolean;
  isItemLoaded: (index: number) => boolean;
  loadMoreItems: (startIndex: number, stopIndex: number) => Promise<void>;
  setIsFocused: (focused: boolean) => void;
  handleSiblingChange: (
    newNode: StoryTreeNodeType,
    index: number,
    fetchNode: (id: string) => Promise<void>
  ) => void;
  fetchNode: (id: string) => Promise<void>;
}

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = ({
  postRootId,
  items,
  hasNextPage,
  isItemLoaded,
  loadMoreItems,
  setIsFocused,
  handleSiblingChange,
  fetchNode,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const listRef = useRef<VariableSizeList | null>(null);
  const sizeMap = useRef<{ [index: number]: number }>({});
  const [totalContentHeight, setTotalContentHeight] = useState<number>(0);
  const { state } = useStoryTree();

  const [replyTargetIndex, setReplyTargetIndex] = useState<number | undefined>(undefined);
  const { replyTarget } = useReplyContext();

  // Use the new infinite node fetching hook for node items.
  const {
    items: fetchedItems,
    loadMoreItems: fetchMoreNodes,
    isItemLoaded: checkItemLoaded,
    error,
    isLoading,
    reset,
  } = useInfiniteNodes<StoryTreeNodeType>(items, loadMoreItems, hasNextPage);

  const setSize = useCallback((index: number, size: number) => {
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
    const newTotalHeight = Object.values(sizeMap.current).reduce((sum, height) => sum + height, 0);
    setTotalContentHeight(newTotalHeight);
  }, []);

  // Update reply target index based on the current reply target.
  useEffect(() => {
    if (!replyTarget) {
      setReplyTargetIndex(undefined);
      listRef.current?.resetAfterIndex(0);
      return;
    }

    const targetIndex = fetchedItems.findIndex(
      (item) => item?.storyTree?.id === replyTarget.storyTree.id
    );

    if (targetIndex >= 0) {
      setReplyTargetIndex(targetIndex);
      listRef.current?.resetAfterIndex(targetIndex);
    }
  }, [replyTarget, fetchedItems]);

  // Update size on window resize.
  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const containerHeight = containerRef.current.clientHeight;
      setSize(0, containerHeight);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [totalContentHeight, setSize]);

  // Auto-scroll to the reply target if set.
  useEffect(() => {
    const scrollToReplyTarget = () => {
      if (replyTargetIndex !== undefined && listRef.current) {
        // Wait for the next tick to ensure row heights have been recalculated.
        setTimeout(() => {
          listRef.current?.scrollToItem(replyTargetIndex, 'end');
        }, 0);
      }
    };

    scrollToReplyTarget();
  }, [replyTargetIndex, totalContentHeight]);

  // Calculate additional height from any quote metadata.
  const getQuoteMetadataHeight = useCallback(
    (node: StoryTreeNodeType | null): number => {
      if (!node?.storyTree?.id) return 0;
      const metadata = state.quoteMetadata[node.storyTree.id];
      if (!metadata) return 0;
      const quotesCount = Object.keys(metadata).length;
      const baseHeight = 24;
      const quoteHeight = 48;
      return quotesCount > 0 ? baseHeight + quotesCount * quoteHeight : 0;
    },
    [state.quoteMetadata]
  );

  // Determine row height based on dynamic sizing plus potential quote metadata.
  const getSize = useCallback(
    (index: number): number => {
      // If index is beyond the reply target, return zero height.
      if (replyTargetIndex !== undefined && index > replyTargetIndex) {
        return 0;
      }

      const node = fetchedItems[index];
      const baseHeight = Math.max(sizeMap.current[index] || 200, 100);
      const metadataHeight = getQuoteMetadataHeight(node);
      return baseHeight + metadataHeight;
    },
    [replyTargetIndex, fetchedItems, getQuoteMetadataHeight]
  );

  const renderRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const node = fetchedItems[index];
      const isLoadingRow = !checkItemLoaded(index);
      const parentId =
        index <= 0 ? postRootId : fetchedItems[index - 1]?.storyTree?.id || postRootId;

      return (
        <Row
          index={index}
          style={style}
          node={node}
          setSize={setSize}
          handleSiblingChange={handleSiblingChange}
          fetchNode={fetchNode}
          isLoading={isLoadingRow}
          postRootId={postRootId}
          replyTargetIndex={replyTargetIndex}
          parentId={parentId}
          setIsFocused={setIsFocused}
        />
      );
    },
    [
      fetchedItems,
      checkItemLoaded,
      postRootId,
      setSize,
      handleSiblingChange,
      fetchNode,
      replyTargetIndex,
      setIsFocused,
    ]
  );

  // When there are no items and no pending page, don't render the list.
  if (!fetchedItems?.length && !hasNextPage) {
    return null;
  }

  const rootNode = fetchedItems[0];
  const totalPossibleItems = rootNode?.storyTree?.nodes?.length
    ? rootNode.storyTree.nodes.length + 1
    : rootNode?.storyTree?.metadata?.quote
    ? state?.replyPagination?.totalItems || fetchedItems.length
    : fetchedItems.length || 1;

  const itemCount = hasNextPage
    ? Math.max(fetchedItems.length + 1, totalPossibleItems)
    : fetchedItems.length;

  return (
    <div style={{ height: '100%', overflow: 'visible' }} ref={containerRef}>
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <InfiniteLoader
            isItemLoaded={checkItemLoaded}
            itemCount={itemCount}
            loadMoreItems={fetchMoreNodes}
            threshold={15}
            minimumBatchSize={10}
          >
            {({ onItemsRendered, ref }) => (
              <VariableSizeList
                ref={(list) => {
                  ref(list);
                  listRef.current = list;
                }}
                height={height}
                itemCount={itemCount}
                itemSize={getSize}
                onItemsRendered={onItemsRendered}
                width={width}
                className="story-list"
                overscanCount={3}
              >
                {renderRow}
              </VariableSizeList>
            )}
          </InfiniteLoader>
        )}
      </AutoSizer>
    </div>
  );
};

export default VirtualizedStoryList; 