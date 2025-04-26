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
  getSelectedQuote,
  getParentId,
  getLevelNumber,
  getPagination,
  getRootNodeId,
  getSelectedNodeHelper,
  isMidLevel,
  isLastLevel
} from '../utils/levelDataHelpers';

class StoryTreeOperator extends BaseOperator {
  // Introduce a store property to hold state and dispatch injected from a React component.
  private store: { state: StoryTreeState, dispatch: React.Dispatch<Action> } | null = null;
  private userContext: { state: { user: { id: string } | null } } | null = null;
  // Reintroduce isLoadingMore flag
  private isLoadingMore: boolean = false;

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

    // For the root post, we use null as the key since it's not replying to any quote
    const siblings: Siblings = {
      levelsMap: [[null, [contentNode]]]
    };

    // Create the content level using the helper function
    const contentLevel = createMidLevel(
      post.id,
      [],
      0,
      null as unknown as Quote, // Type assertion to satisfy TypeScript
      contentNode,
      siblings,
      { 
        hasMore: false,
        totalCount: 1
      }
    );

    // Dispatch the content level
    if (this.store && this.store.dispatch) {
      this.store.dispatch({
        type: ACTIONS.INCLUDE_NODES_IN_LEVELS,
        payload: [contentLevel]
      });
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
    const selectedQuote = getSelectedQuote(level);
    const rootNodeId = getRootNodeId(level);
    
    if (!parentId || !levelNumber || !selectedQuote || !rootNodeId) {
      return;
    }
    
    const url = `${process.env.REACT_APP_API_URL}/api/getReplies/${parentId[0]}/${Quote.toEncodedString(selectedQuote)}/${sortingCriteria}?limit=${limit}&cursor=${cursorString}`;
    
    try {
      const compressedPaginatedResponse = await this.retryApiCallSimplified<Compressed<CursorPaginatedResponse<Reply>>>(
        () => axios.get(url, {
          validateStatus: status => status === 200
        })
      );
      
      const decompressedPaginatedData = await compression.decompress<CursorPaginatedResponse<Reply>>(compressedPaginatedResponse);
      
      if (decompressedPaginatedData && decompressedPaginatedData.pagination) {
        const quoteCountsMap = new Map<Quote, QuoteCounts>();
        const repliesData = decompressedPaginatedData.data;
        await Promise.all(repliesData.map(async (reply: Reply) => {
          const quoteCounts = await this.fetchQuoteCounts(reply.id);
          quoteCountsMap.set(reply.quote, quoteCounts);
        }));
        const replyNodes: StoryTreeNode[] = repliesData.map((reply: Reply) => ({
          id: reply.id,
          rootNodeId: rootNodeId,
          parentId: reply.parentId,
          levelNumber: levelNumber,
          textContent: reply.text,
          authorId: reply.authorId,
          createdAt: reply.createdAt,
          repliedToQuote: reply.quote,
          quoteCounts: quoteCountsMap.get(reply.quote) || null
        }));
        const newLevelData = createMidLevel(
          rootNodeId,
          parentId,
          levelNumber,
          selectedQuote,
          getSelectedNodeHelper(level) || replyNodes[0],
          {
            levelsMap: [[selectedQuote, replyNodes]]
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

    // Validate the quote
    if (!quote) {
      return;
    }

    // Ensure quote has isValid method
    if (!Quote.isValid(quote)) {
      // Try to recreate the quote if possible
      if (quote.text && quote.sourcePostId && quote.selectionRange) {
        quote = new Quote(quote.text, quote.sourcePostId, quote.selectionRange);
      } else {
        throw new StoryTreeError('Invalid quote provided to loadMoreItems');
      }
    }

    // Now check if the quote is valid
    if (!Quote.isValid(quote)) {
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
        return { error: response.data.error || 'Unknown error occurred' };
      }

      // After successful reply, reload the story tree data 
      // TODO: this is a hack, we should only reload the necessary data
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
      return { error: axiosErr.response?.data?.error || 'Failed to submit reply' };
    }
  }

  public loadSingleLevel = async (startIndex: number): Promise<void> => {
    // Check the boolean flag
    if (this.isLoadingMore) {
      console.warn("StoryTreeOperator: loadMoreLevels already in progress, skipping.");
      return;
    }
      
    this.isLoadingMore = true; // Set lock

    try {
      console.log(`StoryTreeOperator: Starting loadMoreLevels for index ${startIndex}`);

      if (!this.store) {
          throw new StoryTreeError('Store not initialized');
      }
      
      // Use startIndex directly as the levelNumber to process
      const levelNumber = startIndex;

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
            console.warn(`[loadMoreLevels] Attempting to load level ${levelNumber}, but current levels length is ${state.storyTree.levels.length}. Stopping.`);
            // This prevents loading levels out of order if Virtuoso triggers rapidly
            return; // Stop if not loading the immediate next level
        }
        // Skip root level (level 0) - This check might be redundant now if levelNumber starts at 1
        // but keep for safety, although startIndex should come from levels.length which is >= 1
        if (levelNumber === 0) {
           console.warn(`[loadMoreLevels] Attempting to load level 0, which is not allowed. Stopping.`);
           return;
        }
      }
      const parentLevel = state.storyTree.levels[levelNumber-1];
      
      // Ensure parentLevel is not undefined before checking isLastLevel
      if (typeof parentLevel === 'undefined') {
         console.error(`[loadMoreLevels] Parent level ${levelNumber - 1} is undefined when trying to load level ${levelNumber}. State length: ${state.storyTree?.levels?.length}`);
         // This indicates a state inconsistency or rapid firing despite the lock?
         throw new StoryTreeError(`Parent level ${levelNumber - 1} is undefined.`);
      }

      // Check if parent level is incorrectly marked as last
      if (isLastLevel(parentLevel)) {
          console.warn(`[loadMoreLevels] Parent level ${levelNumber - 1} is marked as LastLevel, cannot load level ${levelNumber}. Stopping.`);
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
          console.error(`[loadMoreLevels] Error condition reached: Selected node not found for parent level ${levelNumber - 1} when loading level ${levelNumber}.`);
          console.error(`[loadMoreLevels] Parent Level Data: ${JSON.stringify(parentLevel)}`);
          console.error(`[loadMoreLevels] Current Levels State: ${JSON.stringify(state.storyTree.levels)}`);
          const errorMsg = `Selected node not found for level ${levelNumber} (based on parent level ${levelNumber-1});
 parentLevel: ${JSON.stringify(parentLevel)};
 levels: ${JSON.stringify(state.storyTree.levels)}`;
          throw new StoryTreeError(errorMsg);
        }
      }
      const selectedNodeOfParentLevel = getSelectedNodeHelper(parentLevelAsLevel);
      if (!selectedNodeOfParentLevel) {
          // This should ideally be caught by the check above, but keep as safeguard
          console.error(`[loadMoreLevels] Safeguard check failed: Selected node is null/undefined for parent level ${levelNumber-1}.`);
          throw new StoryTreeError(`Selected node not found for level ${levelNumber-1}`);
      }
      const parentId = selectedNodeOfParentLevel.id;
      const parentText = selectedNodeOfParentLevel.textContent;
      { // continue validation
        if (!parentId || !parentText) {
          console.warn(`[loadMoreLevels] Missing parentId or parentText for level ${levelNumber - 1}. Cannot load level ${levelNumber}.`);
          // Dispatch last level for the level we *tried* to load
          this.dispatchLastLevel(levelNumber);
          return;
        }
      }
      const quoteCountsFromParent = selectedNodeOfParentLevel.quoteCounts;
      { // continue validation
        if (!quoteCountsFromParent || !quoteCountsFromParent.quoteCounts || quoteCountsFromParent.quoteCounts.length === 0) {
          console.log(`[loadMoreLevels] Parent node ${parentId} level ${levelNumber-1} has no quotes. Dispatching LastLevel for ${levelNumber}.`);
          this.dispatchLastLevel(levelNumber);
          return;
        }
      }
      try {
        let selectedQuoteFromParent = this.fullQuoteFromText(parentText, parentId);

        if (!isMidLevel(parentLevel)) { 
           console.error(`[loadMoreLevels] Inconsistency: Parent level ${levelNumber-1} passed isLastLevel check but failed isMidLevel check.`);
           throw new StoryTreeError(`Level ${levelNumber-1} state inconsistency.`);
        } else {
            if (parentLevel.midLevel!.selectedQuote) {
              selectedQuoteFromParent = parentLevel.midLevel!.selectedQuote;
            }
        }

        { // Determine actual quote to use if default/selected has no replies
          const hasRepliesForDefaultQuote = quoteCountsFromParent.quoteCounts.some(
            (quoteCountPair: [Quote, number]) => {
              const [quote, count] = quoteCountPair;
              return count > 0 && areQuotesEqual(quote, selectedQuoteFromParent);
            }
          );
          if (hasRepliesForDefaultQuote === false) {
            const maybeQuote = this.mostQuoted(quoteCountsFromParent);
            if (maybeQuote === null) {
              console.log(`[loadMoreLevels] No replies for default quote and no other quotes have replies for level ${levelNumber-1}. Dispatching LastLevel for ${levelNumber}.`);
              this.dispatchLastLevel(levelNumber);
              return;
            } else {
              console.log(`[loadMoreLevels] Default quote has no replies, selecting most quoted for level ${levelNumber-1}:`, maybeQuote);
              selectedQuoteFromParent = maybeQuote;
            }
          }
        }
        
        const sortingCriteria = 'mostRecent';
        const maybeFirstReplies = await this.fetchFirstRepliesForLevel(levelNumber, parentId, selectedQuoteFromParent, sortingCriteria, 5); 
        
        if (!maybeFirstReplies) {
           console.warn(`[loadMoreLevels] fetchFirstRepliesForLevel returned null for level ${levelNumber}. Assuming end of branch.`);
           this.dispatchLastLevel(levelNumber);
           return;
        }
        
        if (maybeFirstReplies.data.length === 0) {
           console.log(`[loadMoreLevels] fetchFirstRepliesForLevel returned 0 replies for level ${levelNumber}. Dispatching LastLevel.`);
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
              console.error(`[loadMoreLevels] Failed to fetch quote counts for reply ${reply.id}:`, qcError);
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
            repliedToQuote: selectedQuoteFromParent,
            quoteCounts: quoteCountsMap.get(reply.quote),
            authorId: reply.authorId,
            createdAt: reply.createdAt,
          } as StoryTreeNode);
        });
        
