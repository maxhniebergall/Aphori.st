/*
 * Requirements:
 * - Implements a singleton pattern to ensure a unified, stateful instance across the application.
 * - Manages internal state including caching, retries, and subscription management for advanced operations.
 * - Provides robust orchestration for story tree operations (e.g., node fetching, reply management, and sibling navigation).
 * - Ensures proper binding of class methods to maintain the correct 'this' context.
 * - Implements robust error handling and retry mechanisms for failed API calls.
 * - Supports transformation and validation of fetched node data before updating state.
 * - Integrates handling of compressed responses and efficient state dispatching.
 * - Enforces full TypeScript support with strict typings for all methods and properties.
 * - Bridges UI interactions and API calls via internal state management and subscription notifications.
 */

import React from 'react';
import { ACTIONS } from '../context/types';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import {
  StoryTreeState,
  StoryTreeLevel,
  StoryTree,
  Quote,
  QuoteMetadata,
  LoadingState,
  Action,
  IdToIndexPair
} from '../context/types';

interface ReplyData {
  text: string;
  parentId: string[];
  quote?: {
    text: string;
    sourcePostId: string;
    selectionRange?: { start: number; end: number };
  } | null;
}

interface StoryTreeOperatorState extends StoryTreeState {
  replySubscribers?: Map<string, Set<() => void>>;
  levels: StoryTreeLevel[];
  idToIndexPair: IdToIndexPair;
  rootNodeId: string;
  selectedQuote: Quote | null;
  error: string | null;
  isLoading: boolean;
  isInitialized: boolean;
}

class StoryTreeOperator extends BaseOperator {
  private state: StoryTreeOperatorState;
  private dispatch: React.Dispatch<Action> | null;
  private replySubscribers: Map<string, Set<() => void>>;
  public fetchRootNode: (uuid: string, fetchedNodes?: Record<string, StoryTreeLevel>) => Promise<StoryTreeLevel[] | null>;

