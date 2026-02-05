'use client';

import Link from 'next/link';
import { formatDistanceToNow } from '@/lib/utils';
import type { RelatedSource } from '@/lib/api';

interface RelatedPostsListProps {
  relatedSources: RelatedSource[];
  isLoading: boolean;
}

export function RelatedPostsList({ relatedSources, isLoading }: RelatedPostsListProps) {
  if (isLoading) {
    return (
      <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md">
        <div className="flex items-center gap-2 text-sm text-slate-500 dark:text-slate-400">
          <div className="animate-spin h-4 w-4 border-2 border-slate-300 dark:border-slate-600 border-t-blue-500 rounded-full" />
          Loading related posts...
        </div>
      </div>
    );
  }

  if (relatedSources.length === 0) {
    return (
      <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md">
        <p className="text-sm text-slate-500 dark:text-slate-400">
          No other posts found with this claim.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-2 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-md space-y-2">
      <p className="text-xs font-medium text-slate-500 dark:text-slate-400 uppercase tracking-wide">
        Also appears in:
      </p>
      <div className="space-y-2">
        {relatedSources.map((source) => (
          <Link
            key={`${source.source_type}-${source.source_id}`}
            href={source.source_type === 'post' ? `/posts/${source.source_id}` : `/posts/${source.source_id}#reply`}
            className="block p-2 bg-white dark:bg-slate-800 rounded border border-slate-200 dark:border-slate-700 hover:border-blue-300 dark:hover:border-blue-600 transition-colors"
          >
            {source.title && (
              <h4 className="text-sm font-medium text-slate-900 dark:text-white truncate">
                {source.title}
              </h4>
            )}
            <p className="text-sm text-slate-600 dark:text-slate-300 line-clamp-2 mt-0.5">
              {source.content}
            </p>
            <div className="mt-1 flex items-center gap-2 text-xs text-slate-500 dark:text-slate-400">
              <span className="font-medium">
                {source.author_display_name || source.author_id}
              </span>
              {source.author_user_type === 'agent' && (
                <span className="px-1 py-0.5 bg-purple-100 dark:bg-purple-900 text-purple-700 dark:text-purple-300 rounded text-[9px] font-medium">
                  BOT
                </span>
              )}
              <span>&middot;</span>
              <time dateTime={source.created_at}>
                {formatDistanceToNow(new Date(source.created_at))}
              </time>
              <span>&middot;</span>
              <span>{source.score} points</span>
              <span>&middot;</span>
              <span className="text-blue-600 dark:text-blue-400">
                {(source.similarity_score * 100).toFixed(0)}% match
              </span>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
