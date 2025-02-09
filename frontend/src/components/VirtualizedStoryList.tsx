/**
 * Requirements:
 * - React-window for virtualized list rendering
 * - Efficient row height management
 * - Support for infinite loading
 * - Support for reply mode
 * - TypeScript support
 */

import React, { useCallback, useRef, useEffect } from 'react';
import { ListChildComponentProps, VariableSizeList } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import Row from './Row';
import { StoryTreeLevel } from '../context/types';
import { useReplyContext } from '../context/ReplyContext';
import { useStoryTree } from '../context/StoryTreeContext';

interface VirtualizedStoryListProps {
  postRootId: string;
  nodes: StoryTreeLevel[];
  hasNextPage: boolean;
  isItemLoaded: (index: number) => boolean;
  loadMoreItems: (startIndex: number, stopIndex: number) => Promise<StoryTreeLevel[]>;
  setIsFocused: (focused: boolean) => void;
  handleSiblingChange: (
    newNode: StoryTreeLevel,
    index: number,
    fetchNode: (id: string) => Promise<void>
  ) => void;
  fetchNode: (id: string) => Promise<void>;
}

const VirtualizedStoryList: React.FC<VirtualizedStoryListProps> = ({
  postRootId,
  nodes,
  hasNextPage,
  isItemLoaded,
  loadMoreItems,
  setIsFocused,
  handleSiblingChange,
  fetchNode,
}) => {
  const listRef = useRef<VariableSizeList | null>(null);
  const sizeMap = useRef<{ [index: number]: number }>({});
  const { state } = useStoryTree();
  const { replyTarget } = useReplyContext();

  // Find reply target index
  const replyTargetIndex = replyTarget?.storyTree?.id 
    ? nodes.findIndex(node => node?.storyTree?.id === replyTarget.storyTree?.id)
    : undefined;

  // Simple size management
  const setSize = useCallback((index: number, size: number) => {
    if (sizeMap.current[index] === size) return;
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
  }, []);

  // Calculate row height including metadata
  const getSize = useCallback((index: number): number => {
    // Hide nodes after reply target
    if (replyTargetIndex !== undefined && index > replyTargetIndex) {
      return 0;
    }

    const node = nodes[index];
    const baseHeight = Math.max(sizeMap.current[index] || 200, 100);
    
    // Add height for quote metadata if present
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
          handleSiblingChange={handleSiblingChange}
          fetchNode={fetchNode}
          isLoading={!isItemLoaded(index)}
          postRootId={postRootId}
          replyTargetIndex={replyTargetIndex}
          parentId={parentId}
          setIsFocused={setIsFocused}
        />
      );
    },
    [nodes, postRootId, setSize, handleSiblingChange, fetchNode, isItemLoaded, replyTargetIndex, setIsFocused]
  );

  if (!nodes.length && !hasNextPage) {
    return null;
  }

  return (
    <div style={{ height: '100%', overflow: 'visible' }}>
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <InfiniteLoader
            isItemLoaded={isItemLoaded}
            itemCount={hasNextPage ? nodes.length + 1 : nodes.length}
            loadMoreItems={async (startIndex: number, stopIndex: number) => {
              await loadMoreItems(startIndex, stopIndex);
            }}
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
                itemCount={hasNextPage ? nodes.length + 1 : nodes.length}
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