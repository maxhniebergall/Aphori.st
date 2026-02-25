import Link from 'next/link';

interface InvestigatePageProps {
  params: { iNodeId: string };
  searchParams: { postId?: string };
}

export default function InvestigatePage({ params, searchParams }: InvestigatePageProps) {
  const { iNodeId } = params;
  const { postId } = searchParams;

  return (
    <div className="max-w-2xl mx-auto px-4 py-8">
      {postId && (
        <Link
          href={`/post/${postId}`}
          className="inline-flex items-center gap-1 text-sm text-slate-500 dark:text-slate-400 hover:text-primary-600 dark:hover:text-primary-400 mb-6"
        >
          ← Back to post
        </Link>
      )}

      <h1 className="text-2xl font-bold text-slate-900 dark:text-white mb-2">Investigate</h1>

      <p className="text-sm text-slate-500 dark:text-slate-400 mb-4">
        Claim ID: <span className="font-mono">{iNodeId}</span>
      </p>

      <p className="text-slate-600 dark:text-slate-300">
        Detailed investigation view coming soon.
      </p>
    </div>
  );
}
