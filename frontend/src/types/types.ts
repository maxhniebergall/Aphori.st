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
 * - Consistent author and authorId fields across all interfaces
 */

import { Quote } from "./quote";

export interface QuoteCounts {
  // the quoteCounts map is a map of quotes (of the node) to the number of replies to that quote
  quoteCounts: Map<Quote, number>;
}

export interface ExistingSelectableQuotesApiFormat {
  quoteCounts: [Quote, number][];
}

export interface Post { // this is the value returned from the backend, representing the root node of the story tree
  id: string; // probably a UUID, appears in the URL; same as the rootNodeId
  content: string;
  quote?: Quote;
  authorId: string;
  createdAt: string;
}

export interface StoryTreeNode { // this value only exists in the frontend. it combines the post and the levels of the story tree
  id: string;
  rootNodeId: string;
  parentId: string[];
  levelNumber: number;
  textContent: string;
  repliedToQuote: Quote;
  quoteCounts: QuoteCounts | null;
  authorId: string;
  createdAt: string;
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

export interface StoryTree { // this is the story tree we assemble as the user navigates
  post: Post;
  levels: StoryTreeLevel[];
  error: string | null;
}

export interface StoryTreeState { // required to allow storyTree to be null before it is initialized
  storyTree: StoryTree | null;
  error: string | null;
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

// Specific response type for createReply endpoint
export interface CreateReplyResponse {
  success: boolean;
  error?: string;
  data?: {
    id: string;
  };
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
    authorId: string;
    createdAt: number;
  };
}

export const ACTIONS = {
  START_STORY_TREE_LOAD: 'START_STORY_TREE_LOAD',
  SET_INITIAL_STORY_TREE_DATA: 'SET_INITIAL_STORY_TREE_DATA',
  INCLUDE_NODES_IN_LEVELS: 'INCLUDE_NODES_IN_LEVELS',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR'
} as const;

export type Action =
  | { type: typeof ACTIONS.START_STORY_TREE_LOAD; payload: { rootNodeId: string } }
  | { type: typeof ACTIONS.SET_INITIAL_STORY_TREE_DATA; payload: { storyTree: StoryTree } }
  | { type: typeof ACTIONS.INCLUDE_NODES_IN_LEVELS; payload: StoryTreeLevel[] }
  | { type: typeof ACTIONS.SET_ERROR; payload: string }
  | { type: typeof ACTIONS.CLEAR_ERROR };