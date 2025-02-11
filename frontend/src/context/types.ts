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

export interface Quote {
  quoteLiteral: string;
  sourcePostId: string;
  selectionRange?: { start: number; end: number };
}

export interface StoryTreeMetadata {
  title?: string;
  author?: string;
  authorId: string;
  authorEmail: string;
  createdAt: string;
  quote: Quote | null;
}

// This needs to be updated to be a superset of the value returned from the server
export interface StoryTree { // this is the root of the story tree
  id: string; // probably a UUID, appears in the URL; same as the rootNodeId
  text: string;
  children: null | StoryTree[];
  parentId: string[] | null;
  metadata: StoryTreeMetadata;
  countOfChildren: number;
}

export interface StoryTreeNode {
  parentId: string[]; // the id of the parent node
  id: string; // probably a UUID
  Quote: string; // the string literal of the quote selected by the user; by default it is the entire textContent of the node
  isTitleNode?: boolean;
  textContent: string; // the text content of the node
}

export interface Siblings {
  levelsMap: Map<Quote, Readonly<StoryTreeNode>[]>; 
  // Quote is the quote selected by the user; 
  // StoryTreeNodes is the list of sibling nodes; 
  // the Quote is the key for performance reasons, but is also in the StoryTreeNode
}

export interface IdToIndexPair {
  indexMap: Map<string, { levelIndex: number, siblingIndex: number }>;
}

export interface StoryTreeLevel {
  rootNodeId: string; // the id of the root node, to keep everything grounded
  levelNumber: number; // the index of the level; the depth (root is 0)
  textContent: string; // the text content of the node
  siblings: Siblings; 
  isTitleNode?: boolean;
}

export interface StoryTreeState {
  isLoading: boolean; // signals to the UI that we should show a loading indicator
  isInitialized: boolean; // whether the story tree has been initialized with its first data
  rootNodeId: string; // the id of the root node, to keep everything grounded

  selectedQuote: Quote | null; // the currently selected quote

  levels: StoryTreeLevel[]; // stores the actual nodes
  idToIndexPair: IdToIndexPair; // stores the index of the node in the levels array for fast lookup

  error: string | null; // the error message, if one occurs
}

export type LoadingState = 'IDLE' | 'LOADING' | 'ERROR' | 'SUCCESS';

export interface QuoteMetadata {
  replyCount: number;
  lastReplyTimestamp?: number;
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

// Define the ACTIONS constant as documented:
export const ACTIONS = {
  START_STORY_TREE_LOAD: 'START_STORY_TREE_LOAD', // called when the user navigates to a story page
  SHOW_LOADING_INDICATOR: 'SHOW_LOADING_INDICATOR', // called after delay if still loading
  SET_STORY_TREE_DATA: 'SET_STORY_TREE_DATA', // called when initial story tree data is loaded
  INCLUDE_NODES_IN_LEVELS: 'INCLUDE_NODES_IN_LEVELS', // called by the operator when a new node is fetched
  NEW_REPLY_FROM_USER: 'NEW_REPLY_FROM_USER', // called when a new reply is submitted by the user
  SET_SELECTED_QUOTE: 'SET_SELECTED_QUOTE', // called when a quote is selected by the user
  SET_ERROR: 'SET_ERROR', // called when an error occurs
  CLEAR_ERROR: 'CLEAR_ERROR', // called when an error is cleared
  SET_PAGINATION_LOADING: 'SET_PAGINATION_LOADING', // called when pagination is loading
  SET_HAS_NEXT_PAGE: 'SET_HAS_NEXT_PAGE' // called when checking if there are more pages
} as const;

// Update the Action union type to match the ACTIONS constant:
export type Action =
  | {
      type: typeof ACTIONS.START_STORY_TREE_LOAD;
      payload: {
        rootNodeId: string;
      };
    }
  | { type: typeof ACTIONS.SHOW_LOADING_INDICATOR; payload: boolean }
  | { type: typeof ACTIONS.SET_STORY_TREE_DATA; payload: {
        levels: StoryTreeLevel[];
        idToIndexPair: IdToIndexPair;
      } }
  | { type: typeof ACTIONS.INCLUDE_NODES_IN_LEVELS; payload: StoryTreeLevel[] }
  | {
      type: typeof ACTIONS.NEW_REPLY_FROM_USER;
      payload: {
        targetId: string;
        content: string;
        selection: SelectionState;
        quote?: Quote;
      };
    }
  | { type: typeof ACTIONS.SET_SELECTED_QUOTE; payload: Quote | null }
  | { type: typeof ACTIONS.SET_ERROR; payload: string }
  | { type: typeof ACTIONS.CLEAR_ERROR }
  | { type: typeof ACTIONS.SET_PAGINATION_LOADING; payload: boolean }
  | { type: typeof ACTIONS.SET_HAS_NEXT_PAGE; payload: boolean };

// ActionType is derived directly from the ACTIONS constant:
export type ActionType = keyof typeof ACTIONS;
