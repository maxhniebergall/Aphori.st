'use client';

import type { BenchmarkData, EvalSession, Rating, ThreadRating } from './types';

const STORAGE_KEY = 'argmining_eval_session';
const DATA_KEY = 'argmining_benchmark_data';

export function saveBenchmarkData(data: BenchmarkData): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(DATA_KEY, JSON.stringify(data));
  sessionStorage.setItem('benchmark_data', JSON.stringify(data));
}

export function loadBenchmarkData(): BenchmarkData | null {
  if (typeof window === 'undefined') return null;
  const raw = sessionStorage.getItem('benchmark_data') ?? localStorage.getItem(DATA_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as BenchmarkData;
  } catch {
    return null;
  }
}

function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) & 0xffffffff;
    return (s >>> 0) / 0xffffffff;
  };
}

export function buildColumnAssignments(data: BenchmarkData): Record<string, boolean> {
  const assignments: Record<string, boolean> = {};
  for (const thread of data.threads) {
    // Seeded by thread index to be reproducible per session
    const seed = thread.test_id.split('').reduce((a, c) => a + c.charCodeAt(0), 0);
    const rng = seededRandom(seed);
    assignments[thread.test_id] = rng() > 0.5; // true = left is Alg_A
  }
  return assignments;
}

export function loadSession(): EvalSession | null {
  if (typeof window === 'undefined') return null;
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as EvalSession;
  } catch {
    return null;
  }
}

export function saveSession(session: EvalSession): void {
  if (typeof window === 'undefined') return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export function addRating(
  session: EvalSession,
  testId: string,
  rating: Rating,
  leftIsAlgA: boolean
): EvalSession {
  const r: ThreadRating = {
    test_id: testId,
    rating,
    leftIsAlgA,
    timestamp: new Date().toISOString(),
  };
  return {
    ...session,
    ratings: { ...session.ratings, [testId]: r },
  };
}

export function exportRatings(session: EvalSession): string {
  const rows = Object.values(session.ratings);
  return JSON.stringify(rows, null, 2);
}
