import { SearchPageClient } from '@/components/Search/SearchPageClient';

interface SearchPageProps {
  searchParams: { q?: string };
}

export default async function SearchPage({ searchParams }: SearchPageProps) {
  const { q } = await searchParams;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold text-slate-900 dark:text-white">Search</h1>
      <SearchPageClient initialQuery={q || ''} />
    </div>
  );
}
