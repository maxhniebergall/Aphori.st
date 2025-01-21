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
 * - Hide child nodes when in reply mode
 * - Implement minimumBatchSize and threshold for InfiniteLoader
 * - Implement overscanCount for react-window List
 * - Use AutoSizer for dynamic list sizing
 * - Display story title and subtitle in the root node
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import AutoSizer from 'react-virtualized-auto-sizer';
import StoryTreeNode from './StoryTreeNode';

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
  onNodeReply,
  replyTarget,
}) => {
  React.useEffect(() => {
    const updateSize = () => {
      if (rowRefs.current[index]) {
        const element = rowRefs.current[index];
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.visibility = 'hidden';
        tempDiv.style.height = 'auto';
        tempDiv.style.width = element.offsetWidth + 'px';
        tempDiv.innerHTML = element.innerHTML;
        document.body.appendChild(tempDiv);
        
        let naturalHeight = tempDiv.offsetHeight;
        
        document.body.removeChild(tempDiv);
        setSize(index, naturalHeight + 32);
      }
    };

    updateSize();

    if (rowRefs.current[index]) {
      const resizeObserver = new ResizeObserver(() => {
        updateSize();
      });
      resizeObserver.observe(rowRefs.current[index]);
      return () => resizeObserver.disconnect();
    }
  }, [setSize, index, rowRefs]);
  
  if (isLoading) {
    return (
      <div 
        className="loading-row"
        ref={el => rowRefs.current[index] = el}
        style={{
          ...style,
          position: 'absolute',
          left: 0,
          right: 0,
          width: '100%',
          padding: '20px',
          boxSizing: 'border-box'
        }}
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
        style={{
          ...style,
          position: 'absolute',
          left: 0,
          right: 0,
          width: '100%',
          padding: '20px',
          boxSizing: 'border-box'
        }}
      >
        <div className="loading-placeholder">Loading node...</div>
      </div>
    );
  }

  return (
    <div 
      ref={el => rowRefs.current[index] = el} 
      className="row-container"
      style={{
        ...style,
        position: 'absolute',
        left: 0,
        right: 0,
        width: '100%',
        padding: '0 20px',
        boxSizing: 'border-box'
      }}
    >
      <StoryTreeNode
        key={node?.id}
        node={node}
        siblings={Array.isArray(node?.siblings) ? node.siblings : []}
        onSiblingChange={(newNode) => handleSiblingChange(newNode, index, fetchNode)}
        postRootId={postRootId}
        onNodeReply={onNodeReply}
        isReplyTarget={replyTarget?.id === node?.id}
      />
    </div>
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
  fetchNode,
  onNodeReply,
  replyTarget,
}) {
  const containerRef = useRef(null);
  const listRef = useRef();
  const sizeMap = useRef({});
  const rowRefs = useRef({});
  const [totalContentHeight, setTotalContentHeight] = useState(0);

  const setSize = useCallback((index, size) => {
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
    const newTotalHeight = Object.values(sizeMap.current).reduce((sum, height) => sum + height, 0);
    setTotalContentHeight(newTotalHeight);
  }, []);

  const getSize = useCallback((index) => {
    return Math.max(sizeMap.current[index] || 200, 100);
  }, []);

  const handleLoadMoreItems = useCallback(async (startIndex, stopIndex) => {
    return loadMoreItems(startIndex, stopIndex);
  }, [loadMoreItems]);

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

  const renderRow = ({ index, style }) => {
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
        onNodeReply={onNodeReply}
        replyTarget={replyTarget}
      />
    );
  };

  if (!items?.length && !hasNextPage) {
    return null;
  }

  const rootNode = items[0];
  const totalPossibleItems = rootNode?.nodes?.length ? rootNode.nodes.length + 1 : items.length || 1;
  const itemCount = hasNextPage ? Math.max(items.length + 1, totalPossibleItems) : items.length;

  return (
    <div style={{ 
      height: '100%',
      overflow: 'visible'
    }}
    ref={containerRef}
    >
      <AutoSizer>
        {({ height, width }) => (
          <InfiniteLoader
            isItemLoaded={isItemLoaded}
            itemCount={itemCount}
            loadMoreItems={handleLoadMoreItems}
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