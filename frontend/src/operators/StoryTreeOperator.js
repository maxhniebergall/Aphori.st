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
 */

import { ACTIONS } from '../context/StoryTreeContext';
import axios from 'axios';
import { BaseOperator } from './BaseOperator';

class StoryTreeOperator extends BaseOperator {
  constructor() {
    super();
    // Initialize with default state to prevent null reference errors
    this.state = {
      items: [],
      hasNextPage: false,
      isNextPageLoading: false,
      rootNode: null,
      currentNode: null,
      isEditing: false,
      error: null
    };
    this.dispatch = null;

    // Bind class methods to maintain 'this' context
    this.isItemLoaded = this.isItemLoaded.bind(this);
    this.loadMoreItems = this.loadMoreItems.bind(this);
    this.setCurrentFocus = this.setCurrentFocus.bind(this);
    this.fetchRootNode = this.fetchRootNode.bind(this);
    this.fetchNode = this.fetchNode.bind(this);
    this.updateContext = this.updateContext.bind(this);
    this.submitReply = this.submitReply.bind(this);
  }

  updateContext(state, dispatch) {
    // Merge new state with defaults to ensure required properties exist
    this.state = {
      items: [],
      hasNextPage: false,
      isNextPageLoading: false,
      rootNode: null,
      currentNode: null,
      isEditing: false,
      error: null,
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
    return node && typeof node === 'object' && typeof node.id === 'string';
  }

  async fetchRootNode(uuid, fetchedNodes = {}) {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const node = await this.handleCompressedResponse(response);
      if (!this.validateNode(node)) {
        console.error('Invalid root node data received:', node);
        return null;
      }

      fetchedNodes[node.id] = node;

      if (node.nodes && node.nodes.length > 0) {
        for (const childNode of node.nodes) {
          if (childNode.id && !fetchedNodes[childNode.id]) {
            await this.fetchRootNode(childNode.id, fetchedNodes);
          }
        }
      }
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
        const node = await this.handleCompressedResponse(response);
        if (!this.validateNode(node)) {
          console.error('Invalid node data received:', node);
          return null;
        }
        return node;
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
      
      if (!lastNode?.nodes?.length) {
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }

      const nextNodeId = lastNode.nodes.find(node => node?.id)?.id;
      if (!nextNodeId) {
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }
      
      const nextNode = await this.fetchNode(nextNodeId);

      if (nextNode && this.validateNode(nextNode)) {
        nextNode.siblings = lastNode.nodes.filter(node => this.validateNode(node));
        this.dispatch({ type: ACTIONS.APPEND_ITEM, payload: nextNode });
        const hasNext = !!(nextNode.nodes?.length && nextNode.nodes.some(node => node?.id));
        this.dispatch({ 
          type: ACTIONS.SET_HAS_NEXT_PAGE, 
          payload: hasNext
        });
      } else {
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

  async submitReply(parentId, content, quoteData = null) {
    if (!parentId || !content) {
      console.error('Parent ID and content are required for reply');
      return null;
    }

    try {
      const replyData = {
        storyTree: {
          parentId,
          content,
          nodes: []
        }
      };

      // Add quote metadata if provided
      if (quoteData) {
        replyData.storyTree.quote = {
          text: quoteData.quote,
          sourcePostId: quoteData.sourcePostId,
          selectionRange: quoteData.selectionRange
        };
      }

      const response = await axios.post(
        `${process.env.REACT_APP_API_URL}/api/createStoryTree`,
        replyData
      );

      const newNode = await this.fetchNode(response.data.id);
      if (newNode) {
        // Update the parent node's children
        const parentNode = this.state.items.find(item => item.id === parentId);
        if (parentNode) {
          parentNode.nodes = [...(parentNode.nodes || []), { id: newNode.id }];
          this.dispatch({ type: ACTIONS.SET_ITEMS, payload: [...this.state.items] });
        }

        // If this is a reply to the last visible node, append it
        if (parentId === this.state.items[this.state.items.length - 1]?.id) {
          this.dispatch({ type: ACTIONS.APPEND_ITEM, payload: newNode });
        }

        return newNode;
      }
    } catch (error) {
      console.error('Error submitting reply:', error);
      return null;
    }
  }
}

// Create a singleton instance
export const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;