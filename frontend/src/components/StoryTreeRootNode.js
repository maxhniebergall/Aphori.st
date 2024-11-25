import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import axios from 'axios';
import EditingOverlay from './EditingOverlay';
import StoryTreeNode from './StoryTreeNode';
import './StoryTree.css';


// This is the root node of the story tree. It is the first node that is fetched from the server.
// It is used to display the story tree, and contains the code to fetch the rest of the tree.
function StoryTreeRootNode() {
  const pathParams = useParams();
  const [rootNode, setRootNode] = useState(null);
  const [isEditing, setIsEditing] = useState(false);
  const [currentNode, setCurrentNode] = useState(null);
  const navigate = useNavigate();
  const [isFocused, setIsFocused] = useState(false);
  const [nodesPath, setNodesPath] = useState([]);
  const [removedFromView, setRemovedFromView] = useState([]);
  const listRef = useRef();
  const sizeMap = useRef({});
  const [totalItems, setTotalItems] = useState(0);
  const [isNextPageLoading, setIsNextPageLoading] = useState(false);
  const [hasNextPage, setHasNextPage] = useState(true);
  const [items, setItems] = useState([]);

  const rootUUID = pathParams.uuid;

  const updateURLWithNodeUUID = useCallback(
    (nodeUUID) => {
      navigate(`/storyTree/${nodeUUID}`, { replace: true });
    },
    [navigate]
  );

  const fetchNode = useCallback(async (id) => {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${id}`
      );
      const data = response.data;
      await appendNodesPath(data.id);
      console.log('Fetched node data:', response.data);
      return data;
    } catch (error) {
      console.error('Error fetching story data:', error);
      return null;
    }
  }, []);

  const appendNodesPath = async (nodeId) => {
    return nodeId;
  };

  const removeFromView = useCallback((id) => {
    setRemovedFromView(prev => [...prev, id]);
    setNodesPath(prev => prev.filter(node => node.id !== id));
  }, []);

  useEffect(() => {
    const fetchRootNode = async () => {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/storyTree/${rootUUID}`
        );
        const data = response.data;
        setRootNode(data);
        if (data.totalNodes) {
          setTotalItems(data.totalNodes);
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
      setItems([rootNode]);
      setHasNextPage(!!rootNode.nodes?.length);
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

  const WINDOW_HEIGHT = window.innerHeight;
  
  useEffect(() => {
    if (nodesPath.length > 0) {
      const lastNode = nodesPath[nodesPath.length - 1];
      setHasNextPage(!!lastNode?.nodes?.length);
    }
  }, [nodesPath]);

  const itemCount = hasNextPage ? items.length + 1 : items.length;

  const isItemLoaded = useCallback(index => {
    return !hasNextPage || index < items.length;
  }, [hasNextPage, items.length]);

  const loadMoreItems = useCallback(async (startIndex, stopIndex) => {
    if (isNextPageLoading) return;

    setIsNextPageLoading(true);
    try {
      const lastNode = items[items.length - 1];
      if (!lastNode?.nodes?.length) {
        setHasNextPage(false);
        return;
      }
      
      if (lastNode?.nodes?.[0]?.id && !removedFromView.includes(lastNode.nodes[0].id)) {
        const nextNode = await fetchNode(lastNode.nodes[0].id);
        if (nextNode) {
          nextNode.siblings = lastNode.nodes;
          setItems(prev => [...prev, nextNode]);
          setHasNextPage(!!nextNode.nodes?.length);
        } else {
          setHasNextPage(false);
        }
      } else {
        setHasNextPage(false);
      }
    } catch (error) {
      console.error('Error loading more items:', error);
      setHasNextPage(false);
    } finally {
      setIsNextPageLoading(false);
    }
  }, [isNextPageLoading, items, fetchNode, removedFromView]);

  const rowRefs = useRef({});

  const renderRow = useCallback(({ index, style }) => {
    if (!isItemLoaded(index)) {
      return <div style={style}>Loading...</div>;
    }

    const node = items[index];
    return (
      <Row
        index={index}
        style={style}
        node={node}
        items={items}
        removeFromView={removeFromView}
        setIsFocused={setIsFocused}
        setSize={setSize}
        rowRefs={rowRefs}
      />
    );
  }, [items, removeFromView, setIsFocused, setSize, isItemLoaded]);

  const getItemSize = index => {
    return (sizeMap.current[index] || 50) + 8;
  };

  // New Header Handlers
  const handleLogoClick = () => {
    navigate('/feed');
  };

  const handleMenuClick = () => {
    // TODO: Implement menu opening logic
    console.log('Menu clicked');
  };

  // Add window resize listener
  useEffect(() => {
    const handleResize = () => {
      // Force recalculation of all row heights
      Object.keys(sizeMap.current).forEach(index => {
        if (rowRefs.current[index]) {
          const height = rowRefs.current[index].getBoundingClientRect().height;
          sizeMap.current[index] = height;
        }
      });
      // Reset the List component to re-render with new sizes
      if (listRef.current) {
        listRef.current.resetAfterIndex(0);
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  return (
    <div className="story-tree-container">
      <div className="combined-header">
        <div className="app-header">
          <div className="logo-container">
            <img 
              src="/logo.jpg"
              alt="Aphori.st Logo" 
              className="logo"
              onClick={handleLogoClick}
            />
          </div>
          <div className="menu-icon" onClick={handleMenuClick}>
            ☰
          </div>
        </div>
        {rootNode && (
          <div className="story-header">
            <h1>{(rootNode.metadata?.title || 'Untitled').slice(0, 45)}</h1>
            <h2>by {rootNode.metadata?.author || 'Anonymous'}</h2>
          </div>
        )}
      </div>
      <InfiniteLoader
        isItemLoaded={isItemLoaded}
        itemCount={itemCount}
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
            itemCount={itemCount}
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
          onClose={() => setIsEditing(false)}
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
  const handleSiblingChange = useCallback(async (newNode) => {
    // First, update the current node in the items array
    setItems(prevItems => {
      const newItems = [...prevItems.slice(0, index)];
      newItems.push(newNode);  // Replace current node with new sibling
      return newItems;
    });

    // Then start fetching the chain of first children
    let currentNode = newNode;
    let nextItems = [];

    // Keep fetching first children until we hit a node with no children
    while (currentNode?.nodes?.length > 0) {
      try {
        const nextNode = await fetchNode(currentNode.nodes[0].id);
        if (!nextNode) break;
        
        // Preserve siblings information for the next node
        nextNode.siblings = currentNode.nodes;
        nextItems.push(nextNode);
        currentNode = nextNode;
      } catch (error) {
        console.error('Error fetching child node:', error);
        break;
      }
    }

    // Update items with all the fetched nodes
    if (nextItems.length > 0) {
      setItems(prevItems => [...prevItems, ...nextItems]);
      setHasNextPage(!!currentNode?.nodes?.length);
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