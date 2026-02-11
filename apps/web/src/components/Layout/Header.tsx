'use client';

import { useState, FormEvent } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';

function SearchIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={className ?? 'w-4 h-4'}
    >
      <path
        fillRule="evenodd"
        d="M9 3.5a5.5 5.5 0 100 11 5.5 5.5 0 000-11zM2 9a7 7 0 1112.452 4.391l3.328 3.329a.75.75 0 11-1.06 1.06l-3.329-3.328A7 7 0 012 9z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Header() {
  const { user, isLoading, isAuthenticated } = useAuth();
  const router = useRouter();
  const [query, setQuery] = useState('');

  function handleSearch(e: FormEvent) {
    e.preventDefault();
    const trimmed = query.trim();
    if (trimmed) {
      router.push(`/search?q=${encodeURIComponent(trimmed)}`);
    }
  }

  return (
    <header className="sticky top-0 z-50 w-full border-b border-slate-200 dark:border-slate-800 bg-white/80 dark:bg-slate-900/80 backdrop-blur">
      <div className="max-w-4xl mx-auto px-4 h-16 flex items-center gap-4">
        <Link
          href="/"
          className="text-xl font-bold text-primary-600 dark:text-primary-400 hover:text-primary-700 dark:hover:text-primary-300 shrink-0"
        >
          Aphorist
        </Link>

        {/* Search bar — full input on sm+, icon link on mobile */}
        <div className="flex-1 flex justify-center min-w-0">
          <form
            onSubmit={handleSearch}
            className="hidden sm:flex items-center w-full max-w-md bg-slate-100 dark:bg-slate-800 rounded-lg border border-slate-200 dark:border-slate-700 focus-within:border-primary-500 focus-within:ring-1 focus-within:ring-primary-500 transition-colors"
          >
            <SearchIcon className="w-4 h-4 ml-3 text-slate-400 shrink-0" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search..."
              className="flex-1 bg-transparent px-2 py-2 text-sm text-slate-900 dark:text-white placeholder-slate-400 outline-none"
            />
          </form>
          <Link
            href="/search"
            className="sm:hidden p-2 text-slate-500 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            aria-label="Search"
          >
            <SearchIcon className="w-5 h-5" />
          </Link>
        </div>

        {/* Right: account link */}
        <nav className="flex items-center shrink-0">
          {isLoading ? (
            <div className="h-8 w-20 bg-slate-200 dark:bg-slate-700 rounded animate-pulse" />
          ) : isAuthenticated ? (
            <Link
              href={`/user/${user?.id}`}
              className="text-sm text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white"
            >
              My Account
            </Link>
          ) : (
            <Link
              href="/auth/verify"
              className="px-4 py-2 text-sm font-medium text-white bg-primary-600 rounded-lg hover:bg-primary-700 transition-colors"
            >
              Sign in
            </Link>
          )}
        </nav>
      </div>
    </header>
  );
}
