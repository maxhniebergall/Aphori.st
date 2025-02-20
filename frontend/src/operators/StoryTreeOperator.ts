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
 * - **Refactor:** fetchStoryTree now returns a complete StoryTree object rather than a StoryTreeLevel[].
 * - **Refactor:** Removed direct usage of React hooks; introduced dependency injection to receive the store (state & dispatch).
 * - **Update:** During initial story tree loading, fetches actual reply counts and pagination data for each level
 *   by calling the /api/getReplies endpoint instead of using hardcoded placeholder pagination.
 * - **Refactor:** Modularized fetchStoryTree by extracting helper functions addTitleLevel, addContentLevel, and updateLevelsPagination.
 * - **Enhancement:** Improved error handling & logging with custom error types and detailed context.
 * - **Enhancement:** Added stricter type definitions using generics in response handlers.
 * - **Enhancement:** State updates now follow immutable patterns.
 * - **Recovery:** Re-added initializeStoryTree to support initialization of the story tree.
 *
 * - TODO:
 * - Implement caching with CacheService
 */

import { ACTIONS, StoryTreeNode, StoryTreeState, UnifiedNode, StoryTreeLevel, Action, StoryTree, CursorPaginatedResponse, Reply, QuoteCounts, ApiResponse } from '../types/types';
import { Quote } from '../types/quote';
import axios, { AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import StoryTreeError from '../errors/StoryTreeError';
import { createPaginatedFetcher, createCursor } from '../utils/pagination';

class StoryTreeOperator extends BaseOperator {
  // Introduce a store property to hold state and dispatch injected from a React component.
  private store: { state: StoryTreeState, dispatch: React.Dispatch<Action> } | null = null;

  // Initialize with a valid root quote that represents the entire content
  public rootQuote: Quote = new Quote(
    'content',  // Non-empty text
    'content',  // Non-empty source ID
    { start: 0, end: 1 }  // Valid range
  );

  constructor() {
    super();
    // Removed React hooks from here.
    // Bind methods
    this.loadMoreItems = this.loadMoreItems.bind(this);
    this.loadMoreLevels = this.loadMoreLevels.bind(this);
    this.fetchStoryTree = this.fetchStoryTree.bind(this);
    this.validateNode = this.validateNode.bind(this);
  }

  // Method to inject the store (state and dispatch) from a React functional component
  public setStore(store: { state: StoryTreeState, dispatch: React.Dispatch<Action> }): void {
    this.store = store;
  }

  private getState() {
    if (!this.store) {
      throw new Error("Store not initialized in StoryTreeOperator. Call setStore() with the appropriate context.");
    }
    return this.store.state;
  }

  validateNode(level: any): level is StoryTreeLevel {
    return level &&
      typeof level === 'object' &&
      typeof level.rootNodeId === 'string' &&
      typeof level.levelNumber === 'number' &&
      level.siblings &&
      typeof level.siblings === 'object' &&
      level.siblings.levelsMap instanceof Map;
  }

  /**
   * Fetches the entire story tree for a given UUID.
   *
   * @param uuid - The unique identifier for the root node of the story tree.
   * @returns A promise that resolves to the fully constructed StoryTree object.
   * @throws {StoryTreeError} Throws an error if fetching or processing the story tree data fails.
   */
  private async fetchStoryTree(uuid: string): Promise<StoryTree> {
    try {
      const url = `${process.env.REACT_APP_API_URL}/api/combinedNode/${uuid}`;
      const response = await axios.get<ApiResponse<UnifiedNode>>(url);
      const data = await this.handleCompressedResponse<ApiResponse<UnifiedNode>>(response);
      console.log("StoryTreeOperator: Initial story tree response:", {
        success: data?.success,
        hasCompressedData: Boolean(data?.compressedData),
        metadata: data?.compressedData?.metadata,
        url
      });
      if (!data || !data.success || !data.compressedData) {
        console.error("Invalid response data received:", data);
        throw new StoryTreeError('Invalid response data received', response.status, url, data);
      }

      const unifiedNode = data.compressedData;
      const storyTree: StoryTree = {
        id: unifiedNode.id,
        parentId: unifiedNode.metadata?.parentId || null,
        metadata: {
          authorId: unifiedNode.metadata?.authorId || '',
          createdAt: unifiedNode.metadata?.createdAt || '',
          quote: null
        },
        levels: [],
        error: null
      };

      // Create content level using modularized helper function
      this.addContentLevel(storyTree, unifiedNode);

      // Update each level with fresh pagination data
      await this.updateLevelsPagination(storyTree.levels);
      return storyTree;
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const endpoint = `${process.env.REACT_APP_API_URL}/api/combinedNode/${uuid}`;
      const storyTreeErr = new StoryTreeError('Error fetching root node', statusCode, endpoint, error);
      console.error(storyTreeErr);
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: storyTreeErr.message });
      }
      throw storyTreeErr;
    }
  }

  /**
   * Helper method to add a content level to the StoryTree.
   *
   * @param storyTree - The StoryTree object being built.
   * @param unifiedNode - The unified node data received from the API.
   */
  private addContentLevel(storyTree: StoryTree, unifiedNode: UnifiedNode): void {
    const contentNode: StoryTreeNode = {
      id: storyTree.id,
      rootNodeId: storyTree.id,
      parentId: [storyTree.id],
      textContent: unifiedNode.content,
      quoteCounts: { quoteCounts: new Map([[this.rootQuote, 0]]) }, // TODO: update this with actual quote counts
      metadata: {
        replyCounts: new Map([[this.rootQuote, 0]]) // TODO: update this with actual reply counts
      }
    };

    console.log("StoryTreeOperator: Creating content level with pagination:", {
      nodeId: storyTree.id,
      parentId: storyTree.id,
      defaultPagination: { nextCursor: undefined, prevCursor: undefined, hasMore: false, matchingRepliesCount: 1 }
    });

    const contentLevel: StoryTreeLevel = {
      rootNodeId: storyTree.id,
      parentId: [storyTree.id],
      levelNumber: storyTree.levels.length,
      selectedQuote: this.rootQuote,
      siblings: { levelsMap: new Map([[this.rootQuote, [contentNode]]]) },
      pagination: { nextCursor: undefined, prevCursor: undefined, hasMore: false, matchingRepliesCount: 1 }
    };

    // Immutable update for the levels array.
    storyTree.levels = [...storyTree.levels, contentLevel];
  }

  /**
   * Helper method to update pagination information for each level in the provided list, in parallel.
   *
   * @param levels - The array of StoryTreeLevel objects whose pagination data will be updated.
   */
  private async updateLevelsPagination(levels: StoryTreeLevel[]): Promise<void> {
    const paginationPromises = levels.map(async (level) => {
      if (level.parentId && level.parentId[0] && level.selectedQuote) {
        // Add validation before making the API call
        if (!level.selectedQuote.isValid()) {
          console.error('Invalid quote in level, skipping pagination update:', {
            levelNumber: level.levelNumber,
            quote: level.selectedQuote
          });
          return;
        }

        const sortingCriteria = 'mostRecent';
        const limit = 1;
        const cursor = 0;
        const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${level.parentId[0]}/${encodeURIComponent(level.selectedQuote.toString())}/${sortingCriteria}?limit=${limit}&cursor=${cursor}`;
        try {
          const paginationResponse = await axios.get<ApiResponse<CursorPaginatedResponse<Reply>>>(url);
          const paginationData = await this.handleCompressedResponse<ApiResponse<CursorPaginatedResponse<Reply>>>(paginationResponse);
          if (paginationData && paginationData.compressedData && paginationData.compressedData.pagination) {
            // Here we update pagination data inside level.
            Object.assign(level, { pagination: paginationData.compressedData.pagination });
            console.log(`Fetched pagination for level ${level.levelNumber}:`, level.pagination);
          } else {
            console.warn(`No pagination data found for level ${level.levelNumber}.`);
          }
        } catch (err) {
          const axiosErr = err as AxiosError;
          const statusCode = axiosErr.response?.status;
          const storyTreeErr = new StoryTreeError(
            `Error fetching pagination for level ${level.levelNumber}`,
            statusCode,
            url,
            err
          );
          console.error(storyTreeErr);
        }
      }
    });
    await Promise.all(paginationPromises);
  }

  /**
   * Fetches quote counts for a given node.
   *
   * @param id - The id of the node.
   * @param quote - The quote used for filtering.
   * @param limit - The pagination limit.
   * @param cursor - The pagination cursor.
   * @returns A promise resolving to QuoteCounts.
   */
  private async fetchQuoteCounts(id: string, quote: Quote, limit: number, cursor: number): Promise<QuoteCounts> {
    const sortingCriteria = 'mostRecent';
    const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${id}/${quote}/${sortingCriteria}?limit=${limit}&cursor=${cursor}`;
    const response = await axios.get<ApiResponse<QuoteCounts>>(url);
    const data = await this.handleCompressedResponse<ApiResponse<QuoteCounts>>(response);
    if (!data || !data.compressedData) {
      console.error('Invalid unified node data received:', data);
      return { quoteCounts: new Map() };
    }
    const quoteCounts = typeof data.compressedData === 'string'
      ? JSON.parse(data.compressedData) as QuoteCounts
      : data.compressedData;
    return quoteCounts;
  }

  /**
   * Loads more items (replies) for a given parent node and updates state accordingly.
   *
   * @param parentId - The id of the parent node.
   * @param levelNumber - The current level number.
   * @param quote - The quote used for filtering.
   * @param startIndex - The starting index for pagination.
   * @param stopIndex - The stopping index for pagination.
   */
  public async loadMoreItems(parentId: string, levelNumber: number, quote: Quote, startIndex: number, stopIndex: number): Promise<void> {
    console.log("StoryTreeOperator: Loading more items:", { parentId, levelNumber, quote: quote.toString(), startIndex, stopIndex });

    // Add validation before making the API call
    if (!quote.isValid()) {
      console.error('Invalid quote provided to loadMoreItems:', {
        parentId,
        levelNumber,
        quote,
        startIndex,
        stopIndex
      });
      throw new StoryTreeError('Invalid quote provided to loadMoreItems');
    }

    const state = this.getState();
    if (!state?.storyTree) {
      console.error('StoryTreeOperator: No story tree found in state');
      return;
    }

    const limit = stopIndex - startIndex + 1;
    const sortingCriteria = 'mostRecent';

    // Create a fetcher for this specific request
    const fetchReplies = createPaginatedFetcher<Reply>(
      `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId}/${encodeURIComponent(quote.toString())}/${sortingCriteria}`
    );

    try {
      // Get the last loaded item for this level to create the cursor
      const currentLevel = state.storyTree.levels[levelNumber];
      const currentNodes = currentLevel?.siblings.levelsMap.get(quote) || [];
      const lastLoadedItem = currentNodes[currentNodes.length - 1];
      
      // Create cursor from the last loaded item if it exists
      const cursor = lastLoadedItem ? createCursor(
        lastLoadedItem.id,
        Date.now(), // Use current timestamp as we don't need exact timestamp for cursor  TODO check that his is correct
        'reply'
      ) : undefined;

      const response = await fetchReplies(cursor, limit);
      
      console.log("StoryTreeOperator: Received paginated response:", {
        success: true,
        paginationInfo: response.pagination,
        replyCount: response.data.length,
        totalCount: response.pagination.matchingItemsCount
      });

      // Ensure storyTree is still available after async operation
      if (!state.storyTree) {
        console.error('StoryTreeOperator: Story tree no longer available');
        return;
      }

      const storyTreeId = state.storyTree.id;
      const nodes: StoryTreeNode[] = await Promise.all(response.data.map(async (reply) => {
        const quoteCounts = await this.fetchQuoteCounts(reply.id, quote, limit, 0);
        return {
          id: reply.id,
          rootNodeId: storyTreeId,
          parentId: reply.parentId,
          textContent: reply.text,
          quoteCounts,
          metadata: {
            authorId: reply.metadata.authorId,
            createdAt: reply.metadata.createdAt.toString(),
            quote: reply.quote,
            replyCounts: new Map([[reply.quote, 0]])
          }
        };
      }));

      // Create a StoryTreeLevel with the new nodes and pagination
      const level: StoryTreeLevel = {
        rootNodeId: storyTreeId,
        parentId: [parentId],
        levelNumber,
        selectedQuote: quote,
        siblings: { levelsMap: new Map([[quote, nodes]]) },
        pagination: {
          nextCursor: response.pagination.nextCursor,
          prevCursor: response.pagination.prevCursor,
          hasMore: response.pagination.hasMore,
          matchingRepliesCount: response.pagination.matchingItemsCount
        }
      };

      // Use the existing INCLUDE_NODES_IN_LEVELS action
      this.store?.dispatch({
        type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
        payload: [level]
      });

    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError('Error loading more items', statusCode, `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId}/${quote}/mostRecent`, error);
      console.error(storyTreeErr);
      throw storyTreeErr;
    }
  }

  /**
   * (Currently unused.) Fetches a single node wrapped as a StoryTreeLevel.
   *
   * @param id - The node id.
   * @param quote - The quote for filtering.
   * @param retries - Number of retry attempts.
   * @param delay - Delay between retries in milliseconds.
   * @returns A promise resolving to a StoryTreeLevel or null.
   */
  private async fetchNode(id: string, quote: Quote, retries = 3, delay = 1000): Promise<StoryTreeLevel | null> {
    for (let i = 0; i < retries; i++) {
      try {
        const url = `${process.env.REACT_APP_API_URL}/api/combinedNode/${id}`;
        const response = await axios.get<ApiResponse<UnifiedNode>>(url);
        const data = await this.handleCompressedResponse<ApiResponse<UnifiedNode>>(response);
        if (!data || !data.compressedData) {
          console.error('Invalid unified node data received:', data);
          return null;
        }
        const unifiedNode: UnifiedNode = typeof data.compressedData === 'string' ? JSON.parse(data.compressedData) : data.compressedData;
        return {
          rootNodeId: unifiedNode.id,
          parentId: unifiedNode.metadata.parentId ? unifiedNode.metadata.parentId : [],
          levelNumber: 1,
          selectedQuote: quote,
          siblings: { levelsMap: new Map() },
          pagination: { nextCursor: undefined, prevCursor: undefined, hasMore: false, matchingRepliesCount: 0 }
        };
      } catch (error) {
        const axiosErr = error as AxiosError;
        if (axiosErr.response?.status === 503 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        const endpoint = `${process.env.REACT_APP_API_URL}/api/combinedNode/${id}`;
        const storyTreeErr = new StoryTreeError('Error fetching unified node', axiosErr.response?.status, endpoint, error);
        console.error(storyTreeErr);
        return null;
      }
    }
    return null;
  }

  /**
   * Submits a reply to a given story node.
   *
   * @param rootNodeId - The root node identifier.
   * @param replyContent - The content of the reply.
   * @param quote - The quote associated with the reply.
   * @returns A promise resolving to an object indicating success.
   */
  public async submitReply(rootNodeId: string, replyContent: string, quote: Quote): Promise<{ success: boolean }> {
    try {
      const response = await axios.post<ApiResponse<any>>(`${process.env.REACT_APP_API_URL}/api/reply`, {
        rootNodeId,
        replyContent,
        quote
      });
      const data = await this.handleCompressedResponse<ApiResponse<any>>(response);
      if (data && data.success) {
        return { success: true };
      }
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const endpoint = `${process.env.REACT_APP_API_URL}/api/reply`;
      const storyTreeErr = new StoryTreeError('Error submitting reply', statusCode, endpoint, error);
      console.error(storyTreeErr);
    }
    return { success: false };
  }

  // loadMoreLevels remains unchanged (aside from the improvements in loadMoreItems)
  public loadMoreLevels = async (startLevelNumber: number, endLevelNumber: number): Promise<void> => {
    let state = this.getState();
    if (!state.storyTree) {
      const errorMsg = `StoryTreeOperator: storyTree not initialized`;
      console.warn(errorMsg);
      return Promise.reject(new StoryTreeError(errorMsg));
    }
    if (startLevelNumber > state.storyTree.levels.length) {
      const errorMsg = `Start level number ${startLevelNumber} is too big, max is ${state.storyTree.levels.length}`;
      console.warn(errorMsg);
      return Promise.reject(new StoryTreeError(errorMsg));
    }
    const countOfNewLevelsToLoad = endLevelNumber - startLevelNumber;
    const loadPromises = [];
    for (let i = 0; i < countOfNewLevelsToLoad; i++) {
      const levelNumber = startLevelNumber + i;
      const level = state.storyTree.levels[levelNumber];
      if (!level) {
        console.warn(`Level ${levelNumber} not found`);
        continue;
      }
      const parentId = level.parentId[0];
      if (!parentId) {
        console.warn(`ParentId not found for level ${levelNumber}`);
        continue;
      }
      loadPromises.push(this.loadMoreItems(parentId, levelNumber, level.selectedQuote, 0, 10));
    }
    if (loadPromises.length === 0) {
      return Promise.resolve();
    }
    // Since loadMoreItems already dispatches state updates, no additional dispatch is performed here.
    return Promise.all(loadPromises).then(() => {
      return;
    });
  };

  /**
   * Centralized method to initialize the story tree.
   * 
   * Requirements:
   * - Dispatch the start of the story tree load.
   * - Fetch the complete story tree using fetchStoryTree.
   * - Update the store with the initial story tree data.
   */
  public async initializeStoryTree(rootUUID: string): Promise<void> {
    try {
      if (!this.store || !this.store.dispatch) {
        throw new StoryTreeError('Dispatch not initialized in StoryTreeOperator.');
      }
      // Dispatch an action to start loading the story tree.
      this.store.dispatch({ type: ACTIONS.START_STORY_TREE_LOAD, payload: { rootNodeId: rootUUID } });
      // Fetch the complete story tree.
      const storyTree = await this.fetchStoryTree(rootUUID);
      if (storyTree) {
        // Dispatch an action to update the store with the loaded story tree.
        this.store.dispatch({ type: ACTIONS.SET_INITIAL_STORY_TREE_DATA, payload: { storyTree } });
      }
    } catch (error) {
      console.error('Error fetching story data:', error);
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load story tree' });
      }
    }
  }
}

const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;