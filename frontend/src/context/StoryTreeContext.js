/*
 * Requirements:
 * - Global state management using React Context
 * - Comprehensive action types for all state changes
 * - Loading state management with defined states (IDLE, LOADING, ERROR, SUCCESS)
 * - Error handling and propagation
 * - Initial state with proper type definitions
 * - Pagination state management
 * - Sibling navigation state handling
 * - Editing state management
 * - Node removal tracking
 */

import React, { createContext, useContext, useReducer } from 'react';
import { storyTreeActions } from './StoryTreeActions';

// Define action types
export const ACTIONS = {
  SET_ROOT_NODE: 'SET_ROOT_NODE',
  SET_ITEMS: 'SET_ITEMS',
  APPEND_ITEM: 'APPEND_ITEM',
  SET_LOADING: 'SET_LOADING',
  SET_HAS_NEXT_PAGE: 'SET_HAS_NEXT_PAGE',
  SET_REMOVED_FROM_VIEW: 'SET_REMOVED_FROM_VIEW',
  SET_EDITING: 'SET_EDITING',
  SET_CURRENT_NODE: 'SET_CURRENT_NODE',
  TRUNCATE_ITEMS: 'TRUNCATE_ITEMS',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_INITIAL_LOADING: 'SET_INITIAL_LOADING',
  SET_PAGINATION_LOADING: 'SET_PAGINATION_LOADING',
  HANDLE_SIBLING_CHANGE: 'HANDLE_SIBLING_CHANGE',
};

// Add these at the top of the file
export const LOADING_STATES = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS'
};

// Initial state
const initialState = {
  rootNode: null,
  items: [],
  isNextPageLoading: false,
  isPaginationLoading: false,
  isInitialLoading: true,
  hasNextPage: true,
  removedFromView: [],
  isEditing: false,
  currentNode: null,
  error: null,
  loadingState: LOADING_STATES.IDLE,
};

// Reducer function
function storyTreeReducer(state, action) {
  switch (action.type) {
    case ACTIONS.SET_ROOT_NODE:
      return {
        ...state,
        rootNode: action.payload,
        items: [action.payload], // Initialize items with root node
      };
    
    case ACTIONS.SET_ITEMS:
      return {
        ...state,
        items: action.payload,
      };
    
    case ACTIONS.APPEND_ITEM:
      return {
        ...state,
        items: [...state.items, action.payload],
      };
    
    case ACTIONS.TRUNCATE_ITEMS:
      return {
        ...state,
        items: state.items.slice(0, action.payload + 1),
      };
    
    case ACTIONS.SET_LOADING:
      return {
        ...state,
        isNextPageLoading: action.payload,
      };
    
    case ACTIONS.SET_HAS_NEXT_PAGE:
      return {
        ...state,
        hasNextPage: action.payload,
      };
    
    case ACTIONS.SET_REMOVED_FROM_VIEW:
      return {
        ...state,
        removedFromView: [...state.removedFromView, action.payload],
      };
    
    case ACTIONS.SET_EDITING:
      return {
        ...state,
        isEditing: action.payload,
      };
    
    case ACTIONS.SET_CURRENT_NODE:
      return {
        ...state,
        currentNode: action.payload,
      };

    default:
      return state;
  }
}

// Create context
const StoryTreeContext = createContext();

// Add error boundary component
class StoryTreeErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('StoryTree Error:', error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="story-tree-error">
          <h2>Something went wrong.</h2>
          <button onClick={() => window.location.reload()}>
            Refresh Page
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}

// Update provider to include error boundary and loading states
export function StoryTreeProvider({ children }) {
  const [state, dispatch] = useReducer(storyTreeReducer, initialState);
  const value = {
    state,
    dispatch,
    actions: storyTreeActions
  };

  return (
    <StoryTreeErrorBoundary>
      <StoryTreeContext.Provider value={value}>
        {children}
      </StoryTreeContext.Provider>
    </StoryTreeErrorBoundary>
  );
}

// Add loading component
export function StoryTreeLoading() {
  return (
    <div className="story-tree-loading">
      <div className="loading-spinner"></div>
      <p>Loading story tree...</p>
    </div>
  );
}

// Custom hook for using the context
export function useStoryTree() {
  const context = useContext(StoryTreeContext);
  if (!context) {
    throw new Error('useStoryTree must be used within a StoryTreeProvider');
  }
  return context;
} 