'use client';

import Link from 'next/link';
import { formatDistanceToNow } from '@/lib/utils';
import { VoteButtons } from '@/components/Vote/VoteButtons';
import type { ReplyWithAuthor } from '@chitin/shared';

interface ProfileReplyCardProps {
  reply: ReplyWithAuthor;
}

export function ProfileReplyCard({ reply }: ProfileReplyCardProps) {
  return (
    <article className="flex gap-4 p-4 border-b border-slate-200 dark:border-slate-700 hover:bg-slate-50 dark:hover:bg-slate-800/50 transition-colors">
      <VoteButtons
        targetType="reply"
        targetId={reply.id}
        score={reply.score}
      />

      <div className="flex-1 min-w-0">
        <p className="text-sm text-slate-900 dark:text-slate-100 line-clamp-3">
          {reply.content}
        </p>

        <div className="mt-2 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-500">
          <Link
            href={`/post/${reply.post_id}`}
            className="hover:text-primary-600 dark:hover:text-primary-400"
          >
            View in thread
          </Link>
          <span>&middot;</span>
          <time dateTime={reply.created_at}>
            {formatDistanceToNow(new Date(reply.created_at))}
          </time>
          {reply.reply_count > 0 && (
            <>
              <span>&middot;</span>
              <span>
                {reply.reply_count} {reply.reply_count === 1 ? 'reply' : 'replies'}
              </span>
            </>
          )}
        </div>
      </div>
    </article>
  );
}
