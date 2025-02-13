/**
 * Requirements:
 * - Provides stateless, fully typed TypeScript action creators for handling story tree data operations.
 * - Encapsulates API calls, node data transformations, and dispatches state updates in a consistent manner.
 * - Separates UI event handling from business logic by isolating asynchronous operations into focused functions.
 * - Implements robust error handling and loading state management during API interactions.
 * - Supports sibling navigation, pagination, and other data operations through modular, reusable functions.
 * - Centralizes side-effectful operations, ensuring maintainability and clarity across the application.
 */

import React from 'react';
import axios from 'axios';
import { Action, ACTIONS, StoryTreeLevel, StoryTree, Quote, Siblings } from '../types/types';
import { DatabaseCompression } from '../utils/compression';

const compression = new DatabaseCompression();

interface APIResponse {
  storyTree: StoryTree | string;
}

export const storyTreeActions = {
  fetchRootNode: async (dispatch: React.Dispatch<Action>, uuid: string) => {
    dispatch({ type: ACTIONS.START_STORY_TREE_LOAD, payload: { rootNodeId: uuid } });
    try {
      const response = await axios.get<APIResponse>(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );

      const data = await compression.decompress(response.data);
      if (!data || !data.storyTree) {
        throw new Error('Invalid response data received');
      }

      const storyTree: StoryTree = typeof data.storyTree === 'string' 
        ? JSON.parse(data.storyTree) 
        : data.storyTree;

      // Create initial level
      const initialLevel: StoryTreeLevel = {
        rootNodeId: storyTree.id,
        levelNumber: 0,
        textContent: storyTree.metadata?.title || 'Untitled',
        siblings: { levelsMap: new Map() }
      };

      dispatch({ 
        type: ACTIONS.SET_STORY_TREE_DATA, 
        payload: {
          levels: [initialLevel],
          idToIndexPair: { indexMap: new Map() }
        }
      });

      return initialLevel;
    } catch (error) {
      console.error('Error fetching root node:', error);
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load story tree' });
      return null;
    }
  },

  handleSiblingChange: async (
    dispatch: React.Dispatch<Action>,
    options: {
      newNode: StoryTreeLevel;
      index: number;
      fetchNode: (id: string) => Promise<StoryTreeLevel | null>;
    }
  ) => {
    const { newNode, index, fetchNode } = options;
    try {
      const fetchedNode = await fetchNode(newNode.rootNodeId);
      if (fetchedNode) {
        dispatch({ 
          type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
          payload: [fetchedNode] 
        });
      }
    } catch (error) {
      console.error('Error handling sibling change:', error);
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load sibling' });
    }
  },

  loadMoreItems: async (
    dispatch: React.Dispatch<Action>,
    options: {
      items: StoryTreeLevel[];
      fetchNode: (id: string) => Promise<StoryTreeLevel | null>;
      removedFromView: string[];
    }
  ) => {
    const { items, fetchNode, removedFromView } = options;
    if (!items.length) return;

    const lastLevel = items[items.length - 1];
    if (!lastLevel?.siblings?.levelsMap.size) return;

    try {
      // Get all siblings from the last level's levelsMap
      const allSiblings: StoryTreeLevel[] = [];
      lastLevel.siblings.levelsMap.forEach((siblings) => {
        allSiblings.push(...siblings.map(sibling => ({
          rootNodeId: lastLevel.rootNodeId,
          levelNumber: lastLevel.levelNumber + 1,
          textContent: sibling.textContent,
          siblings: { levelsMap: new Map() }
        })));
      });

      const nodesToLoad = allSiblings.filter(node => !removedFromView.includes(node.rootNodeId));
      const loadedNodes = await Promise.all(
        nodesToLoad.map(async (node) => {
          const fetchedNode = await fetchNode(node.rootNodeId);
          return fetchedNode;
        })
      );

      const validNodes = loadedNodes.filter((node): node is StoryTreeLevel => node !== null);
      
      if (validNodes.length > 0) {
        dispatch({ 
          type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
          payload: validNodes 
        });
      }
    } catch (error) {
      console.error('Error loading more items:', error);
      dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load more items' });
    }
  },

  fetchNodes: async (
    items: StoryTreeLevel[],
    fetchNode: (id: string) => Promise<StoryTreeLevel | null>
  ) => {
    const promises = items.map((item) => {
      // Get first sibling's ID from each level
      const firstSiblingSet = Array.from(item.siblings.levelsMap.values())[0];
      const firstSibling = firstSiblingSet?.[0];
      return firstSibling ? fetchNode(firstSibling.id) : null;
    });
    return Promise.all(promises);
  },

  fetchNodeById: async (id: string): Promise<StoryTreeLevel | null> => {
    try {
      const response = await axios.get<{ storyTree: StoryTree | string }>(
        `/api/story-tree/nodes/${id}`
      );
      const data = await compression.decompress(response.data);
      if (!data || !data.storyTree) {
        return null;
      }

      const storyTree: StoryTree = typeof data.storyTree === 'string' 
        ? JSON.parse(data.storyTree) 
        : data.storyTree;

      return {
        rootNodeId: storyTree.id,
        levelNumber: 1,
        textContent: storyTree.text || '',
        siblings: { levelsMap: new Map() }
      };
    } catch (error) {
      console.error('Error fetching node:', error);
      return null;
    }
  }
}; 