  constructor() {
    super();
    this.state = {
      isLoading: false,
      isInitialized: false,
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
    this.setCurrentFocus = this.setCurrentFocus.bind(this);
    this.fetchRootNode = this.fetchRootNodeWithIncludedNodes.bind(this);
    this.fetchNode = this.fetchNode.bind(this);
    this.updateContext = this.updateContext.bind(this);
    this.submitReply = this.submitReply.bind(this);
    this.fetchReply = this.fetchReply.bind(this);
    this.fetchReplies = this.fetchReplies.bind(this);
    this.fetchRepliesFeed = this.fetchRepliesFeed.bind(this);
    this.updateQuoteMetadata = this.updateQuoteMetadata.bind(this);
  }

  updateContext(state: Partial<StoryTreeState>, dispatch: React.Dispatch<Action>): void {
    this.state = {
      ...this.state,
      ...state
    };
    this.dispatch = dispatch;
    console.log('StoryTreeOperator state updated:', this.state);
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

  async fetchRootNodeWithIncludedNodes(uuid: string, fetchedNodes: Record<string, StoryTreeLevel> = {}): Promise<StoryTreeLevel[] | null> {
    try {
      const response = await axios.get<{ storyTree: StoryTree | string }>(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const data = await this.handleCompressedResponse(response);
      if (!data || !data.storyTree) {
        console.error('Invalid response data received:', data);
        return null;
      }

      const storyTree: StoryTree = typeof data.storyTree === 'string' ? JSON.parse(data.storyTree) : data.storyTree;
      
      // Create a title node if metadata exists
      if (storyTree.metadata?.title || storyTree.metadata?.author) {
        const titleNode: StoryTreeLevel = {
          rootNodeId: storyTree.id,
          levelNumber: 0,
          textContent: storyTree.metadata.title || 'Untitled',
          siblings: { levelsMap: new Map() },
          isTitleNode: true
        };
        fetchedNodes[`${storyTree.id}-title`] = titleNode;
      }

      // Create a content node
      const contentNode: StoryTreeLevel = {
        rootNodeId: storyTree.id,
        levelNumber: 1,
        textContent: '',
        siblings: { levelsMap: new Map() }
      };
      fetchedNodes[storyTree.id] = contentNode;

      return Object.values(fetchedNodes);
    } catch (error) {
      console.error('Error fetching root node:', error);
      return null;
    }
  }

  private setLoading(isLoading: boolean): void {
    if (this.dispatch) {
      this.state = {
        ...this.state,
        isLoading: isLoading
      };
      this.dispatch({ 
        type: ACTIONS.SHOW_LOADING_INDICATOR, 
        payload: isLoading 
      });
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

        const storyTree: StoryTree = typeof data.storyTree === 'string' 
          ? JSON.parse(data.storyTree) 
          : data.storyTree;

        return {
          rootNodeId: storyTree.id,
          levelNumber: 1, // Default to 1 for non-root nodes
          textContent: '',
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

  isItemLoaded = (index: number): boolean => {
    const levels = this.state?.levels ?? [];
    return index < levels.length;
  };

  loadMoreItems = async (startIndex: number, stopIndex: number): Promise<StoryTreeLevel[]> => {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return [];
    }

    this.setLoading(true);
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
    } finally {
      this.setLoading(false);
    }
  };

  setCurrentFocus = (index: number): void => {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return;
    }

    const levels = this.state.levels ?? [];
    const item = levels[index];
    if (item && this.validateNode(item)) {
      this.dispatch({ 
        type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
        payload: [item]
      });
    } else {
      console.warn('Attempted to focus invalid node at index:', index);
    }
  };

  subscribeToReplySubmission(parentId: string, callback: () => void): () => void {
    if (!this.replySubscribers.has(parentId)) {
      this.replySubscribers.set(parentId, new Set());
    }
    this.replySubscribers.get(parentId)!.add(callback);
    return () => {
      const subscribers = this.replySubscribers.get(parentId);
      if (subscribers) {
        subscribers.delete(callback);
        if (subscribers.size === 0) {
          this.replySubscribers.delete(parentId);
        }
      }
    };
  }

  private notifyReplySubmission(parentId: string): void {
    const subscribers = this.replySubscribers.get(parentId);
    if (subscribers) {
      subscribers.forEach(callback => callback());
    }
  }

  async submitReply(parentId: string, content: string, quoteData: Quote | null = null): Promise<{ success: boolean }> {
    if (!parentId || !content) {
      console.error('Parent ID and content are required for reply');
      return { success: false };
    }

    const replyData: ReplyData = {
      text: content,
      parentId: [parentId],
      quote: quoteData ? {
        text: quoteData.quoteLiteral,
        sourcePostId: quoteData.sourcePostId,
        selectionRange: quoteData.selectionRange
      } : null
    };

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/createReply`,
        replyData
      );
      
      if (!response.data) {
        console.error('Invalid response from createReply:', response.data);
        return { success: false };
      }

      if (response.data.quoteMetadata) {
        this.updateQuoteMetadata(parentId, response.data.quoteMetadata);
      }

      this.notifyReplySubmission(parentId);

      return { success: true };
    } catch (error) {
      console.error('Error submitting reply:', error);
      console.error('Request data:', replyData);
      return { success: false };
    }
  }

  async fetchReply(uuid: string): Promise<any> {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/getReply/${uuid}`
      );
      const data = await this.handleCompressedResponse(response);
      
      if (data?.quoteMetadata) {
        this.updateQuoteMetadata(uuid, data.quoteMetadata);
      }
      
      return data;
    } catch (error) {
      console.error('Error fetching reply:', error);
      return null;
    }
  }

  async fetchReplies(
    uuid: string,
    quote: string,
    sortingCriteria: string = 'mostRecent',
    page: number = 1,
    limit: number = 10
  ): Promise<{ replies: StoryTreeLevel[]; pagination: any } | null> {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/getReplies/${uuid}/${encodeURIComponent(quote)}/${sortingCriteria}`,
        {
          params: {
            page,
            limit
          }
        }
      );
      
      const data = await this.handleCompressedResponse(response);
      
      if (data?.replies && data?.pagination) {
        this.dispatch?.({ 
          type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
          payload: data.replies 
        });
        
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error fetching replies:', error);
      return null;
    }
  }

  async fetchRepliesFeed(): Promise<StoryTreeLevel[]> {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/getRepliesFeed`
      );
      const replies = await this.handleCompressedResponse(response);
      this.dispatch?.({ 
        type: ACTIONS.INCLUDE_NODES_IN_LEVELS, 
        payload: replies 
      });
      return replies;
    } catch (error) {
      console.error('Error fetching replies feed:', error);
      return [];
    }
  }

  updateQuoteMetadata(nodeId: string, metadata: QuoteMetadata): void {
    if (this.state) {
      this.state = {
        ...this.state,
        levels: this.state.levels.map(level => 
          level.rootNodeId === nodeId 
            ? { ...level, metadata } 
            : level
        )
      };
    }
  }

  // Loading state is now handled through error state
  private setError(error: string | null): void {
    if (this.dispatch) {
      if (error) {
        this.dispatch({ type: ACTIONS.SET_ERROR, payload: error });
      } else {
        this.dispatch({ type: ACTIONS.CLEAR_ERROR });
      }
    }
  }
}

// Create a singleton instance
export const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;