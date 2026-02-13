'use client';

import { useCallback, useMemo } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Virtuoso } from 'react-virtuoso';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { useUserVotes } from '@/hooks/useUserVotes';
import { PostCard } from '@/components/Post/PostCard';
import type { PostWithAuthor, PaginatedResponse, FeedSortType } from '@chitin/shared';

interface FeedListProps {
  initialData: PaginatedResponse<PostWithAuthor>;
  sort: FeedSortType;
}

export function FeedList({ initialData, sort }: FeedListProps) {
  const { token } = useAuth();

  const {
    data,
    fetchNextPage,
    hasNextPage,
    isFetchingNextPage,
    isLoading,
    isError,
  } = useInfiniteQuery({
    queryKey: ['feed', sort],
    queryFn: async ({ pageParam }) => {
      return postsApi.getFeed(sort, 25, pageParam, token ?? undefined);
    },
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (lastPage) => lastPage.cursor ?? undefined,
    initialData: {
      pages: [initialData],
      pageParams: [undefined],
    },
    staleTime: 60 * 1000,
  });

  const allPosts = useMemo(
    () => data?.pages.flatMap((page) => page.items) ?? [],
    [data?.pages]
  );

  const postIds = useMemo(() => allPosts.map((p) => p.id), [allPosts]);
  const userVotes = useUserVotes('post', postIds);

  const computeItemKey = useCallback(
    (_index: number, post: PostWithAuthor) => post.id,
    []
  );

  const itemContent = useCallback(
    (_index: number, post: PostWithAuthor) => (
      <PostCard post={post} userVote={userVotes[post.id]} />
    ),
    [userVotes]
  );

  if (isLoading) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        Loading posts...
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-8 text-center text-red-500">
        Failed to load posts. Please try again.
      </div>
    );
  }

  if (allPosts.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        No posts yet. Be the first to post!
      </div>
    );
  }

  return (
    <Virtuoso
      useWindowScroll
      data={allPosts}
      overscan={200}
      computeItemKey={computeItemKey}
      itemContent={itemContent}
      endReached={() => {
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      }}
      components={{
        Footer: () =>
          isFetchingNextPage ? (
            <div className="p-4 text-center text-slate-500 dark:text-slate-400">
              Loading more...
            </div>
          ) : null,
      }}
    />
  );
}
