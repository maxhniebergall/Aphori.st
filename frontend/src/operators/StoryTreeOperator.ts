/*
 * Requirements:
 * - Implements a singleton pattern to ensure a unified, stateful instance across the application.
 * - Manages internal state including caching and subscription management.
 * - Provides robust orchestration for story tree operations.
 * - Ensures proper binding of class methods.
 * - Implements robust error handling.
 * - Supports transformation and validation of fetched node data.
 * - Integrates handling of compressed responses.
 * - Uses a generic compressed response type (CompressedResponse) for API responses.
 * - Enforces full TypeScript support with strict typings.
 * - Bridges UI interactions and API calls.
 * - Issue 2: Added submitReply method to support reply submission
 * - **Update:** Uses unified node backend API for fetching individual nodes.
 * - **Update:** loadMoreItems method now utilizes levelNumber and quote to fetch the correct sibling nodes.
 * 
 * - TODO:
 * - Implement caching with CacheService
 * 
 */

import React from 'react';
import { ACTIONS, StoryTreeNode, StoryTreeState, UnifiedNode, StoryTreeLevel, Quote, Action, IdToIndexPair, StoryTree, CursorPaginatedResponse, Reply } from '../types/types';
import axios, { AxiosResponse, AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import { compareQuotes } from '../types/quote';
import { CompressedResponse } from '../types/compressed';
class StoryTreeOperator extends BaseOperator {
  private state: StoryTreeState;
  private dispatch: React.Dispatch<Action> | null;
  private replySubscribers: Map<string, Set<() => void>>;
  public fetchRootNode: (uuid: string) => Promise<StoryTreeLevel[] | null>;
  public rootQuote: Quote = {
    quoteLiteral: '',
    sourcePostId: '',
    selectionRange: {
      start: 0,
      end: 0
    }
  }
  private titleNodeId: string = "";
  constructor() {
    super();
    this.state = {
      storyTree: null,
      error: null
    };
    this.dispatch = null;
    this.replySubscribers = new Map();

    // Bind methods
    this.loadMoreItems = this.loadMoreItems.bind(this);
    this.fetchNode = this.fetchNode.bind(this);
    this.updateContext = this.updateContext.bind(this);
    this.fetchRootNode = this.fetchRootNodeImpl.bind(this);
  }

  updateContext(state: Partial<StoryTree>, dispatch: React.Dispatch<Action>): void {
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
      const response = await axios.get<{ storyTree: CompressedResponse<UnifiedNode> }>(
        `${process.env.REACT_APP_API_URL}/api/combinedNode/${uuid}`
      );
      const data = await this.handleCompressedResponse(response);
      if (!data || !data.storyTree) {
        console.error('Invalid response data received:', data);
        return null;
      }

      const storyTree: StoryTree = typeof data.storyTree === 'string' ? JSON.parse(data.storyTree) : data.storyTree;

      const levels: StoryTreeLevel[] = [];

      // Create a title node if metadata exists
      if (storyTree.metadata?.title || storyTree.metadata?.author) {
        const titleNode: StoryTreeNode = {
          id: this.titleNodeId,
          rootNodeId: storyTree.id,
          parentId: [storyTree.id],
          textContent: storyTree.metadata.title || 'Untitled',
          quote: this.rootQuote,
          isTitleNode: true
        };
        const titleLevel: StoryTreeLevel = {
          parentId: [storyTree.id],
          rootNodeId: storyTree.id,
          levelNumber: 0,
          selectedQuote: this.rootQuote,
          siblings: { levelsMap: new Map([[this.rootQuote, [titleNode]]]) }
        };

        levels.push(titleLevel);
      }

      // Create a content node
      levels.push({
        rootNodeId: storyTree.id,
        parentId: [this.titleNodeId],
        levelNumber: levels.length,
        selectedQuote: this.rootQuote,
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

  async fetchNode(id: string, quote: Quote, retries = 3, delay = 1000): Promise<StoryTreeLevel | null> {
    for (let i = 0; i < retries; i++) {
      try {
        const response = await axios.get<{ data: UnifiedNode }>(`${process.env.REACT_APP_API_URL}/api/combinedNode/${id}`);
        const data = await this.handleCompressedResponse(response);

        if (!data || !data.data) {
          console.error('Invalid unified node data received:', data);
          return null;
        }

        const unifiedNode: UnifiedNode = typeof data.data === 'string' ? JSON.parse(data.data) : data.data;

        return {
          rootNodeId: unifiedNode.id,
          parentId: unifiedNode.metadata.parentId ? unifiedNode.metadata.parentId : [],
          levelNumber: 1, // Default to 1 for non-root nodes
          selectedQuote: quote,
          siblings: { levelsMap: new Map() }
        };
      } catch (error) {
        const axiosError = error as AxiosError;
        if (axiosError.response?.status === 503 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        console.error('Error fetching unified node:', error);
        return null;
      }
    }
    return null;
  }

  // Loads nodes as a side effect via the StoryTreeContext
  public async loadMoreItems(parentId: string, levelNumber: number, quote: Quote, startIndex: number, stopIndex: number): Promise<void> {
    return new Promise<void>(async (resolve, reject) => {
      if (!this.state || !this.dispatch) {
        console.warn('StoryTreeOperator: state or dispatch not initialized');
        reject(new Error('StoryTreeOperator: state or dispatch not initialized'));
      }
      try {
        const levels: StoryTreeLevel[] = this.state.storyTree?.levels ?? [];
        // Find the target level that matches the provided level number and quote.
        const targetLevel = levels.find((level) =>
          level.levelNumber === levelNumber && compareQuotes(level.selectedQuote, quote)
        );

        if (!targetLevel) {
          console.warn(`No level found for levelNumber ${levelNumber} with the provided quote`);
          reject(new Error(`No level found for levelNumber ${levelNumber} with the provided quote`));
        }

        const limit = stopIndex - startIndex + 1;
        const cursor = startIndex;
        const uuid = parentId;
        const sortingCriteria = 'mostRecent';

        const response = await axios.get<{ compressedData: CursorPaginatedResponse<Reply> }>(`${process.env.REACT_APP_API_URL}/api/getReplies/${uuid}/${quote}/${sortingCriteria}?limit=${limit}&cursor=${cursor}`);
        const data = await this.handleCompressedResponse(response);
        if (!data || !data.compressedData) {
          console.error('Invalid unified node data received:', data);
          return [];
        }

        const paginatedResponse = JSON.parse(data.data) as CursorPaginatedResponse<Reply>;
        const replies = paginatedResponse.data;

        const nodes: StoryTreeNode[] = replies.map((reply) => ({
          id: reply.id,
          rootNodeId: this.state.storyTree?.id || 'undefinedRootNodeId',
          parentId: reply.parentId,
          textContent: reply.text,
          quote: reply.quote
        }));

        const level: StoryTreeLevel = {
          parentId: [this.state.storyTree?.id || 'undefinedRootNodeId'],
          rootNodeId: this.state.storyTree?.id || 'undefinedRootNodeId',
          levelNumber: levelNumber,
          selectedQuote: quote,
          siblings: { levelsMap: new Map([[quote, nodes]]) }
        };

        if (nodes.length > 0) {
          if (this.dispatch) {
            this.dispatch({
              type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
              payload: [level]
            });
            resolve();
          } else {
            reject(new Error('StoryTreeOperator: dispatch not initialized'));
          }
        }

      } catch (error) {
        console.error('Error loading more items:', error);
        reject(error);
      }
    }
  }


  public async loadMoreLevels(startLevelNumber: number, endLevelNumber: number): Promise<StoryTreeNode[]> {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return [];
    }

    // TODO
    //  1. Assert that the startLevelNumber is 

    try {
      const levels: StoryTreeLevel[] = this.state.storyTree?.levels ?? [];

      // Filter the siblings for the provided quote.
      let existingSiblingsForQuote: StoryTreeNode[] = this.state.storyTree?.levels[levelNumber].siblings.levelsMap.get(quote) || [];
      // FIXME this section below is nor correct
      // we need to get the new siblings from the backend

      const limit = stopIndex - startIndex + 1;
      const cursor = startIndex;
      const uuid = parentId;
      const sortingCriteria = 'mostRecent';

      const response = await axios.get<{ compressedData: CursorPaginatedResponse<Reply> }>(`${process.env.REACT_APP_API_URL}/api/getReplies/${uuid}/${quote}/${sortingCriteria}?limit=${limit}&cursor=${cursor}`);
      const data = await this.handleCompressedResponse(response);
      if (!data || !data.compressedData) {
        console.error('Invalid unified node data received:', data);
        return [];
      }

      const paginatedResponse = JSON.parse(data.data) as CursorPaginatedResponse<Reply>;
      const replies = paginatedResponse.data;

      const nodes: StoryTreeNode[] = replies.map((reply) => ({
        id: reply.id,
        rootNodeId: this.state.storyTree?.id || 'undefinedRootNodeId',
        parentId: reply.parentId,
        textContent: reply.text,
        quote: reply.quote
      }));

      const level: StoryTreeLevel = {
        parentId: [this.state.storyTree?.id || 'undefinedRootNodeId'],
        rootNodeId: this.state.storyTree?.id || 'undefinedRootNodeId',
        levelNumber: levelNumber,
        selectedQuote: quote,
        siblings: { levelsMap: new Map([[quote, nodes]]) }
      };

      if (nodes.length > 0) {
        this.dispatch({
          type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
          payload: [level]
        });
      }

      return [...existingSiblingsForQuote, ...nodes];
    } catch (error) {
      console.error('Error loading more items:', error);
      return [];
    }
  }

  async submitReply(rootNodeId: string, replyContent: string, quote: Quote): Promise<{ success: boolean }> {
    try {
      const response = await axios.post(`${process.env.REACT_APP_API_URL}/api/reply`, {
        rootNodeId,
        replyContent,
        quote
      });
      const data = await this.handleCompressedResponse(response);
      if (data && data.success) {
        return { success: true };
      }
    } catch (error) {
      console.error('Error submitting reply:', error);
    }
    return { success: false };
  }
}

export default new StoryTreeOperator();