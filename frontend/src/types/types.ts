/**
 * Requirements:
 * - TypeScript interfaces and types for the post tree application
 * - Unified data model for posts and replies
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
  quoteCounts: [Quote, number][];
}

export interface ExistingSelectableQuotesApiFormat {
  quoteCounts: [Quote, number][];
}

export interface Post { // this is the value returned from the backend, representing the root node of the post tree
  id: string; // probably a UUID, appears in the URL; same as the rootNodeId
  content: string;
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
  textSnippet: string;
  authorId: string;
  createdAt: string;
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


export interface PostTreeNode { // this value only exists in the frontend. it combines the post and the levels of the post tree
  id: string;
  rootNodeId: string;
  parentId?: string;
  levelNumber: number;
  textContent: string;
  repliedToQuote: Quote | null;
  quoteCounts: QuoteCounts | null;
  authorId: string;
  createdAt: string;
  duplicateGroupId?: string; // Optional field for nodes that are part of a duplicate group
}

export interface Siblings {
  // Store siblings as an array of entries [Quote | null, PostTreeNode[]] for better serialization
  // levelsMap: [Quote | null, PostTreeNode[]][];
  nodes: PostTreeNode[]; // New: A single, sorted list of sibling nodes for the level
}

export interface PostTreeLevel {
  isLastLevel: boolean;
  midLevel: MidLevel | null;
  lastLevel: LastLevel | null;
}

export interface MidLevel {
  rootNodeId: string;
  parentId: string;
  levelNumber: number;
  selectedQuoteInParent: Quote | null;
  selectedQuoteInThisLevel: Quote | null;
  selectedNode: PostTreeNode;
  siblings: Siblings;
  pagination: Pagination;
}

export interface LastLevel {
  // a LastLevel valued level indicates that there are no replies for that level, and further levels will not be loaded
  levelNumber: number;
  rootNodeId: string;
}

export interface PostTree { // this is the post tree we assemble as the user navigates
  post: Post;
  levels: PostTreeLevel[]; 
  error: string | null;
}

export interface PostTreeState { // required to allow postTree to be null before it is initialized
  postTree: PostTree | null;
  error: string | null;
  isLoadingMore: boolean;
  navigationRequest?: NavigationRequest | null;
}

// Define the NavigationRequest type
export interface NavigationRequest {
  type: 'next' | 'prev';
  levelNumber: number;
  expectedCurrentNodeId: string | null;
}

// Cache Types
export interface CacheKey {
  type: 'post' | 'reply' | 'batch';
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

// CreateReplyRequest is the request body for the createReply endpoint
export interface CreateReplyRequest {
  text: string;
  parentId: string;
  quote: Quote;
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
  success: boolean;
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
  parentId: string;
  parentType: "post" | "reply";
  rootPostId: string;
  quote: Quote;
  authorId: string;
  createdAt: string;
}

// Duplicate Reply Types for Deduplication Feature (Frontend)
export interface DuplicateReply extends Reply {
  duplicateGroupId: string; // UUID linking related duplicates
  originalReplyId: string; // Reference to the first reply in the group
  similarityScore: number; // Cosine similarity to original (0-1)
  votes: DuplicateVotes; // Object tracking user votes on which duplicate is better
  parentConnections: string[]; // Array of parent reply/post IDs for web mapping
}

export interface DuplicateVotes {
  upvotes: string[]; // Array of user IDs who voted for this duplicate
  downvotes: string[]; // Array of user IDs who voted against this duplicate
  totalScore: number; // Calculated weighted score
}

export interface DuplicateGroup {
  id: string; // Group UUID
  originalReplyId: string; // First reply in the group
  duplicateIds: string[]; // Array of duplicate reply IDs
  createdAt: string; // When group was created
  parentConnections: string[]; // All parent connections from duplicates
  threshold: number; // Similarity threshold used for this group
}

export interface DuplicateDetectionResult {
  isDuplicate: boolean;
  duplicateGroup?: DuplicateGroup;
  similarityScore?: number;
  matchedReplyId?: string;
}

// API Response Types for Duplicate Features
export interface DuplicateGroupResponse extends ApiResponse<DuplicateGroup> {}

export interface DuplicateComparisonResponse extends ApiResponse<{
  originalReply: Reply;
  duplicates: DuplicateReply[];
  group: DuplicateGroup;
}> {}

export const ACTIONS = {
  START_POST_TREE_LOAD: 'START_POST_TREE_LOAD',
  SET_INITIAL_POST_TREE_DATA: 'SET_INITIAL_POST_TREE_DATA',
  INCLUDE_NODES_IN_LEVELS: 'INCLUDE_NODES_IN_LEVELS',
  SET_SELECTED_NODE: 'SET_SELECTED_NODE',
  UPDATE_THIS_LEVEL_SELECTED_QUOTE: 'UPDATE_THIS_LEVEL_SELECTED_QUOTE',
  REPLACE_LEVEL_DATA: 'REPLACE_LEVEL_DATA',
  CLEAR_LEVELS_AFTER: 'CLEAR_LEVELS_AFTER',
  SET_LAST_LEVEL: 'SET_LAST_LEVEL',
  SET_ERROR: 'SET_ERROR',
  CLEAR_ERROR: 'CLEAR_ERROR',
  SET_LOADING_MORE: 'SET_LOADING_MORE',
  NAVIGATE_NEXT_SIBLING: 'NAVIGATE_NEXT_SIBLING',
  NAVIGATE_PREV_SIBLING: 'NAVIGATE_PREV_SIBLING',
  CLEAR_NAVIGATION_REQUEST: 'CLEAR_NAVIGATION_REQUEST',
} as const;

export type Action =
  | { type: typeof ACTIONS.START_POST_TREE_LOAD; payload: { rootNodeId: string } }
  | { type: typeof ACTIONS.SET_INITIAL_POST_TREE_DATA; payload: { postTree: PostTree; error?: never } | { postTree?: never; error: string } }
  | { type: typeof ACTIONS.INCLUDE_NODES_IN_LEVELS; payload: PostTreeLevel[] }
  | { type: typeof ACTIONS.SET_SELECTED_NODE; payload: PostTreeNode }
  | { type: typeof ACTIONS.UPDATE_THIS_LEVEL_SELECTED_QUOTE; payload: { levelNumber: number; newQuote: Quote | null } }
  | { type: typeof ACTIONS.REPLACE_LEVEL_DATA; payload: PostTreeLevel }
  | { type: typeof ACTIONS.CLEAR_LEVELS_AFTER; payload: { levelNumber: number } }
  | { type: typeof ACTIONS.SET_LAST_LEVEL; payload: { levelNumber: number } } 
      // levelNumber is the number of the level immediately after the last level that has replies, will be filled with nulls
  | { type: typeof ACTIONS.SET_ERROR; payload: string }
  | { type: typeof ACTIONS.CLEAR_ERROR }
  | { type: typeof ACTIONS.SET_LOADING_MORE; payload: boolean }
  | { type: typeof ACTIONS.NAVIGATE_NEXT_SIBLING; payload: { levelNumber: number; expectedCurrentNodeId: string | null } }
  | { type: typeof ACTIONS.NAVIGATE_PREV_SIBLING; payload: { levelNumber: number; expectedCurrentNodeId: string | null } }
  | { type: typeof ACTIONS.CLEAR_NAVIGATION_REQUEST };