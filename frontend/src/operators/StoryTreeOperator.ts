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

import { ACTIONS, StoryTreeNode, StoryTreeState, StoryTreeLevel, Action, StoryTree, CursorPaginatedResponse, Reply, QuoteCounts, CompressedApiResponse, CreateReplyResponse, Post, Pagination, Siblings, ExistingSelectableQuotesApiFormat } from '../types/types';
import { Quote } from '../types/quote';
import axios, { AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import StoryTreeError from '../errors/StoryTreeError';
import { Compressed } from '../types/compressed';
import compression from '../utils/compression';

class StoryTreeOperator extends BaseOperator {
  // Introduce a store property to hold state and dispatch injected from a React component.
  private store: { state: StoryTreeState, dispatch: React.Dispatch<Action> } | null = null;
  private userContext: { state: { user: { id: string } | null } } | null = null;

  // Initialize with a valid root quote that represents the entire content


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
   * Fetches the root node of the story tree for a given UUID and initializes the story tree structure.
   * The rest of the story tree nodes are fetched asynchronously as needed.
   *
   * @param uuid - The unique identifier for the root node of the story tree.
   * @returns A promise that resolves to the fully constructed StoryTree object.
   * @throws {StoryTreeError} Throws an error if fetching or processing the story tree data fails.
   */
  private async fetchStoryTree(uuid: string): Promise<void> {
    const url = `${process.env.REACT_APP_API_URL}/api/getPost/${uuid}`;
    try {
      const compressedPost = await this.retryApiCallSimplified<Compressed<Post>>(
        () => axios.get<CompressedApiResponse<Compressed<Post>>>(url, {
            validateStatus: status => status === 200
        })
      );

      const decompressedPost = await compression.decompress<Post>(compressedPost);
      if (!decompressedPost) {
        throw new StoryTreeError('Failed to decompress post');
      }

      // Add the root post content and fetch its quote counts
      // updates storyTree.levels as a side effect
      // fetches quote counts async, so we don't immediately have quote counts after this runs
      await this.addPostContentToLevelZero(decompressedPost); // this part seems to be working

      return Promise.resolve();
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
  private async addPostContentToLevelZero(post: Post): Promise<void> {
    console.log("StoryTreeOperator: Adding post content to level zero:", {
      postId: post.id,
      postContent: post.content,
      authorId: post.authorId,
      createdAt: post.createdAt
    });

    const quoteCounts = await this.fetchQuoteCounts(post.id);

    const contentNode: StoryTreeNode = {
      id: post.id,
      rootNodeId: post.id,
      parentId: [],
      levelNumber: 0,
      textContent: post.content,
      authorId: post.authorId,
      createdAt: post.createdAt,
      repliedToQuote: null, // Root post isn't replying to anything
      quoteCounts: quoteCounts,
    };

    console.log("StoryTreeOperator: Created content node:", {
      nodeId: contentNode.id,
      textContent: contentNode.textContent,
      levelNumber: contentNode.levelNumber
    });

    // For the root post, we use null as the key since it's not replying to any quote
    const siblings: Siblings = {
      levelsMap: [[null, [contentNode]]]
    };

    // Create the content level
    const contentLevel: StoryTreeLevel = {
      rootNodeId: post.id,
      parentId: [],
      levelNumber: 0,
      selectedQuote: null as unknown as Quote, // Type assertion to satisfy TypeScript
      selectedNode: contentNode,
      siblings: siblings,
      pagination: { 
        hasMore: false,
        totalCount: 1
      }
    };

    // Dispatch the content level
    if (this.store && this.store.dispatch) {
      this.store.dispatch({
        type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
        payload: [contentLevel]
      });
    }

    console.log("StoryTreeOperator: Added post content to level zero:", {
      levelNumber: contentLevel.levelNumber,
      siblingsCount: siblings.levelsMap[0][1].length,
      firstNodeContent: siblings.levelsMap[0][1][0]?.textContent
    });
  }

  private async fetchAndDispatchReplies(level: StoryTreeLevel, sortingCriteria: string, limit: number, cursor: string | undefined = undefined) {
    let cursorString = cursor;
    if (cursor === undefined) {
      cursorString = level.pagination.nextCursor;
    }
    const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${level.parentId[0]}/${encodeURIComponent(level.selectedQuote.toString())}/${sortingCriteria}?limit=${limit}&cursor=${cursorString}`;
    try {
      const compressedPaginatedResponse = await this.retryApiCallSimplified<Compressed<CursorPaginatedResponse<Reply>>>(
        () => axios.get(url, {
          validateStatus: status => status === 200
        })
      );
      console.log(`Fetched replies for level ${level.levelNumber}:`, compressedPaginatedResponse);
      const decompressedPaginatedData = await compression.decompress<CursorPaginatedResponse<Reply>>(compressedPaginatedResponse);
      if (decompressedPaginatedData && decompressedPaginatedData.pagination) {
        console.log(`Fetched replies for level ${level.levelNumber}:`, decompressedPaginatedData);
        const quoteCountsMap = new Map<Quote, QuoteCounts>();
        // Use only the standardized data field
        const repliesData = decompressedPaginatedData.data;
                          
        await Promise.all(repliesData.map(async (reply: Reply) => {
          const quoteCounts = await this.fetchQuoteCounts(reply.id);
          quoteCountsMap.set(reply.quote, quoteCounts);
        }));

        const newLevelData: StoryTreeLevel = {
          ...level,
          siblings: {
            levelsMap: [[level.selectedQuote, repliesData.map((reply: Reply) => (
              {
                id: reply.id,
                rootNodeId: level.rootNodeId,
                parentId: reply.parentId,
                levelNumber: level.levelNumber,
                textContent: reply.text,
                authorId: reply.authorId,
                createdAt: reply.createdAt,
                repliedToQuote: reply.quote,
                quoteCounts: quoteCountsMap.get(reply.quote)
              } as StoryTreeNode
            ))]]
          },
          pagination: decompressedPaginatedData.pagination
        };
        console.log(`Fetched replies for level ${level.levelNumber}:`, newLevelData, "ready to dispatch");

        if (this.store && this.store.dispatch) {
          this.store.dispatch({
            type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
            payload: [newLevelData]
          });
        }
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

  private async   fetchFirstRepliesForLevel(levelNumber: number, parentId: string, selectedQuote: Quote, sortingCriteria: string, limit: number): Promise<CursorPaginatedResponse<Reply> | null> {
    const encodedSelectedQuoteString = new Quote(selectedQuote.text, selectedQuote.sourcePostId, selectedQuote.selectionRange).toString();
    const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId}/${encodedSelectedQuoteString}/${sortingCriteria}?limit=${limit}`;
    try {
      const compressedPaginatedResponse = await this.retryApiCallSimplified<Compressed<CursorPaginatedResponse<Reply>>>(
        () => axios.get(url, {
          validateStatus: status => status === 200
        })
      );
      console.log("fetchFirstRepliesForLevel compressedPaginatedResponse", compressedPaginatedResponse);
      const decompressedPaginatedData = await compression.decompress<CursorPaginatedResponse<Reply>>(compressedPaginatedResponse);
      console.log("fetchFirstRepliesForLevel decompressedPaginatedData", decompressedPaginatedData);
      return decompressedPaginatedData;

    } catch (err) {
      const axiosErr = err as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError(
        `Error fetching pagination for level ${levelNumber}`,
        statusCode,
        url,
        err
      );
      throw storyTreeErr;
    }
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
    const decompressedResponse = await compression.decompress<ExistingSelectableQuotesApiFormat>(compressedResponse);
    if (!decompressedResponse || !decompressedResponse.quoteCounts) {
      console.error('Invalid data received for quote counts:', decompressedResponse);
      throw new StoryTreeError('Invalid data received for quote counts');
    }
    
    // Create a new array of quote counts with properly reconstructed Quote objects
    
    console.log("StoryTreeOperator: Fetched quote counts size:", decompressedResponse.quoteCounts.length);
    if (decompressedResponse.quoteCounts.length > 0) {
      console.log("StoryTreeOperator: First quote count:", decompressedResponse.quoteCounts[0]);
    }
    
    return {quoteCounts: decompressedResponse.quoteCounts};
  }

  /**
   * Loads more items (replies) for a given parent node and updates state accordingly.
   * Only used for loading more items for existing levels. Existing levels should already have some siblings/replies. 
   *
   * @param parentId - The id of the parent node.
   * @param levelNumber - The current level number.
   * @param quote - The quote used for filtering.
   * @param startIndex - The starting index for pagination.
   * @param stopIndex - The stopping index for pagination.
   * @requires that the level already exists in the state
   * // TODO we need to introduce the cache here so that requesting existing items doesn't trigger a new fetch (for those items)
   */
  public async loadMoreItems(parentId: string, levelNumber: number, quote: Quote, startIndex: number, stopIndex: number): Promise<void> {
    console.log("StoryTreeOperator: Loading more items:", { 
      parentId, 
      levelNumber, 
      quote: quote ? quote.toString() : 'undefined', 
      startIndex, 
      stopIndex 
    });

    // Validate the quote
    if (!quote) {
      console.error('Quote is undefined in loadMoreItems');
      throw new StoryTreeError('Quote is undefined in loadMoreItems');
    }

    // Ensure quote has isValid method
    if (typeof quote.isValid !== 'function') {
      console.error('Invalid quote object provided to loadMoreItems:', quote);
      // Try to recreate the quote if possible
      if (quote.text && quote.sourcePostId && quote.selectionRange) {
        quote = new Quote(quote.text, quote.sourcePostId, quote.selectionRange);
      } else {
        throw new StoryTreeError('Invalid quote provided to loadMoreItems');
      }
    }

    // Now check if the quote is valid
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

    const limit = stopIndex - startIndex;
    const sortingCriteria = 'mostRecent'
    try {
      { // block scoping to ensure updated state
        // this block is used to fetch the replies and update the state, including the quoteCounts

        const state = this.getState();
          if (!state?.storyTree) {
            console.error('StoryTreeOperator: No story tree found in state');
            return;
          }
        const currentLevel = state.storyTree.levels[levelNumber];
        // this call to getReplies will fetch the replies and update the state, including the quoteCounts
        await this.fetchAndDispatchReplies(currentLevel, sortingCriteria, limit); 
      }
      
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError(
        'Error loading more items', 
        statusCode, 
        `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId}/${encodeURIComponent(quote.toString())}/mostRecent`, 
        error
      );
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

  // TODO verify that we are only dispatching state once per iteration
  // TODO -- this is the problem right now
  public loadMoreLevels = async (startLevelNumber: number, endLevelNumber: number): Promise<void> => {
    console.log("StoryTreeOperator: Loading more levels:", { startLevelNumber, endLevelNumber });
    
    // Load each level sequentially
    const countOfNewLevelsToLoad = endLevelNumber - startLevelNumber;
    for (let i = 0; i < countOfNewLevelsToLoad; i++) {
      const levelNumber = startLevelNumber + i;
      const state = this.getState(); 
      // get the current state for each iteration, 
      // we will dispatch the new level and load the items for each iteration

      { // Validate inputs and state
        if (!state.storyTree) {
          const errorMsg = `StoryTreeOperator: storyTree not initialized`;
          console.error(errorMsg);
          throw new StoryTreeError(errorMsg);
        }
      }
      const parentLevel = state.storyTree.levels[startLevelNumber - 1];
      const rootNodeId = state.storyTree.post.id;
      { // continue validation
        if (startLevelNumber < 1) {
          const errorMsg = `Start level number ${startLevelNumber} is less than 1, which is not allowed`;
          console.error(errorMsg);
          throw new StoryTreeError(errorMsg);
        }
        
        if (startLevelNumber > state.storyTree.levels.length) {
          const errorMsg = `Start level number ${startLevelNumber} is too big, max is ${state.storyTree.levels.length}`;
          console.error(errorMsg);
          throw new StoryTreeError(errorMsg);
        }

        // Get the parent level for the first level we want to load
        if (!parentLevel || !parentLevel.selectedNode) {
          const errorMsg = `Selected node not found for level ${startLevelNumber - 1}`;
          console.error(errorMsg);
          throw new StoryTreeError(errorMsg);
        }
        // Skip root level (level 0) since it doesn't have any siblings
        if (levelNumber === 0) {
          console.log("Skipping root level (level 0) since it doesn't have any siblings");
          continue;
        }
      
        // Ensure parent level and selected node exist
        if (!parentLevel || !parentLevel.selectedNode) {
          console.log(`No selected node for level ${levelNumber - 1}, stopping level loading`);
          break;
        }
      }
      const parentId = parentLevel.selectedNode.id;
      const parentText = parentLevel.selectedNode.textContent;
      { // continue validation
        if (!parentId || !parentText) {
          console.error(`Invalid parent node at level ${levelNumber - 1}:`, parentLevel.selectedNode);
          break;
        }
      }
      const quoteCounts = parentLevel.selectedNode.quoteCounts;
      { // continue validation
        if (!quoteCounts || !quoteCounts.quoteCounts || quoteCounts.quoteCounts.length === 0) {
          console.log(`No quotes found for parentId: ${parentId}, no more levels to load`);
          break;
        }
      }
      try {
        let selectedQuote = fullQuoteFromText(parentText, parentId);
        { // for new levels, we assume there isn't a selected quote yet
          // we start by checking if there are any replies to the default quote
          // otherwise, we select the quote with the most replies
          // Check if the default quote has replies
          const hasReplies = quoteCounts.quoteCounts.some(([quote, count]) => 
            quote.toString() === selectedQuote.toString() && count > 0
          );
          if (!hasReplies) {
            console.log("No replies for default quote, selecting quote with most replies instead");
            const maybeQuote = this.mostQuoted(quoteCounts);
            if (!maybeQuote) {
              console.log(`No quotes with replies found for level ${levelNumber}, no more levels to load`);
              break;
            } else {
              selectedQuote = maybeQuote;
            }
          }
        }
        let siblingsForQuote: StoryTreeNode[] = [];
        // Find siblings for the selected quote in the levelsMap array
        const existingLevel = state.storyTree.levels[levelNumber];
        let existingLevelPagination : Pagination | null = null;
        if (existingLevel) {
          const levelsMapEntry = existingLevel.siblings.levelsMap.find(
            ([quote]) => quote && quote.toString() === selectedQuote.toString()
          );
          if (levelsMapEntry) {
            siblingsForQuote = levelsMapEntry[1];
          }
          existingLevelPagination = existingLevel.pagination;
        }
          if (siblingsForQuote && siblingsForQuote.length > 0 || !!existingLevelPagination) {
            throw new StoryTreeError(`New level already has siblings or pagination, but shouldn't [${existingLevel.levelNumber}] [${siblingsForQuote.length}] [${existingLevelPagination}]`);
          }
          const sortingCriteria = 'mostRecent';
            // this call to getReplies will fetch the replies and update the state, including the quoteCounts
          const maybeFirstReplies = await this.fetchFirstRepliesForLevel(levelNumber, parentId, selectedQuote, sortingCriteria, 5); 
          if (!maybeFirstReplies) {
            console.log(`No replies found for level ${levelNumber}, no more levels to load`);
            break;
          } 
          const pagination = maybeFirstReplies.pagination;

          const firstReplies: Reply[] = maybeFirstReplies.data;
          console.log("firstReplies", firstReplies);
          const quoteCountsMap = new Map<Quote, QuoteCounts>();
          await Promise.all(firstReplies.map(async (reply: Reply) => {
            const quoteCounts = await this.fetchQuoteCounts(reply.id);
            quoteCountsMap.set(reply.quote, quoteCounts);
          }));

          firstReplies.forEach(reply => {
            siblingsForQuote.push({
              id: reply.id,
              rootNodeId: rootNodeId,
              parentId: [parentId],
              levelNumber: levelNumber,
              textContent: reply.text,
              repliedToQuote: selectedQuote,
              quoteCounts: quoteCountsMap.get(reply.quote),
              authorId: reply.authorId,
              createdAt: reply.createdAt,
            } as StoryTreeNode);
          });
        
        // Create the fully initialized new level
        const level: StoryTreeLevel = {
          rootNodeId: rootNodeId,
          parentId: [parentId],
          levelNumber: levelNumber,
          selectedQuote: selectedQuote,
          siblings: { levelsMap: [[selectedQuote, siblingsForQuote]] },
          selectedNode: siblingsForQuote[0],
          pagination: pagination
        };
        
        // Dispatch the new level to the store
        await this.dispatchNewLevel(level);
        
      } catch (error) {
        console.error(`Error loading level ${levelNumber}:`, error);
        throw new StoryTreeError(`Failed to load level ${levelNumber}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  };

  private mostQuoted(quoteCounts: QuoteCounts): Quote | null {
    if (!quoteCounts.quoteCounts || quoteCounts.quoteCounts.length === 0) {
      return null;
    }
    
    // Find the quote with the highest count
    let maxQuoteTuple = quoteCounts.quoteCounts[0];
    for (const quoteTuple of quoteCounts.quoteCounts) {
      if (quoteTuple[1] > maxQuoteTuple[1]) {
        maxQuoteTuple = quoteTuple;
      }
    }
    
    // Return just the Quote part of the tuple
    return maxQuoteTuple[0];
  }

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
      await this.fetchStoryTree(rootUUID);
    } catch (error) {
      console.error('Error fetching story data:', error);
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load story tree' });
      }
    }
  }

  public async dispatchNewLevel(level: StoryTreeLevel): Promise<void> {
    if (!this.store || !this.store.dispatch) {
      throw new StoryTreeError('Dispatch not initialized in StoryTreeOperator.');
    }
    this.store.dispatch({ type: ACTIONS.INCLUDE_NODES_IN_LEVELS, payload: [level] });
  }

  public async setSelectedNode(node: StoryTreeNode): Promise<void> {
    if (!this.store || !this.store.dispatch) {
      throw new StoryTreeError('Dispatch not initialized in StoryTreeOperator.');
    }
    this.store.dispatch({ type: ACTIONS.SET_SELECTED_NODE, payload: node });
  }
}

// Create and export a single instance
const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;

function fullQuoteFromText(parentText: string, parentId: string): Quote {
  if (!parentText || !parentId) {
    throw new StoryTreeError('Invalid parent text or parent ID');
  }
  if (parentText.length === 0) {
    throw new StoryTreeError('Parent text is empty, but must not be');
  }
  if (parentId.length === 0) {
    throw new StoryTreeError('Parent ID is empty, but must not be');
  }
  return new Quote(parentText, parentId, {
    start: 0,
    end: parentText.length
  });
}
