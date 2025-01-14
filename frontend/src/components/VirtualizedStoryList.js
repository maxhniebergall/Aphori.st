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
 */

import React, { useCallback, useRef, useEffect, useState } from 'react';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import StoryTreeNode from './StoryTreeNode';

const Row = React.memo(({ 
  index, 
  style, 
  node, 
  setIsFocused, 
  setSize, 
  rowRefs,
  handleSiblingChange,
  fetchNode,
  isLoading
}) => {
  React.useEffect(() => {
    const updateSize = () => {
      if (rowRefs.current[index]) {
        const element = rowRefs.current[index];
        // Create a temporary div to measure the natural height
        const tempDiv = document.createElement('div');
        tempDiv.style.position = 'absolute';
        tempDiv.style.visibility = 'hidden';
        tempDiv.style.height = 'auto';
        tempDiv.style.width = element.offsetWidth + 'px';
        tempDiv.innerHTML = element.innerHTML;
        document.body.appendChild(tempDiv);
        
        const naturalHeight = tempDiv.offsetHeight;
        document.body.removeChild(tempDiv);
        
        setSize(index, naturalHeight + 32); // Add padding
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
        index={index}
        setCurrentFocus={setIsFocused}
        siblings={Array.isArray(node?.siblings) ? node.siblings : []}
        onSiblingChange={(newNode) => handleSiblingChange(newNode, index, fetchNode)}
      />
    </div>
  );
});

function VirtualizedStoryList({
  items,
  hasNextPage,
  isItemLoaded,
  loadMoreItems,
  setIsFocused,
  handleSiblingChange,
  fetchNode,
  replyToNodeId,
  onReplySubmit,
  onReplyClick,
}) {
  const containerRef = useRef(null);
  const listRef = useRef();
  const sizeMap = useRef({});
  const rowRefs = useRef({});
  const [listHeight, setListHeight] = useState(window.innerHeight);
  const [totalContentHeight, setTotalContentHeight] = useState(0);

  // Add resize observer to update list height
  useEffect(() => {
    if (!containerRef.current) return;

    const updateHeight = () => {
      if (containerRef.current) {
        setListHeight(containerRef.current.offsetHeight);
      }
    };

    const resizeObserver = new ResizeObserver(updateHeight);
    resizeObserver.observe(containerRef.current);
    updateHeight();

    return () => resizeObserver.disconnect();
  }, []);

  const setSize = useCallback((index, size) => {
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
    const newTotalHeight = Object.values(sizeMap.current).reduce((sum, height) => sum + height, 0);
    setTotalContentHeight(newTotalHeight);
  }, []);

  const getSize = useCallback((index) => {
    // Ensure minimum height for rows
    return Math.max(sizeMap.current[index] || 200, 100);
  }, []);

  const handleLoadMoreItems = useCallback(async (startIndex, stopIndex) => {
    return loadMoreItems(startIndex, stopIndex);
  }, [loadMoreItems]);

  useEffect(() => {
    const handleResize = () => {
      const headerHeight = document.querySelector('.story-tree-header')?.offsetHeight || 0;
      const titleHeight = document.querySelector('.story-title-section')?.offsetHeight || 0;
      const availableHeight = window.innerHeight - headerHeight - titleHeight;
      setListHeight(availableHeight);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [totalContentHeight]);

  const renderRow = ({ index, style }) => {
    const node = items[index];
    const isLoading = !isItemLoaded(index);
    
    console.log('Rendering row:', { index, isLoading, node });
    
    // Return loading placeholder if item is not loaded yet
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
            height: 'auto',
            width: '100%',
            padding: '20px',
            boxSizing: 'border-box'
          }}
        >
          <div className="loading-placeholder">Loading...</div>
        </div>
      );
    }

    // Return empty placeholder if node is undefined or invalid
    if (!node || typeof node !== 'object') {
      console.warn(`Invalid or undefined node at index ${index}:`, node);
      return (
        <div 
          ref={el => rowRefs.current[index] = el}
          style={{
            ...style,
            position: 'absolute',
            left: 0,
            right: 0,
            height: 'auto',
            width: '100%',
            padding: '20px',
            boxSizing: 'border-box'
          }}
        >
          <div className="empty-placeholder">No content available</div>
        </div>
      );
    }
    
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
        replyToNodeId={replyToNodeId}
        onReplyClick={onReplyClick}
      />
    );
  };

  // Don't render if there are no items and we're not expecting any
  if (!items?.length && !hasNextPage) {
    return null;
  }

  // Calculate total items based on root node's nodes array length plus one (for root node)
  const rootNode = items[0];
  const totalPossibleItems = rootNode?.nodes?.length ? rootNode.nodes.length + 1 : items.length || 1;
  const itemCount = hasNextPage ? Math.max(items.length + 1, totalPossibleItems) : items.length;

  return (
    <div style={{ 
      height: totalContentHeight < listHeight ? 'auto' : listHeight,
      overflow: totalContentHeight > listHeight ? 'auto' : 'hidden'
    }}>
      <InfiniteLoader
        isItemLoaded={isItemLoaded}
        itemCount={itemCount}
        loadMoreItems={handleLoadMoreItems}
        threshold={1}
        minimumBatchSize={1}
      >
        {({ onItemsRendered, ref }) => (
          <List
            ref={(list) => {
              ref(list);
              listRef.current = list;
            }}
            height={totalContentHeight < listHeight ? totalContentHeight : listHeight}
            itemCount={itemCount}
            itemSize={getSize}
            onItemsRendered={onItemsRendered}
            width="100%"
            className="story-list"
          >
            {renderRow}
          </List>
        )}
      </InfiniteLoader>
    </div>
  );
}

export default VirtualizedStoryList;