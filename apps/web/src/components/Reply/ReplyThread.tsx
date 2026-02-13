'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ReplyCard } from './ReplyCard';
import type { QuoteData } from '@/components/Shared/TextSelectionQuote';
import type { ReplyWithAuthor, PaginatedResponse, VoteValue } from '@chitin/shared';

type SortOption = 'top' | 'new' | 'controversial';

const sortLabels: Record<SortOption, string> = {
  top: 'Top',
  new: 'New',
  controversial: 'Controversial',
};

interface ReplyThreadProps {
  postId: string;
  initialReplies: PaginatedResponse<ReplyWithAuthor>;
  userVotes?: Record<string, VoteValue>;
  onQuote?: (quote: QuoteData) => void;
  onSearch?: (text: string) => void;
}

export function ReplyThread({ postId, initialReplies, userVotes, onQuote, onSearch }: ReplyThreadProps) {
  const { token } = useAuth();
  const [sort, setSort] = useState<SortOption>('top');

  const { data } = useQuery({
    queryKey: ['replies', postId, sort],
    queryFn: () => postsApi.getReplies(postId, 100, undefined, token ?? undefined, sort),
    initialData: sort === 'top' ? initialReplies : undefined,
    staleTime: 30 * 1000,
  });

  const replies = data?.items ?? [];

  // Build a children map for O(n) tree construction
  const { rootReplies, childrenMap } = useMemo(() => {
    const map = new Map<string, ReplyWithAuthor[]>();
    const roots: ReplyWithAuthor[] = [];

    for (const reply of replies) {
      if (!reply.parent_reply_id) {
        roots.push(reply);
      } else {
        const siblings = map.get(reply.parent_reply_id);
        if (siblings) {
          siblings.push(reply);
        } else {
          map.set(reply.parent_reply_id, [reply]);
        }
      }
    }

    // Sort children to match selected sort order
    const sortFn = getSortFn(sort);
    roots.sort(sortFn);
    for (const children of map.values()) {
      children.sort(sortFn);
    }

    return { rootReplies: roots, childrenMap: map };
  }, [replies, sort]);

  if (replies.length === 0) {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        No replies yet. Be the first to reply!
      </div>
    );
  }

  const renderReply = (reply: ReplyWithAuthor, depth: number = 0) => {
    const children = childrenMap.get(reply.id) ?? [];

    return (
      <div key={reply.id}>
        <ReplyCard reply={reply} postId={postId} depth={depth} userVote={userVotes?.[reply.id]} onQuote={onQuote} onSearch={onSearch} />
        {children.length > 0 && (
          <div className="ml-4 border-l-2 border-slate-200 dark:border-slate-700">
            {children.map((child) => renderReply(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div>
      <div className="flex items-center gap-1 px-4 py-2 border-b border-slate-200 dark:border-slate-700">
        {(Object.keys(sortLabels) as SortOption[]).map((option) => (
          <button
            key={option}
            onClick={() => setSort(option)}
            className={`
              px-3 py-1 text-xs font-medium rounded-full transition-colors
              ${sort === option
                ? 'bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900'
                : 'text-slate-500 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 hover:text-slate-700 dark:hover:text-slate-300'
              }
            `}
          >
            {sortLabels[option]}
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-200 dark:divide-slate-700">
        {rootReplies.map((reply) => renderReply(reply))}
      </div>
    </div>
  );
}

function getSortFn(sort: SortOption): (a: ReplyWithAuthor, b: ReplyWithAuthor) => number {
  switch (sort) {
    case 'top':
      return (a, b) => b.score - a.score || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    case 'new':
      return (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    case 'controversial':
      return (a, b) => {
        // Controversial: most total votes but near-zero net score
        const aVotes = ('vote_count' in a ? (a as ReplyWithAuthor & { vote_count: number }).vote_count : 0);
        const bVotes = ('vote_count' in b ? (b as ReplyWithAuthor & { vote_count: number }).vote_count : 0);
        if (bVotes !== aVotes) return bVotes - aVotes;
        if (Math.abs(a.score) !== Math.abs(b.score)) return Math.abs(a.score) - Math.abs(b.score);
        return new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
      };
  }
}
