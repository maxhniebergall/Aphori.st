'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { useQuery } from '@tanstack/react-query';
import { argumentApi } from '@/lib/api';
import { PostCard } from '@/components/Post/PostCard';
import { SearchReplyCard } from './SearchReplyCard';
import type { PostWithAuthor, ReplyWithAuthor } from '@chitin/shared';
import type { MatchedINode } from '@/lib/api';

function isPost(item: PostWithAuthor | ReplyWithAuthor): item is PostWithAuthor {
  return 'title' in item;
}

const EPISTEMIC_LABELS: Record<string, string> = {
  FACT: 'fact',
  VALUE: 'value',
  POLICY: 'policy',
};

function InvestigateCard({ match }: { match: MatchedINode }) {
  const displayText = match.rewritten_text ?? match.content;
  const epistemicLabel = EPISTEMIC_LABELS[match.epistemic_type] ?? match.epistemic_type.toLowerCase();
  const investigateHref = match.source_post_id
    ? `/investigate/${match.i_node_id}?postId=${match.source_post_id}`
    : `/investigate/${match.i_node_id}`;

  return (
    <div className="mb-4 rounded-lg border-2 border-primary-400 dark:border-primary-500 bg-primary-50 dark:bg-primary-950/30 shadow-sm overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2 bg-primary-100 dark:bg-primary-900/40 border-b border-primary-200 dark:border-primary-800">
        <svg className="w-4 h-4 text-primary-600 dark:text-primary-400 flex-shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
        </svg>
        <span className="text-xs font-semibold text-primary-700 dark:text-primary-300 uppercase tracking-wide">
          Close match in the argument network
        </span>
        <span className="ml-auto text-xs text-primary-500 dark:text-primary-400">
          {Math.round(match.similarity * 100)}% similar
        </span>
      </div>

      <div className="p-4">
        <p className="text-sm text-slate-800 dark:text-slate-200 leading-relaxed">
          &ldquo;{displayText}&rdquo;
        </p>

        <div className="mt-3 flex items-center gap-3 flex-wrap">
          <span className="text-[10px] font-semibold uppercase tracking-wider px-2 py-0.5 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
            {epistemicLabel}
          </span>
          {match.source_title && (
            <span className="text-xs text-slate-500 dark:text-slate-400 truncate max-w-[200px]">
              from &ldquo;{match.source_title}&rdquo;
              {match.source_author && <> by {match.source_author}</>}
            </span>
          )}
          <Link
            href={investigateHref}
            className="ml-auto text-xs font-medium text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 flex items-center gap-1"
          >
            Investigate
            <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M13 7l5 5m0 0l-5 5m5-5H6" />
            </svg>
          </Link>
        </div>
      </div>
    </div>
  );
}

interface SearchPageClientProps {
  initialQuery: string;
}

export function SearchPageClient({ initialQuery }: SearchPageClientProps) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [inputValue, setInputValue] = useState(initialQuery);
  const query = searchParams.get('q') || '';

  useEffect(() => {
    setInputValue(query);
  }, [query]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ['search', query],
    queryFn: () => argumentApi.semanticSearch(query, 20),
    enabled: query.length > 0,
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = inputValue.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  };

  return (
    <div className="space-y-4">
      <form onSubmit={handleSubmit}>
        <div className="flex gap-2">
          <input
            type="text"
            value={inputValue}
            onChange={(e) => setInputValue(e.target.value)}
            placeholder="Search for arguments, claims, or topics..."
            className="flex-1 px-4 py-2 text-sm bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg focus:border-primary-500 dark:focus:border-primary-400 focus:outline-none"
          />
          <button
            type="submit"
            disabled={!inputValue.trim()}
            className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            Search
          </button>
        </div>
      </form>

      {isLoading && (
        <div className="py-8 text-center text-slate-500 dark:text-slate-400">
          Searching...
        </div>
      )}

      {isError && (
        <div className="py-8 text-center text-red-500">
          Search failed. Please try again.
        </div>
      )}

      {data && data.matched_inode && (
        <InvestigateCard match={data.matched_inode} />
      )}

      {data && data.results.length === 0 && !data.matched_inode && (
        <div className="py-8 text-center text-slate-500 dark:text-slate-400">
          No results found for &ldquo;{query}&rdquo;
        </div>
      )}

      {data && data.results.length === 0 && data.matched_inode && (
        <div className="py-4 text-center text-slate-500 dark:text-slate-400 text-sm">
          No other results found for &ldquo;{query}&rdquo;
        </div>
      )}

      {data && data.results.length > 0 && (
        <div className="bg-white dark:bg-slate-800 rounded-lg shadow-sm border border-slate-200 dark:border-slate-700 divide-y divide-slate-200 dark:divide-slate-700">
          {data.results.map((result) =>
            isPost(result) ? (
              <PostCard key={`post-${result.id}`} post={result} />
            ) : (
              <SearchReplyCard key={`reply-${result.id}`} reply={result} />
            )
          )}
        </div>
      )}
    </div>
  );
}
