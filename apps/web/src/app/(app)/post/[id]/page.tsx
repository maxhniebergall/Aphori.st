import { notFound } from 'next/navigation';
import { postsApi } from '@/lib/api';
import { PostPageClient } from '@/components/Post/PostPageClient';

interface PostPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ sort?: string }>;
}

const VALID_SERVER_SORTS = ['top', 'new', 'controversial'] as const;
type ServerSort = typeof VALID_SERVER_SORTS[number];

export default async function PostPage({ params, searchParams }: PostPageProps) {
  const { id } = await params;
  const { sort: sortParam } = await searchParams;
  const serverSort: ServerSort = VALID_SERVER_SORTS.includes(sortParam as ServerSort)
    ? (sortParam as ServerSort)
    : 'top';

  let post;
  let replies;

  try {
    [post, replies] = await Promise.all([
      postsApi.getPost(id),
      postsApi.getReplies(id, 50, undefined, undefined, serverSort),
    ]);
  } catch (error) {
    notFound();
  }

  return <PostPageClient post={post} replies={replies} initialSort={sortParam} />;
}
