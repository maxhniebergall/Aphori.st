'use client';

import { useInfiniteQuery } from '@tanstack/react-query';
import { Virtuoso } from 'react-virtuoso';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
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

  const allPosts = data?.pages.flatMap((page) => page.items) ?? [];

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
      endReached={() => {
        if (hasNextPage && !isFetchingNextPage) {
          fetchNextPage();
        }
      }}
      itemContent={(index, post) => (
        <PostCard key={post.id} post={post} />
      )}
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
