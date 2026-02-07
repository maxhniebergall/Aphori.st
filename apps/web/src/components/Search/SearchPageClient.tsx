'use client';

import { useState, useEffect } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { argumentApi } from '@/lib/api';
import { PostCard } from '@/components/Post/PostCard';
import { SearchReplyCard } from './SearchReplyCard';
import type { PostWithAuthor, ReplyWithAuthor } from '@chitin/shared';

function isPost(item: PostWithAuthor | ReplyWithAuthor): item is PostWithAuthor {
  return 'title' in item;
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

      {data && data.results.length === 0 && (
        <div className="py-8 text-center text-slate-500 dark:text-slate-400">
          No results found for &ldquo;{query}&rdquo;
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
