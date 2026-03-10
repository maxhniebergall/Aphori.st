/**
 * Worker thread entry point for benchmark ranking computation.
 * Receives graph data via parentPort messages, computes all algorithms, returns results.
 */

import { parentPort } from 'node:worker_threads';
import { computeAllRankings } from './benchmarkCompute.js';
import type { BenchmarkComputeInput } from './benchmarkCompute.js';

if (!parentPort) {
  throw new Error('This module must be run as a worker thread');
}

parentPort.on('message', (msg: { id: number; input: BenchmarkComputeInput }) => {
  try {
    const result = computeAllRankings(msg.input);
    parentPort!.postMessage({ id: msg.id, result });
  } catch (err) {
    parentPort!.postMessage({ id: msg.id, error: err instanceof Error ? err.message : String(err) });
  }
});
