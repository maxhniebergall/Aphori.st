import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { VariableSizeList as List } from 'react-window';
import InfiniteLoader from 'react-window-infinite-loader';
import axios from 'axios';
import EditingOverlay from './EditingOverlay';
import StoryTreeNode from './StoryTreeNode';
import './StoryTree.css';

const Row = React.memo(({ index, style, node, removeFromView, setIsFocused, setSize, rowRefs }) => {
  useEffect(() => {
    if (rowRefs.current[index]) {
      setSize(index, rowRefs.current[index].getBoundingClientRect().height);
    }
  }, [index, setSize, rowRefs]);
  
  return (
    <div ref={el => rowRefs.current[index] = el} style={style}>
      <StoryTreeNode
        key={node.id}
        node={node}
        index={index}
        onSwipeLeft={() => removeFromView(node.id)}
        setCurrentFocus={setIsFocused}
      />
    </div>
  );
});

function StoryTreeHolder() {
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
      console.log('Fetched node data:', response.data);  // Debug log
      return data;
    } catch (error) {
      console.error('Error fetching story data:', error);
      return null;
    }
  }, []);

  const fillNodesPath = useCallback(
    async (index) => {
      console.log('fillNodesPath called with index:', index);
      
      if (!rootNode) return;
      
      // If we're just starting, initialize with root
      if (nodesPath.length === 0) {
        setNodesPath([rootNode]);
        return;
      }

      const currentNode = nodesPath[nodesPath.length - 1];
      
      // Check if current node has children to fetch
      if (currentNode?.nodes?.[0]?.id) {
        console.log('Attempting to fetch child node:', currentNode.nodes[0].id);
        const nextNode = await fetchNode(currentNode.nodes[0].id);
        if (nextNode) {
          setNodesPath(prev => [...prev, nextNode]);
        }
      }
    },
    [rootNode, fetchNode, nodesPath]
  );

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
    sizeMap.current = { ...sizeMap.current, [index]: size };
    listRef.current?.resetAfterIndex(index);
  }, []);

  const getSize = useCallback((index) => {
    return sizeMap.current[index] || 200; // default height
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
    if (isNextPageLoading) {
      return;
    }

    setIsNextPageLoading(true);
    try {
      const lastNode = items[items.length - 1];
      if (lastNode?.nodes?.[0]?.id && !removedFromView.includes(lastNode.nodes[0].id)) {
        const nextNode = await fetchNode(lastNode.nodes[0].id);
        if (nextNode) {
          setItems(prev => [...prev, nextNode]);
          setHasNextPage(!!nextNode.nodes?.length);
        } else {
          setHasNextPage(false);
        }
      } else {
        setHasNextPage(false);
      }
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
        removeFromView={removeFromView}
        setIsFocused={setIsFocused}
        setSize={setSize}
        rowRefs={rowRefs}
      />
    );
  }, [items, removeFromView, setIsFocused, setSize, isItemLoaded]);

  return (
    <div className="story-tree-container">
      {rootNode && (
        <div className="story-header" style={{
          padding: '20px',
          marginBottom: '20px',
          borderBottom: '1px solid #ccc',
          position: 'sticky',
          top: 0,
          backgroundColor: '#fff',
          zIndex: 1000,
        }}>
          <h1 style={{
            fontSize: '2rem',
            marginBottom: '10px',
            color: '#333'
          }}>
            {rootNode.title || 'Untitled'}
          </h1>
          <h2 style={{
            fontSize: '1.2rem',
            marginBottom: '10px',
            color: '#666'
          }}>
            by {rootNode.author || 'Anonymous'}
          </h2>
        </div>
      )}
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
            itemSize={getSize}
            onItemsRendered={onItemsRendered}
            width="100%"
            style={{ padding: '0 20px' }}
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

export default StoryTreeHolder; 