/*
 * Requirements:
 * - Singleton pattern to prevent multiple instances
 * - Proper class method binding to maintain 'this' context
 * - Robust loading condition checks to prevent infinite loading
 * - Proper state management for story tree pagination
 * - Validation of node data before dispatching
 * - Retry mechanism for failed node fetches
 * - Compressed response handling
 * - Error boundary implementation
 * - Proper sibling state management
 * - Efficient caching of fetched nodes
 * - Quote metadata handling in replies
 * - Reply creation and fetching support
 * - Reply feed management
 * - Quote counts tracking and updates
 * - Full page scrolling instead of individual element scrolling
 * - Header should remain fixed at the top
 * - Content should flow naturally in the document
 * - Proper handling of viewport heights
 * - Support for mobile browsers
 * - Title and author should scroll with the list
 */

import { ACTIONS } from '../context/StoryTreeContext';
import axios from 'axios';
import { BaseOperator } from './BaseOperator';

class StoryTreeOperator extends BaseOperator {
  constructor() {
    super();
    this.state = {
      items: [],
      hasNextPage: false,
      isNextPageLoading: false,
      rootNode: null,
      currentNode: null,
      isEditing: false,
      error: null,
      replies: [],
      selectedQuote: null,
      quoteMetadata: {}
    };
    this.dispatch = null;
    this.replySubscribers = new Map();

    // Bind existing methods
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

  updateContext(state, dispatch) {
    this.state = {
      items: [],
      hasNextPage: false,
      isNextPageLoading: false,
      rootNode: null,
      currentNode: null,
      isEditing: false,
      error: null,
      replies: [],
      selectedQuote: null,
      quoteMetadata: {},
      ...state
    };
    this.dispatch = dispatch;
  }

  updateLoadingState(loadingState) {
    if (this.dispatch) {
      this.dispatch({ type: ACTIONS.SET_LOADING_STATE, payload: loadingState });
    } else {
      console.warn('Dispatch not initialized in StoryTreeOperator');
    }
  }

  validateNode(node) {
    return node && typeof node === 'object' && ((node.id && typeof node.id === 'string') || (node.storyTree && typeof node.storyTree === 'object' && node.storyTree.id && typeof node.storyTree.id === 'string'));
  }

  async fetchRootNodeWithIncludedNodes(uuid, fetchedNodes = {}) {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const data = await this.handleCompressedResponse(response);
      if (!data || !data.storyTree) {
        console.error('Invalid response data received:', data);
        return null;
      }

      const node = typeof data.storyTree === 'string' ? JSON.parse(data.storyTree) : data.storyTree;
      if (!this.validateNode(node)) {
        console.error('Invalid root node data received:', node);
        return null;
      }

      console.log('Processing root node:', {
        id: node.id,
        nodesCount: node.nodes?.length,
        nodes: node.nodes
      });

      // Create a title node
      const titleNode = {
        storyTree: {
          id: `${node.id}-title`,
          metadata: {
            title: node.metadata?.title,
            author: node.metadata?.author,
          },
          isTitleNode: true,
        }
      };
      fetchedNodes[titleNode.storyTree.id] = titleNode;

      // Create a content node
      const contentNode = {
        storyTree: {
          ...node,
          quoteReplyCounts: data.quoteReplyCounts || {},
          siblings: node.nodes?.filter(n => n?.id),
          metadata: {
            ...node.metadata,
            title: null,
            author: null,
          }
        }
      };
      fetchedNodes[contentNode.storyTree.id] = contentNode;

      // Fetch first few sibling nodes immediately
      if (node.nodes && node.nodes.length > 0) {
        const initialNodesToFetch = node.nodes.slice(0, 3);
        console.log('Fetching initial sibling nodes:', initialNodesToFetch);

        await Promise.all(
          initialNodesToFetch.map(async (childNode) => {
            if (childNode.id && !fetchedNodes[childNode.id]) {
              const response = await axios.get(
                `${process.env.REACT_APP_API_URL}/api/storyTree/${childNode.id}`
              );
              const childData = await this.handleCompressedResponse(response);
              if (childData?.storyTree) {
                const childNodeData = typeof childData.storyTree === 'string' 
                  ? JSON.parse(childData.storyTree) 
                  : childData.storyTree;

                fetchedNodes[childNode.id] = {
                  storyTree: {
                    ...childNodeData,
                    quoteReplyCounts: childData.quoteReplyCounts || {},
                    siblings: node.nodes.filter(n => n?.id)
                  }
                };
              }
            }
          })
        );
      }

      console.log('Fetched nodes:', {
        count: Object.keys(fetchedNodes).length,
        nodes: fetchedNodes
      });

      return Object.values(fetchedNodes);
    } catch (error) {
      console.error('Error fetching root node:', error);
      return null;
    }
  }

