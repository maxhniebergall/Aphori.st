'use client';

import { useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { BenchmarkData } from '@/lib/types';
import { buildColumnAssignments, saveSession, loadSession, saveBenchmarkData } from '@/lib/store';

export default function HomePage() {
  const router = useRouter();
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleFile = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setLoading(true);
      setError(null);
      try {
        const text = await file.text();
        const data = JSON.parse(text) as BenchmarkData;
        if (!data.threads || !Array.isArray(data.threads)) {
          throw new Error('Invalid benchmark file: missing "threads" array');
        }
        saveBenchmarkData(data);
        // Always ensure a valid session exists with assignments for all threads
        const existingSession = loadSession();
        const hasValidSession = existingSession &&
          data.threads.every(t => t.test_id in existingSession.columnAssignments);
        if (!hasValidSession) {
          const assignments = buildColumnAssignments(data);
          saveSession({ ratings: existingSession?.ratings ?? {}, columnAssignments: assignments });
        }
        router.push('/rate/0');
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to parse file');
        setLoading(false);
      }
    },
    [router]
  );

  return (
    <main className="min-h-screen bg-gray-50 flex flex-col items-center justify-center p-8">
      <div className="max-w-lg w-full bg-white rounded-2xl shadow-md p-8 space-y-6">
        <h1 className="text-2xl font-bold text-gray-900">ArgMining Human Evaluation</h1>
        <p className="text-gray-600 text-sm">
          Load a <code className="bg-gray-100 px-1 rounded">benchmark-results.json</code> file
          produced by <code className="bg-gray-100 px-1 rounded">runBenchmark.ts</code> to begin
          blind A/B evaluation of the two ranking algorithms.
        </p>

        <label className="block">
          <span className="text-sm font-medium text-gray-700">Select benchmark file</span>
          <input
            type="file"
            accept=".json"
            onChange={handleFile}
            disabled={loading}
            className="mt-2 block w-full text-sm text-gray-500 file:mr-4 file:py-2 file:px-4
                       file:rounded-lg file:border-0 file:text-sm file:font-semibold
                       file:bg-blue-50 file:text-blue-700 hover:file:bg-blue-100 cursor-pointer"
          />
        </label>

        {loading && <p className="text-sm text-blue-600">Loading…</p>}
        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="text-xs text-gray-400 border-t pt-4">
          <p>Ratings are stored in localStorage and exported from the Results page.</p>
        </div>
      </div>
    </main>
  );
}
