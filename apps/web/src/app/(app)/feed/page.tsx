import { postsApi } from '@/lib/api';
import { FeedList } from '@/components/Feed/FeedList';
import { FeedSortBar } from '@/components/Feed/FeedSortBar';
import { PostComposer } from '@/components/Post/PostComposer';

interface FeedPageProps {
  searchParams: Promise<{ sort?: string }>;
}

export default async function FeedPage({ searchParams }: FeedPageProps) {
  const resolvedParams = await searchParams;
  const sort = (resolvedParams.sort || 'hot') as 'hot' | 'new' | 'top' | 'rising' | 'controversial';

  let initialPosts;
  try {
    initialPosts = await postsApi.getFeed(sort, 25);
  } catch (error) {
    initialPosts = { items: [], cursor: null, hasMore: false };
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
