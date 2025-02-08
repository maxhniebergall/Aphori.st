/**
 * Requirements:
 * - Fully typed TypeScript implementation
 * - Handles story tree node fetching and pagination
 * - Manages loading states and error handling
 * - Supports sibling navigation
 * - Properly transforms node data into StoryTreeLevel objects
 */

import axios from 'axios';
import { ACTIONS } from './StoryTreeContext';
import { Action, StoryTreeLevel } from './types';

// TODO update the URL when sibling changes, so that the currently viewed siblings are displayed if the user copies the URL

interface SiblingChangeParams {
  newNode: StoryTreeLevel;
  index: number;
  fetchNode: (id: string) => Promise<StoryTreeLevel | null>;
}

interface LoadMoreItemsParams {
  items: StoryTreeLevel[];
  fetchNode: (id: string) => Promise<StoryTreeLevel | null>;
  removedFromView: string[];
}

export const storyTreeActions = {
  fetchRootNode: async (dispatch: React.Dispatch<Action>, uuid: string) => {
    dispatch({ type: ACTIONS.SET_INITIAL_LOADING, payload: true });
    try {
      const response = await axios.get<StoryTreeLevel>(
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

      const storyTree = newNode.storyTree;
      if (!storyTree || !storyTree.nodes || storyTree.nodes.length === 0) {
        return;
      }

      const firstChild = await fetchNode(storyTree.nodes[0].id);
      if (firstChild) {
        const siblings: StoryTreeLevel[] = storyTree.nodes.map(node => ({
          id: node.id,
          content: '',
          parentId: node.parentId,
          storyTree
        }));
        firstChild.siblings = siblings;
        dispatch({ type: ACTIONS.APPEND_NODE, payload: firstChild });
        dispatch({
          type: ACTIONS.SET_HAS_NEXT_PAGE,
          payload: !!firstChild.storyTree?.nodes?.length
        });
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
      const storyTree = lastNode?.storyTree;
      
      if (!storyTree || !storyTree.nodes || storyTree.nodes.length === 0) {
        dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }

      const firstNodeId = storyTree.nodes[0]?.id;
      if (firstNodeId && !removedFromView.includes(firstNodeId)) {
        const nextNode = await fetchNode(firstNodeId);
        if (nextNode) {
          const siblings: StoryTreeLevel[] = storyTree.nodes.map(node => ({
            id: node.id,
            content: '',
            parentId: node.parentId,
            storyTree
          }));
          nextNode.siblings = siblings;
          dispatch({ type: ACTIONS.APPEND_NODE, payload: nextNode });
          dispatch({
            type: ACTIONS.SET_HAS_NEXT_PAGE,
            payload: !!nextNode.storyTree?.nodes?.length
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
  },

  fetchNodes: async (
    items: StoryTreeLevel[],
    fetchNode: (id: string) => Promise<StoryTreeLevel | null>
  ) => {
    const promises = items.map((item) => fetchNode(item.id));
    return Promise.all(promises);
  },

  fetchNodeById: async (id: string) => {
    try {
      const response = await axios.get<StoryTreeLevel>(
        `/api/story-tree/nodes/${id}`
      );
      return response.data;
    } catch (error) {
      console.error('Error fetching node:', error);
      return null;
    }
  }
}; 