import React, { useCallback, useRef } from 'react';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import StoryTreeNode from './StoryTreeNode';

const WINDOW_HEIGHT = window.innerHeight - 60;

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
        const height = rowRefs.current[index].getBoundingClientRect().height;
        setSize(index, height);
      }
    };

    updateSize();

    if (rowRefs.current[index]) {
      const resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(rowRefs.current[index]);
      return () => resizeObserver.disconnect();
    }
  }, [setSize, index, rowRefs]);
  
  if (isLoading) {
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
        <div className="loading-placeholder">Loading...</div>
      </div>
    );
  }

  if (!node || typeof node !== 'object') {
    console.warn(`Invalid node at index ${index}:`, node);
    return null;
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
        height: 'auto',
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
  fetchNode
}) {
  const listRef = useRef();
  const sizeMap = useRef({});
  const rowRefs = useRef({});

  const setSize = useCallback((index, size) => {
    sizeMap.current[index] = size;
    listRef.current?.resetAfterIndex(index);
  }, []);

  const getSize = useCallback((index) => {
    return sizeMap.current[index] || 200;
  }, []);

  // Wrap loadMoreItems to add logging
  const handleLoadMoreItems = useCallback(async (startIndex, stopIndex) => {
    console.log('InfiniteLoader requesting items:', { startIndex, stopIndex });
    return loadMoreItems(startIndex, stopIndex);
  }, [loadMoreItems]);

  const renderRow = ({ index, style }) => {
    const node = items[index];
    const isLoading = !isItemLoaded(index);
    
    console.log('Rendering row:', { index, isLoading, node });
    
    return (
      <Row
        index={index}
        style={style}
        node={node}
        setIsFocused={setIsFocused}
        setSize={setSize}
        rowRefs={rowRefs}
        handleSiblingChange={handleSiblingChange}
        fetchNode={fetchNode}
        isLoading={isLoading}
      />
    );
  };

  // Don't render if there are no items and we're not expecting any
  if (!items?.length && !hasNextPage) {
    return null;
  }

  // Calculate total items based on root node's nodes array length plus one (for root node)
  const rootNode = items[0];
  const totalPossibleItems = rootNode?.nodes?.length ? rootNode.nodes.length + 1 : 1;
  const itemCount = Math.max(items?.length || 0, totalPossibleItems);

  console.log('VirtualizedStoryList render:', {
    itemCount,
    currentItems: items,
    rootNode
  });

  return (
    <InfiniteLoader
      isItemLoaded={isItemLoaded}
      itemCount={itemCount}
      loadMoreItems={handleLoadMoreItems}
      threshold={1}
      minimumBatchSize={1}
    >
      {({ onItemsRendered, ref }) => {
        console.log('InfiniteLoader rendered with ref:', ref);
        return (
          <List
            ref={(list) => {
              ref(list);
              listRef.current = list;
            }}
            height={20000}
            itemCount={itemCount}
            itemSize={getSize}
            onItemsRendered={(props) => {
              console.log('List onItemsRendered:', props);
              onItemsRendered(props);
            }}
            width="100%"
            className="story-list"
          >
            {renderRow}
          </List>
        );
      }}
    </InfiniteLoader>
  );
}

export default VirtualizedStoryList;