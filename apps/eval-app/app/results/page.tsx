'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import type { BenchmarkData, EvalSession } from '@/lib/types';
import { loadSession, exportRatings, loadBenchmarkData } from '@/lib/store';

function MetricRow({ label, a, b }: { label: string; a: number; b: number }) {
  return (
    <tr className="border-t">
      <td className="py-2 pr-4 text-sm text-gray-600">{label}</td>
      <td className={`py-2 px-4 text-sm font-mono text-center ${a > b ? 'text-green-600 font-bold' : 'text-gray-700'}`}>
        {a.toFixed(4)}
      </td>
      <td className={`py-2 px-4 text-sm font-mono text-center ${b > a ? 'text-green-600 font-bold' : 'text-gray-700'}`}>
        {b.toFixed(4)}
      </td>
    </tr>
  );
}

export default function ResultsPage() {
  const router = useRouter();
  const [data, setData] = useState<BenchmarkData | null>(null);
  const [session, setSession] = useState<EvalSession | null>(null);

  useEffect(() => {
    const data = loadBenchmarkData();
    if (!data) { router.replace('/'); return; }
    setData(data);
    setSession(loadSession());
  }, [router]);

  if (!data || !session) return <div className="p-8 text-gray-500">Loading…</div>;

  const ratings = Object.values(session.ratings);
  const total = data.threads.length;
  const rated = ratings.length;

  // Human preference counts
  // rating < 0: left better; > 0: right better; = 0: tie
  // We map back to Alg_A vs Alg_B
  let humanPrefA = 0, humanPrefB = 0, humanTie = 0;
  for (const r of ratings) {
    const leftIsA = r.leftIsAlgA;
    if (r.rating < 0) { leftIsA ? humanPrefA++ : humanPrefB++; }
    else if (r.rating > 0) { leftIsA ? humanPrefB++ : humanPrefA++; }
    else humanTie++;
  }

  const handleExport = () => {
    const json = exportRatings(session);
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'eval-ratings.json';
    a.click();
    URL.revokeObjectURL(url);
  };

  const s = data.summary;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <h1 className="text-2xl font-bold text-gray-900">Evaluation Results</h1>
          <button
            onClick={() => router.push('/rate/0')}
            className="text-sm text-blue-600 hover:underline"
          >
            ← Back to rating
          </button>
        </div>

        {/* Progress */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-sm text-gray-600">
            Rated <span className="font-semibold">{rated}</span> / {total} threads
          </p>
          <div className="w-full h-2 bg-gray-200 rounded-full mt-2">
            <div className="h-2 bg-blue-500 rounded-full" style={{ width: `${(rated / total) * 100}%` }} />
          </div>
        </div>

        {/* Algorithmic metrics */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <h2 className="text-base font-semibold text-gray-800 mb-3">Algorithmic Metrics (from benchmark)</h2>
          <table className="w-full">
            <thead>
              <tr>
                <th className="text-left text-xs text-gray-400 pb-2">Metric</th>
                <th className="text-center text-xs text-gray-400 pb-2">Alg A (EvidenceRank)</th>
                <th className="text-center text-xs text-gray-400 pb-2">Alg B (WeightedBipolar)</th>
              </tr>
            </thead>
            <tbody>
              <MetricRow label="Delta-MRR" a={s.Alg_A.mrr} b={s.Alg_B.mrr} />
              <MetricRow label="nDCG@5" a={s.Alg_A.ndcg5} b={s.Alg_B.ndcg5} />
              <MetricRow label="nDCG@10" a={s.Alg_A.ndcg10} b={s.Alg_B.ndcg10} />
              <MetricRow label="Win rate" a={s.Alg_A.win_rate} b={s.Alg_B.win_rate} />
            </tbody>
          </table>
        </div>

        {/* Human ratings */}
        {rated > 0 && (
          <div className="bg-white rounded-xl shadow-sm p-5">
            <h2 className="text-base font-semibold text-gray-800 mb-3">Human Preferences ({rated} ratings)</h2>
            <div className="flex gap-6">
              <div className="text-center">
                <p className="text-3xl font-bold text-blue-600">{humanPrefA}</p>
                <p className="text-xs text-gray-500 mt-1">Prefer Alg A</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-gray-400">{humanTie}</p>
                <p className="text-xs text-gray-500 mt-1">Tie</p>
              </div>
              <div className="text-center">
                <p className="text-3xl font-bold text-orange-600">{humanPrefB}</p>
                <p className="text-xs text-gray-500 mt-1">Prefer Alg B</p>
              </div>
            </div>
            <p className="text-xs text-gray-400 mt-4">
              Note: Columns were randomized per thread — rater was blind to which algorithm was which.
            </p>
          </div>
        )}

        {/* Export */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <button
            onClick={handleExport}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700"
          >
            Export ratings (eval-ratings.json)
          </button>
          <p className="text-xs text-gray-400 mt-2">
            Exports all ratings as JSON for statistical analysis.
          </p>
        </div>
      </div>
    </main>
  );
}
