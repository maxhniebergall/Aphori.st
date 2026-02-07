import { config } from './config';
import type {
  User,
  PostWithAuthor,
  ReplyWithAuthor,
  PaginatedResponse,
  FeedSortType,
  CreatePostInput,
  CreateReplyInput,
  CreateVoteInput,
  VoteValue,
  AgentIdentity,
} from '@chitin/shared';

// Argument types (V2 ontology)
export type ADUType = 'MajorClaim' | 'Supporting' | 'Opposing' | 'Evidence';
export type CanonicalClaimType = 'MajorClaim' | 'Supporting' | 'Opposing';

export interface ADU {
  id: string;
  source_type: 'post' | 'reply';
  source_id: string;
  adu_type: ADUType;
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
  target_adu_id: string | null;
  created_at: string;
}

export interface CanonicalClaim {
  id: string;
  representative_text: string;
  claim_type: CanonicalClaimType;
  adu_count: number;
  discussion_count: number;
  author_id: string | null;
  created_at: string;
  updated_at: string;
}

export interface SearchResult {
  query: string;
  results: (PostWithAuthor | ReplyWithAuthor)[];
}

export interface ADUCanonicalMapping {
  adu_id: string;
  canonical_claim_id: string;
  similarity_score: number;
  representative_text: string;
  adu_count: number;
}

export interface RelatedSource {
  source_type: 'post' | 'reply';
  source_id: string;
  title: string | null;
  content: string;
  author_id: string;
  author_display_name: string | null;
  author_user_type: string;
  created_at: string;
  score: number;
  adu_text: string;
  similarity_score: number;
}

type ApiResponse<T> =
  | { success: true; data: T }
  | { success: false; error: { error: string; message: string } };

interface RequestOptions {
  method?: string;
  body?: unknown;
  token?: string;
  revalidate?: number;
}

async function apiRequest<T>(
  endpoint: string,
  options: RequestOptions = {}
): Promise<T> {
  const { method = 'GET', body, token, revalidate } = options;

  const headers: HeadersInit = {
    'Content-Type': 'application/json',
  };

  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const fetchOptions: RequestInit & { next?: { revalidate?: number } } = {
    method,
    headers,
  };

  if (body) {
    fetchOptions.body = JSON.stringify(body);
  }

  if (revalidate !== undefined) {
    fetchOptions.next = { revalidate };
  }

  const response = await fetch(`${config.apiUrl}${endpoint}`, fetchOptions);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'API request failed');
  }

  // Handle both `{ success: true, data: T }` and `{ success: true, ...T }` response formats
  return data.data !== undefined ? data.data : data;
}

// Auth API
export const authApi = {
  async sendMagicLink(email: string, isSignup?: boolean): Promise<void> {
    await apiRequest('/api/v1/auth/send-magic-link', {
      method: 'POST',
      body: { email, isSignup },
    });
  },

  async verifyMagicLink(token: string): Promise<{ token: string; user: { id: string; email: string } }> {
    return apiRequest('/api/v1/auth/verify-magic-link', {
      method: 'POST',
      body: { token },
    });
  },

  async verifyToken(token: string): Promise<{ id: string; email: string; user_type: string }> {
    return apiRequest('/api/v1/auth/verify-token', {
      method: 'POST',
      body: { token },
    });
  },

  async checkUserId(id: string): Promise<{ available: boolean }> {
    return apiRequest(`/api/v1/auth/check-user-id/${encodeURIComponent(id)}`);
  },

  async signup(
    id: string,
    email: string,
    verificationToken?: string,
    displayName?: string
  ): Promise<{ token?: string; user?: { id: string; email: string } }> {
    return apiRequest('/api/v1/auth/signup', {
      method: 'POST',
      body: { id, email, verificationToken, displayName },
    });
  },

  async getMe(token: string): Promise<{ id: string; email: string; display_name: string | null; user_type: string }> {
    return apiRequest('/api/v1/auth/me', { token });
  },
};

// Posts API
export const postsApi = {
  async getFeed(
    sort: FeedSortType = 'hot',
    limit = 25,
    cursor?: string,
    token?: string
  ): Promise<PaginatedResponse<PostWithAuthor>> {
    const params = new URLSearchParams({
      sort,
      limit: limit.toString(),
      ...(cursor && { cursor }),
    });
    return apiRequest(`/api/v1/feed?${params}`, { token, revalidate: 60 });
  },

  async getPost(id: string, token?: string): Promise<PostWithAuthor> {
    return apiRequest(`/api/v1/posts/${id}`, { token, revalidate: 60 });
  },

  async createPost(input: CreatePostInput, token: string): Promise<PostWithAuthor> {
    return apiRequest('/api/v1/posts', {
      method: 'POST',
      body: input,
      token,
    });
  },

  async deletePost(id: string, token: string): Promise<void> {
    await apiRequest(`/api/v1/posts/${id}`, {
      method: 'DELETE',
      token,
    });
  },

  async getReplies(
    postId: string,
    limit = 50,
    cursor?: string,
    token?: string
  ): Promise<PaginatedResponse<ReplyWithAuthor>> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(cursor && { cursor }),
    });
    return apiRequest(`/api/v1/posts/${postId}/replies?${params}`, { token, revalidate: 30 });
  },

  async createReply(
    postId: string,
    input: CreateReplyInput,
    token: string
  ): Promise<ReplyWithAuthor> {
    return apiRequest(`/api/v1/posts/${postId}/replies`, {
      method: 'POST',
      body: input,
      token,
    });
  },
};

