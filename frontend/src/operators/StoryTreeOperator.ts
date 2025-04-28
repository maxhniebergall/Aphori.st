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

import { ACTIONS, StoryTreeNode, StoryTreeState, StoryTreeLevel, Action, StoryTree, CursorPaginatedResponse, Reply, QuoteCounts, CompressedApiResponse, CreateReplyResponse, Post, Pagination, Siblings, ExistingSelectableQuotesApiFormat, LastLevel } from '../types/types';
import { areQuotesEqual, Quote } from '../types/quote';
import axios, { AxiosError } from 'axios';
import { BaseOperator } from './BaseOperator';
import StoryTreeError from '../errors/StoryTreeError';
import { Compressed } from '../types/compressed';
import compression from '../utils/compression';
import { 
  createMidLevel, 
  getSelectedQuoteInParent,
  getSelectedQuoteInThisLevel,
  getParentId,
  getLevelNumber,
  getPagination,
  getRootNodeId,
  getSelectedNodeHelper,
  isMidLevel,
  isLastLevel,
  getSiblings,
  setSelectedNodeHelper
} from '../utils/levelDataHelpers';

// Define the type for the ReplyContext setters we need
interface ReplyContextSetters {
  resetReplyState: () => void;
  // Add other setters if needed directly by the operator
}

class StoryTreeOperator extends BaseOperator {
  // Introduce a store property to hold state and dispatch injected from a React component.
  private store: { state: StoryTreeState, dispatch: React.Dispatch<Action> } | null = null;
  private userContext: { state: { user: { id: string } | null } } | null = null;
  // Add property to hold ReplyContext setters
  private replyContextSetters: ReplyContextSetters | null = null;
  // Loading flag
  private isLoadingMore: boolean = false;
  // Track which level is currently being loaded
  private loadingLevelNumber: number | null = null;

  // Initialize with a valid root quote that represents the entire content


