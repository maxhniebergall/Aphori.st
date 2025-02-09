/**
 * Requirements:
 * - React-window for virtualized list rendering
 * - Efficient row height management
 * - Support for infinite loading
 * - Support for reply mode
 * - TypeScript support
 * - Utilize StoryTreeContext for state management (removes redundant props)
 */

import React, { useCallback, useRef, useEffect, useMemo } from 'react';
import { ListChildComponentProps, VariableSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import Row from './Row';
import { useReplyContext } from '../context/ReplyContext';
import { useStoryTree } from '../context/StoryTreeContext';
import storyTreeOperator from '../operators/StoryTreeOperator';
import { storyTreeActions } from '../context/StoryTreeActions';
import { StoryTreeLevel } from '../context/types'; // Make sure this is imported if needed

interface VirtualizedStoryListProps {
  postRootId: string;
  setIsFocused: (focused: boolean) => void;
}

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = ({ postRootId, setIsFocused }) => {
  const listRef = useRef<VariableSizeList | null>(null);
  const sizeMap = useRef<{ [index: number]: number }>({});
  const { state, dispatch } = useStoryTree();
  const { replyTarget } = useReplyContext();
  const nodes = state.nodes;
  const hasNextPage = state.hasNextPage;
  
  // Memoize replyTargetIndex calculation
  const replyTargetIndex = useMemo(() => 
    replyTarget?.storyTree?.id 
      ? nodes.findIndex(node => node?.storyTree?.id === replyTarget.storyTree?.id)
      : undefined,
    [replyTarget?.storyTree?.id, nodes]
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
    const node = nodes[index];
    const baseHeight = Math.max(sizeMap.current[index] || 200, 100);
    if (node?.storyTree?.id) {
      const metadata = state.quoteMetadata[node.storyTree.id];
      if (metadata) {
        const quotesCount = Object.keys(metadata).length;
        return baseHeight + (quotesCount > 0 ? 24 + quotesCount * 48 : 0);
      }
    }
    return baseHeight;
  }, [replyTargetIndex, nodes, state.quoteMetadata]);

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
    const result = await storyTreeOperator.fetchNode(id);
    if (!result) return null;
    return {
      id: result.storyTree.id,
      content: result.storyTree.text || '',
      storyTree: result.storyTree,
      metadata: result.storyTree.metadata
    };
  }, []);

  // Update handleSiblingChangeWrapper to use the correct fetchNode type
  const handleSiblingChangeWrapper = useCallback(
    (newNode: StoryTreeLevel, index: number, _fetchNode: (id: string) => Promise<void>) => {
      storyTreeActions.handleSiblingChange(dispatch, { 
        newNode, 
        index, 
        fetchNode: fetchNodeForSiblingChange 
      });
    },
    [dispatch, fetchNodeForSiblingChange]
  );

  // Create a wrapper for fetchNode that returns void
  const fetchNodeWrapper = useCallback(async (id: string): Promise<void> => {
    await storyTreeOperator.fetchNode(id);
  }, []);

  // Memoize row rendering function
  const renderRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      const node = nodes[index];
      const parentId = index <= 0 ? postRootId : nodes[index - 1]?.storyTree?.id || postRootId;
      
      return (
        <Row
          index={index}
          style={style}
          node={node}
          setSize={setSize}
          isLoading={!storyTreeOperator.isItemLoaded(index)}
          postRootId={postRootId}
          replyTargetIndex={replyTargetIndex}
          parentId={parentId}
          setIsFocused={setIsFocused}
          handleSiblingChange={handleSiblingChangeWrapper}
          fetchNode={fetchNodeWrapper}
        />
      );
    },
    [nodes, postRootId, setSize, replyTargetIndex, setIsFocused, handleSiblingChangeWrapper, fetchNodeWrapper]
  );

  // Memoize InfiniteLoader props
  const infiniteLoaderProps = useMemo(() => ({
    isItemLoaded: (index: number) => storyTreeOperator.isItemLoaded(index),
    itemCount: hasNextPage ? nodes.length + 1 : nodes.length,
    loadMoreItems: async (startIndex: number, stopIndex: number) => {
      await storyTreeOperator.loadMoreItems(startIndex, stopIndex);
    },
    threshold: 15,
    minimumBatchSize: 10
  }), [hasNextPage, nodes.length]);

  // Memoize list props
  const getListProps = useCallback((height: number, width: number) => ({
    ref: (list: VariableSizeList | null) => {
      listRef.current = list;
    },
    height,
    itemCount: hasNextPage ? nodes.length + 1 : nodes.length,
    itemSize: getSize,
    width,
    className: "story-list",
    overscanCount: 3
  }), [hasNextPage, nodes.length, getSize]);

  if (!nodes.length && !hasNextPage) {
    return null;
  }

  return (
    <div style={{ height: '100%', overflow: 'visible' }}>
      <AutoSizer>
        {({ height, width }) => (
          <InfiniteLoader {...infiniteLoaderProps}>
            {({ onItemsRendered, ref }) => (
              <VariableSizeList
                {...getListProps(height, width)}
                onItemsRendered={onItemsRendered}
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