// Votes API
export const votesApi = {
  async vote(input: CreateVoteInput, token: string): Promise<void> {
    await apiRequest('/api/v1/votes', {
      method: 'POST',
      body: input,
      token,
    });
  },

  async removeVote(targetType: 'post' | 'reply', targetId: string, token: string): Promise<void> {
    await apiRequest('/api/v1/votes', {
      method: 'DELETE',
      body: { target_type: targetType, target_id: targetId },
      token,
    });
  },

  async getUserVotes(
    targetType: 'post' | 'reply',
    targetIds: string[],
    token: string
  ): Promise<Record<string, VoteValue>> {
    const params = new URLSearchParams({
      target_type: targetType,
      target_ids: targetIds.join(','),
    });
    return apiRequest(`/api/v1/votes/user?${params}`, { token });
  },
};

// Arguments API
export const argumentApi = {
  async getPostADUs(postId: string, token?: string): Promise<ADU[]> {
    return apiRequest(`/api/v1/arguments/posts/${postId}/adus`, { token });
  },

  async getCanonicalClaim(claimId: string, token?: string): Promise<CanonicalClaim> {
    return apiRequest(`/api/v1/arguments/claims/${claimId}`, { token });
  },

  async semanticSearch(query: string, limit = 20, token?: string): Promise<SearchResult> {
    const params = new URLSearchParams({
      q: query,
      type: 'semantic',
      limit: limit.toString(),
    });
    return apiRequest(`/api/v1/search?${params}`, { token });
  },

  async getReplyADUs(replyId: string, token?: string): Promise<ADU[]> {
    return apiRequest(`/api/v1/arguments/replies/${replyId}/adus`, { token });
  },

  async getCanonicalMappingsForReply(replyId: string, token?: string): Promise<ADUCanonicalMapping[]> {
    return apiRequest(`/api/v1/arguments/replies/${replyId}/canonical-mappings`, { token });
  },

  async getCanonicalMappingsForPost(postId: string, token?: string): Promise<ADUCanonicalMapping[]> {
    return apiRequest(`/api/v1/arguments/posts/${postId}/canonical-mappings`, { token });
  },

  async getRelatedPostsForCanonicalClaim(
    canonicalClaimId: string,
    limit = 10,
    excludeSourceId?: string,
    token?: string
  ): Promise<RelatedSource[]> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(excludeSourceId && { exclude_source_id: excludeSourceId }),
    });
    return apiRequest(`/api/v1/arguments/canonical-claims/${canonicalClaimId}/related-posts?${params}`, { token });
  },
};

// Agents API
export const agentsApi = {
  async registerAgent(
    input: {
      id: string;
      name: string;
      description?: string;
      model_info?: string;
    },
    token: string
  ): Promise<AgentIdentity> {
    return apiRequest('/api/v1/agents/register', {
      method: 'POST',
      body: input,
      token,
    });
  },

  async getMyAgents(token: string): Promise<AgentIdentity[]> {
    return apiRequest('/api/v1/agents/my', { token });
  },

  async getAgent(agentId: string, token?: string): Promise<AgentIdentity> {
    return apiRequest(`/api/v1/agents/${encodeURIComponent(agentId)}`, { token });
  },

  async updateAgent(
    agentId: string,
    updates: {
      name?: string;
      description?: string | null;
      model_info?: string | null;
    },
    token: string
  ): Promise<AgentIdentity> {
    return apiRequest(`/api/v1/agents/${encodeURIComponent(agentId)}`, {
      method: 'PATCH',
      body: updates,
      token,
    });
  },

  async deleteAgent(agentId: string, token: string): Promise<void> {
    await apiRequest(`/api/v1/agents/${encodeURIComponent(agentId)}`, {
      method: 'DELETE',
      token,
    });
  },

  async generateToken(
    agentId: string,
    token: string
  ): Promise<{ token: string; expires_at: string; jti: string }> {
    return apiRequest(`/api/v1/agents/${encodeURIComponent(agentId)}/token`, {
      method: 'POST',
      token,
    });
  },

  async revokeTokens(
    agentId: string,
    token: string
  ): Promise<{ revoked_count: number }> {
    return apiRequest(`/api/v1/agents/${encodeURIComponent(agentId)}/revoke-tokens`, {
      method: 'POST',
      token,
    });
  },
};

// Users API
export interface UserProfile extends User {
  agent: {
    description: string | null;
    model_info: string | null;
    owner_id: string;
  } | null;
}

export const usersApi = {
  async getUser(id: string): Promise<UserProfile> {
    return apiRequest(`/api/v1/users/${encodeURIComponent(id)}`);
  },

  async getUserPosts(
    id: string,
    limit = 25,
    cursor?: string
  ): Promise<PaginatedResponse<PostWithAuthor>> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(cursor && { cursor }),
    });
    return apiRequest(`/api/v1/users/${encodeURIComponent(id)}/posts?${params}`);
  },

  async getUserReplies(
    id: string,
    limit = 25,
    cursor?: string
  ): Promise<PaginatedResponse<ReplyWithAuthor>> {
    const params = new URLSearchParams({
      limit: limit.toString(),
      ...(cursor && { cursor }),
    });
    return apiRequest(`/api/v1/users/${encodeURIComponent(id)}/replies?${params}`);
  },
};
