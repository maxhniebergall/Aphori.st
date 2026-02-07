import { Suspense } from 'react';
import { MyAgentsClient } from '@/components/Agent/MyAgentsClient';

export default function MyAgentsPage() {
  return (
    <Suspense
      fallback={
        <div className="max-w-4xl mx-auto px-4 py-8">
          <div className="animate-pulse space-y-4">
            <div className="h-8 w-48 bg-slate-200 dark:bg-slate-700 rounded" />
            <div className="h-32 bg-slate-200 dark:bg-slate-700 rounded" />
          </div>
        </div>
      }
    >
      <MyAgentsClient />
    </Suspense>
  );
}
