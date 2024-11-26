import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import axios from 'axios';
import EditingOverlay from './EditingOverlay';
import StoryTreeNode from './StoryTreeNode';
import './StoryTree.css';
import StoryTreeHeader from './StoryTreeHeader';
import { 
  StoryTreeProvider, 
  useStoryTree, 
  ACTIONS,
  StoryTreeLoading 
} from '../context/StoryTreeContext';

// Constants
const WINDOW_HEIGHT = window.innerHeight - 60; // Adjust based on your header height

// Utility functions
const fetchNode = async (id) => {
  try {
    const response = await axios.get(
      `${process.env.REACT_APP_API_URL}/api/storyTree/${id}`
    );
    return response.data;
  } catch (error) {
    console.error('Error fetching node:', error);
    return null;
  }
};

const getItemSize = index => 150; // Default height, adjust as needed

function StoryTreeRootNode() {
  return (
    <StoryTreeProvider>
      <StoryTreeContent />
    </StoryTreeProvider>
  );
}

function StoryTreeContent() {
  const { state, dispatch } = useStoryTree();
  const pathParams = useParams();
  const navigate = useNavigate();
  const listRef = useRef();
  const sizeMap = useRef({});
  const rowRefs = useRef({});
  const [isFocused, setIsFocused] = useState(false);

  const {
    rootNode,
    items,
    isNextPageLoading,
    hasNextPage,
    removedFromView,
    isEditing,
    currentNode
  } = state;

  const rootUUID = pathParams.uuid;

  const updateURLWithNodeUUID = useCallback(
    (nodeUUID) => {
      navigate(`/storyTree/${nodeUUID}`, { replace: true });
    },
    [navigate]
  );

  const removeFromView = useCallback((id) => {
    dispatch({ type: ACTIONS.SET_REMOVED_FROM_VIEW, payload: id });
  }, [dispatch]);

  useEffect(() => {
    const fetchRootNode = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/storyTree/${rootUUID}`
        );
        const data = response.data;
        dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
        if (data.totalNodes) {
          dispatch({ type: ACTIONS.SET_TOTAL_ITEMS, payload: data.totalNodes });
        }
      } catch (error) {
        console.error('Error fetching story data:', error);
      }
    };

    if (rootUUID) {
      updateURLWithNodeUUID(rootUUID);
      fetchRootNode();
    }
  }, [rootUUID, updateURLWithNodeUUID]);

  useEffect(() => {
    if (rootNode) {
      dispatch({ type: ACTIONS.SET_ITEMS, payload: [rootNode] });
      dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: !!rootNode.nodes?.length });
    }
  }, [rootNode]);

  const setSize = useCallback((index, size) => {
    console.log(`Updating size map for index ${index}: ${size}`);
    sizeMap.current[index] = size;
    if (listRef.current) {
      listRef.current.resetAfterIndex(index);
    }
  }, []);

  const getSize = useCallback((index) => {
    console.log(`Getting size for index ${index}: ${sizeMap.current[index] || 200}`);
    return sizeMap.current[index] || 200;
  }, []);

  useEffect(() => {
    if (removedFromView.length > 0) {
      const lastNode = removedFromView[removedFromView.length - 1];
      dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: !!lastNode?.nodes?.length });
    }
  }, [removedFromView]);

  const itemCount = hasNextPage ? items.length + 1 : items.length;

  const isItemLoaded = useCallback(index => {
    return !hasNextPage || index < items.length;
  }, [hasNextPage, items.length]);

  const loadMoreItems = useCallback(async (startIndex, stopIndex) => {
    if (isNextPageLoading) return;

    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const lastNode = items[items.length - 1];
      if (!lastNode?.nodes?.length) {
        dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }
      
      if (lastNode?.nodes?.[0]?.id && !removedFromView.includes(lastNode.nodes[0].id)) {
        const nextNode = await fetchNode(lastNode.nodes[0].id);
        if (nextNode) {
          nextNode.siblings = lastNode.nodes;
          dispatch({ type: ACTIONS.APPEND_ITEM, payload: nextNode });
          dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: !!nextNode.nodes?.length });
        } else {
          dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        }
      } else {
        dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
      }
    } catch (error) {
      console.error('Error loading more items:', error);
      dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [isNextPageLoading, items, fetchNode, removedFromView]);

  const renderRow = ({ index, style }) => {
    const node = items[index];
    return (
      <Row
        index={index}
        style={style}
        node={node}
        setIsFocused={setIsFocused}
        setSize={(index, size) => {
          sizeMap.current[index] = size;
          listRef.current?.resetAfterIndex(index);
        }}
        rowRefs={rowRefs}
      />
    );
  };

  return (
    <div className="story-tree-container">
      <StoryTreeHeader 
        rootNode={rootNode}
        onLogoClick={() => navigate('/feed')}
        onMenuClick={() => console.log('Menu clicked')}
      />
      <InfiniteLoader
        isItemLoaded={index => !hasNextPage || index < items.length}
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
            itemSize={getItemSize}
            onItemsRendered={onItemsRendered}
            width="100%"
            className="story-list"
          >
            {renderRow}
          </List>
        )}
      </InfiniteLoader>
      {isEditing && (
        <EditingOverlay
          node={currentNode}
          onClose={() => dispatch({ type: ACTIONS.SET_EDITING, payload: false })}
        />
      )}
    </div>
  );
}

const Row = React.memo(({ 
  index, 
  style, 
  node, 
  setIsFocused, 
  setSize, 
  rowRefs,
  setItems,
  setHasNextPage,
  fetchNode
}) => {
  const { dispatch } = useStoryTree();

  const handleSiblingChange = useCallback(async (newNode) => {
    setItems(prevItems => {
      // Keep items up to and including the current index
      return [...prevItems.slice(0, index + 1)];
    });

    // If the new node has children, fetch the first child
    if (newNode.nodes?.length > 0) {
      try {
        const firstChild = await fetchNode(newNode.nodes[0].id);
        if (firstChild) {
          firstChild.siblings = newNode.nodes; // Preserve siblings information
          setItems(prevItems => [...prevItems, firstChild]);
          setHasNextPage(!!firstChild.nodes?.length);
        }
      } catch (error) {
        console.error('Error fetching child node:', error);
        setHasNextPage(false);
      }
    } else {
      setHasNextPage(false);
    }
  }, [index, setItems, setHasNextPage, fetchNode]);

  useEffect(() => {
    const updateSize = () => {
      if (rowRefs.current[index]) {
        const height = rowRefs.current[index].getBoundingClientRect().height;
        setSize(index, height);
      }
    };

    updateSize();

    // Add resize observer to handle content changes
    if (rowRefs.current[index]) {
      const resizeObserver = new ResizeObserver(updateSize);
      resizeObserver.observe(rowRefs.current[index]);
      return () => resizeObserver.disconnect();
    }
  }, [setSize, index, rowRefs]);
  
  // Use the siblings array that was attached to the node in loadMoreItems
  const siblings = node.siblings || [];
  
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
        boxSizing: 'border-box',
        overflowWrap: 'break-word',
        wordWrap: 'break-word',
        whiteSpace: 'normal',
        overflow: 'visible',
      }}
    >
      <StoryTreeNode
        key={node.id}
        node={node}
        index={index}
        setCurrentFocus={setIsFocused}
        siblings={siblings}
      />
    </div>
  );
});

export default StoryTreeRootNode; 