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

import { Compressed } from "./compressed";
import { Quote } from "./quote";

export interface QuoteCounts {
  // the quoteCounts map is a map of quotes (of the node) to the number of replies to that quote
  quoteCounts: Array<[Quote, number]>;
}

export interface ExistingSelectableQuotesApiFormat {
  quoteCounts: Array<[Quote, number]>;
}

export interface Post { // this is the value returned from the backend, representing the root node of the story tree
  id: string; // probably a UUID, appears in the URL; same as the rootNodeId
  content: string;
  quote?: Quote;
  authorId: string;
  createdAt: string;
}

export interface PostCreationRequest {
  content: string;
}

export interface Pagination {
  nextCursor?: string;
  prevCursor?: string;
  hasMore: boolean;
  totalCount: number;
}


export interface FeedItem {
  id: string;
  text: string;
  authorId: string;
  createdAt: string;
  title?: string; // Added title property
}

export interface FeedItemsResponse{
    data: FeedItem[];
    pagination: Pagination;
}

// Feed component interfaces
export interface FeedResponse {
  success: boolean;
  error?: string;
  data: FeedItem[];
  pagination?: Pagination;
}

export interface FetchResult {
  data: FeedItem[];
  pagination: Pagination;
}


export interface StoryTreeNode { // this value only exists in the frontend. it combines the post and the levels of the story tree
  id: string;
  rootNodeId: string;
  parentId: string[];
  levelNumber: number;
  textContent: string;
  repliedToQuote: Quote | null;
  quoteCounts: QuoteCounts | null;
  authorId: string;
  createdAt: string;
}

export interface Siblings {
  // Store siblings as an array of entries [Quote | null, StoryTreeNode[]] for better serialization
  levelsMap: Array<[Quote | null, StoryTreeNode[]]>;
}

export interface StoryTreeLevel {
  isLastLevel: boolean;
  midLevel: MidLevel | null;
  lastLevel: LastLevel | null;
}

export interface MidLevel {
  rootNodeId: string;
  parentId: string[];
  levelNumber: number;
  selectedQuote: Quote; // the selected quote is a quote of this level, and defines which replies (i.e., children) are visible
  selectedNode: StoryTreeNode;
  siblings: Siblings;
  pagination: Pagination;
}

export interface LastLevel {
  // a LastLevel valued level indicates that there are no replies for that level, and further levels will not be loaded
  levelNumber: number;
  rootNodeId: string;
}

export interface StoryTree { // this is the story tree we assemble as the user navigates
  post: Post;
  levels: Array<StoryTreeLevel>; 
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
export interface CompressedApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  message?: string;
  compressedData?: Compressed<T>;
}

export interface ApiResponse<T = unknown> {
  success: boolean;
  error?: string;
  message?: string;
  data?: T;
}

// Specific response type for createReply endpoint
export interface CreateReplyResponse {
  success: boolean;
  error?: string;
  data?: {
    id: string;
  };
}

export interface CursorPaginatedResponse<T> {
  pagination: Pagination;
  data: T[]; 
}

export interface DecompressedCursorPaginatedResponse<T> extends ApiResponse<T[]> {
  pagination: Pagination;
}

// Reply Types (from backend)
export interface Reply {
  id: string;
  text: string;
  parentId: string[];
  quote: Quote;
  authorId: string;
  createdAt: string;
}

export const ACTIONS = {
  START_STORY_TREE_LOAD: 'START_STORY_TREE_LOAD',
  SET_INITIAL_STORY_TREE_DATA: 'SET_INITIAL_STORY_TREE_DATA',
  INCLUDE_NODES_IN_LEVELS: 'INCLUDE_NODES_IN_LEVELS',
  SET_SELECTED_NODE: 'SET_SELECTED_NODE',
  UPDATE_LEVEL_SELECTED_QUOTE: 'UPDATE_LEVEL_SELECTED_QUOTE',
  REPLACE_LEVEL_DATA: 'REPLACE_LEVEL_DATA',
  CLEAR_LEVELS_AFTER: 'CLEAR_LEVELS_AFTER',
  SET_LAST_LEVEL: 'SET_LAST_LEVEL',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR'
} as const;

export type Action =
  | { type: typeof ACTIONS.START_STORY_TREE_LOAD; payload: { rootNodeId: string } }
  | { type: typeof ACTIONS.SET_INITIAL_STORY_TREE_DATA; payload: { storyTree: StoryTree } }
  | { type: typeof ACTIONS.INCLUDE_NODES_IN_LEVELS; payload: StoryTreeLevel[] }
  | { type: typeof ACTIONS.SET_SELECTED_NODE; payload: StoryTreeNode }
  | { type: typeof ACTIONS.UPDATE_LEVEL_SELECTED_QUOTE; payload: { levelNumber: number; newQuote: Quote } }
  | { type: typeof ACTIONS.REPLACE_LEVEL_DATA; payload: StoryTreeLevel }
  | { type: typeof ACTIONS.CLEAR_LEVELS_AFTER; payload: { levelNumber: number } }
  | { type: typeof ACTIONS.SET_LAST_LEVEL; payload: { levelNumber: number } } 
      // levelNumber is the number of the level immediately after the last level that has replies, will be filled with nulls
  | { type: typeof ACTIONS.SET_ERROR; payload: string }
  | { type: typeof ACTIONS.CLEAR_ERROR };