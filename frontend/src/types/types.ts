/**
 * Requirements:
 * - TypeScript interfaces and types for the story tree application
 * - Unified data model for stories and replies
 * - Comprehensive action types for all state changes
 * - Simple boolean loading state
 * - Error handling types
 * - Node and tree structure types
 * - Quote and metadata types
 * - Reply and navigation types
 * - Type safety for all operations
 * - Yarn for package management
 */

export interface Quote {
  quoteLiteral: string;
  sourcePostId: string;
  selectionRange: SelectionState;
}

export interface StoryTreeMetadata {
  title: string;
  author: string;
  authorId: string;
  authorEmail: string;
  createdAt: string;
  quote: Quote | null;
}

export interface StoryTreeState {
  storyTree: StoryTree | null;
  error: string | null;
}

// This needs to be updated to be a superset of the value returned from the server
export interface StoryTree { // this is the root of the story tree
  id: string; // probably a UUID, appears in the URL; same as the rootNodeId
  text: string;
  children: StoryTreeLevel;
  parentId: string[] | null;
  metadata: StoryTreeMetadata;
  countOfChildren: number;
  levels: StoryTreeLevel[];
  idToIndexPair: IdToIndexPair;
  error: string | null;
}

export interface StoryTreeNode {
  parentId: string[]; // the id of the parent node
  id: string; // probably a UUID
  quote: Quote; // the string literal of the quote selected by the user; by default it is the entire textContent of the node
  isTitleNode?: boolean;
  textContent: string; // the text content of the node
}

export interface Siblings {
  levelsMap: Map<Quote, StoryTreeNode[]>;
}

export interface IdToIndexPair {
  indexMap: Map<string, { levelIndex: number; siblingIndex: number }>;
}

export interface StoryTreeNode {
  rootNodeId: string;
  parentId: string[];
  textContent: string;
  metadata?: QuoteMetadata;
  isTitleNode?: boolean;
}

export interface StoryTreeLevel {
  rootNodeId: string;
  parentId: string[];
  levelNumber: number;
  selectedQuote: Quote;
  siblings: Siblings;
}

export interface QuoteMetadata {
  replyCounts: Map<Quote, number>
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

export enum ACTIONS {
  START_STORY_TREE_LOAD = 'START_STORY_TREE_LOAD',
  SET_STORY_TREE_DATA = 'SET_STORY_TREE_DATA',
  INCLUDE_NODES_IN_LEVELS = 'INCLUDE_NODES_IN_LEVELS',
  SET_ERROR = 'SET_ERROR',
  CLEAR_ERROR = 'CLEAR_ERROR'
}

export type Action =
  | { type: ACTIONS.START_STORY_TREE_LOAD; payload: { rootNodeId: string } }
  | { type: ACTIONS.SET_STORY_TREE_DATA; payload: { levels: StoryTreeLevel[]; idToIndexPair: IdToIndexPair } }
  | { type: ACTIONS.INCLUDE_NODES_IN_LEVELS; payload: StoryTreeLevel[] }
  | { type: ACTIONS.SET_ERROR; payload: string }
  | { type: ACTIONS.CLEAR_ERROR };

// Unified Node Types
export interface UnifiedNode {
    id: string;
    type: 'story' | 'reply';
    content: string;
    metadata: UnifiedNodeMetadata;
}

export interface UnifiedNodeMetadata {
    parentId: string[] | null;
    quote?: Quote;
    author: string;
    createdAt: string;
    title?: string;
}

// Cache Types
export interface CacheKey {
    type: 'story' | 'reply' | 'batch';
    id: string;
}


// API Response Types
export interface ApiResponse<T = any> {
  success: boolean;
  error?: string;
  message?: string;
  compressedData?: T;
}

export interface CursorPaginatedResponse<T> extends ApiResponse {
  data: T[];
  pagination: {
      nextCursor?: string;
      prevCursor?: string;
      hasMore: boolean;
      matchingRepliesCount: number;
  };
}


// Reply Types (from backend)
export interface Reply {
  id: string;
  text: string;
  parentId: string[];
  quote: Quote;
  metadata: {
      author: string;
      authorId: string;
      authorEmail: string;
      createdAt: number;
  };
}