import axios from 'axios';
import { ACTIONS } from './StoryTreeContext';

// Action creators
export const storyTreeActions = {
  // Fetch root node
  fetchRootNode: async (dispatch, uuid) => {
    dispatch({ type: ACTIONS.SET_INITIAL_LOADING, payload: true });
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const data = response.data;
      dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
      if (data.totalNodes) {
        dispatch({ type: ACTIONS.SET_TOTAL_ITEMS, payload: data.totalNodes });
      }
    } catch (error) {
      dispatch({ 
        type: ACTIONS.SET_ERROR, 
        payload: 'Failed to fetch root node' 
      });
    } finally {
      dispatch({ type: ACTIONS.SET_INITIAL_LOADING, payload: false });
    }
  },

  // Handle sibling change with proper loading states
  handleSiblingChange: async (dispatch, { newNode, index, fetchNode }) => {
    dispatch({ type: ACTIONS.SET_PAGINATION_LOADING, payload: true });
    try {
      dispatch({ 
        type: ACTIONS.HANDLE_SIBLING_CHANGE, 
        payload: { newNode, index } 
      });

      if (newNode.nodes?.length > 0) {
        const firstChild = await fetchNode(newNode.nodes[0].id);
        if (firstChild) {
          firstChild.siblings = newNode.nodes;
          dispatch({ type: ACTIONS.APPEND_ITEM, payload: firstChild });
          dispatch({ 
            type: ACTIONS.SET_HAS_NEXT_PAGE, 
            payload: !!firstChild.nodes?.length 
          });
        }
      }
    } catch (error) {
      dispatch({ 
        type: ACTIONS.SET_ERROR, 
        payload: 'Failed to handle sibling change' 
      });
    } finally {
      dispatch({ type: ACTIONS.SET_PAGINATION_LOADING, payload: false });
    }
  },

  // Load more items with proper error handling
  loadMoreItems: async (dispatch, { items, fetchNode, removedFromView }) => {
    dispatch({ type: ACTIONS.SET_PAGINATION_LOADING, payload: true });
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
          dispatch({ 
            type: ACTIONS.SET_HAS_NEXT_PAGE, 
            payload: !!nextNode.nodes?.length 
          });
        }
      }
    } catch (error) {
      dispatch({ 
        type: ACTIONS.SET_ERROR, 
        payload: 'Failed to load more items' 
      });
    } finally {
      dispatch({ type: ACTIONS.SET_PAGINATION_LOADING, payload: false });
    }
  }
}; 