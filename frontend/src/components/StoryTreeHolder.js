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
      return data;
    } catch (error) {
      console.error('Error fetching story data:', error);
      return null;
    }
  }, []);

  const fillNodesPath = useCallback(
    async (index) => {
      const NODES_PATH_SIZE = index + 10;
      if (!rootNode) return;

      let localNodesPath = [rootNode];
      let currentNode = rootNode;
      let count = 1;

      while (count < NODES_PATH_SIZE && currentNode) {
        if (currentNode.nodes?.length > 0) {
          const nextNode = await fetchNode(currentNode.nodes[0].id);
          if (nextNode) {
            localNodesPath.push(nextNode);
            currentNode = nextNode;
            count++;
          } else {
            break;
          }
        } else {
          break;
        }
      }
      
      setNodesPath(prev => {
        if (prev.length !== localNodesPath.length) return localNodesPath;
        return prev;
      });
    },
    [rootNode, fetchNode]
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
      fillNodesPath(0);
    }
  }, [rootNode, fillNodesPath]);

  const setSize = useCallback((index, size) => {
    sizeMap.current = { ...sizeMap.current, [index]: size };
    listRef.current?.resetAfterIndex(index);
  }, []);

  const getSize = useCallback((index) => {
    return sizeMap.current[index] || 200; // default height
  }, []);

  const WINDOW_HEIGHT = window.innerHeight;
  
  const isItemLoaded = useCallback((index) => {
    return index < nodesPath.length;
  }, [nodesPath.length]);

  const loadMoreItems = useCallback(async (startIndex, stopIndex) => {
    await fillNodesPath(stopIndex);
  }, [fillNodesPath]);

  const rowRefs = useRef({});

  const renderRow = useCallback(({ index, style }) => {
    if (!isItemLoaded(index)) {
      return <div style={style}>Loading...</div>;
    }
    const node = nodesPath[index];
    
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
  }, [nodesPath, removeFromView, setIsFocused, setSize, isItemLoaded]);

  return (
    <div className="story-tree-container">
      <InfiniteLoader
        isItemLoaded={isItemLoaded}
        itemCount={Math.max(nodesPath.length + 1, totalItems)}
        loadMoreItems={loadMoreItems}
      >
        {({ onItemsRendered, ref }) => (
          <List
            ref={(list) => {
              ref(list);
              listRef.current = list;
            }}
            height={WINDOW_HEIGHT}
            itemCount={Math.max(nodesPath.length + 1, totalItems)}
            itemSize={getSize}
            onItemsRendered={onItemsRendered}
            width="100%"
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