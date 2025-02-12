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
  levelsMap: Map<Quote, StoryTreeLevel[]>;
}

export interface IdToIndexPair {
  indexMap: Map<string, { levelIndex: number; siblingIndex: number }>;
}

export interface StoryTreeLevel {
  rootNodeId: string;
  levelNumber: number;
  textContent: string;
  siblings: Siblings;
  metadata?: QuoteMetadata;
  isTitleNode?: boolean;
}

export interface StoryTreeState {
  rootNodeId: string;
  selectedQuote: Quote | null;
  levels: StoryTreeLevel[];
  idToIndexPair: IdToIndexPair;
  error: string | null;
}

export interface QuoteMetadata {
  replyCount: number;
  lastReplyTimestamp: string;
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
