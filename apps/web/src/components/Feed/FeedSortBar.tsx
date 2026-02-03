'use client';

import Link from 'next/link';
import { useSearchParams } from 'next/navigation';

interface FeedSortBarProps {
  currentSort: string;
}

const SORT_OPTIONS = [
  { key: 'hot', label: 'Hot' },
  { key: 'new', label: 'New' },
  { key: 'top', label: 'Top' },
] as const;

export function FeedSortBar({ currentSort }: FeedSortBarProps) {
  return (
    <div className="flex items-center gap-1 px-4 py-3 border-b border-slate-200 dark:border-slate-700">
      {SORT_OPTIONS.map((option) => (
        <Link
          key={option.key}
          href={`/?sort=${option.key}`}
          className={`px-3 py-1.5 text-sm font-medium rounded-lg transition-colors ${
            currentSort === option.key
              ? 'bg-primary-100 dark:bg-primary-900 text-primary-700 dark:text-primary-300'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-700'
          }`}
        >
          {option.label}
        </Link>
      ))}
    </div>
  );
}
