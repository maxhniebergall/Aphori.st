import React from 'react';
import { useStoryTree, ACTIONS } from '../context/StoryTreeContext';
import VirtualizedStoryList from './VirtualizedStoryList';
import axios from 'axios';
import { useSiblingNavigation } from '../hooks/useSiblingNavigation';

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

function StoryTreeOperator() {
  const { state, dispatch } = useStoryTree();
  const {
    items,
    hasNextPage,
    isNextPageLoading
  } = state;
  const { handleSiblingChange } = useSiblingNavigation();

  console.log('StoryTreeOperator items:', items);

  const isItemLoaded = React.useCallback(index => {
    return !hasNextPage || index < items.length;
  }, [hasNextPage, items.length]);

  const loadMoreItems = React.useCallback(async (startIndex, stopIndex) => {
    if (isNextPageLoading) return;

    dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const lastNode = items[items.length - 1];
      if (!lastNode?.nodes?.length) {
        dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }
      
      if (lastNode?.nodes?.[0]?.id) {
        const nextNode = await fetchNode(lastNode.nodes[0].id);
        if (nextNode) {
          nextNode.siblings = lastNode.nodes;
          dispatch({ type: ACTIONS.APPEND_ITEM, payload: nextNode });
          dispatch({ 
            type: ACTIONS.SET_HAS_NEXT_PAGE, 
            payload: !!nextNode.nodes?.length 
          });
        } else {
          dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        }
      }
    } catch (error) {
      console.error('Error loading more items:', error);
      dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
    } finally {
      dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  }, [isNextPageLoading, items, dispatch]);

  const setCurrentFocus = React.useCallback((index) => {
    if (items[index]) {
      dispatch({ 
        type: ACTIONS.SET_CURRENT_NODE, 
        payload: items[index] 
      });
    }
  }, [items, dispatch]);

  return (
    <VirtualizedStoryList
      items={items}
      hasNextPage={hasNextPage}
      isItemLoaded={isItemLoaded}
      loadMoreItems={loadMoreItems}
      fetchNode={fetchNode}
      setIsFocused={setCurrentFocus}
      handleSiblingChange={handleSiblingChange}
    />
  );
}


export default StoryTreeOperator; 