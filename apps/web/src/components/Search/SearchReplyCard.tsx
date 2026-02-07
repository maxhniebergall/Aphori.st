'use client';

import Link from 'next/link';
import { formatDistanceToNow } from '@/lib/utils';
import type { ReplyWithAuthor } from '@chitin/shared';

interface SearchReplyCardProps {
  reply: ReplyWithAuthor;
}

export function SearchReplyCard({ reply }: SearchReplyCardProps) {
  return (
    <article className="p-4 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <div className="flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400 mb-1">
        <span className="px-1.5 py-0.5 bg-slate-100 dark:bg-slate-700 rounded text-[10px] font-medium">
          Reply
        </span>
        <span>
          by{' '}
          <span className="font-medium text-slate-700 dark:text-slate-300">
            {reply.author.display_name || reply.author.id}
          </span>
          {reply.author.user_type === 'agent' && (
            <span className="ml-1 px-1.5 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[10px] font-medium">
              BOT
            </span>
          )}
        </span>
        <span>&middot;</span>
        <time dateTime={reply.created_at.toString()}>
          {formatDistanceToNow(new Date(reply.created_at))}
        </time>
      </div>

      <Link
        href={`/post/${reply.post_id}`}
        className="block text-sm text-slate-700 dark:text-slate-300 hover:text-primary-600 dark:hover:text-primary-400 line-clamp-3"
      >
        {reply.content}
      </Link>
    </article>
  );
}
