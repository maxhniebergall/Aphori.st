import React, { useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import axios from 'axios';
import EditingOverlay from './EditingOverlay';
import './StoryTree.css';
import StoryTreeHeader from './StoryTreeHeader';
import { 
  StoryTreeProvider, 
  useStoryTree, 
  ACTIONS,
} from '../context/StoryTreeContext';
import VirtualizedStoryList from './VirtualizedStoryList';

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

  useEffect((id) => {
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

  return (
    <div className="story-tree-container">
      <StoryTreeHeader 
        rootNode={rootNode}
        onLogoClick={() => navigate('/feed')}
        onMenuClick={() => console.log('Menu clicked')}
      />
      <VirtualizedStoryList
        items={items}
        hasNextPage={hasNextPage}
        isItemLoaded={isItemLoaded}
        loadMoreItems={loadMoreItems}
        fetchNode={fetchNode}
      />
      {isEditing && (
        <EditingOverlay
          node={currentNode}
          onClose={() => dispatch({ type: ACTIONS.SET_EDITING, payload: false })}
        />
      )}
    </div>
  );
}

export default StoryTreeRootNode; 