import { useCallback } from 'react';
import { useStoryTree, ACTIONS } from '../context/StoryTreeContext';

export function useSiblingNavigation() {
  const { state, dispatch } = useStoryTree();

  const handleSiblingChange = useCallback(async (newNode, index, fetchNode) => {
    // Keep items up to and including the current index
    dispatch({ 
      type: ACTIONS.SET_ITEMS, 
      payload: state.items.slice(0, index + 1) 
    });

    // If the new node has children, fetch the first child
    if (newNode.nodes?.length > 0) {
      try {
        const firstChild = await fetchNode(newNode.nodes[0].id);
        if (firstChild) {
          firstChild.siblings = newNode.nodes; // Preserve siblings information
          dispatch({ type: ACTIONS.APPEND_ITEM, payload: firstChild });
          dispatch({ 
            type: ACTIONS.SET_HAS_NEXT_PAGE, 
            payload: !!firstChild.nodes?.length 
          });
        }
      } catch (error) {
        console.error('Error fetching child node:', error);
        dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
      }
    } else {
      dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
    }
  }, [dispatch, state.items]);

  const removeFromView = useCallback((id) => {
    dispatch({ type: ACTIONS.SET_REMOVED_FROM_VIEW, payload: id });
  }, [dispatch]);

  return {
    handleSiblingChange,
    removeFromView,
    removedFromView: state.removedFromView
  };
} 