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
  fetchNode
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
        key={node.id}
        node={node}
        index={index}
        setCurrentFocus={setIsFocused}
        siblings={node.siblings || []}
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

  const renderRow = ({ index, style }) => {
    const node = items[index];
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
      />
    );
  };

  return (
    <InfiniteLoader
      isItemLoaded={isItemLoaded}
      itemCount={items.length + (hasNextPage ? 1 : 0)}
      loadMoreItems={loadMoreItems}
      threshold={2}
      minimumBatchSize={1}
    >
      {({ onItemsRendered, ref }) => (
        <List
          ref={(list) => {
            ref(list);
            listRef.current = list;
          }}
          height={WINDOW_HEIGHT}
          itemCount={items.length}
          itemSize={getSize}
          onItemsRendered={onItemsRendered}
          width="100%"
          className="story-list"
        >
          {renderRow}
        </List>
      )}
    </InfiniteLoader>
  );
}

export default VirtualizedStoryList;