  constructor() {
    super();
    // Removed React hooks from here.
    // Bind methods
    this.loadMoreItems = this.loadMoreItems.bind(this);
    this.loadSingleLevel = this.loadSingleLevel.bind(this);
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

  // Method to inject ReplyContext setters
  public setReplyContextSetters(setters: ReplyContextSetters): void {
    this.replyContextSetters = setters;
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

    // Determine the initial selected quote for level 0 (e.g., the most quoted one)
    const initialSelectedQuote = this.mostQuoted(quoteCounts);

    // Dispatch action based on whether an initial quote exists
    if (this.store && this.store.dispatch) {
      // Always create and dispatch a level 0
      const siblings: Siblings = {
        levelsMap: [[null, [contentNode]]] // Keep null key for the map itself
      };

      const contentLevel = createMidLevel(
        post.id,
        [],
        0,
        null, // selectedQuoteInParent is null for level 0
        initialSelectedQuote, // selectedQuoteInThisLevel is the initial selection within level 0
        contentNode,
        siblings,
        {
          hasMore: false,
          totalCount: 1
        }
      );

      this.store.dispatch({
        type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
        payload: [contentLevel]
      });

      // If there was no actual quote, immediately mark the next level as the last level
      if (!initialSelectedQuote) {
        this.dispatchLastLevel(1);
      }
    }
  }

  private async fetchAndDispatchReplies(level: StoryTreeLevel, sortingCriteria: string, limit: number = 5, cursor: string | undefined = undefined) {
    let cursorString = cursor;
    if (cursor === undefined) {
      const pagination = getPagination(level);
      if (!pagination) {
        return;
      }
      cursorString = pagination.nextCursor;
    }
    
    const parentId = getParentId(level);
    const levelNumber = getLevelNumber(level);
    // Use getSelectedQuoteInParent to determine which siblings list is relevant
    const selectedQuoteParent = getSelectedQuoteInParent(level); 
    const rootNodeId = getRootNodeId(level);
    
    // Check selectedQuoteParent specifically
    if (!parentId || parentId.length === 0 || levelNumber === undefined || !selectedQuoteParent || !rootNodeId) {
      console.warn('[fetchAndDispatchReplies] Missing critical data:', { parentId, levelNumber, selectedQuoteParent, rootNodeId });
      return;
    }
    
    // Use static method for encoding
    const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId[0]}/${Quote.toEncodedString(selectedQuoteParent)}/${sortingCriteria}?limit=${limit}&cursor=${cursorString}`;
    
    try {
      const compressedPaginatedResponse = await this.retryApiCallSimplified<Compressed<CursorPaginatedResponse<Reply>>>(
        () => axios.get(url, {
          validateStatus: status => status === 200
        })
      );
      
      const decompressedPaginatedData = await compression.decompress<CursorPaginatedResponse<Reply>>(compressedPaginatedResponse);
      
      if (decompressedPaginatedData && decompressedPaginatedData.pagination) {
        const quoteCountsMap = new Map<Quote, QuoteCounts>();
        console.log(`[fetchAndDispatchReplies] quote counts map: ${JSON.stringify(quoteCountsMap)}`);
        const repliesData = decompressedPaginatedData.data;
        await Promise.all(repliesData.map(async (reply: Reply) => {
          const quoteCounts = await this.fetchQuoteCounts(reply.id);
          quoteCountsMap.set(reply.quote, quoteCounts);
        }));
        const replyNodes: StoryTreeNode[] = repliesData.map((reply: Reply) => ({
          id: reply.id,
          rootNodeId: rootNodeId,
          parentId: reply.parentId,
          levelNumber: levelNumber + 1, // Correct level number for replies
          textContent: reply.text,
          authorId: reply.authorId,
          createdAt: reply.createdAt,
          repliedToQuote: reply.quote, // The quote in the parent this node replies to
          quoteCounts: quoteCountsMap.get(reply.quote) || null
        }));
        const initialSelectedQuoteInNewLevel = this.mostQuoted(replyNodes[0].quoteCounts);
        const newLevelData = createMidLevel(
          rootNodeId,
          parentId, // Parent ID comes from the current level's selected node
          levelNumber + 1, // Level number for the replies
          selectedQuoteParent, // The quote selected in the parent (current level) that led to these replies
          initialSelectedQuoteInNewLevel, // The default selected quote *within* the first reply node of the new level
          replyNodes[0], // The selected node for the new level is the first reply
          {
            // The siblings map for the new level contains these replies, keyed by the quote from the parent
            levelsMap: [[selectedQuoteParent, replyNodes]] 
          },
          decompressedPaginatedData.pagination
        );
        
        if (this.store && this.store.dispatch) {
          this.store.dispatch({
            type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
            payload: [newLevelData]
          });
        } else {
          throw new StoryTreeError('Store not initialized when dispatching replies');
        }
      } else {
        // Dispatch an action to indicate the end of this branch if needed
        if (this.store && this.store.dispatch) {
          this.store.dispatch({
            type: ACTIONS.SET_LAST_LEVEL,
            payload: { levelNumber }
          });
        }
      }
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError('Error fetching or dispatching replies', statusCode, url, error);
      
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: storyTreeErr.message });
      }
    }
  }

  private async fetchFirstRepliesForLevel(levelNumber: number, parentId: string, selectedQuote: Quote, sortingCriteria: string, limit: number): Promise<CursorPaginatedResponse<Reply> | null> {
    // Use static method for encoding
    const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId}/${Quote.toEncodedString(selectedQuote)}/${sortingCriteria}?limit=${limit}`;
    
    try {
      const compressedPaginatedResponse = await this.retryApiCallSimplified<Compressed<CursorPaginatedResponse<Reply>>>(
        () => axios.get(url, {
          validateStatus: status => status === 200
        })
      );
      
      const decompressedPaginatedData = await compression.decompress<CursorPaginatedResponse<Reply>>(compressedPaginatedResponse);
      
      return decompressedPaginatedData || null;
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError('Error fetching first replies', statusCode, url, error);
      
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: storyTreeErr.message });
      }
      return null;
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
      throw new StoryTreeError('Invalid data received for quote counts');
    }
    console.log(`[fetchQuoteCounts] quote counts: ${JSON.stringify(decompressedResponse.quoteCounts)}`);
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

    // Validate the quote simply
    if (!quote || !Quote.isValid(quote)) {
      console.error('Invalid quote provided to loadMoreItems:', quote);
      throw new StoryTreeError('Invalid quote provided to loadMoreItems');
    }

    const limit = stopIndex - startIndex;
    const sortingCriteria = 'mostRecent'
    try {
      { // block scoping to ensure updated state
        // this block is used to fetch the replies and update the state, including the quoteCounts

        const state = this.getState();
          if (!state?.storyTree) {
            return;
          }
        const currentLevel = state.storyTree.levels[levelNumber];
        await this.fetchAndDispatchReplies(currentLevel, sortingCriteria, limit); 
      }
      
    } catch (error) {
      const axiosErr = error as AxiosError;
      const statusCode = axiosErr.response?.status;
      const storyTreeErr = new StoryTreeError(
        'Error loading more items', 
        statusCode, 
        // Use static method for encoding
        `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId}/${Quote.toEncodedString(quote)}/mostRecent`,
        error
      );
      throw storyTreeErr;
    }
  }

  /**
   * Fetches the first page of replies for a given parent ID and quote,
   * transforms them into StoryTreeNodes, creates a new StoryTreeLevel,
   * and dispatches an action to update the state.
   *
   * @param targetLevelIndex The index of the level to refresh/create.
   * @param parentId The ID of the node whose replies we are fetching.
   * @param quoteInParent The quote in the parent node that these replies are responding to.
   */
  private async refreshLevel(targetLevelIndex: number, parentId: string, quoteInParent: Quote): Promise<void> {
    if (!this.store) {
      throw new StoryTreeError('Store not initialized in refreshLevel');
    }
    const state = this.getState();
    if (!state.storyTree) {
      throw new StoryTreeError('StoryTree not initialized in refreshLevel');
    }

    console.log(`[refreshLevel] Refreshing level ${targetLevelIndex} for parent ${parentId} based on quote:`, quoteInParent);

    try {
      // Fetch the first page of replies for the parent node and the specific quote.
      // Use a default sorting criteria, e.g., 'mostRecent'
      const sortingCriteria = 'mostRecent'; // Or fetch this from context/config if needed
      const limit = 5; // Or fetch this from context/config if needed

      // Re-use fetchFirstRepliesForLevel logic
      const repliesResponse = await this.fetchFirstRepliesForLevel(
        targetLevelIndex, // Pass target level number
        parentId,
        quoteInParent, // Use the specific quote from the parent
        sortingCriteria,
        limit
      );

      let newLevel: StoryTreeLevel;

      if (repliesResponse && repliesResponse.data.length > 0) {
        // Transform replies into StoryTreeNodes
        const nodes: StoryTreeNode[] = await Promise.all(repliesResponse.data.map(async (reply): Promise<StoryTreeNode> => {
          const quoteCounts = await this.fetchQuoteCounts(reply.id); // Fetch quote counts for each reply
          return {
            id: reply.id,
            rootNodeId: state.storyTree!.post.id, // Use rootNodeId from the existing story tree
            parentId: [parentId], // The parent ID is the node we are refreshing replies for
            levelNumber: targetLevelIndex,
            textContent: reply.text,
            authorId: reply.authorId,
            createdAt: reply.createdAt,
            repliedToQuote: reply.quote, // Store the quote this reply is responding to
            quoteCounts: quoteCounts,
          };
        }));

        // Select the first node as the default selected node for the refreshed level
        const selectedNode = nodes[0];

        // Determine the quote to pre-select within this new level's selected node
        const selectedQuoteInThisLevel = this.mostQuoted(selectedNode.quoteCounts);

        // Construct siblings map for the new level
        const siblingsMap: Siblings = {
          levelsMap: [[quoteInParent, nodes]] // Use the parent's quote as the key
        };

        // Create the new MidLevel
        newLevel = createMidLevel(
          state.storyTree!.post.id,
          [parentId],
          targetLevelIndex,
          quoteInParent, // The quote selected *in the parent* that led to this level
          selectedQuoteInThisLevel, // The quote pre-selected *within* this new level
          selectedNode,
          siblingsMap,
          repliesResponse.pagination // Use pagination info from the API response
        );
      } else {
        // If no replies are found, create a LastLevel
        console.log(`[refreshLevel] No replies found for parent ${parentId} and quote. Creating LastLevel for index ${targetLevelIndex}.`);
        newLevel = { // Manually construct LastLevel structure
           isLastLevel: true,
           midLevel: null,
           lastLevel: {
               rootNodeId: state.storyTree.post.id,
               levelNumber: targetLevelIndex
           }
        };
      }

      // --- Parent Level Update ---
      const parentLevelIndex = targetLevelIndex - 1;
      const parentLevel = state.storyTree.levels[parentLevelIndex];

      if (parentLevel && isMidLevel(parentLevel)) {
        const parentNode = getSelectedNodeHelper(parentLevel);
        if (parentNode && parentNode.id === parentId) {
          try {
            console.log(`[refreshLevel] Fetching updated quote counts for parent node ${parentId}`);
            const updatedQuoteCounts = await this.fetchQuoteCounts(parentId);
            const updatedParentNode = { ...parentNode, quoteCounts: updatedQuoteCounts };
            const updatedParentLevel = setSelectedNodeHelper(parentLevel, updatedParentNode);
            
            console.log(`[refreshLevel] Dispatching REPLACE_LEVEL_DATA for parent level ${parentLevelIndex}`);
            this.store.dispatch({
              type: ACTIONS.REPLACE_LEVEL_DATA,
              payload: updatedParentLevel
            });
          } catch (qcError) {
            console.error(`[refreshLevel] Failed to fetch/update quote counts for parent ${parentId}:`, qcError);
            // Continue without updating parent counts if fetch fails
          }
        } else {
           console.warn(`[refreshLevel] Parent node mismatch or not found when trying to update counts. Parent ID: ${parentId}, Node found: ${parentNode?.id}`);
        }
      } else {
         console.warn(`[refreshLevel] Parent level ${parentLevelIndex} not found or not MidLevel when trying to update counts.`);
      }
      // --- End Parent Level Update ---

      // Dispatch action to replace the target level data (N+1)
      console.log(`[refreshLevel] Dispatching REPLACE_LEVEL_DATA for target level ${targetLevelIndex}`);
      this.store.dispatch({
        type: ACTIONS.REPLACE_LEVEL_DATA,
        payload: newLevel
      });

    } catch (error) {
      console.error(`[refreshLevel] Error refreshing level ${targetLevelIndex}:`, error);
      // Optionally dispatch an error state update
      const errorMessage = error instanceof Error ? error.message : 'Failed to refresh level';
      this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Error refreshing level ${targetLevelIndex}: ${errorMessage}` });
      // Decide if we should dispatch a LastLevel here on error or let the UI handle the error state
       this.dispatchLastLevel(targetLevelIndex); // Tentatively set LastLevel on error
    }
  }

  public async submitReply(text: string, parentId: string, quote: Quote): Promise<{ replyId?: string; error?: string }> {
    // Ensure reply context setters are available before proceeding
    if (!this.replyContextSetters) {
        console.error("[submitReply] ReplyContext setters not initialized in StoryTreeOperator.");
        return { error: 'Internal configuration error: Reply context not available.' };
    }
    try {
      // Get the user ID, which will throw if user is not authenticated
      const authorId = this.getUserId();

      const response = await axios.post<CreateReplyResponse>(`${process.env.REACT_APP_API_URL}/api/createReply`, {
        text,
        parentId: [parentId], // Ensure parentId is always an array
        quote,
        metadata: {
          authorId,
        }
      });

      if (!response.data.success || !response.data.data?.id) {
        return { error: response.data.error || 'Unknown error occurred during reply submission' };
      }

      const newReplyId = response.data.data.id;
      console.log(`[submitReply] Reply successfully submitted with ID: ${newReplyId}`);

      // --- Refetch Logic ---
      const state = this.getState();
      if (state.storyTree && state.storyTree.levels) {
        // Find the index of the parent level
        const parentLevelIndex = state.storyTree.levels.findIndex(level =>
          isMidLevel(level) && level.midLevel?.selectedNode.id === parentId
        );

        if (parentLevelIndex !== -1) {
          const targetLevelIndex = parentLevelIndex + 1;
          console.log(`[submitReply] Triggering refresh for level ${targetLevelIndex} after submitting reply to parent ${parentId}`);
          // Call refreshLevel asynchronously (don't block the return)
          this.refreshLevel(targetLevelIndex, parentId, quote).catch(err => {
             console.error(`[submitReply] Error during background level refresh:`, err);
             // Optionally dispatch an error notification here
          });
        } else {
          console.error(`[submitReply] Could not find parent level index for parentId: ${parentId}. Cannot refresh level.`);
          // Handle this case - maybe dispatch an error or warning?
        }
      } else {
         console.warn(`[submitReply] Story tree or levels not found in state after reply submission. Cannot refresh level.`);
      }
      // --- End Refetch Logic ---

      // Reset Reply UI State BEFORE returning
      this.replyContextSetters.resetReplyState();

      // Return success immediately, refresh happens in the background
      return { replyId: newReplyId };

    } catch (error) {
      console.error("[submitReply] Error submitting reply:", error); // Log the full error
      if (error instanceof StoryTreeError) {
        return { error: error.message };
      }
      const axiosErr = error as AxiosError<CreateReplyResponse>;
      // Try to get a more specific error message from the response
      const backendError = axiosErr.response?.data?.error;
      const statusText = axiosErr.response?.statusText;
      return { error: backendError || statusText || 'Failed to submit reply due to network or server error' };
    }
  }

  // Remove startIndex parameter, determine levelNumber from context state
  public loadSingleLevel = async (): Promise<void> => {
    // Read state inside the function to get the latest
    const currentState = this.store?.state;
    const currentLevelsLength = currentState?.storyTree?.levels?.length ?? 0;
    const levelNumber = currentLevelsLength; // Level to load is the current length

    // Check the internal boolean flag first
    if (this.isLoadingMore) {
      // If already loading, check if it's for the *same level* we are about to load
      if (this.loadingLevelNumber === levelNumber) {
        return;
      } else {
        // This case should ideally not happen if loadMore calls are sequential, 
        // but handles potential edge cases where a load for N+1 starts before N finishes releasing the lock.
        return;
      }
    }

    // Belt-and-suspenders: Also check the shared context state
    // This check might be redundant now with the level-specific lock, but keep for safety?
    if (currentState?.isLoadingMore) {
      return;
    }
      
    this.isLoadingMore = true; // Set internal lock
    this.loadingLevelNumber = levelNumber; // Set level being loaded

    // Access dispatch via this.store
    // Ensure store exists before dispatching
    if (this.store?.dispatch) {
      this.store.dispatch({ type: ACTIONS.SET_LOADING_MORE, payload: true }); // Dispatch START loading action
    } else {
      this.isLoadingMore = false;
      return; // Can't proceed without dispatch
    }

    try {
      // Log the level number we are actually processing
      console.log(`StoryTreeOperator: Starting loadSingleLevel processing for level ${levelNumber}`);

      if (!this.store) {
          throw new StoryTreeError('Store not initialized');
      }
      
      // Re-read state here? Or rely on the one fetched at the start?
      // Let's re-read to be absolutely sure we have the latest before validation
      const state = this.getState();  

      { // Validate inputs and state
        if (!state.storyTree) {
          const errorMsg = `StoryTreeOperator: storyTree not initialized`;
          throw new StoryTreeError(errorMsg);
        }
        // Validate levelNumber directly
        if (levelNumber < 1) {
          const errorMsg = `Start level number ${levelNumber} is less than 1, which is not allowed`;
          throw new StoryTreeError(errorMsg);
        }
        // Adjusted check: Ensure we are only trying to load the *next* available level
        if (levelNumber !== state.storyTree.levels.length) { 
            console.warn(`[loadSingleLevel] Attempting to load level ${levelNumber}, but current levels length is ${state.storyTree.levels.length}. Stopping.`);
            // This prevents loading levels out of order if Virtuoso triggers rapidly
            return; // Stop if not loading the immediate next level
        }
        // Skip root level (level 0) - This check might be redundant now if levelNumber starts at 1
        // but keep for safety, although startIndex should come from levels.length which is >= 1
        if (levelNumber === 0) {
           console.warn(`[loadSingleLevel] Attempting to load level 0, which is not allowed. Stopping.`);
           return;
        }
      }
      const parentLevel = state.storyTree.levels[levelNumber-1];
      
      // Ensure parentLevel is not undefined before checking isLastLevel
      if (typeof parentLevel === 'undefined') {
         console.error(`[loadSingleLevel] Parent level ${levelNumber - 1} is undefined when trying to load level ${levelNumber}. State length: ${state.storyTree?.levels?.length}`);
         // This indicates a state inconsistency or rapid firing despite the lock?
         throw new StoryTreeError(`Parent level ${levelNumber - 1} is undefined.`);
      }

      // Check if parent level is incorrectly marked as last
      if (isLastLevel(parentLevel)) {
          console.warn(`[loadSingleLevel] Parent level ${levelNumber - 1} is marked as LastLevel, cannot load level ${levelNumber}. Stopping.`);
          return; // Stop loading
      }
      
      const parentLevelAsLevel : StoryTreeLevel = parentLevel as StoryTreeLevel;
      const rootNodeId = state.storyTree.post.id;
      { // continue validation
        // This check might be redundant now after the explicit undefined check above, but keep for structure
        if (!parentLevel) { 
          this.dispatchLastLevel(levelNumber);
          // Use return instead of break since loop is gone
          return; 
        }
        // Get the parent level for the first level we want to load
        const selectedNode = getSelectedNodeHelper(parentLevelAsLevel);
        if (!selectedNode) { // Simplified check: !selectedNode implies !parentLevel check is redundant if parentLevel existed
          // Log the state *right before* throwing the error
          console.error(`[loadSingleLevel] Error condition reached: Selected node not found for parent level ${levelNumber - 1} when loading level ${levelNumber}.`);
          console.error(`[loadSingleLevel] Parent Level Data: ${JSON.stringify(parentLevel)}`);
          console.error(`[loadSingleLevel] Current Levels State: ${JSON.stringify(state.storyTree.levels)}`);
          const errorMsg = `Selected node not found for level ${levelNumber} (based on parent level ${levelNumber-1});
 parentLevel: ${JSON.stringify(parentLevel)};
 levels: ${JSON.stringify(state.storyTree.levels)}`;
          throw new StoryTreeError(errorMsg);
        }
      }
      const selectedNodeOfParentLevel = getSelectedNodeHelper(parentLevelAsLevel);
      if (!selectedNodeOfParentLevel) {
          // This should ideally be caught by the check above, but keep as safeguard
          console.error(`[loadSingleLevel] Safeguard check failed: Selected node is null/undefined for parent level ${levelNumber-1}.`);
          throw new StoryTreeError(`Selected node not found for level ${levelNumber-1}`);
      }
      const parentId = selectedNodeOfParentLevel.id;
      const parentText = selectedNodeOfParentLevel.textContent;
      { // continue validation
        if (!parentId || !parentText) {
          console.warn(`[loadSingleLevel] Missing parentId or parentText for level ${levelNumber - 1}. Cannot load level ${levelNumber}.`);
          // Dispatch last level for the level we *tried* to load
          this.dispatchLastLevel(levelNumber);
          return;
        }
      }
      const quoteCountsFromParent = selectedNodeOfParentLevel.quoteCounts;
      { // continue validation
        if (!quoteCountsFromParent || !quoteCountsFromParent.quoteCounts || quoteCountsFromParent.quoteCounts.length === 0) {
          console.log(`[loadSingleLevel] Parent node ${parentId} level ${levelNumber-1} has no quotes. Dispatching LastLevel for ${levelNumber}.`);
          this.dispatchLastLevel(levelNumber);
          return;
        }
      }
      try {
        // Determine the quote in the PARENT level that should lead to the children we are loading now.
        // This defaults to the currently selected quote *within* the parent level's node.
        let quoteInParentToFetchChildrenFor = getSelectedQuoteInThisLevel(parentLevelAsLevel); 

        // If no quote is selected in the parent, or if the selected one has no replies, pick the most quoted one.
        const parentHasQuoteSelected = !!quoteInParentToFetchChildrenFor;
        let selectedParentQuoteHasReplies = false;
        if (parentHasQuoteSelected) {
           selectedParentQuoteHasReplies = quoteCountsFromParent.quoteCounts.some(
            ([quote, count]) => count > 0 && areQuotesEqual(quote, quoteInParentToFetchChildrenFor)
          );
        }

        if (!parentHasQuoteSelected || !selectedParentQuoteHasReplies) {
            const mostQuotedInParent = this.mostQuoted(quoteCountsFromParent);
            if (mostQuotedInParent === null) {
              console.log(`[loadSingleLevel] No quote selected in parent, or selected has no replies, and no other quotes have replies for level ${levelNumber-1}. Dispatching LastLevel for ${levelNumber}.`);
              this.dispatchLastLevel(levelNumber);
              return;
            } else {
              console.log(`[loadSingleLevel] No quote selected/no replies for selected, using most quoted from parent level ${levelNumber-1}:`, mostQuotedInParent);
              quoteInParentToFetchChildrenFor = mostQuotedInParent;
              // OPTIONAL: Dispatch an update to the parent level's selectedQuoteInThisLevel? 
              // Or let the UI handle selection explicitly? Let's not dispatch for now.
            }
        }

        // We MUST have a valid quote at this point to proceed
        if (!quoteInParentToFetchChildrenFor) {
           console.error(`[loadSingleLevel] Logic error: quoteInParentToFetchChildrenFor is null/undefined after checks. Cannot fetch replies. Parent Level:`, parentLevelAsLevel);
           // Dispatch last level as we cannot proceed without a quote
           this.dispatchLastLevel(levelNumber);
           return; 
           // throw new StoryTreeError('Failed to determine parent quote for fetching children.'); // Alternative: throw error
        }

        // Fetch replies using the determined quote from the parent
        const sortingCriteria = 'mostRecent';
        // Now quoteInParentToFetchChildrenFor is guaranteed to be a Quote
        const maybeFirstReplies = await this.fetchFirstRepliesForLevel(levelNumber, parentId, quoteInParentToFetchChildrenFor, sortingCriteria, 5); 
        
        if (!maybeFirstReplies) {
           console.warn(`[loadSingleLevel] fetchFirstRepliesForLevel returned null for level ${levelNumber}. Assuming end of branch.`);
           this.dispatchLastLevel(levelNumber);
           return;
        }
        
        if (maybeFirstReplies.data.length === 0) {
           console.log(`[loadSingleLevel] fetchFirstRepliesForLevel returned 0 replies for level ${levelNumber}. Dispatching LastLevel.`);
           this.dispatchLastLevel(levelNumber);
           return;
        }
        
        const pagination = maybeFirstReplies.pagination;
        const firstReplies: Reply[] = maybeFirstReplies.data;
        const quoteCountsMap = new Map<Quote, QuoteCounts>();
        
        await Promise.all(firstReplies.map(async (reply: Reply) => {
          try {
              const quoteCounts = await this.fetchQuoteCounts(reply.id);
              quoteCountsMap.set(reply.quote, quoteCounts);
          } catch (qcError) {
              console.error(`[loadSingleLevel] Failed to fetch quote counts for reply ${reply.id}:`, qcError);
              quoteCountsMap.set(reply.quote, { quoteCounts: [] }); // Store empty counts on error
          }
        }));

        const siblingsForQuote : Array<StoryTreeNode> = [];
        firstReplies.forEach(reply => {
          siblingsForQuote.push({
            id: reply.id,
            rootNodeId: rootNodeId,
            parentId: [parentId],
            levelNumber: levelNumber,
            textContent: reply.text,
            repliedToQuote: quoteInParentToFetchChildrenFor, // Link back to the parent quote
            quoteCounts: quoteCountsMap.get(reply.quote),
            authorId: reply.authorId,
            createdAt: reply.createdAt,
          } as StoryTreeNode);
        });
        
        // Determine initial selected quote *within* the first node of the *newly loaded* level
        const selectedNodeForNewLevel = siblingsForQuote[0];
        const initialSelectedQuoteInNewLevel = selectedNodeForNewLevel.quoteCounts ? this.mostQuoted(selectedNodeForNewLevel.quoteCounts) : null;

        const level: StoryTreeLevel = createMidLevel(
          rootNodeId,
          [parentId],
          levelNumber,
          quoteInParentToFetchChildrenFor, // This is the quote selected in the parent that led to this level
          initialSelectedQuoteInNewLevel, // This is the default selection *within* the first node of *this* level
          selectedNodeForNewLevel, // The default selected node for this new level
          { levelsMap: [[quoteInParentToFetchChildrenFor, siblingsForQuote]] }, // Siblings keyed by the parent quote
          pagination
        );
        
        await this.dispatchNewLevel(level);
        
      } catch (error) {
         console.error(`[loadSingleLevel] Error processing level ${levelNumber}:`, error);
         if (this.store?.dispatch) {
             this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Failed to process level ${levelNumber}: ${error instanceof Error ? error.message : String(error)}` });
         }
         // Don't automatically dispatch LastLevel on error, let the error state handle it?
         // Or maybe dispatch LastLevel to prevent further loading attempts?
         // Let's dispatch LastLevel to be safe and stop further loading on this branch.
         this.dispatchLastLevel(levelNumber);
      }

    } catch (error) {
        console.error(`[loadSingleLevel] Outer error during loadSingleLevel for level ${levelNumber}:`, error);
        if (this.store?.dispatch) {
          this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Failed to load level ${levelNumber}: ${error instanceof Error ? error.message : String(error)}` });
        }
    } finally {
      // Dispatch context update immediately
      if (this.store?.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_LOADING_MORE, payload: false }); 
      } else {
        console.error("StoryTreeOperator: Store not available for dispatching SET_LOADING_MORE false.");
      }

      // Reset internal locks on the next tick to allow context state to propagate
      setTimeout(() => {
        // Why setTimeout(0)?
        // In React StrictMode, the calling component (`VirtualizedStoryList` via Virtuoso's `endReached`)
        // might invoke this `loadSingleLevel` function twice in rapid succession.
        // The first call sets internal locks (`isLoadingMore`, `loadingLevelNumber`) and dispatches a context
        // update (`SET_LOADING_MORE: false`) in the `finally` block immediately.
        // However, React state updates are not synchronous. If we reset the internal locks immediately too,
        // the second invocation might run *before* the context state update propagates. It would then
        // see the *internal* locks as released (false/null) and incorrectly start a duplicate load.
        // By using setTimeout(0), we yield to the event loop, pushing the reset of the *internal* locks
        // to the next tick. This gives React time to process the context state update. When the second
        // invocation runs, it correctly sees the *internal* locks are still engaged from the first call
        // and skips the duplicate load. The internal locks are then safely reset later when the timeout executes.
        this.isLoadingMore = false; // Release internal lock
        this.loadingLevelNumber = null; // Clear level being loaded
      }, 0);

    }
  };

  private mostQuoted(quoteCounts: QuoteCounts | null): Quote | null { // Allow null input
    if (!quoteCounts || !quoteCounts.quoteCounts || quoteCounts.quoteCounts.length === 0) {
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
      if (this.store && this.store.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: 'Failed to load story tree' });
      }
    } finally {
      // Ensure loading state is always reset after initialization attempt
      if (this.store?.dispatch) {
        this.store.dispatch({ type: ACTIONS.SET_LOADING_MORE, payload: false });
      }
    }
  }

  public dispatchNewLevel(level: StoryTreeLevel): void {
    if (!this.store || !this.store.dispatch) {
      throw new StoryTreeError('Dispatch not initialized in StoryTreeOperator.');
    }
    this.store.dispatch({ type: ACTIONS.INCLUDE_NODES_IN_LEVELS, payload: [level] });
  }

  public async setSelectedNode(node: StoryTreeNode): Promise<void> {
    if (!this.store || !this.store.dispatch || !this.store.state || !this.store.state.storyTree) {
        throw new StoryTreeError('Store, state, or story tree not initialized for setSelectedNode');
    }

    const state = this.store.state;
    const dispatch = this.store.dispatch;
    const levelNumber = node.levelNumber;
    const targetLevel = state.storyTree?.levels[levelNumber];
    const nextLevelNumber = levelNumber + 1;
    const rootNodeId = node.rootNodeId; // Assuming consistent rootNodeId

    if (!targetLevel || !isMidLevel(targetLevel)) {
        console.warn(`[setSelectedNode] Target level ${levelNumber} not found or is not a MidLevel. Dispatching SET_SELECTED_NODE only.`);
        dispatch({ type: ACTIONS.SET_SELECTED_NODE, payload: node });
        return;
    }

    // --- Step 1: Dispatch update for the selected node in the current level ---
    dispatch({ type: ACTIONS.SET_SELECTED_NODE, payload: node });

    // --- Step 2: Get the quote that *was* selected in this level ---
    const currentSelectedQuote = getSelectedQuoteInThisLevel(targetLevel);
    let isPreviouslySelectedQuoteValidForNewNode = false;
    if (currentSelectedQuote) {
        const quotesMap = node.quoteCounts?.quoteCounts;
        if (quotesMap) {
            isPreviouslySelectedQuoteValidForNewNode = quotesMap.some(([quoteFromMap]) => areQuotesEqual(quoteFromMap, currentSelectedQuote));
        }
    }

    // Determine the quote context that *should* drive the next level
    let quoteToDriveNextLevel: Quote | null = null;

    if (currentSelectedQuote && isPreviouslySelectedQuoteValidForNewNode) {
        // Case A: Previous selection is still valid for the new node.
        quoteToDriveNextLevel = currentSelectedQuote;
        console.log(`[setSelectedNode] Prev selected quote is valid for node ${node.id}. Quote:`, quoteToDriveNextLevel);
        // No need to dispatch UPDATE_THIS_LEVEL_SELECTED_QUOTE as it hasn't changed.
    } else {
        // Case B: Previous selection is invalid (or didn't exist). Need to find the new default.
        const newDefaultQuoteForParent = this.mostQuoted(node.quoteCounts);
        quoteToDriveNextLevel = newDefaultQuoteForParent; // This might be null if no quotes exist

        console.log(`[setSelectedNode] Prev selected quote invalid or null. New driving quote for node ${node.id}:`, quoteToDriveNextLevel);

        // Explicitly update/reset the parent level's selected quote state
        dispatch({
            type: ACTIONS.UPDATE_THIS_LEVEL_SELECTED_QUOTE,
            payload: {
                levelNumber: levelNumber,
                // Set to the new default, or null if no default exists.
                // Setting it here ensures the parent level state reflects the context driving N+1.
                newQuote: quoteToDriveNextLevel
            }
        });
    }

    // --- Step 3: Check if the *next* level (N+1) needs updating ---
    // Re-add explicit null check to satisfy linter
    if (!state.storyTree) {
        console.error("[setSelectedNode] state.storyTree became null unexpectedly before checking next level.");
        return; 
    }
    const nextLevel = state.storyTree.levels[nextLevelNumber];
    let nextLevelNeedsUpdate = true; // Assume update needed unless proven otherwise

    if (nextLevel && isMidLevel(nextLevel)) {
        // Next level exists and has data. Check if its driving quote matches.
        const nextLevelParentQuote = getSelectedQuoteInParent(nextLevel);
        if (areQuotesEqual(nextLevelParentQuote, quoteToDriveNextLevel)) {
            // The next level already shows data for the correct quote. No update needed.
            nextLevelNeedsUpdate = false;
            console.log(`[setSelectedNode] Next level ${nextLevelNumber} already reflects the correct quote. No update needed.`);
        } else {
             console.log(`[setSelectedNode] Next level ${nextLevelNumber} needs update. Current parent quote:`, nextLevelParentQuote, `Required:`, quoteToDriveNextLevel);
        }
    } else if (nextLevel && isLastLevel(nextLevel)) {
        // Next level exists but is 'End of thread'. Check if it *should* be.
        if (quoteToDriveNextLevel === null) {
            // Correct state: Parent context leads to no children. No update needed.
            nextLevelNeedsUpdate = false;
            console.log(`[setSelectedNode] Next level ${nextLevelNumber} is LastLevel and driving quote is null. Correct state.`);
        } else {
             console.log(`[setSelectedNode] Next level ${nextLevelNumber} is LastLevel, but should show children for quote:`, quoteToDriveNextLevel);
        }
    } else if (!nextLevel && quoteToDriveNextLevel !== null) {
        // Next level doesn't exist yet, but it should (parent has a driving quote).
         console.log(`[setSelectedNode] Next level ${nextLevelNumber} does not exist, but should be fetched for quote:`, quoteToDriveNextLevel);
    } else {
        // Default case: nextLevel doesn't exist and driving quote is null. Correct state.
        nextLevelNeedsUpdate = false;
         console.log(`[setSelectedNode] Next level ${nextLevelNumber} does not exist and driving quote is null. Correct state.`);
    }


    // --- Step 4: If N+1 needs updating, fetch/replace data ---
    if (nextLevelNeedsUpdate) {
        console.log(`[setSelectedNode] Proceeding to update level ${nextLevelNumber}.`);
        const parentIdForNextLevel = node.id;

        try {
            let nextLevelData: StoryTreeLevel;

            if (quoteToDriveNextLevel) {
                // Fetch replies for the driving quote
                const sortingCriteria = 'mostRecent';
                const limit = 5;
                const maybeFirstReplies = await this.fetchFirstRepliesForLevel(nextLevelNumber, parentIdForNextLevel, quoteToDriveNextLevel, sortingCriteria, limit);

                if (maybeFirstReplies && maybeFirstReplies.data.length > 0) {
                    // Construct MidLevel N+1
                    const firstReplies: Reply[] = maybeFirstReplies.data;
                    const pagination: Pagination = maybeFirstReplies.pagination;
                    const quoteCountsMap = new Map<Quote, QuoteCounts>();
                     await Promise.all(firstReplies.map(async (reply: Reply) => {
                      const quoteCounts = await this.fetchQuoteCounts(reply.id);
                      quoteCountsMap.set(reply.quote, quoteCounts);
                    }));
                    const siblingsForQuote: Array<StoryTreeNode> = firstReplies.map(reply => ({
                      id: reply.id, rootNodeId: rootNodeId, parentId: [parentIdForNextLevel], levelNumber: nextLevelNumber,
                      textContent: reply.text, repliedToQuote: quoteToDriveNextLevel,
                      quoteCounts: quoteCountsMap.get(reply.quote), authorId: reply.authorId, createdAt: reply.createdAt,
                    } as StoryTreeNode));
                    const selectedNodeForNewLevel = siblingsForQuote[0];
                    const initialSelectedQuoteInNewLevel = selectedNodeForNewLevel.quoteCounts ? this.mostQuoted(selectedNodeForNewLevel.quoteCounts) : null;

                    nextLevelData = createMidLevel(
                      rootNodeId, [parentIdForNextLevel], nextLevelNumber,
                      quoteToDriveNextLevel, // selectedQuoteInParent for N+1
                      initialSelectedQuoteInNewLevel, // selectedQuoteInThisLevel for N+1's first node
                      selectedNodeForNewLevel,
                      { levelsMap: [[quoteToDriveNextLevel, siblingsForQuote]] },
                      pagination
                    );

                } else {
                    // No replies found for the driving quote, mark N+1 as LastLevel
                     console.log(`[setSelectedNode] No replies found for quote. Marking level ${nextLevelNumber} as LastLevel.`);
                    nextLevelData = { isLastLevel: true, lastLevel: { levelNumber: nextLevelNumber, rootNodeId: rootNodeId }, midLevel: null };
                }
            } else {
                // Driving quote is null, mark N+1 as LastLevel
                 console.log(`[setSelectedNode] Driving quote is null. Marking level ${nextLevelNumber} as LastLevel.`);
                nextLevelData = { isLastLevel: true, lastLevel: { levelNumber: nextLevelNumber, rootNodeId: rootNodeId }, midLevel: null };
            }

            // Dispatch REPLACE_LEVEL_DATA for N+1
            dispatch({
                type: ACTIONS.REPLACE_LEVEL_DATA,
                payload: nextLevelData
            });

            // Dispatch CLEAR_LEVELS_AFTER N+1
            dispatch({
                type: ACTIONS.CLEAR_LEVELS_AFTER,
                payload: { levelNumber: nextLevelNumber }
            });

        } catch (error) {
             console.error(`[setSelectedNode] Error fetching or processing data for level ${nextLevelNumber}:`, error);
            const storyTreeErr = new StoryTreeError(`Failed to update level ${nextLevelNumber}: ${error instanceof Error ? error.message : String(error)}`);
            dispatch({ type: ACTIONS.SET_ERROR, payload: storyTreeErr.message });
            // Add null check before accessing storyTree again for rootNodeId
            const finalRootNodeId = state.storyTree ? state.storyTree.post.id : 'unknown_root'; // Fallback ID
            // Mark N+1 as LastLevel on error
            const errorLevelData: StoryTreeLevel = { isLastLevel: true, lastLevel: { levelNumber: nextLevelNumber, rootNodeId: finalRootNodeId }, midLevel: null };
             dispatch({ type: ACTIONS.REPLACE_LEVEL_DATA, payload: errorLevelData });
             dispatch({ type: ACTIONS.CLEAR_LEVELS_AFTER, payload: { levelNumber: nextLevelNumber } });
        }
    }
  }

  // Modified to fetch replies for the new quote and update subsequent levels
  public async setSelectedQuoteForNodeInLevel(quote: Quote, node: StoryTreeNode, level: StoryTreeLevel): Promise<void> {
    if (!this.store || !this.store.dispatch || !this.store.state.storyTree) {
      throw new StoryTreeError('Store or story tree not initialized for setSelectedQuoteForNodeInLevel');
    }

    // Validate the quote
    if (!quote || !Quote.isValid(quote)) {
      throw new StoryTreeError('Invalid quote provided');
    }

    // Validate the node
    if (!node || !node.id) {
      throw new StoryTreeError('Invalid node provided');
    }

    // Validate the level is a MidLevel
    if (!level || !isMidLevel(level)) {
      throw new StoryTreeError('Invalid level provided: must be a MidLevel');
    }

    console.log('[StoryTreeOperator] setSelectedQuoteForNodeInLevel called with quote:', quote, 'node:', node, 'level:', level);
    console.log('[StoryTreeOperator] State before update:', this.store.state);

    // 1. Update the selected quote for the current level (N)
    const levelNumber = level.midLevel!.levelNumber; // Get level number (safe due to isMidLevel check)

    // Dispatch specific action to update selectedQuoteInThisLevel in the target level
    this.store.dispatch({
      type: ACTIONS.UPDATE_THIS_LEVEL_SELECTED_QUOTE, // Use renamed action
      payload: {
        levelNumber: levelNumber,
        newQuote: quote // Pass the necessary info to the reducer
      }
    });
    
    // Add this check to satisfy the linter, although isMidLevel should have handled it
    if (!isMidLevel(level)) {
      throw new StoryTreeError('Internal error: Level type changed unexpectedly');
    }

    // Use non-null assertion (!) since the isMidLevel checks above guarantee it's not null.
    const nextLevelNumber = level.midLevel!.levelNumber + 1;
    const parentId = node.id; // The node whose quote was selected becomes the parent for the next level
    const rootNodeId = node.rootNodeId; // Assuming rootNodeId is consistent

    try {
      // 2. Fetch the first page of replies for the new quote (which is now the parent selection) in the next level (N+1)
      const sortingCriteria = 'mostRecent'; // Or fetch from config/state
      const limit = 5; // Or fetch from config/state
      // Fetch using 'quote' which is the selection made in level N
      const maybeFirstReplies = await this.fetchFirstRepliesForLevel(nextLevelNumber, parentId, quote, sortingCriteria, limit);

      let nextLevelData: StoryTreeLevel;

      if (maybeFirstReplies && maybeFirstReplies.data.length > 0) {
        const firstReplies: Reply[] = maybeFirstReplies.data;
        const pagination: Pagination = maybeFirstReplies.pagination;
        
        // TODO: Consider fetching quote counts for these replies asynchronously later if needed immediately
        const quoteCountsMap = new Map<Quote, QuoteCounts>();
        await Promise.all(firstReplies.map(async (reply: Reply) => {
          const quoteCounts = await this.fetchQuoteCounts(reply.id);
          quoteCountsMap.set(reply.quote, quoteCounts);
        }));

        const siblingsForQuote: Array<StoryTreeNode> = firstReplies.map(reply => ({
          id: reply.id,
          rootNodeId: rootNodeId,
          parentId: [parentId],
          levelNumber: nextLevelNumber,
          textContent: reply.text,
          repliedToQuote: quote, // Replies are to the newly selected quote from level N
          quoteCounts: quoteCountsMap.get(reply.quote), 
          authorId: reply.authorId,
          createdAt: reply.createdAt,
        } as StoryTreeNode));

        // Determine initial selected quote *within* the first node of the *new* level N+1
        const selectedNodeForNewLevel = siblingsForQuote[0];
        const initialSelectedQuoteInNewLevel = selectedNodeForNewLevel.quoteCounts ? this.mostQuoted(selectedNodeForNewLevel.quoteCounts) : null;

        // Create the new level N+1 data
        nextLevelData = createMidLevel(
          rootNodeId,
          [parentId],
          nextLevelNumber,
          quote, // The quote selected in the parent (level N) that led to this level
          initialSelectedQuoteInNewLevel, // The default selection *within* the first node of this new level N+1
          selectedNodeForNewLevel, // Select the first reply node by default
          { levelsMap: [[quote, siblingsForQuote]] }, // Siblings keyed by the parent quote
          pagination
        );
        
        // 3. Dispatch action to replace level N+1 data
        this.store.dispatch({
          type: ACTIONS.REPLACE_LEVEL_DATA, // New action needed in reducer
          payload: nextLevelData
        });

      } else {
        // No replies found, create a LastLevel marker according to StoryTreeLevel structure
        nextLevelData = {
          isLastLevel: true,
          lastLevel: { levelNumber: nextLevelNumber, rootNodeId: rootNodeId },
          midLevel: null
        };
        
        // Dispatch action to replace level N+1 data with LastLevel
         this.store.dispatch({
          type: ACTIONS.REPLACE_LEVEL_DATA, // New action needed in reducer
          payload: nextLevelData
        });
      }

      // 4. Dispatch action to clear levels N+2 onwards
      this.store.dispatch({
        type: ACTIONS.CLEAR_LEVELS_AFTER, // New action needed in reducer
        payload: { levelNumber: nextLevelNumber } 
      });

      // Optional: Log state after updates
      setTimeout(() => {
        if (this.store) {
          
        }
      }, 0);

    } catch (error) {
       // Optionally dispatch an error state update
       const storyTreeErr = new StoryTreeError(`Failed to load replies for the selected quote: ${error instanceof Error ? error.message : String(error)}`);
        if (this.store && this.store.dispatch) {
            this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: storyTreeErr.message });
        }
       // Rethrow or handle as appropriate
       throw storyTreeErr; 
    }
  }

  private dispatchLastLevel(levelNumber: number): void {
    console.log(`[dispatchLastLevel] Dispatching LastLevel for levelNumber: ${levelNumber}`); // Add logging here
    if (this.store && this.store.dispatch) {
      this.store.dispatch({
        type: ACTIONS.SET_LAST_LEVEL,
        payload: { levelNumber }
      });
    }
  }

  private fullQuoteFromText(parentText: string, parentId: string): Quote {
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

  // Add these new methods
  public async handleNavigateNextSibling(levelNumber: number): Promise<void> {
    if (!this.store || !this.store.state) {
        console.warn("[Operator NAV_NEXT] Store or state not initialized.");
        return;
    }
    if (!this.store.state.storyTree) {
        console.warn("[Operator NAV_NEXT] storyTree not initialized.");
        return;
    }
    const state = this.store.state;
    // Use non-null assertion after check
    const levelData = state.storyTree!.levels[levelNumber]; 

    console.log(`[Operator] Handling NAVIGATE_NEXT_SIBLING for Level: ${levelNumber}`);

    if (!levelData || !isMidLevel(levelData) || !levelData.midLevel) {
      console.warn(`[Operator NAV_NEXT] Invalid level data for level ${levelNumber}`);
      return;
    }

    const siblingsData = getSiblings(levelData);
    const currentSelectedNode = getSelectedNodeHelper(levelData);

    if (!siblingsData || !currentSelectedNode) {
        console.error(`[Operator NAV_NEXT] Missing siblings data or selected node for level ${levelNumber}`);
        return;
    }

    let siblingsList: StoryTreeNode[] | undefined;
    for (const [quoteKey, nodesForQuote] of siblingsData.levelsMap) {
        if (nodesForQuote.some((node: StoryTreeNode) => node.id === currentSelectedNode.id)) {
            siblingsList = nodesForQuote;
            break;
        }
    }

    if (!siblingsList) {
        console.error(`[Operator NAV_NEXT] Consistency Error: Selected node ${currentSelectedNode.id} not found in any sibling list for level ${levelNumber}`);
        return;
    }

    const currentIndex = siblingsList.findIndex(sibling => sibling.id === currentSelectedNode.id);
    if (currentIndex === -1) {
       console.error(`[Operator NAV_NEXT] Safeguard Error: Current node ${currentSelectedNode.id} not found in its identified list.`);
       return;
    }
    if (currentIndex >= siblingsList.length - 1) {
      console.log(`[Operator NAV_NEXT] Already at last sibling for level ${levelNumber}.`);
      // TODO: Handle pagination/load more?
      return;
    }

    const nextSibling = siblingsList[currentIndex + 1];
    if (!nextSibling) {
       console.error(`[Operator NAV_NEXT] Next sibling is unexpectedly undefined at index ${currentIndex + 1} for level ${levelNumber}`);
       return;
    }

    try {
      await this.setSelectedNode(nextSibling);
    } catch (error) {
      console.error(`[Operator NAV_NEXT] Failed to set selected node for level ${levelNumber}:`, error);
       if (this.store.dispatch) {
            this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Navigation failed: ${error instanceof Error ? error.message : String(error)}` });
        }
    }
  }

  public async handleNavigatePrevSibling(levelNumber: number): Promise<void> {
     if (!this.store || !this.store.state) {
        console.warn("[Operator NAV_PREV] Store or state not initialized.");
        return;
     }
    if (!this.store.state.storyTree) {
        console.warn("[Operator NAV_PREV] storyTree not initialized.");
        return;
    }
    const state = this.store.state;
    // Use non-null assertion after check
    const levelData = state.storyTree!.levels[levelNumber];

    console.log(`[Operator] Handling NAVIGATE_PREV_SIBLING for Level: ${levelNumber}`);

     if (!levelData || !isMidLevel(levelData) || !levelData.midLevel) {
       console.warn(`[Operator NAV_PREV] Invalid level data for level ${levelNumber}`);
      return;
     }

    const siblingsData = getSiblings(levelData);
    const currentSelectedNode = getSelectedNodeHelper(levelData);

    if (!siblingsData || !currentSelectedNode) {
       console.error(`[Operator NAV_PREV] Missing siblings data or selected node for level ${levelNumber}`);
        return;
    }

    let siblingsList: StoryTreeNode[] | undefined;
     for (const [quoteKey, nodesForQuote] of siblingsData.levelsMap) {
        if (nodesForQuote.some((node: StoryTreeNode) => node.id === currentSelectedNode.id)) {
            siblingsList = nodesForQuote;
            break;
        }
    }

     if (!siblingsList) {
       console.error(`[Operator NAV_PREV] Consistency Error: Selected node ${currentSelectedNode.id} not found in any sibling list for level ${levelNumber}`);
        return;
    }

    const currentIndex = siblingsList.findIndex(sibling => sibling.id === currentSelectedNode.id);
     if (currentIndex === -1) {
        console.error(`[Operator NAV_PREV] Safeguard Error: Current node ${currentSelectedNode.id} not found in its identified list.`);
       return;
     }
     if (currentIndex <= 0) {
        console.log(`[Operator NAV_PREV] Already at first sibling for level ${levelNumber}.`);
       return;
     }

    const previousSibling = siblingsList[currentIndex - 1];
     if (!previousSibling) {
        console.error(`[Operator NAV_PREV] Previous sibling is unexpectedly undefined at index ${currentIndex - 1} for level ${levelNumber}`);
       return;
     }

    try {
      await this.setSelectedNode(previousSibling);
    } catch (error) {
       console.error(`[Operator NAV_PREV] Failed to set selected node for level ${levelNumber}:`, error);
       if (this.store.dispatch) {
            this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Navigation failed: ${error instanceof Error ? error.message : String(error)}` });
        }
    }
  }
}

// Create and export a single instance
const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;


