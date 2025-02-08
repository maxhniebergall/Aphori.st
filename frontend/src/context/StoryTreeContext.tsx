import React, { createContext, useContext, useReducer, ReactNode } from 'react';
import { storyTreeActions } from './StoryTreeActions';
import { StoryTreeState, Action, LoadingState } from './types';

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
 * - Quote metadata and reply counts handling
 * - Support for nested storyTree structure in node objects
 * - Proper type checking for node structure
 * - Handle quote metadata
 * - Support for reply-based navigation
 * - TypeScript type safety and interfaces
 */

export const ACTIONS = {
  SET_ROOT_NODE: 'SET_ROOT_NODE',
  SET_NODES: 'SET_NODES',
  APPEND_NODE: 'APPEND_NODE',
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
  SET_LOADING_STATE: 'SET_LOADING_STATE',
  SET_REPLIES: 'SET_REPLIES',
  ADD_REPLY: 'ADD_REPLY',
  SET_REPLIES_FEED: 'SET_REPLIES_FEED',
  SET_SELECTED_QUOTE: 'SET_SELECTED_QUOTE',
  CLEAR_REPLIES: 'CLEAR_REPLIES',
  SET_QUOTE_METADATA: 'SET_QUOTE_METADATA',
} as const;

export const LOADING_STATES: Record<LoadingState, LoadingState> = {
  IDLE: 'IDLE',
  LOADING: 'LOADING',
  ERROR: 'ERROR',
  SUCCESS: 'SUCCESS'
};

const initialState: StoryTreeState = {
  rootNode: null,
  nodes: [],
  isNextPageLoading: false,
  isPaginationLoading: false,
  isInitialLoading: true,
  hasNextPage: false,
  removedFromView: [],
  isEditing: false,
  currentNode: null,
  error: null,
  loadingState: LOADING_STATES.IDLE,
  replies: [],
  repliesFeed: [],
  selectedQuote: null,
  quoteMetadata: {},
};

function storyTreeReducer(state: StoryTreeState, action: Action): StoryTreeState {
  switch (action.type) {
    case ACTIONS.SET_ROOT_NODE:
      return {
        ...state,
        rootNode: action.payload,
        nodes: [action.payload],
      };
    
    case ACTIONS.SET_NODES:
      return {
        ...state,
        nodes: action.payload,
      };
    
    case ACTIONS.APPEND_NODE:
      return {
        ...state,
        nodes: [...state.nodes, action.payload],
      };
    
    case ACTIONS.TRUNCATE_ITEMS:
      return {
        ...state,
        nodes: state.nodes.slice(0, action.payload + 1),
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

    case ACTIONS.SET_LOADING_STATE:
      return {
        ...state,
        loadingState: action.payload,
      };

    case ACTIONS.SET_REPLIES:
      return {
        ...state,
        replies: action.payload
      };
    
    case ACTIONS.ADD_REPLY:
      return {
        ...state,
        replies: [...state.replies, action.payload]
      };
    
    case ACTIONS.SET_REPLIES_FEED:
      return {
        ...state,
        repliesFeed: action.payload
      };
    
    case ACTIONS.SET_SELECTED_QUOTE:
      return {
        ...state,
        selectedQuote: action.payload
      };
    
    case ACTIONS.CLEAR_REPLIES:
      return {
        ...state,
        replies: [],
        selectedQuote: null
      };

    case ACTIONS.SET_QUOTE_METADATA:
      return {
        ...state,
        quoteMetadata: {
          ...state.quoteMetadata,
          [action.payload.nodeId]: action.payload.metadata
        }
      };

    default:
      return state;
  }
}

interface StoryTreeContextType {
  state: StoryTreeState;
  dispatch: React.Dispatch<Action>;
  actions: typeof storyTreeActions;
}

const StoryTreeContext = createContext<StoryTreeContextType | undefined>(undefined);

interface StoryTreeErrorBoundaryProps {
  children: ReactNode;
}

interface StoryTreeErrorBoundaryState {
  hasError: boolean;
}

class StoryTreeErrorBoundary extends React.Component<
  StoryTreeErrorBoundaryProps,
  StoryTreeErrorBoundaryState
> {
  constructor(props: StoryTreeErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(error: Error): StoryTreeErrorBoundaryState {
    return { hasError: true };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo): void {
    console.error('StoryTree Error:', error, errorInfo);
  }

  render(): React.ReactElement {
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

    return <>{this.props.children}</>;
  }
}

interface StoryTreeProviderProps {
  children: ReactNode;
}

export function StoryTreeProvider({ children }: StoryTreeProviderProps) {
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

export function StoryTreeLoading(): React.ReactElement {
  return (
    <div className="story-tree-loading">
      <div className="loading-spinner"></div>
      <p>Loading story tree...</p>
    </div>
  );
}

export function useStoryTree(): StoryTreeContextType {
  const context = useContext(StoryTreeContext);
  if (!context) {
    throw new Error('useStoryTree must be used within a StoryTreeProvider');
  }
  return context;
} 