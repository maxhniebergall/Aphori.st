/**
 * Requirements:
 * - React-window for virtualized list rendering
 * - useRef for container reference management
 * - Dynamic height calculations for variable-sized rows
 * - Infinite loading support with InfiniteLoader
 * - ResizeObserver for dynamic content updates
 * - Proper error handling for invalid nodes
 * - Memory efficient row rendering with React.memo
 * - Responsive height calculations based on window size
 * - Proper cleanup of resize observers
 * - Hide descendant nodes when in reply mode using row indices
 * - Dynamic height recalculation for hidden nodes
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

interface RowProps extends Omit<ListChildComponentProps, 'data'> {
  node: StoryTreeNodeType | null;
  setSize: (index: number, size: number) => void;
  rowRefs: React.MutableRefObject<{ [key: number]: HTMLDivElement | null }>;
  handleSiblingChange: (
    newNode: StoryTreeNodeType,
    index: number,
    fetchNode: (id: string) => Promise<void>
  ) => void;
  fetchNode: (id: string) => Promise<void>;
  isLoading: boolean;
  postRootId: string;
  replyTargetIndex?: number;
  parentId: string;
  setIsFocused?: (focused: boolean) => void;
  className?: string;
}

const Row: React.FC<RowProps> = React.memo(
  ({
    index,
    style,
    node,
    setSize,
    rowRefs,
    handleSiblingChange,
    fetchNode,
    isLoading,
    postRootId,
    replyTargetIndex,
    parentId,
    setIsFocused,
  }) => {
    const { replyTarget } = useReplyContext();

    const shouldHideNode = React.useMemo((): boolean => {
      if (!replyTarget || replyTargetIndex === undefined) return false;
      return index > replyTargetIndex;
    }, [replyTarget, replyTargetIndex, index]);

    const memoizedStyle = React.useMemo((): React.CSSProperties => ({
      ...style,
      position: 'absolute',
      left: 0,
      right: 0,
      width: '100%',
      padding: '20px',
      boxSizing: 'border-box',
    }), [style]);

    React.useEffect(() => {
      const updateSize = () => {
        const element = rowRefs.current[index];
        if (!element) return;
        if (shouldHideNode) {
          setSize(index, 0);
          return;
        }

        const titleSection = element.querySelector('.story-title-section') as HTMLElement | null;
        const content = element.querySelector('.story-tree-node-content') as HTMLElement | null;
        const sibling = element.querySelector('.story-tree-node-content.has-siblings') as HTMLElement | null;
        const replySection = element.querySelector('.reply-section') as HTMLElement | null;

        let totalHeight = 0;
        if (titleSection) totalHeight += titleSection.offsetHeight;
        if (content) totalHeight += content.offsetHeight;
        if (replySection) totalHeight += replySection.offsetHeight;
        if (sibling) {
          totalHeight += sibling.offsetHeight + 64;
        }
        totalHeight += 24;
        totalHeight = Math.max(totalHeight, 100);

        setSize(index, totalHeight);
      };

      updateSize();

      const timeoutId = setTimeout(updateSize, 100);

      const element = rowRefs.current[index];
      if (element) {
        const resizeObserver = new ResizeObserver(() => {
          if (!shouldHideNode) {
            requestAnimationFrame(updateSize);
          }
        });
        resizeObserver.observe(element);
        const contentElement = element.querySelector('.story-tree-node-content');
        if (contentElement) {
          resizeObserver.observe(contentElement);
        }
        return () => {
          resizeObserver.disconnect();
          clearTimeout(timeoutId);
        };
      }
      return () => clearTimeout(timeoutId);
    }, [setSize, index, rowRefs, node, postRootId, shouldHideNode]);

    if (shouldHideNode) {
      return (
        <div
          ref={(el) => {
            rowRefs.current[index] = el;
          }}
          style={{
            ...memoizedStyle,
            height: 0,
            padding: 0,
            overflow: 'hidden',
            opacity: 0,
            pointerEvents: 'none'
          }}
        />
      );
    }

    if (isLoading) {
      return (
        <div
          className="loading-row"
          ref={el => {
            rowRefs.current[index] = el;
          }}
          style={memoizedStyle}
        >
          <div className="loading-placeholder">Loading...</div>
        </div>
      );
    }

    if (!node || typeof node !== 'object' || !node.storyTree || typeof node.storyTree !== 'object') {
      console.warn(`Invalid node or storyTree at index ${index}:`, {
        node,
        storyTreeExists: !!node?.storyTree,
        storyTreeType: typeof node?.storyTree,
      });
      return (
        <div
          ref={el => {
            rowRefs.current[index] = el;
          }}
          style={memoizedStyle}
        >
          <div className="loading-placeholder">Loading node...</div>
        </div>
      );
    }

    // Render title node differently
    if (node.storyTree.isTitleNode) {
      return (
        <div
          ref={el => {
            rowRefs.current[index] = el;
          }}
          className="row-container"
          style={memoizedStyle}
        >
          <div className="story-title-section">
            {node.storyTree.metadata?.title && <h1>{node.storyTree.metadata.title}</h1>}
            {node.storyTree.metadata?.author && (
              <h2 className="story-subtitle">by {node.storyTree.metadata.author}</h2>
            )}
          </div>
        </div>
      );
    }

    return (
      <div
        ref={el => {
          rowRefs.current[index] = el;
        }}
        className="row-container"
        style={memoizedStyle}
      >
        <StoryTreeNode
          key={node.storyTree.id}
          node={node}
          onSiblingChange={(newNode: StoryTreeNodeType) =>
            handleSiblingChange(newNode, index, fetchNode)
          }
          parentId={parentId}
        />
      </div>
    );
  },
  (prevProps, nextProps) => {
    return (
      prevProps.node?.storyTree?.id === nextProps.node?.storyTree?.id &&
      prevProps.isLoading === nextProps.isLoading &&
      prevProps.index === nextProps.index &&
      prevProps.style.top === nextProps.style.top
    );
  }
);

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
  const sizeMap = useRef<{ [key: number]: number }>({});
  const rowRefs = useRef<{ [key: number]: HTMLDivElement | null }>({});
  const [totalContentHeight, setTotalContentHeight] = useState<number>(0);
  const { state } = useStoryTree();

  const [replyTargetIndex, setReplyTargetIndex] = useState<number | undefined>(undefined);
  const { replyTarget } = useReplyContext();

  const memoizedLoadMoreItems = useCallback(loadMoreItems, [loadMoreItems]);

  const setSize = useCallback(
    (index: number, size: number) => {
      sizeMap.current[index] = size;
      listRef.current?.resetAfterIndex(index);
      const newTotalHeight = Object.values(sizeMap.current).reduce((sum, height) => sum + height, 0);
      setTotalContentHeight(newTotalHeight);
    },
    []
  );

  useEffect(() => {
    if (!replyTarget) {
      setReplyTargetIndex(undefined);
      if (listRef.current) {
        listRef.current.resetAfterIndex(0);
      }
      return;
    }

    const targetIndex = items.findIndex(
      (item) => item?.storyTree?.id === replyTarget.storyTree.id
    );

    if (targetIndex >= 0) {
      setReplyTargetIndex(targetIndex);
      if (listRef.current) {
        listRef.current.resetAfterIndex(targetIndex);
      }
    }
  }, [replyTarget, items]);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const containerHeight = containerRef.current.clientHeight;
      // Update row 0 size (if used for container sizing)
      setSize(0, containerHeight);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [totalContentHeight, setSize]);

  useEffect(() => {
    const scrollToReplyTarget = () => {
      if (replyTargetIndex !== undefined && listRef.current) {
        // Wait for the next tick to ensure row heights have been recalculated
        setTimeout(() => {
          if (listRef.current) {
            listRef.current.scrollToItem(replyTargetIndex, 'end');
          }
        }, 0);
      }
    };
    
    scrollToReplyTarget();
  }, [replyTargetIndex, totalContentHeight]);

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

  const getSize = useCallback(
    (index: number): number => {
      if (replyTargetIndex !== undefined && index > replyTargetIndex) {
        return 0;
      }

      const node = items[index];
      const baseHeight = Math.max(sizeMap.current[index] || 200, 100);
      const metadataHeight = getQuoteMetadataHeight(node);
      return baseHeight + metadataHeight;
    },
    [replyTargetIndex, items, getQuoteMetadataHeight]
  );

  const renderRow = useCallback(
    ({ index, style }: ListChildComponentProps) => {
      if (replyTargetIndex !== undefined && index > replyTargetIndex) {
        return null;
      }

      const node = items[index];
      const isLoading = !isItemLoaded(index);
      const parentId =
        index <= 0 ? postRootId : items[index - 1]?.storyTree?.id || postRootId;

      return (
        <Row
          className={`row ${replyTarget ? 'reply-mode' : ''}`}
          index={index}
          style={style}
          node={node}
          setIsFocused={setIsFocused}
          setSize={setSize}
          rowRefs={rowRefs}
          handleSiblingChange={handleSiblingChange}
          fetchNode={fetchNode}
          isLoading={isLoading}
          postRootId={postRootId}
          replyTargetIndex={replyTargetIndex}
          parentId={parentId}
        />
      );
    },
    [
      items,
      isItemLoaded,
      setIsFocused,
      setSize,
      handleSiblingChange,
      fetchNode,
      postRootId,
      replyTargetIndex,
      replyTarget
    ]
  );

  if (!items?.length && !hasNextPage) {
    return null;
  }

  const rootNode = items[0];
  const totalPossibleItems =
    rootNode?.storyTree?.nodes?.length
      ? rootNode.storyTree.nodes.length + 1
      : rootNode?.storyTree?.metadata?.quote
      ? state?.replyPagination?.totalItems || items.length
      : items.length || 1;

  const itemCount = hasNextPage
    ? Math.max(items.length + 1, totalPossibleItems)
    : items.length;

  return (
    <div style={{ height: '100%', overflow: 'visible' }} ref={containerRef}>
      <AutoSizer>
        {({ height, width }: { height: number; width: number }) => (
          <InfiniteLoader
            isItemLoaded={isItemLoaded}
            itemCount={itemCount}
            loadMoreItems={memoizedLoadMoreItems}
            threshold={15}
            minimumBatchSize={10}
          >
            {({
              onItemsRendered,
              ref,
            }: {
              onItemsRendered: (props: ListOnItemsRenderedProps) => void;
              ref: (list: VariableSizeList | null) => void;
            }) => (
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