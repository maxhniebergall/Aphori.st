export interface BackendPostData {
  id: string;
  authorId: string;
  content: string;
  createdAt: string; // ISO 8601 Timestamp String
  replyCount: number;
}

export interface BackendReplyDataQuote {
  text: string;
  sourceId: string; // ID of the post/reply where the quote originated
  selectionRange: {
    start: number;
    end: number;
  };
}

export interface BackendReplyData {
  id: string;
  authorId: string;
  text: string; // Content for reply
  parentId: string;
  parentType: "post" | "reply";
  rootPostId: string;
  quote: BackendReplyDataQuote; // The quote being replied to
  createdAt: string; // ISO 8601 Timestamp String
}

// Represents a single item in the 'results' array from the backend /api/search/vector
export interface RawSearchResultItem {
  id: string;
  type: 'post' | 'reply';
  score: number;
  data: BackendPostData | BackendReplyData;
}

// Represents the entire API response from /api/search/vector
export interface VectorSearchApiResponse {
  success: boolean;
  results: RawSearchResultItem[];
  pagination?: {
    offset: number;
    limit: number;
    total: number;
    hasMore: boolean;
  };
  error?: string;
}

// Transformed types for frontend display

// Represents the quote a reply is made to, for display purposes
export interface DisplayReplyTargetQuote {
  text: string;
  sourceId: string; // ID of the post/reply where the quote originated
}

export interface BaseDisplaySearchResult {
  id: string;
  type: 'post' | 'reply';
  score: number;
  content: string; // For post: data.content. For reply: data.text
  authorId: string; // from data.authorId
  createdAt: string; // ISO 8601 string from backend. Conversion to Date/timestamp can occur in component.
}

export interface PostDisplaySearchResult extends BaseDisplaySearchResult {
  type: 'post';
  replyCount?: number; // from data.replyCount, might be useful for display
}

export interface ReplyDisplaySearchResult extends BaseDisplaySearchResult {
  type: 'reply';
  rootPostId: string; // from data.rootPostId (this is the `postId` for navigation)
  // parentId: string;   // from data.parentId
  // parentType: 'post' | 'reply'; // from data.parentType
  replyToQuote?: DisplayReplyTargetQuote; // from data.quote
}

export type DisplaySearchResultItem = PostDisplaySearchResult | ReplyDisplaySearchResult; 