import { Suspense } from 'react';
import { SearchPageClient } from '@/components/Search/SearchPageClient';

interface SearchPageProps {
  searchParams: { q?: string };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = searchParams;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Search</h1>
      <Suspense fallback={<div className="py-8 text-center text-slate-500 dark:text-slate-400">Loading...</div>}>
        <SearchPageClient initialQuery={q || ''} />
      </Suspense>
    </div>
  );
}
