import { config } from './config';
import type {
  PostWithAuthor,
  ReplyWithAuthor,
  PaginatedResponse,
  FeedSortType,
  CreatePostInput,
  CreateReplyInput,
  CreateVoteInput,
  VoteValue,
} from '@chitin/shared';

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

  const fetchOptions: RequestInit = {
    method,
    headers,
    ...(body && { body: JSON.stringify(body) }),
    ...(revalidate !== undefined && { next: { revalidate } }),
  };

  const response = await fetch(`${config.apiUrl}${endpoint}`, fetchOptions);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.message || 'API request failed');
  }

  return data.data;
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
