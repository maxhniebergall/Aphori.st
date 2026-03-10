/**
 * Local benchmark computation pool.
 *
 * Worker threads are incompatible with tsx's ESM hooks in Node 23,
 * so computation runs in the main thread. The key optimization is
 * that the API only does lightweight DB queries (graph_only=1) while
 * all CPU-bound ranking computation happens here — no more overloading
 * the API server.
 */

import { computeAllRankings } from '../services/experiments/benchmarkCompute.js';
import type { BenchmarkComputeInput, BenchmarkComputeOutput } from '../services/experiments/benchmarkCompute.js';

export function initPool(_size: number): void {
  // No-op: computation runs in main thread
}

export async function computeInWorker(input: BenchmarkComputeInput): Promise<BenchmarkComputeOutput> {
  return computeAllRankings(input);
}

export async function destroyPool(): Promise<void> {
  // No-op
}
