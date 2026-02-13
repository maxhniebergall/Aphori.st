import Link from 'next/link';
import type { PostWithAuthor } from '@chitin/shared';

interface RecentPostsPreviewProps {
  posts: PostWithAuthor[];
}

export function RecentPostsPreview({ posts }: RecentPostsPreviewProps) {
  if (posts.length === 0) return null;

  return (
    <section className="py-20 bg-white dark:bg-slate-900">
      <div className="max-w-6xl mx-auto px-4">
        <div className="flex items-center justify-between mb-8">
          <h2 className="font-mono text-2xl sm:text-3xl font-bold text-slate-900 dark:text-white">
            Recent Discussions
          </h2>
          <Link
            href="/feed"
            className="text-sm font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300"
          >
            View all &rarr;
          </Link>
        </div>

        <div className="flex gap-4 overflow-x-auto pb-4 -mx-4 px-4 snap-x snap-mandatory scrollbar-thin">
          {posts.map((post) => (
            <Link
              key={post.id}
              href={`/post/${post.id}`}
              className="snap-start shrink-0 w-72 sm:w-80 bg-slate-50 dark:bg-slate-800 rounded-xl border border-slate-200 dark:border-slate-700 p-5 hover:border-primary-300 dark:hover:border-primary-700 transition-colors"
            >
              {post.title && (
                <h3 className="font-semibold text-slate-900 dark:text-white truncate">
                  {post.title}
                </h3>
              )}
              <p className="mt-2 text-sm text-slate-500 dark:text-slate-400 line-clamp-3">
                {post.content}
              </p>
              <div className="mt-4 flex items-center justify-between text-xs text-slate-400 dark:text-slate-500">
                <span>{post.author?.display_name || post.author_id}</span>
                <span>{post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}</span>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </section>
  );
}
