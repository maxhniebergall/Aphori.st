'use client';

import { use, useEffect, useState, useCallback } from 'react';
import { useRouter } from 'next/navigation';
import type { BenchmarkData, EvalSession, Rating, RankedResult } from '@/lib/types';
import { loadSession, saveSession, addRating, loadBenchmarkData } from '@/lib/store';

const DISPLAY_LIMIT = 10;

const LIKERT_OPTIONS: { value: Rating; label: string }[] = [
  { value: -2, label: 'Left much better' },
  { value: -1, label: 'Left better' },
  { value:  0, label: 'About the same' },
  { value:  1, label: 'Right better' },
  { value:  2, label: 'Right much better' },
];

function CommentCard({ item, index }: { item: RankedResult; index: number }) {
  const indent = Math.min(item.depth ?? 0, 3) * 16;
  return (
    <li className="bg-gray-50 rounded-lg overflow-hidden text-sm" style={{ marginLeft: `${indent}px` }}>
      {item.parent_text && (
        <div className="px-3 pt-2 pb-1 border-b border-gray-200 text-xs text-gray-400 italic">
          ↳ {item.parent_text}
        </div>
      )}
      <div className="px-3 py-2 text-gray-700">
        <span className="inline-block w-6 text-gray-400 font-mono shrink-0">{index + 1}.</span>
        {item.text}
      </div>
    </li>
  );
}

function RankingColumn({ title, items }: { title: string; items: RankedResult[] }) {
  return (
    <div className="flex-1 min-w-0">
      <h2 className="text-base font-semibold text-gray-800 mb-3">{title}</h2>
      <ol className="space-y-2">
        {items.slice(0, DISPLAY_LIMIT).map((item, i) => (
          <CommentCard key={item.id} item={item} index={i} />
        ))}
      </ol>
    </div>
  );
}

export default function RatePage({ params }: { params: Promise<{ threadIndex: string }> }) {
  const { threadIndex } = use(params);
  const idx = parseInt(threadIndex, 10);
  const router = useRouter();

  const [data, setData] = useState<BenchmarkData | null>(null);
  const [session, setSession] = useState<EvalSession | null>(null);
  const [selected, setSelected] = useState<Rating | null>(null);

  useEffect(() => {
    const data = loadBenchmarkData();
    if (!data) { router.replace('/'); return; }
    setData(data);
    setSession(loadSession());
  }, [router]);

  const thread = data?.threads[idx];
  const total  = data?.threads.length ?? 0;
  const leftIsAlgA = session?.columnAssignments[thread?.test_id ?? ''] ?? true;

  useEffect(() => {
    if (session && thread) {
      const existing = session.ratings[thread.test_id];
      setSelected(existing ? existing.rating : null);
    }
  }, [session, thread]);

  const handleNext = useCallback(() => {
    if (selected === null || !session || !thread) return;
    const updated = addRating(session, thread.test_id, selected, leftIsAlgA);
    saveSession(updated);
    setSession(updated);
    router.push(idx + 1 >= total ? '/results' : `/rate/${idx + 1}`);
  }, [selected, session, thread, leftIsAlgA, idx, total, router]);

  if (!data || !session) return <div className="p-8 text-gray-500">Loading…</div>;
  if (!thread) { router.replace('/results'); return null; }

  const leftResults  = leftIsAlgA ? thread.algorithms.Alg_A : thread.algorithms.Alg_B;
  const rightResults = leftIsAlgA ? thread.algorithms.Alg_B : thread.algorithms.Alg_A;
  const rated = Object.keys(session.ratings).length;

  return (
    <main className="min-h-screen bg-gray-50 p-6">
      <div className="max-w-6xl mx-auto space-y-5">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-gray-900">Thread {idx + 1} / {total}</h1>
            <div className="w-64 h-2 bg-gray-200 rounded-full mt-1">
              <div
                className="h-2 bg-blue-500 rounded-full transition-all"
                style={{ width: `${(rated / total) * 100}%` }}
              />
            </div>
          </div>
          <button onClick={() => router.push('/results')} className="text-sm text-gray-500 hover:text-gray-700 underline">
            View results
          </button>
        </div>

        {/* Original argument — full text */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-2">Original argument (OP)</p>
          <p className="text-sm text-gray-700 whitespace-pre-wrap">{thread.parent_argument}</p>
        </div>

        {/* A/B columns */}
        <div className="bg-white rounded-xl shadow-sm p-5">
          <p className="text-xs font-semibold text-gray-400 uppercase tracking-wide mb-4">
            Top {DISPLAY_LIMIT} ranked replies — which ordering is more persuasive / argumentatively sound?
          </p>
          <div className="flex gap-6">
            <RankingColumn title="Algorithm Left" items={leftResults} />
            <div className="w-px bg-gray-200 shrink-0" />
            <RankingColumn title="Algorithm Right" items={rightResults} />
          </div>
        </div>

        {/* Likert rating */}
        <div className="bg-white rounded-xl shadow-sm p-5 space-y-3">
          <p className="text-sm font-medium text-gray-700">Which side ranks the comments better?</p>
          <div className="flex flex-wrap gap-2">
            {LIKERT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSelected(opt.value)}
                className={`px-4 py-2 rounded-lg text-sm border transition-colors
                  ${selected === opt.value
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-gray-700 border-gray-300 hover:border-blue-400'}`}
              >
                {opt.label}
              </button>
            ))}
          </div>
          <div className="flex gap-3 pt-2">
            {idx > 0 && (
              <button
                onClick={() => router.push(`/rate/${idx - 1}`)}
                className="px-4 py-2 rounded-lg border border-gray-300 text-sm text-gray-600 hover:bg-gray-50"
              >
                ← Back
              </button>
            )}
            <button
              onClick={handleNext}
              disabled={selected === null}
              className="px-6 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium disabled:opacity-40 hover:bg-blue-700 transition-colors"
            >
              {idx + 1 >= total ? 'Finish' : 'Next →'}
            </button>
          </div>
        </div>
      </div>
    </main>
  );
}
