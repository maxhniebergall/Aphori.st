/**
 * Requirements:
 * - TypeScript interfaces and types for the story tree application
 * - Unified data model for stories and replies
 * - Comprehensive action types for all state changes
 * - Simple boolean loading state
 * - Error handling types
 * - Node and tree structure types
 * - Reply and navigation types
 * - Type safety for all operations
 * - Yarn for package management
 */


import { Quote, QuoteMetadata } from "./quote";

export interface QuoteCounts {
  quoteCounts: Map<Quote, number>;
}

export interface StoryTreeNode {
  id: string;
  rootNodeId: string;
  parentId: string[];
  textContent: string;
  metadata?: QuoteMetadata;
  isTitleNode?: boolean;
  quoteCounts: QuoteCounts | null;
}

export interface Siblings {
  levelsMap: Map<Quote, StoryTreeNode[]>;
}

export interface Pagination {
  nextCursor?: string;
  prevCursor?: string;
  hasMore: boolean;
  matchingRepliesCount: number;
}

export interface StoryTreeLevel {
  rootNodeId: string;
  parentId: string[];
  levelNumber: number;
  selectedQuote: Quote;
  siblings: Siblings;
  pagination: Pagination;
}

export interface StoryTreeMetadata {
  title: string;
  author: string;
  authorId: string;
  authorEmail: string;
  createdAt: string;
  quote: Quote | null;
}

export interface StoryTree { // this is the root of the story tree
  id: string; // probably a UUID, appears in the URL; same as the rootNodeId
  parentId: string[] | null;
  metadata: StoryTreeMetadata;
  levels: StoryTreeLevel[];
  error: string | null;
}

export interface StoryTreeState {
  storyTree: StoryTree | null;
  error: string | null;
}

export interface UnifiedNodeMetadata {
  parentId: string[] | null;
  quote?: Quote;
  author: string;
  createdAt: string;
  title?: string;
}

export interface UnifiedNode {
    id: string;
    type: 'story' | 'reply';
    content: string;
    metadata: UnifiedNodeMetadata;
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
  pagination: Pagination;
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

export enum ACTIONS {
  START_STORY_TREE_LOAD = 'START_STORY_TREE_LOAD',
  SET_INITIAL_STORY_TREE_DATA = 'SET_INITIAL_STORY_TREE_DATA',
  INCLUDE_NODES_IN_LEVELS = 'INCLUDE_NODES_IN_LEVELS',
  SET_ERROR = 'SET_ERROR',
  CLEAR_ERROR = 'CLEAR_ERROR'
}

export type Action =
  | { type: ACTIONS.START_STORY_TREE_LOAD; payload: { rootNodeId: string } }
  | { type: ACTIONS.SET_INITIAL_STORY_TREE_DATA; payload: { storyTree: StoryTree } }
  | { type: ACTIONS.INCLUDE_NODES_IN_LEVELS; payload: StoryTreeLevel[] }
  | { type: ACTIONS.SET_ERROR; payload: string }
  | { type: ACTIONS.CLEAR_ERROR };