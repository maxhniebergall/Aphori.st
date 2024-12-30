/*
 * Requirements:
 * - Proper class method binding to maintain 'this' context
 * - Robust loading condition checks to prevent infinite loading
 * - Proper state management for story tree pagination
 * - Validation of node data before dispatching
 */

import { ACTIONS } from '../context/StoryTreeContext';
import axios from 'axios';
import { BaseOperator } from './BaseOperator';

export class StoryTreeOperator extends BaseOperator {
  constructor(state, dispatch) {
    super();
    this.state = state;
    this.dispatch = dispatch;

    // Bind class methods to maintain 'this' context
    this.isItemLoaded = this.isItemLoaded.bind(this);
    this.loadMoreItems = this.loadMoreItems.bind(this);
    this.setCurrentFocus = this.setCurrentFocus.bind(this);
    this.fetchRootNode = this.fetchRootNode.bind(this);
    this.fetchNode = this.fetchNode.bind(this);
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
    return !this.state.hasNextPage || index < this.state.items.length;
  };

  loadMoreItems = async (startIndex, stopIndex) => {
    if (this.state?.isNextPageLoading) return;

    this.dispatch({ type: ACTIONS.SET_LOADING, payload: true });
    try {
      const lastNode = this.state.items[this.state.items.length - 1];
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
    const item = this.state.items[index];
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

export default StoryTreeOperator;