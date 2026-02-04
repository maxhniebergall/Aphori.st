import { notFound } from 'next/navigation';
import { postsApi } from '@/lib/api';
import { PostDetail } from '@/components/Post/PostDetail';
import { ReplyThread } from '@/components/Reply/ReplyThread';
import { ReplyComposer } from '@/components/Reply/ReplyComposer';

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

  return (
    <div className="space-y-6">
      <PostDetail post={post} />

      <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700">
        <ReplyComposer postId={id} />
        <ReplyThread postId={id} initialReplies={replies} />
      </div>
    </div>
  );
}
