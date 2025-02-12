/*
 * Requirements:
 * - Implements a singleton pattern to ensure a unified, stateful instance across the application.
 * - Manages internal state including caching and subscription management.
 * - Provides robust orchestration for story tree operations.
 * - Ensures proper binding of class methods.
 * - Implements robust error handling.
 * - Supports transformation and validation of fetched node data.
 * - Integrates handling of compressed responses.
 * - Enforces full TypeScript support with strict typings.
 * - Bridges UI interactions and API calls.
 */

import React from 'react';
import { ACTIONS } from '../context/types';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import {
  StoryTreeState,
  StoryTreeLevel,
  StoryTree as GlobalStoryTree,
  Quote,
  QuoteMetadata,
  Action,
  IdToIndexPair
} from '../context/types';

interface StoryTreeOperatorState {
  rootNodeId: string;
  selectedQuote: Quote | null;
  levels: StoryTreeLevel[];
  idToIndexPair: IdToIndexPair;
  error: string | null;
}

interface StoryTreeData {
  id: string;
  metadata?: {
    title?: string;
    author?: string;
  };
  content?: string;
}

class StoryTreeOperator extends BaseOperator {
  private state: StoryTreeOperatorState;
  private dispatch: React.Dispatch<Action> | null;
  private replySubscribers: Map<string, Set<() => void>>;
  public fetchRootNode: (uuid: string) => Promise<StoryTreeLevel[] | null>;

  constructor() {
    super();
    this.state = {
      rootNodeId: '',
      selectedQuote: null,
      levels: [],
      idToIndexPair: { indexMap: new Map() },
      error: null
    };
    this.dispatch = null;
    this.replySubscribers = new Map();

    // Bind methods
    this.isItemLoaded = this.isItemLoaded.bind(this);
    this.loadMoreItems = this.loadMoreItems.bind(this);
    this.fetchNode = this.fetchNode.bind(this);
    this.updateContext = this.updateContext.bind(this);
    this.fetchRootNode = this.fetchRootNodeImpl.bind(this);
  }

  updateContext(state: Partial<StoryTreeState>, dispatch: React.Dispatch<Action>): void {
    this.state = {
      ...this.state,
      ...state
    };
    this.dispatch = dispatch;
  }

  validateNode(node: any): node is StoryTreeLevel {
    return node && 
           typeof node === 'object' &&
           typeof node.rootNodeId === 'string' &&
           typeof node.levelNumber === 'number' &&
           typeof node.textContent === 'string' &&
           node.siblings &&
           typeof node.siblings === 'object' &&
           node.siblings.levelsMap instanceof Map;
  }

  async handleCompressedResponse(response: AxiosResponse): Promise<any> {
    return super.handleCompressedResponse(response);
  }

  private async fetchRootNodeImpl(uuid: string): Promise<StoryTreeLevel[] | null> {
    try {
      const response = await axios.get<{ storyTree: StoryTreeData | string }>(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const data = await this.handleCompressedResponse(response);
      if (!data || !data.storyTree) {
        console.error('Invalid response data received:', data);
        return null;
      }

      const storyTree: StoryTreeData = typeof data.storyTree === 'string' ? JSON.parse(data.storyTree) : data.storyTree;
      
      const levels: StoryTreeLevel[] = [];
      
      // Create a title node if metadata exists
      if (storyTree.metadata?.title || storyTree.metadata?.author) {
        levels.push({
          rootNodeId: storyTree.id,
          levelNumber: 0,
          textContent: storyTree.metadata.title || 'Untitled',
          siblings: { levelsMap: new Map() },
          isTitleNode: true
        });
      }

      // Create a content node
      levels.push({
        rootNodeId: storyTree.id,
        levelNumber: levels.length,
        textContent: storyTree.content || '',
        siblings: { levelsMap: new Map() }
      });

      return levels;
    } catch (error) {
      console.error('Error fetching root node:', error);
      if (this.dispatch) {
        this.dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load story tree' });
      }
      return null;
    }
  }

  async fetchNode(id: string, retries = 3, delay = 1000): Promise<StoryTreeLevel | null> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get(
          `${process.env.REACT_APP_API_URL}/api/storyTree/${id}`
        );
        const data = await this.handleCompressedResponse(response);
        if (!data || !data.storyTree) {
          console.error('Invalid response data received:', data);
          return null;
        }

        const storyTree: StoryTreeData = typeof data.storyTree === 'string' 
          ? JSON.parse(data.storyTree) 
          : data.storyTree;

        return {
          rootNodeId: storyTree.id,
          levelNumber: 1, // Default to 1 for non-root nodes
          textContent: storyTree.content || '',
          siblings: { levelsMap: new Map() }
        };
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 503 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        console.error('Error fetching node:', error);
        return null;
      }
    }
    return null;
  }

  isItemLoaded(index: number): boolean {
    return index < (this.state?.levels?.length || 0);
  }

  async loadMoreItems(startIndex: number, stopIndex: number): Promise<StoryTreeLevel[]> {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return [];
    }

    try {
      const levels = this.state.levels ?? [];
      const lastLevel = levels[levels.length - 1];
      
      if (!lastLevel?.siblings?.levelsMap.size) {
        return [];
      }

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

      const nodesToLoad = allSiblings.slice(startIndex, stopIndex + 1);
      const loadedNodes = await Promise.all(
        nodesToLoad.map(async (node) => {
          const fetchedNode = await this.fetchNode(node.rootNodeId);
          return fetchedNode;
        })
      );

      const validNodes = loadedNodes.filter((node): node is StoryTreeLevel => node !== null);
      
      if (validNodes.length > 0) {
        this.dispatch({ 
          type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
          payload: validNodes 
        });
      }

      return validNodes;
    } catch (error) {
      console.error('Error loading more items:', error);
      return [];
    }
  }
}

export default new StoryTreeOperator();