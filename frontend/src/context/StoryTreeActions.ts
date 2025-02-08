/**
 * Requirements:
 * - Fully typed TypeScript implementation
 * - Handles story tree node fetching and pagination
 * - Manages loading states and error handling
 * - Supports sibling navigation
 * - Properly transforms node data into StoryTreeNode objects
 */

import axios from 'axios';
import { ACTIONS } from './StoryTreeContext';
import { Action, StoryTreeNode } from './types';

// TODO update the URL when sibling changes, so that the currently viewed siblings are displayed if the user copies the URL

interface SiblingChangeParams {
  newNode: StoryTreeNode;
  index: number;
  fetchNode: (id: string) => Promise<StoryTreeNode | null>;
}

interface LoadMoreItemsParams {
  items: StoryTreeNode[];
  fetchNode: (id: string) => Promise<StoryTreeNode | null>;
  removedFromView: string[];
}

export const storyTreeActions = {
  fetchRootNode: async (dispatch: React.Dispatch<Action>, uuid: string) => {
    dispatch({ type: ACTIONS.SET_INITIAL_LOADING, payload: true });
    try {
      const response = await axios.get<StoryTreeNode>(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const data = response.data;
      dispatch({ type: ACTIONS.SET_ROOT_NODE, payload: data });
    } catch (error) {
      dispatch({ 
        type: ACTIONS.SET_ERROR, 
        payload: 'Failed to fetch root node' 
      });
    } finally {
      dispatch({ type: ACTIONS.SET_INITIAL_LOADING, payload: false });
    }
  },

  handleSiblingChange: async (
    dispatch: React.Dispatch<Action>, 
    { newNode, index, fetchNode }: SiblingChangeParams
  ) => {
    dispatch({ type: ACTIONS.SET_PAGINATION_LOADING, payload: true });
    try {
      dispatch({ 
        type: ACTIONS.HANDLE_SIBLING_CHANGE, 
        payload: { newNode, index } 
      });

      if (newNode.storyTree.nodes?.length > 0) {
        const firstChild = await fetchNode(newNode.storyTree.nodes[0].id);
        if (firstChild) {
          firstChild.siblings = newNode.storyTree.nodes.map(node => ({
            id: node.id,
            parentId: node.parentId,
            storyTree: newNode.storyTree
          }));
          dispatch({ type: ACTIONS.APPEND_ITEM, payload: firstChild });
          dispatch({ 
            type: ACTIONS.SET_HAS_NEXT_PAGE, 
            payload: !!firstChild.storyTree.nodes?.length 
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

  loadMoreItems: async (
    dispatch: React.Dispatch<Action>, 
    { items, fetchNode, removedFromView }: LoadMoreItemsParams
  ) => {
    dispatch({ type: ACTIONS.SET_PAGINATION_LOADING, payload: true });
    try {
      const lastNode = items[items.length - 1];
      if (!lastNode?.storyTree.nodes?.length) {
        dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }

      if (lastNode?.storyTree.nodes?.[0]?.id && !removedFromView.includes(lastNode.storyTree.nodes[0].id)) {
        const nextNode = await fetchNode(lastNode.storyTree.nodes[0].id);
        if (nextNode) {
          nextNode.siblings = lastNode.storyTree.nodes.map(node => ({
            id: node.id,
            parentId: node.parentId,
            storyTree: lastNode.storyTree
          }));
          dispatch({ type: ACTIONS.APPEND_ITEM, payload: nextNode });
          dispatch({ 
            type: ACTIONS.SET_HAS_NEXT_PAGE, 
            payload: !!nextNode.storyTree.nodes?.length 
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