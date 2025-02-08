import { ACTIONS } from "./StoryTreeContext";

/**
 * Requirements:
 * - Complete type coverage for all components
 * - Strict null checks
 * - Proper interface inheritance
 * - Consistent naming conventions
 * - No any types unless absolutely necessary
 * - Proper documentation for complex types
 * - Type guards for runtime checks
 * - Readonly properties where appropriate
 * - Union types for state management
 * - Proper error type definitions
 * - Proper typing for async operations
 * - Proper typing for context values
 * - Type safety for action creators
 * - Proper typing for external library integration
 * - Version compatibility with TypeScript
 */

// First, let's define our types in a separate file
export interface Quote {
  text: string;
  sourcePostId: string;
  selectionRange?: { start: number; end: number };
}

export interface StoryTreeMetadata {
  quote?: Quote;
  title?: string;
  author?: string;
  authorId?: string;
  authorEmail?: string;
  createdAt?: number;
}

export interface StoryTree {
  id: string;
  text: string;
  nodes: { id: string; parentId: string | null; }[];
  parentId: string[];
  metadata?: StoryTreeMetadata;
  siblings?: StoryTreeNode[];
  isTitleNode?: boolean;
  quoteReplyCounts?: Record<string, number>;
}

export interface StoryTreeNode {
  id: string;
  parentId?: string | null;
  storyTree: StoryTree;
  quoteReplyCounts?: Record<string, number>;
  siblings?: StoryTreeNode[];
}

export interface StoryTreeState {
  rootNode: StoryTreeNode | null;
  items: StoryTreeNode[];
  isNextPageLoading: boolean;
  isPaginationLoading: boolean;
  isInitialLoading: boolean;
  hasNextPage: boolean;
  removedFromView: string[];
  isEditing: boolean;
  currentNode: StoryTreeNode | null;
  error: string | null;
  loadingState: LoadingState;
  replies: StoryTreeNode[];
  repliesFeed: StoryTreeNode[];
  selectedQuote: Quote | null;
  quoteMetadata: Record<string, any>;
  replyPagination?: {
    totalItems: number;
  };
}

export type LoadingState = 'IDLE' | 'LOADING' | 'ERROR' | 'SUCCESS';

export interface QuoteMetadata {
  replyCount: number;
  lastReplyTimestamp?: number;
}

export interface ReplyAction {
  type: 'CREATE_REPLY';
  payload: {
    targetId: string;
    content: string;
    selection: SelectionState;
    quote?: Quote;
  };
}

export interface ReplyError {
  code: string;
  message: string;
  details?: unknown;
}

export interface SelectionState {
  start: number;
  end: number;
}

export type Action = 
  | { type: 'SET_ROOT_NODE'; payload: any }
  | { type: 'SET_ITEMS'; payload: any[] }
  | { type: 'APPEND_ITEM'; payload: any }
  | { type: 'SET_LOADING'; payload: boolean }
  | { type: 'SET_HAS_NEXT_PAGE'; payload: boolean }
  | { type: 'SET_REMOVED_FROM_VIEW'; payload: string }
  | { type: 'SET_EDITING'; payload: boolean }
  | { type: 'SET_CURRENT_NODE'; payload: any }
  | { type: 'TRUNCATE_ITEMS'; payload: number }
  | { type: 'SET_LOADING_STATE'; payload: LoadingState }
  | { type: 'SET_REPLIES'; payload: any[] }
  | { type: 'ADD_REPLY'; payload: any }
  | { type: 'SET_REPLIES_FEED'; payload: any[] }
  | { type: 'SET_SELECTED_QUOTE'; payload: any }
  | { type: 'CLEAR_REPLIES' }
  | { type: 'SET_QUOTE_METADATA'; payload: { nodeId: string; metadata: QuoteMetadata } }
  | { type: 'SET_ERROR'; payload: string }
  | { type: 'CLEAR_ERROR'; payload: void }
  | { type: 'SET_INITIAL_LOADING'; payload: boolean }
  | { type: 'SET_PAGINATION_LOADING'; payload: boolean }
  | { type: 'HANDLE_SIBLING_CHANGE'; payload: { newNode: StoryTreeNode; index: number } }
  | ReplyAction
  | { type: 'SET_REPLY_ERROR'; payload: ReplyError | null }
  | { type: 'CLEAR_REPLY_STATE' };

export type ActionType = keyof typeof ACTIONS;
