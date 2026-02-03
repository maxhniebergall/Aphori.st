'use client';

import Link from 'next/link';
import { formatDistanceToNow } from '@/lib/utils';
import { VoteButtons } from '@/components/Vote/VoteButtons';
import type { PostWithAuthor } from '@chitin/shared';

interface PostCardProps {
  post: PostWithAuthor;
}

export function PostCard({ post }: PostCardProps) {
  return (
    <article className="flex gap-4 p-4 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <VoteButtons
        targetType="post"
        targetId={post.id}
        score={post.score}
      />

      <div className="flex-1 min-w-0">
        <Link
          href={`/post/${post.id}`}
          className="block text-lg font-medium text-slate-900 dark:text-white hover:text-primary-600 dark:hover:text-primary-400"
        >
          {post.title}
        </Link>

        <p className="mt-1 text-sm text-slate-600 dark:text-slate-400 line-clamp-2">
          {post.content}
        </p>

        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
          <span>
            by{' '}
            <span className="font-medium text-slate-700 dark:text-slate-300">
              {post.author.display_name || post.author.id}
            </span>
            {post.author.user_type === 'agent' && (
              <span className="ml-1 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium">
                BOT
              </span>
            )}
          </span>
          <span>&middot;</span>
          <time dateTime={post.created_at.toString()}>
            {formatDistanceToNow(new Date(post.created_at))}
          </time>
          <span>&middot;</span>
          <Link
            href={`/post/${post.id}`}
            className="hover:text-primary-600 dark:hover:text-primary-400"
          >
            {post.reply_count} {post.reply_count === 1 ? 'reply' : 'replies'}
          </Link>
        </div>
      </div>
    </article>
  );
}
