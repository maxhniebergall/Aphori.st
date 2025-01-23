/*
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
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import StoryTreeNode from './StoryTreeNode';
import { useReplyContext } from '../context/ReplyContext';
import { useStoryTree } from '../context/StoryTreeContext';

const Row = React.memo(({ 
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
}) => {
  const { replyTarget } = useReplyContext();
  const memoizedStyle = React.useMemo(() => ({
    ...style,
    position: 'absolute',
    left: 0,
    right: 0,
    width: '100%',
    padding: '20px',
    boxSizing: 'border-box'
  }), [style]);

  const shouldHideNode = React.useMemo(() => {
    if (!replyTarget || replyTargetIndex === undefined) return false;
    if (!node) return false;
    
    // Show nodes that come before the reply target (ancestors)
    return index > replyTargetIndex;
  }, [replyTarget, replyTargetIndex, index, node]);

  React.useEffect(() => {
    const updateSize = () => {
      if (rowRefs.current[index]) {
        const element = rowRefs.current[index];
        
        // If node should be hidden, set height to 0
        if (shouldHideNode) {
          setSize(index, 0);
          return;
        }
        
        // Get the actual rendered height including all children
        const titleSection = element.querySelector('.story-title-section');
        const textSection = element.querySelector('.story-tree-node-text');
        const footer = element.querySelector('.story-tree-node-footer');
        const replySection = element.querySelector('.reply-section');
        
        let totalHeight = 0;
        
        // Add heights of all sections
        if (titleSection) totalHeight += titleSection.offsetHeight;
        if (textSection) totalHeight += textSection.offsetHeight;
        if (footer) totalHeight += footer.offsetHeight;
        if (replySection) totalHeight += replySection.offsetHeight;
        
        // Add padding
        totalHeight += 32;
        
        // Set minimum height
        totalHeight = Math.max(totalHeight, 100);
        
        setSize(index, totalHeight);
      }
    };

    updateSize();

    if (rowRefs.current[index]) {
      const resizeObserver = new ResizeObserver(() => {
        if (!shouldHideNode) {
          updateSize();
        }
      });
      resizeObserver.observe(rowRefs.current[index]);
      return () => resizeObserver.disconnect();
    }
  }, [setSize, index, rowRefs, node, postRootId, shouldHideNode]);
  
  if (shouldHideNode) {
    return (
      <div
        ref={el => rowRefs.current[index] = el}
        style={{ ...memoizedStyle, height: 0, padding: 0, overflow: 'hidden' }}
      />
    );
  }

  if (isLoading) {
    return (
      <div 
        className="loading-row"
        ref={el => rowRefs.current[index] = el}
        style={memoizedStyle}
      >
        <div className="loading-placeholder">Loading...</div>
      </div>
    );
  }

  if (!node || typeof node !== 'object') {
    console.warn(`Invalid node at index ${index}:`, node);
    return (
      <div 
        ref={el => rowRefs.current[index] = el}
        style={memoizedStyle}
      >
        <div className="loading-placeholder">Loading node...</div>
      </div>
    );
  }

  return (
    <div 
      ref={el => rowRefs.current[index] = el} 
      className="row-container"
      style={memoizedStyle}
    >
      <StoryTreeNode
        key={node?.id}
        node={node}
        onSiblingChange={(newNode) => handleSiblingChange(newNode, index, fetchNode)}
        postRootId={postRootId}
      />
    </div>
  );
}, (prevProps, nextProps) => {
  return (
    prevProps.node?.id === nextProps.node?.id &&
    prevProps.isLoading === nextProps.isLoading &&
    prevProps.index === nextProps.index &&
    prevProps.style.top === nextProps.style.top
  );
});

function VirtualizedStoryList({
  postRootId,
  items,
  hasNextPage,
  isItemLoaded,
  loadMoreItems,
  setIsFocused,
  handleSiblingChange,
  fetchNode
}) {
  const containerRef = useRef(null);
  const listRef = useRef();
  const sizeMap = useRef({});
  const rowRefs = useRef({});
  const [totalContentHeight, setTotalContentHeight] = useState(0);
  const { state } = useStoryTree();

  // Add state to track reply target index
  const [replyTargetIndex, setReplyTargetIndex] = useState(undefined);
  const { replyTarget } = useReplyContext();

  // Add effect to find reply target index
  useEffect(() => {
    if (!replyTarget || !items) {
      setReplyTargetIndex(undefined);
      return;
    }

    const targetIndex = items.findIndex(item => item?.id === replyTarget.id);
    setReplyTargetIndex(targetIndex >= 0 ? targetIndex : undefined);
  }, [replyTarget, items]);

  const memoizedLoadMoreItems = useCallback(loadMoreItems, [loadMoreItems]);

  const setSize = useCallback((index, size) => {
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
    const newTotalHeight = Object.values(sizeMap.current).reduce((sum, height) => sum + height, 0);
    setTotalContentHeight(newTotalHeight);
  }, []);

  const getQuoteMetadataHeight = useCallback((node) => {
    if (!node?.id) return 0;
    
    const metadata = state.quoteMetadata[node.id];
    if (!metadata) return 0;

    // Calculate height based on number of quotes and their stats
    const quotesCount = Object.keys(metadata).length;
    const baseHeight = 24; // Height for total replies count
    const quoteHeight = 48; // Height per quote stat
    return quotesCount > 0 ? baseHeight + (quotesCount * quoteHeight) : 0;
  }, [state.quoteMetadata]);

  const getSize = useCallback((index) => {
    // Return 0 for hidden nodes
    if (replyTargetIndex !== undefined && index > replyTargetIndex) {
      return 0;
    }

    const node = items[index];
    const baseHeight = Math.max(sizeMap.current[index] || 200, 100);
    const metadataHeight = getQuoteMetadataHeight(node);
    
    return baseHeight + metadataHeight;
  }, [replyTargetIndex, items, getQuoteMetadataHeight]);

  useEffect(() => {
    const handleResize = () => {
      if (!containerRef.current) return;
      const containerHeight = containerRef.current.clientHeight;
      setSize(containerHeight);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [totalContentHeight, setSize]);

  // Add effect to scroll to bottom when nodes are hidden
  useEffect(() => {
    if (replyTargetIndex !== undefined && listRef.current) {
      // Wait for next tick to ensure heights are recalculated
      setTimeout(() => {
        listRef.current.scrollToItem(replyTargetIndex, 'end');
      }, 0);
    }
  }, [replyTargetIndex, totalContentHeight]);

  const renderRow = useCallback(({ index, style }) => {
    const node = items[index];
    const isLoading = !isItemLoaded(index);
    
    return (
      <Row
        className="row"
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
      />
    );
  }, [items, isItemLoaded, setIsFocused, setSize, handleSiblingChange, fetchNode, postRootId, replyTargetIndex]);

  if (!items?.length && !hasNextPage) {
    return null;
  }

  const rootNode = items[0];
  const totalPossibleItems = rootNode?.nodes?.length 
    ? rootNode.nodes.length + 1 
    : (rootNode?.metadata?.quote 
      ? state?.replyPagination?.totalItems || items.length 
      : items.length) || 1;
  
  const itemCount = hasNextPage 
    ? Math.max(items.length + 1, totalPossibleItems) 
    : items.length;

  return (
    <div style={{ height: '100%', overflow: 'visible' }} ref={containerRef}>
      <AutoSizer>
        {({ height, width }) => (
          <InfiniteLoader
            isItemLoaded={isItemLoaded}
            itemCount={itemCount}
            loadMoreItems={memoizedLoadMoreItems}
            threshold={15}
            minimumBatchSize={10}
          >
            {({ onItemsRendered, ref }) => (
              <List
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
              </List>
            )}
          </InfiniteLoader>
        )}
      </AutoSizer>
    </div>
  );
}

export default VirtualizedStoryList;