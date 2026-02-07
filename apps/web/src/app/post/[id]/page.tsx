import { notFound } from 'next/navigation';
import { postsApi } from '@/lib/api';
import { PostPageClient } from '@/components/Post/PostPageClient';

interface PostPageProps {
  params: { id: string };
}

export default async function PostPage({ params }: PostPageProps) {
  const { id } = await params;

  let post;
  let replies;

  try {
    [post, replies] = await Promise.all([
      postsApi.getPost(id),
      postsApi.getReplies(id),
    ]);
  } catch (error) {
    notFound();
  }

  return <PostPageClient post={post} replies={replies} />;
}
