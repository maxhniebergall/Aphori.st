'use client';

import { useState, useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import { postsApi } from '@/lib/api';
import { useAuth } from '@/contexts/AuthContext';
import { ReplyCard } from './ReplyCard';
import type { QuoteData } from '@/components/Shared/TextSelectionQuote';
import type { ReplyWithAuthor, PaginatedResponse, VoteValue, V3Subgraph, SyntheticReplyWithAuthor } from '@chitin/shared';
import Link from 'next/link';

type SortOption = 'top' | 'new' | 'controversial' | 'evidence';

const sortLabels: Record<SortOption, string> = {
  top: 'Top',
  new: 'New',
  controversial: 'Controversial',
  evidence: 'Evidence',
};

interface ReplyThreadProps {
  postId: string;
  initialReplies: PaginatedResponse<ReplyWithAuthor>;
  userVotes?: Record<string, VoteValue>;
  onQuote?: (quote: QuoteData) => void;
  onSearch?: (text: string) => void;
  v3Subgraph?: V3Subgraph;
}

export function ReplyThread({ postId, initialReplies, userVotes, onQuote, onSearch, v3Subgraph }: ReplyThreadProps) {
  const { token } = useAuth();
  const [sort, setSort] = useState<SortOption>('evidence');
  const [collapsedReplies, setCollapsedReplies] = useState<Set<string>>(new Set());

  const toggleCollapse = (id: string) =>
    setCollapsedReplies(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  // Evidence sort: fetch pre-nested SyntheticThreadResponse
  const { data: evidenceData } = useQuery({
    queryKey: ['replies', postId, 'evidence'],
    queryFn: () => postsApi.getEvidenceReplies(postId, 25, undefined, token ?? undefined),
    enabled: sort === 'evidence',
    staleTime: 30 * 1000,
  });

  // Standard sorts: fetch flat list and build tree client-side
  const { data: standardData } = useQuery({
    queryKey: ['replies', postId, sort],
    queryFn: () => postsApi.getReplies(postId, 100, undefined, token ?? undefined, sort as 'top' | 'new' | 'controversial'),
    enabled: sort !== 'evidence',
    initialData: sort === 'top' ? initialReplies : undefined,
    staleTime: 30 * 1000,
  });

  const effectiveSort = useMemo(() => {
    if (sort === 'evidence' && evidenceData?.fallback) return 'top';
    return sort;
  }, [sort, evidenceData]);

  const standardReplies = useMemo(() => standardData?.items ?? [], [standardData]);

  // Build a children map for O(n) tree construction (standard sorts only)
  const { rootReplies, childrenMap } = useMemo(() => {
    const replies = effectiveSort !== 'evidence' ? standardReplies : [];
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

    const sortFn = getSortFn(effectiveSort === 'evidence' ? 'top' : effectiveSort);
    roots.sort(sortFn);
    for (const children of map.values()) {
      children.sort(sortFn);
    }

    return { rootReplies: roots, childrenMap: map };
  }, [standardReplies, effectiveSort]);

  const syntheticItems = useMemo(
    () => (effectiveSort === 'evidence' ? (evidenceData?.items ?? []) : []),
    [effectiveSort, evidenceData]
  );

  const isEmpty = effectiveSort === 'evidence'
    ? syntheticItems.length === 0
    : rootReplies.length === 0;

  if (isEmpty && sort !== 'evidence') {
    return (
      <div className="p-8 text-center text-slate-500 dark:text-slate-400">
        No replies yet. Be the first to reply!
      </div>
    );
  }

  // Recursive renderer for IBA synthetic replies (pre-nested)
  const renderSyntheticReply = (reply: SyntheticReplyWithAuthor, depth: number = 0) => {
    return (
      <div key={reply.id}>
        <ReplyCard
          reply={reply}
          postId={postId}
          depth={depth}
          userVote={userVotes?.[reply.id]}
          onQuote={onQuote}
          onSearch={onSearch}
          v3Subgraph={v3Subgraph}
          direction={reply.direction}
          hasReplies={reply.hasReplies}
          continueThreadUrl={reply.continueThreadUrl}
        />
        {reply.continueThreadUrl ? (
          <div className="ml-8 pl-4 py-2">
            <Link
              href={reply.continueThreadUrl}
              className="text-xs text-primary-600 dark:text-primary-400 hover:underline"
            >
              Continue thread →
            </Link>
          </div>
        ) : reply.children.length > 0 ? (
          <div className="relative ml-4 pl-4">
            <button
              className="absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center group"
              onClick={() => toggleCollapse(reply.id)}
              aria-label={collapsedReplies.has(reply.id) ? 'Expand thread' : 'Collapse thread'}
            >
              <span className="w-0.5 h-full bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-400 dark:group-hover:bg-slate-500 transition-colors" />
            </button>
            {!collapsedReplies.has(reply.id) && reply.children.map(child => renderSyntheticReply(child, depth + 1))}
            {collapsedReplies.has(reply.id) && (
              <div className="py-1 text-[10px] text-slate-400 dark:text-slate-500">
                {reply.children.length} replies hidden
              </div>
            )}
          </div>
        ) : null}
      </div>
    );
  };

  // Standard renderer for non-evidence sorts
  const renderReply = (reply: ReplyWithAuthor, depth: number = 0) => {
    const children = childrenMap.get(reply.id) ?? [];
    const isCollapsed = collapsedReplies.has(reply.id);

    return (
      <div key={reply.id}>
        <ReplyCard
          reply={reply}
          postId={postId}
          depth={depth}
          userVote={userVotes?.[reply.id]}
          onQuote={onQuote}
          onSearch={onSearch}
          v3Subgraph={v3Subgraph}
        />
        {children.length > 0 && (
          <div className="relative ml-4 pl-4">
            <button
              className="absolute left-0 top-0 bottom-0 w-4 flex items-center justify-center group"
              onClick={() => toggleCollapse(reply.id)}
              aria-label={isCollapsed ? 'Expand thread' : 'Collapse thread'}
            >
              <span className="w-0.5 h-full bg-slate-200 dark:bg-slate-700 group-hover:bg-slate-400 dark:group-hover:bg-slate-500 transition-colors" />
            </button>
            {!isCollapsed && children.map((child) => renderReply(child, depth + 1))}
            {isCollapsed && (
              <div className="py-1 text-[10px] text-slate-400 dark:text-slate-500">
                {children.length} replies hidden
              </div>
            )}
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

      {isEmpty ? (
        <div className="p-8 text-center text-slate-500 dark:text-slate-400">
          No replies yet. Be the first to reply!
        </div>
      ) : (
        <div className="divide-y divide-slate-200 dark:divide-slate-700">
          {effectiveSort === 'evidence'
            ? syntheticItems.map((reply) => renderSyntheticReply(reply as SyntheticReplyWithAuthor))
            : rootReplies.map((reply) => renderReply(reply))
          }
        </div>
      )}
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
    default:
      return (a, b) => b.score - a.score || new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
  }
}
