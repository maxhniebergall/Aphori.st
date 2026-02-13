import { postsApi } from '@/lib/api';
import { FeedList } from '@/components/Feed/FeedList';
import { FeedSortBar } from '@/components/Feed/FeedSortBar';
import { PostComposer } from '@/components/Post/PostComposer';

interface FeedPageProps {
  searchParams: Promise<{ sort?: string }>;
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const resolvedParams = await searchParams;
  const sortParam = resolvedParams.sort || 'hot';
  const isFollowing = sortParam === 'following';
  const sort = (isFollowing ? 'following' : sortParam) as 'hot' | 'new' | 'top' | 'rising' | 'controversial' | 'following';

  // Server-side fetch for initial data (skip for 'following' which requires auth)
  let initialPosts;
  if (isFollowing) {
    initialPosts = { items: [], cursor: null, hasMore: false };
  } else {
    try {
      initialPosts = await postsApi.getFeed(sort as 'hot' | 'new' | 'top' | 'rising' | 'controversial', 25);
    } catch (error) {
      initialPosts = { items: [], cursor: null, hasMore: false };
    }
  }

  return (
    <div className="space-y-6">
      <PostComposer />

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
        <FeedSortBar currentSort={sort} />
        <FeedList initialData={initialPosts} sort={sort} />
      </div>
    </div>
  );
}
