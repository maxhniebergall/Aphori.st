/*
 * Requirements:
 * - Proper class method binding to maintain 'this' context
 * - Robust loading condition checks to prevent infinite loading
 * - Proper state management for story tree pagination
 * - Validation of node data before dispatching
 * - Singleton pattern to prevent multiple instances
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

  validateNode(node) {
    return node && typeof node === 'object' && typeof node.id === 'string';
  }

  async fetchRootNode(uuid) {
    try {
      const response = await axios.get(
        `${process.env.REACT_APP_API_URL}/api/storyTree/${uuid}`
      );
      const node = await this.handleCompressedResponse(response);
      if (!this.validateNode(node)) {
        console.error('Invalid root node data received:', node);
        return null;
      }
      return node;
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
          console.log(`Retrying fetch for node ${id} after 503 error (attempt ${i + 1}/${retries})`);
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
    return !hasNextPage || index < items.length;
  };

  loadMoreItems = async (startIndex, stopIndex) => {
    if (!this.state || !this.dispatch) {
      console.warn('StoryTreeOperator: state or dispatch not initialized');
      return;
    }

    if (this.state.isNextPageLoading) return;

    this.dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const items = this.state.items ?? [];
      const lastNode = items[items.length - 1];
      
      // Check if there are actual nodes (not just an empty array) and valid next node ID
      if (!lastNode?.nodes?.length || !lastNode.nodes[0]?.id) {
        this.dispatch({ type: ACTIONS.SET_HAS_NEXT_PAGE, payload: false });
        return;
      }
      
      const nextNode = await this.fetchNode(lastNode.nodes[0].id);
      if (nextNode && this.validateNode(nextNode)) {
        nextNode.siblings = lastNode.nodes.filter(node => this.validateNode(node));
        this.dispatch({ type: ACTIONS.APPEND_ITEM, payload: nextNode });
        // Only set hasNextPage true if nextNode has valid child nodes
        this.dispatch({ 
          type: ACTIONS.SET_HAS_NEXT_PAGE, 
          payload: !!(nextNode.nodes?.length && nextNode.nodes[0]?.id)
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
}

// Create a singleton instance
export const storyTreeOperator = new StoryTreeOperator();
export default storyTreeOperator;