  async fetchNode(id, retries = 3, delay = 1000) {
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

        const node = data.storyTree;
        if (!this.validateNode(node)) {
          console.error('Invalid node data received:', node);
          return null;
        }

        // Create a node with storyTree wrapper to maintain compatibility
        return {
          storyTree: {
            ...node,
            quoteReplyCounts: data.quoteReplyCounts || {}
          }
        };
      } catch (error) {
        if (error.response?.status === 503 && i < retries - 1) {
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }
        console.error('Error fetching node:', error);
        return null;
      }
    }
    return null;
  }

  isItemLoaded = (index) => {
    // Add null checks and default values
    const hasNextPage = this.state?.hasNextPage ?? false;
    const items = this.state?.items ?? [];
    const isLoading = this.state?.isNextPageLoading ?? false;
    
    // If we're loading, consider items not loaded
    if (isLoading) return false;
    
    // If we have the item at this index, it's loaded
    if (index < items.length) return true;
    
    // If we don't have the item and there's no next page, consider it loaded (end of list)
    if (!hasNextPage) return true;
    
    // Otherwise, we need to load this item
    return false;
  };

  loadMoreItems = async (startIndex, stopIndex) => {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return;
    }

    if (this.state.isNextPageLoading) {
      return;
    }

    this.dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const items = this.state.items ?? [];
      const lastNode = items[items.length - 1];
      
      console.log('Loading more items:', {
        startIndex,
        stopIndex,
        lastNode,
        nodesLength: lastNode?.storyTree?.nodes?.length
      });

      if (!lastNode?.storyTree?.nodes?.length) {
        console.log('No more nodes to load');
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }

      // Get all node IDs that need to be loaded
      const nodesToLoad = lastNode.storyTree.nodes
        .slice(startIndex, stopIndex + 1)
        .filter(node => node?.id);

      console.log('Nodes to load:', nodesToLoad);

      if (nodesToLoad.length === 0) {
        console.log('No valid nodes to load');
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }

      // Fetch all nodes in parallel
      const loadedNodes = await Promise.all(
        nodesToLoad.map(async (node) => {
          if (node.id === lastNode.storyTree.id) return lastNode;
          const fetchedNode = await this.fetchNode(node.id);
          if (fetchedNode) {
            fetchedNode.storyTree.siblings = lastNode.storyTree.nodes.filter(n => n?.id);
          }
          return fetchedNode;
        })
      );

      // Filter out any null results and add to items
      const validNodes = loadedNodes.filter(node => node !== null);
      console.log('Loaded valid nodes:', validNodes);

      if (validNodes.length > 0) {
        this.dispatch({ type: ACTIONS.SET_ITEMS, payload: [...items, ...validNodes] });
        
        // Check if there are more nodes to load
        const lastLoadedNode = validNodes[validNodes.length - 1];
        const hasMore = lastLoadedNode?.storyTree?.nodes?.some(node => node?.id);
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: hasMore });
      } else {
        console.log('No valid nodes were loaded');
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
      }
    } catch (error) {
      console.error('Error loading more items:', error);
      this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
    } finally {
      this.dispatch({ type: ACTIONS.SET_LOADING, payload: false });
    }
  };

  setCurrentFocus = (index) => {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return;
    }

    const items = this.state.items ?? [];
    const item = items[index];
    if (item && this.validateNode(item)) {
      this.dispatch({ 
        type: ACTIONS.SET_CURRENT_NODE, 
        payload: item 
      });
    } else {
      console.warn('Attempted to focus invalid node at index:', index);
    }
  };

  subscribeToReplySubmission(parentId, callback) {
    if (!this.replySubscribers.has(parentId)) {
      this.replySubscribers.set(parentId, new Set());
    }
    this.replySubscribers.get(parentId).add(callback);
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

  notifyReplySubmission(parentId) {
    const subscribers = this.replySubscribers.get(parentId);
    if (subscribers) {
      subscribers.forEach(callback => callback());
    }
  }

  async submitReply(parentId, content, quoteData = null) {
    if (!parentId || !content) {
      console.error('Parent ID and content are required for reply');
      return { success: false };
    }

    const replyData = {
      text: content,
      parentId: [parentId],
      quote: quoteData ? {
        text: quoteData.quote,
        sourcePostId: quoteData.sourcePostId,
        selectionRange: quoteData.selectionRange
      } : null
    };

    try {
      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/createReply`,
        replyData
      );

      // Add debug logging
      console.log('Create reply response:', response.data);
      
      if (!response.data) {
        console.error('Invalid response from createReply:', response.data);
        return { success: false };
      }

      // Handle updated quote metadata from response
      if (response.data.quoteMetadata) {
        this.updateQuoteMetadata(parentId, response.data.quoteMetadata);
      }

      // Notify only the parent node's subscribers
      this.notifyReplySubmission(parentId);

      return { success: true };
    } catch (error) {
      console.error('Error submitting reply:', error);
      console.error('Request data:', replyData);
      return { success: false };
    }
  }

  async fetchReply(uuid) {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/getReply/${uuid}`
      );
      const data = await this.handleCompressedResponse(response);
      
      // Handle quote metadata if present
      if (data?.quoteMetadata) {
        this.updateQuoteMetadata(uuid, data.quoteMetadata);
      }
      
      return data;
    } catch (error) {
      console.error('Error fetching reply:', error);
      return null;
    }
  }

  async fetchReplies(uuid, quote, sortingCriteria = 'mostRecent', page = 1, limit = 10) {
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
        this.dispatch({ type: ACTIONS.SET_REPLIES, payload: data.replies });
        
        // Handle quote metadata if present
        if (data.quoteMetadata) {
          this.updateQuoteMetadata(uuid, data.quoteMetadata);
        }
        
        return data;
      }
      return null;
    } catch (error) {
      console.error('Error fetching replies:', error);
      return null;
    }
  }

  async fetchRepliesFeed() {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/getRepliesFeed`
      );
      const replies = await this.handleCompressedResponse(response);
      this.dispatch({ type: ACTIONS.SET_REPLIES_FEED, payload: replies });
      return replies;
    } catch (error) {
      console.error('Error fetching replies feed:', error);
      return [];
    }
  }

  // Add new method to handle quote metadata
  updateQuoteMetadata(nodeId, metadata) {
    if (this.dispatch) {
      this.dispatch({
        type: ACTIONS.SET_QUOTE_METADATA,
        payload: { nodeId, metadata }
      });
    }
  }
}

// Create a singleton instance
export const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;