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

import { ACTIONS, StoryTreeNode, StoryTreeState, StoryTreeLevel, Action, StoryTree, CursorPaginatedResponse, Reply, QuoteCounts, ApiResponse, CreateReplyResponse, ExistingSelectableQuotesApiFormat, Post } from '../types/types';
import { Quote } from '../types/quote';
import axios, { AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import StoryTreeError from '../errors/StoryTreeError';
import { createPaginatedFetcher, createCursor } from '../utils/pagination';
import { Compressed } from '../types/compressed';
import compression from '../utils/compression';

class StoryTreeOperator extends BaseOperator {
  // Introduce a store property to hold state and dispatch injected from a React component.
  private store: { state: StoryTreeState, dispatch: React.Dispatch<Action> } | null = null;
  private userContext: { state: { user: { id: string } | null } } | null = null;

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

  // Method to inject the user context
  public setUserContext(context: { state: { user: { id: string } | null } }): void {
    this.userContext = context;
  }

  private getState() {
    if (!this.store) {
      throw new StoryTreeError("Store not initialized in StoryTreeOperator. Call setStore() with the appropriate context.");
    }
    return this.store.state;
  }

  private getUserId(): string {
    if (!this.userContext?.state.user) {
      throw new StoryTreeError("User not authenticated. Please log in to submit replies.");
    }
    return this.userContext.state.user.id;
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
    const url = `${process.env.REACT_APP_API_URL}/api/getPost/${uuid}`;
    try {
      const compressedPost = await this.retryApiCallSimplified<Compressed<Post>>(
        () => axios.get<ApiResponse<Compressed<Post>>>(url, {
            validateStatus: status => status === 200
        })
      );

      const decompressedPost = await compression.decompress<Compressed<Post>, Post>(compressedPost);
      if (!decompressedPost) {
        throw new StoryTreeError('Failed to decompress post');
      }

      const storyTree: StoryTree = {
        post: decompressedPost,
        levels: [],
        error: null
      };

      this.addPostContentToLevelZero(storyTree, decompressedPost);

      // Update each level with fresh pagination data
      await this.updateLevelsPagination(storyTree.levels);

      // Asynchronously update the root node's quoteCounts using the new function.
      // Do not await this promise to avoid delaying the initial story tree load.
      this.fetchQuoteCounts(storyTree.post.id)
        .then(quoteCounts => {
          // Locate the content level (assumed at index 0).
          const contentLevel = storyTree.levels[0];
          if (contentLevel) {
            // Retrieve the content node using the rootQuote as key.
            const nodes = contentLevel.siblings.levelsMap.get(this.rootQuote);
            if (nodes && nodes.length > 0) {
              // Create an updated copy of the content node, following immutable update patterns.
              const updatedNode: StoryTreeNode = { ...nodes[0], quoteCounts };
              // Update the levelsMap for the root quote. (overrides the existing root node)
              contentLevel.siblings.levelsMap.set(this.rootQuote, [updatedNode]);
              // Reuse the existing action to update the level data.
              if (this.store && this.store.dispatch) {
                this.store.dispatch({
                  type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
                  payload: [contentLevel]
                });
              }
            }
          }
        })
        .catch(error => {
          console.error("Failed to update quote counts for root node:", error);
        });

      return storyTree;
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError('Error fetching root node', statusCode, url, error);
      console.error(storyTreeErr);
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: storyTreeErr.message });
      }
      throw storyTreeErr;
    }
  }

  /**
   * Helper method to add the content for level 0 of the story tree (the post)
   *
   * @param storyTree - The StoryTree object being built.
   * @param post - The post data received from the API.
   */
  private addPostContentToLevelZero(storyTree: StoryTree, post: Post): void {
    const contentNode: StoryTreeNode = {
      id: post.id,
      rootNodeId: post.id,
      parentId: [],
      levelNumber: 0,
      textContent: post.content,
      authorId: post.authorId,
      createdAt: post.createdAt,
      repliedToQuote: this.rootQuote,
      quoteCounts: { quoteCounts: new Map<Quote, number>() } // Will be populated asynchronously
    };

    console.log("StoryTreeOperator: Creating content level with pagination:", {
      nodeId: storyTree.post.id,
      parentId: storyTree.post.id,
      content: contentNode.textContent,
      quoteCounts: contentNode.quoteCounts,
    });

    // Create a Map with the root quote and an array containing the content node
    const levelsMap = new Map();
    levelsMap.set(this.rootQuote, [contentNode]);

    const contentLevel: StoryTreeLevel = {
      rootNodeId: storyTree.post.id,
      parentId: [],
      levelNumber: storyTree.levels.length,
      selectedQuote: this.rootQuote,
      siblings: { levelsMap },
      pagination: { 
        nextCursor: undefined,
        prevCursor: undefined,
        hasMore: false,
        matchingRepliesCount: 1  // Root node always counts as 1
      }
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
          const compressedPaginatedResponse = await this.retryApiCallSimplified<Compressed<CursorPaginatedResponse<Reply>>>(
            () => axios.get(url, {
              validateStatus: status => status === 200
            })
          );
          const decompressedPaginatedData = await compression.decompress<Compressed<CursorPaginatedResponse<Reply>>, CursorPaginatedResponse<Reply>>(compressedPaginatedResponse);
          if (decompressedPaginatedData && decompressedPaginatedData.pagination) {
            // Here we update pagination data inside level.
            Object.assign(level, { pagination: decompressedPaginatedData.pagination });
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
   * Fetches quote counts for a given node using the new API.
   *
   * @param id - The id of the node.
   * @returns A promise resolving to QuoteCounts.
   */
  private async fetchQuoteCounts(id: string): Promise<QuoteCounts> {
    const url = `${process.env.REACT_APP_API_URL}/api/getQuoteCounts/${id}`;
    const compressedResponse = await this.retryApiCallSimplified<Compressed<ExistingSelectableQuotesApiFormat>>(
      () => axios.get(url, {
        validateStatus: status => status === 200
      })
    );
    const decompressedResponse = await compression.decompress<Compressed<ExistingSelectableQuotesApiFormat>, ExistingSelectableQuotesApiFormat>(compressedResponse);
    if (!decompressedResponse || !decompressedResponse.quoteCounts) {
      console.error('Invalid data received for quote counts:', decompressedResponse);
      throw new StoryTreeError('Invalid data received for quote counts');
    }
    const quoteCounts = new Map(decompressedResponse.quoteCounts) as Map<Quote, number>;
    console.log("StoryTreeOperator: Fetched quote counts:", quoteCounts);
    return { quoteCounts };
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

      const storyTreeId = state.storyTree.post.id;
      const nodes: StoryTreeNode[] = await Promise.all(response.data.map(async (reply) => {
        const quoteCounts = await this.fetchQuoteCounts(reply.id);
        return {
          id: reply.id,
          rootNodeId: storyTreeId,
          parentId: reply.parentId,
          levelNumber,
          textContent: reply.text,
          quoteCounts,
          authorId: reply.metadata.authorId,
          createdAt: reply.metadata.createdAt.toString(),
          repliedToQuote: reply.quote,
        } as StoryTreeNode;
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
   * Submits a reply to a given story node.
   *
   * @param text - The content of the reply.
   * @param parentId - The parent node identifier.
   * @param quote - The quote associated with the reply.
   * @returns A promise resolving to an object indicating success and optionally the reply ID.
   * @throws {StoryTreeError} If user is not authenticated
   */
  public async submitReply(text: string, parentId: string, quote: Quote): Promise<{ replyId?: string; error?: string }> {
    try {
      // Get the user ID, which will throw if user is not authenticated
      const authorId = this.getUserId();

      const response = await axios.post<CreateReplyResponse>(`${process.env.REACT_APP_API_URL}/api/createReply`, {
        text,
        parentId,
        quote,
        metadata: {
          authorId,
          createdAt: new Date().toISOString()
        }
      });

      if (!response.data.success) {
        console.error('Error submitting reply:', response.data.error);
        return { error: response.data.error || 'Unknown error occurred' };
      }

      // After successful reply, reload the story tree data
      const state = this.getState();
      if (state.storyTree) {
        await this.initializeStoryTree(state.storyTree.post.id);
      }

      return { replyId: response.data.data?.id };
    } catch (error) {
      if (error instanceof StoryTreeError) {
        return { error: error.message };
      }
      const axiosErr = error as AxiosError<CreateReplyResponse>;
      console.error('Error submitting reply:', {
        status: axiosErr.response?.status,
        endpoint: `${process.env.REACT_APP_API_URL}/api/createReply`,
        error: axiosErr.response?.data?.error || axiosErr.message
      });
      return { error: axiosErr.response?.data?.error || 'Failed to submit reply' };
    }
  }

  // loadMoreLevels remains unchanged (aside from the improvements in loadMoreItems)
  public loadMoreLevels = async (startLevelNumber: number, endLevelNumber: number): Promise<void> => {
    console.log("StoryTreeOperator: Loading more levels:", { startLevelNumber, endLevelNumber });
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

// Create and export a single instance
const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;