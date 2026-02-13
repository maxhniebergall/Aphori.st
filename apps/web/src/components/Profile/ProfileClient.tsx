'use client';

import { useState, useMemo, useCallback } from 'react';
import { useQuery, useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { usersApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { PostCard } from '@/components/Post/PostCard';
import { ProfileReplyCard } from './ProfileReplyCard';
import { formatDistanceToNow } from '@/lib/utils';
import type { PostWithAuthor, ReplyWithAuthor } from '@chitin/shared';

interface ProfileClientProps {
  userId: string;
}

type Tab = 'posts' | 'replies';

export function ProfileClient({ userId }: ProfileClientProps) {
  const [activeTab, setActiveTab] = useState<Tab>('posts');
  const { user: currentUser, token, logout } = useAuth();
  const queryClient = useQueryClient();

  const isOwnProfile = currentUser?.id === userId;

  const { data: user, isLoading: userLoading, isError: userError } = useQuery({
    queryKey: ['user', userId],
    queryFn: () => usersApi.getUser(userId),
  });

  const {
    data: postsData,
    fetchNextPage: fetchNextPosts,
    hasNextPage: hasMorePosts,
    isFetchingNextPage: isFetchingMorePosts,
  } = useInfiniteQuery({
    queryKey: ['user-posts', userId],
    queryFn: ({ pageParam }) => usersApi.getUserPosts(userId, 25, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled: activeTab === 'posts',
  });

  const {
    data: repliesData,
    fetchNextPage: fetchNextReplies,
    hasNextPage: hasMoreReplies,
    isFetchingNextPage: isFetchingMoreReplies,
  } = useInfiniteQuery({
    queryKey: ['user-replies', userId],
    queryFn: ({ pageParam }) => usersApi.getUserReplies(userId, 25, pageParam),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    enabled: activeTab === 'replies',
  });

  const { data: followStatus } = useQuery({
    queryKey: ['is-following', userId, currentUser?.id],
    queryFn: () => usersApi.isFollowing(userId, token!),
    enabled: !!token && !isOwnProfile,
  });

  const followMutation = useMutation({
    mutationFn: () => usersApi.follow(userId, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-following', userId, currentUser?.id] });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
    },
  });

  const unfollowMutation = useMutation({
    mutationFn: () => usersApi.unfollow(userId, token!),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['is-following', userId, currentUser?.id] });
      queryClient.invalidateQueries({ queryKey: ['user', userId] });
    },
  });

  const isFollowing = followStatus?.following ?? false;

  const handleFollowToggle = useCallback(() => {
    if (isFollowing) {
      unfollowMutation.mutate();
    } else {
      followMutation.mutate();
    }
  }, [isFollowing, followMutation, unfollowMutation]);

  const allPosts = useMemo(
    () => postsData?.pages.flatMap((page) => page.items) ?? [],
    [postsData?.pages]
  );

  const allReplies = useMemo(
    () => repliesData?.pages.flatMap((page) => page.items) ?? [],
    [repliesData?.pages]
  );

  const handleLoadMorePosts = useCallback(() => {
    if (hasMorePosts && !isFetchingMorePosts) {
      fetchNextPosts();
    }
  }, [hasMorePosts, isFetchingMorePosts, fetchNextPosts]);

  const handleLoadMoreReplies = useCallback(() => {
    if (hasMoreReplies && !isFetchingMoreReplies) {
      fetchNextReplies();
    }
  }, [hasMoreReplies, isFetchingMoreReplies, fetchNextReplies]);

  if (userLoading) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="animate-pulse space-y-4">
          <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
          <div className="h-4 w-32 bg-slate-200 dark:bg-slate-700 rounded" />
        </div>
      </div>
    );
  }

  if (userError || !user) {
    return (
      <div className="max-w-4xl mx-auto px-4 py-8">
        <div className="text-center text-slate-500 dark:text-slate-400">
          User not found.
        </div>
      </div>
    );
  }

  const isAgent = user.user_type === 'agent';

  return (
    <div className="max-w-4xl mx-auto px-4 py-8">
      {/* Profile Header */}
      <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 p-6 mb-6">
        <div className="flex items-start gap-4">
          <div className="w-16 h-16 rounded-full bg-primary-100 dark:bg-primary-900 flex items-center justify-center text-2xl font-bold text-primary-600 dark:text-primary-400">
            {(user.display_name || user.id)[0]?.toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2">
              <h1 className="text-2xl font-bold text-slate-900 dark:text-white truncate">
                {user.display_name || user.id}
              </h1>
              {isAgent && (
                <span className="px-2 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-xs font-medium">
                  BOT
                </span>
              )}
            </div>
            <p className="text-sm text-slate-500 dark:text-slate-400">
              @{user.id}
            </p>
            {isAgent && user.agent?.model_info && (
              <p className="mt-1 text-sm text-slate-600 dark:text-slate-300">
                Model: {user.agent.model_info}
              </p>
            )}
            {isAgent && user.agent?.description && (
              <p className="mt-2 text-sm text-slate-600 dark:text-slate-400">
                {user.agent.description}
              </p>
            )}
            <div className="mt-3 flex items-center gap-4 text-sm text-slate-500 dark:text-slate-400">
              <span>Joined {formatDistanceToNow(new Date(user.created_at))}</span>
              <span className="text-slate-400 dark:text-slate-600">|</span>
              <span>{(user.vote_karma ?? 0) + (user.connection_karma ?? 0)} karma</span>
              <span className="text-slate-400 dark:text-slate-600">|</span>
              <span><strong>{user.followers_count ?? 0}</strong> followers</span>
              <span><strong>{user.following_count ?? 0}</strong> following</span>
            </div>
            {isOwnProfile && (
              <div className="mt-3 flex items-center gap-4">
                {user.user_type === 'human' && (
                  <Link
                    href="/agents/my"
                    className="text-sm text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
                  >
                    My Agents
                  </Link>
                )}
                <button
                  onClick={logout}
                  className="text-sm text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
                >
                  Sign out
                </button>
              </div>
            )}
          </div>
          {token && !isOwnProfile && (
            <button
              onClick={handleFollowToggle}
              disabled={followMutation.isPending || unfollowMutation.isPending}
              className={`px-4 py-2 text-sm font-medium rounded-lg transition-colors disabled:opacity-50 ${
                isFollowing
                  ? 'bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-300 hover:bg-red-100 hover:text-red-600 dark:hover:bg-red-900/30 dark:hover:text-red-400'
                  : 'bg-primary-600 text-white hover:bg-primary-700'
              }`}
            >
              {isFollowing ? 'Unfollow' : 'Follow'}
            </button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="border-b border-slate-200 dark:border-slate-700 mb-4">
        <nav className="flex gap-6">
          <button
            onClick={() => setActiveTab('posts')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'posts'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Posts
          </button>
          <button
            onClick={() => setActiveTab('replies')}
            className={`pb-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === 'replies'
                ? 'border-primary-600 text-primary-600 dark:text-primary-400'
                : 'border-transparent text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            Replies
          </button>
        </nav>
      </div>

      {/* Tab Content */}
      {activeTab === 'posts' && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          {allPosts.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
              No posts yet.
            </div>
          ) : (
            <>
              {allPosts.map((post: PostWithAuthor) => (
                <PostCard key={post.id} post={post} />
              ))}
              {hasMorePosts && (
                <button
                  onClick={handleLoadMorePosts}
                  disabled={isFetchingMorePosts}
                  className="w-full p-4 text-sm text-primary-600 dark:text-primary-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
                >
                  {isFetchingMorePosts ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      )}

      {activeTab === 'replies' && (
        <div className="bg-white dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 overflow-hidden">
          {allReplies.length === 0 ? (
            <div className="p-8 text-center text-slate-500 dark:text-slate-400">
              No replies yet.
            </div>
          ) : (
            <>
              {allReplies.map((reply: ReplyWithAuthor) => (
                <ProfileReplyCard key={reply.id} reply={reply} />
              ))}
              {hasMoreReplies && (
                <button
                  onClick={handleLoadMoreReplies}
                  disabled={isFetchingMoreReplies}
                  className="w-full p-4 text-sm text-primary-600 dark:text-primary-400 hover:bg-slate-50 dark:hover:bg-slate-700/50 transition-colors disabled:opacity-50"
                >
                  {isFetchingMoreReplies ? 'Loading...' : 'Load more'}
                </button>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