        const level: StoryTreeLevel = createMidLevel(
          rootNodeId,
          [parentId],
          levelNumber,
          selectedQuoteFromParent,
          siblingsForQuote[0],
          { levelsMap: [[selectedQuoteFromParent, siblingsForQuote]] },
          pagination
        );
        
        await this.dispatchNewLevel(level);
        
      } catch (error) {
         console.error(`[loadMoreLevels] Error processing level ${levelNumber}:`, error);
         if (this.store?.dispatch) {
             this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Failed to process level ${levelNumber}: ${error instanceof Error ? error.message : String(error)}` });
         }
         // Don't automatically dispatch LastLevel on error, let the error state handle it?
         // Or maybe dispatch LastLevel to prevent further loading attempts?
         // Let's dispatch LastLevel to be safe and stop further loading on this branch.
         this.dispatchLastLevel(levelNumber);
      }

    } catch (error) {
        console.error(`[loadMoreLevels] Outer error during loadMoreLevels for index ${startIndex}:`, error);
        if (this.store?.dispatch) {
          this.store.dispatch({ type: ACTIONS.SET_ERROR, payload: `Failed to load level ${startIndex}: ${error instanceof Error ? error.message : String(error)}` });
        }
    } finally {
      this.isLoadingMore = false;
    }
  };

  private mostQuoted(quoteCounts: QuoteCounts): Quote | null {
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
    }
  }

  public dispatchNewLevel(level: StoryTreeLevel): void {
    if (!this.store || !this.store.dispatch) {
      throw new StoryTreeError('Dispatch not initialized in StoryTreeOperator.');
    }
    this.store.dispatch({ type: ACTIONS.INCLUDE_NODES_IN_LEVELS, payload: [level] });
  }

  public async setSelectedNode(node: StoryTreeNode): Promise<void> {
    if (this.store && this.store.dispatch) {
      this.store.dispatch({ type: ACTIONS.SET_SELECTED_NODE, payload: node });
    } else {
      throw new StoryTreeError('Store not initialized for setSelectedNode');
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

    // Dispatch specific action to update only the selectedQuote in the target level
    this.store.dispatch({
      type: ACTIONS.UPDATE_LEVEL_SELECTED_QUOTE, // <<< Use new specific action type
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
      // 2. Fetch the first page of replies for the new quote in the next level (N+1)
      const sortingCriteria = 'mostRecent'; // Or fetch from config/state
      const limit = 5; // Or fetch from config/state
      const maybeFirstReplies = await this.fetchFirstRepliesForLevel(nextLevelNumber, parentId, quote, sortingCriteria, limit);

      let nextLevelData: StoryTreeLevel;

      if (maybeFirstReplies && maybeFirstReplies.data.length > 0) {
        const firstReplies: Reply[] = maybeFirstReplies.data;
        const pagination: Pagination = maybeFirstReplies.pagination;
        
        // TODO: Consider fetching quote counts for these replies asynchronously later if needed immediately
        const quoteCountsMap = new Map<Quote, QuoteCounts>();
        // await Promise.all(firstReplies.map(async (reply: Reply) => {
        //   const quoteCounts = await this.fetchQuoteCounts(reply.id);
        //   quoteCountsMap.set(reply.quote, quoteCounts);
        // }));

        const siblingsForQuote: Array<StoryTreeNode> = firstReplies.map(reply => ({
          id: reply.id,
          rootNodeId: rootNodeId,
          parentId: [parentId],
          levelNumber: nextLevelNumber,
          textContent: reply.text,
          repliedToQuote: quote, // Replies are to the newly selected quote
          quoteCounts: quoteCountsMap.get(reply.quote), // Initially undefined or empty
          authorId: reply.authorId,
          createdAt: reply.createdAt,
        } as StoryTreeNode));

        // Create the new level N+1 data
        nextLevelData = createMidLevel(
          rootNodeId,
          [parentId],
          nextLevelNumber,
          quote, // The quote leading to this level
          siblingsForQuote[0], // Select the first reply node by default
          { levelsMap: [[quote, siblingsForQuote]] }, // Only include siblings for the selected quote initially
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
  
}

// Create and export a single instance
const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;


