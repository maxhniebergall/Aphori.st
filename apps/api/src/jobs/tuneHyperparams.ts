#!/usr/bin/env node
/**
 * Offline hyperparameter tuning for EvidenceRank and QuadraticEnergy strategies.
 *
 * Reads cached raw graph + LLM scores from a benchmark results JSON (produced by
 * runBenchmark.ts with ?raw=1) and grid-searches hyperparameters without re-running
 * the expensive LLM scoring step.
 *
 * Usage:
 *   cd apps/api && npx tsx src/jobs/tuneHyperparams.ts \
 *     --input /tmp/benchmark-results-v3.json
 */

import fs from 'fs';
import { parseArgs } from 'util';
import { EvidenceRankStrategy } from '../services/experiments/EvidenceRankStrategy.js';
import { QuadraticEnergyStrategy } from '../services/experiments/QuadraticEnergyStrategy.js';
import { DampedModularStrategy } from '../services/experiments/DampedModularStrategy.js';
import type { GraphNode, GraphEdge, RankedResult } from '../services/experiments/RankingStrategy.js';

const { values: args } = parseArgs({
  options: {
    input: { type: 'string' },
  },
  strict: false,
});

if (!args['input']) {
  console.error('Error: --input <path> is required');
  process.exit(1);
}

// ── Types ──────────────────────────────────────────────────────────────────

interface RawNode {
  id: string;
  vote_score: number;
  llm_score: number;
  source_type: string;
  source_id: string;
}

interface RawEdge {
  from_node_id: string;
  to_node_id: string;
  direction: string;
  confidence: number;
}

interface RawThreadData {
  focalNodeId: string;
  nodes: RawNode[];
  edges: RawEdge[];
  nodeTargets: Array<[string, string[]]>;
}

interface ThreadResult {
  test_id: string;
  delta_reply_ids: string[];
  raw_data?: RawThreadData;
}

// ── Graph construction ─────────────────────────────────────────────────────

function sigmoid(x: number): number {
  return 1 / (1 + Math.exp(-x));
}

function makeNodesER(rawNodes: RawNode[], useVote: boolean): GraphNode[] {
  return rawNodes.map(n => ({
    id: n.id,
    text: '',
    basic_strength: sigmoid(n.vote_score),
    vote_score: useVote ? Math.max(1, n.vote_score) : n.llm_score,
    user_karma: 0,
  }));
}

function makeNodesQE(rawNodes: RawNode[], useVote: boolean): GraphNode[] {
  return rawNodes.map(n => ({
    id: n.id,
    text: '',
    basic_strength: 0.5,
    vote_score: useVote ? Math.max(1, n.vote_score) : Math.round(n.llm_score * 100),
    user_karma: 0,
  }));
}

function makeNodesDM(rawNodes: RawNode[], useVote: boolean): GraphNode[] {
  return rawNodes.map(n => ({
    id: n.id,
    text: '',
    basic_strength: useVote ? sigmoid(Math.max(1, n.vote_score)) : n.llm_score,
    vote_score: 0,
    user_karma: 0,
  }));
}

function makeEdges(rawEdges: RawEdge[]): GraphEdge[] {
  return rawEdges.map(e => ({
    from_node_id: e.from_node_id,
    to_node_id: e.to_node_id,
    direction: e.direction as 'SUPPORT' | 'ATTACK',
    confidence: e.confidence,
  }));
}

// ── Aggregate to reply level (local copy with bridgeCoeff param) ───────────

function aggregateToReplyLevel(
  rankResults: RankedResult[],
  rawNodes: RawNode[],
  rawEdges: RawEdge[],
  nodeTargets: Map<string, string[]>,
  bridgeCoeff: number
): Array<{ id: string; rank: number }> {
  const degreeCentrality = new Map<string, number>();
  for (const e of rawEdges) {
    degreeCentrality.set(e.from_node_id, (degreeCentrality.get(e.from_node_id) ?? 0) + 1);
  }

  const nodeById = new Map<string, RawNode>();
  for (const n of rawNodes) nodeById.set(n.id, n);

  const replyScores = new Map<string, number>();
  for (const r of rankResults) {
    const node = nodeById.get(r.id);
    if (!node || node.source_type !== 'reply') continue;
    const dc = degreeCentrality.get(r.id) ?? 1;
    const nodeScore = r.score * Math.log(1 + dc);
    if (!replyScores.has(node.source_id) || nodeScore > replyScores.get(node.source_id)!) {
      replyScores.set(node.source_id, nodeScore);
    }
  }

  if (bridgeCoeff > 0) {
    const replyTargets = new Map<string, Set<string>>();
    for (const [iNodeId, conclusionIds] of nodeTargets) {
      const node = nodeById.get(iNodeId);
      if (!node || node.source_type !== 'reply') continue;
      const targets = replyTargets.get(node.source_id) ?? new Set<string>();
      for (const cId of conclusionIds) targets.add(cId);
      replyTargets.set(node.source_id, targets);
    }
    for (const [replyId, baseScore] of replyScores) {
      const uniqueTargets = replyTargets.get(replyId)?.size ?? 1;
      const bridgeMultiplier = 1.0 + bridgeCoeff * (uniqueTargets - 1);
      replyScores.set(replyId, baseScore * bridgeMultiplier);
    }
  }

  const sorted = [...replyScores.entries()].sort((a, b) => b[1] - a[1]);
  return sorted.map(([id], idx) => ({ id, rank: idx + 1 }));
}

// ── MRR helpers ────────────────────────────────────────────────────────────

function reciprocalRank(items: Array<{ id: string; rank: number }>, deltaIds: Set<string>): number {
  for (const item of items) {
    if (deltaIds.has(item.id)) return 1 / item.rank;
  }
  return 0;
}

function mrr(rrs: number[]): number {
  return rrs.reduce((a, b) => a + b, 0) / rrs.length;
}

// ── Thread runner ──────────────────────────────────────────────────────────

type Strategy = { rank(nodes: GraphNode[], edges: GraphEdge[], focalNodeId: string): RankedResult[] };

function runVariant(
  threads: ThreadResult[],
  makeNodes: (raw: RawThreadData) => GraphNode[],
  strategy: Strategy,
  bridgeCoeff: number
): number {
  const rrs = threads.map(t => {
    const raw = t.raw_data!;
    const nodes = makeNodes(raw);
    const edges = makeEdges(raw.edges);
    const nodeTargets = new Map(raw.nodeTargets);
    const ranked = strategy.rank(nodes, edges, raw.focalNodeId);
    const items = aggregateToReplyLevel(ranked, raw.nodes, raw.edges, nodeTargets, bridgeCoeff);
    return reciprocalRank(items, new Set(t.delta_reply_ids));
  });
  return mrr(rrs);
}

// ── Formatting ─────────────────────────────────────────────────────────────

const fmt = (n: number) => n.toFixed(3);

function star(val: number, best: number): string {
  return val === best ? ' ★' : '  ';
}

// ── Main ───────────────────────────────────────────────────────────────────

function main() {
  const raw = JSON.parse(fs.readFileSync(args['input'] as string, 'utf-8')) as { threads: ThreadResult[] };
  const threads = raw.threads.filter(t => t.raw_data !== undefined);

  if (threads.length === 0) {
    console.error('No threads with raw_data found. Re-run benchmark with ?raw=1 support.');
    process.exit(1);
  }

  console.log(`Loaded ${threads.length} threads with raw data.\n`);

  const erDampingGrid   = [0.7, 0.8, 0.85, 0.9, 0.95];
  const qeAlphaGrid     = [0.05, 0.1, 0.15, 0.2, 0.3, 0.4];
  const qePhase1Grid    = [0.3, 0.4, 0.45, 0.49];
  const bridgeCoeffGrid = [0.0, 0.25, 0.5, 1.0, 2.0];

  const FIX_BRIDGE = 0.5;

  // ── Sweep 1: ER Damping ──────────────────────────────────────────────────
  console.log('=== ER Damping Sweep ===');

  const erDampingRows = erDampingGrid.map(damping => {
    const strategy = new EvidenceRankStrategy(damping);
    return {
      damping,
      erVote: runVariant(threads, raw => makeNodesER(raw.nodes, true),  strategy, FIX_BRIDGE),
      erLlm:  runVariant(threads, raw => makeNodesER(raw.nodes, false), strategy, FIX_BRIDGE),
    };
  });

  const bestErVoteDamping = Math.max(...erDampingRows.map(r => r.erVote));
  const bestErLlmDamping  = Math.max(...erDampingRows.map(r => r.erLlm));

  console.log('damping  EvidenceRank_Vote  EvidenceRank_LLM');
  for (const r of erDampingRows) {
    console.log(
      `${r.damping.toFixed(2)}     ${fmt(r.erVote)}${star(r.erVote, bestErVoteDamping)}` +
      `             ${fmt(r.erLlm)}${star(r.erLlm, bestErLlmDamping)}`
    );
  }

  const bestErDamping = erDampingRows.reduce((best, r) => r.erVote > best.erVote ? r : best).damping;

  // ── Sweep 2: QE Alpha ────────────────────────────────────────────────────
  console.log('\n=== QE Alpha Sweep ===');

  const qeAlphaRows = qeAlphaGrid.map(alpha => {
    const strategy = new QuadraticEnergyStrategy(50, alpha, 0.001);
    return {
      alpha,
      qeVote: runVariant(threads, raw => makeNodesQE(raw.nodes, true),  strategy, FIX_BRIDGE),
      qeLlm:  runVariant(threads, raw => makeNodesQE(raw.nodes, false), strategy, FIX_BRIDGE),
    };
  });

  const bestQeVoteAlpha = Math.max(...qeAlphaRows.map(r => r.qeVote));
  const bestQeLlmAlpha  = Math.max(...qeAlphaRows.map(r => r.qeLlm));

  console.log('alpha   QE_Vote  QE_LLM');
  for (const r of qeAlphaRows) {
    console.log(
      `${r.alpha.toFixed(2)}    ${fmt(r.qeVote)}${star(r.qeVote, bestQeVoteAlpha)}` +
      `  ${fmt(r.qeLlm)}${star(r.qeLlm, bestQeLlmAlpha)}`
    );
  }

  const bestQeAlpha = qeAlphaRows.reduce((best, r) => r.qeVote > best.qeVote ? r : best).alpha;

  // ── Sweep 3: QE Phase1Coeff ──────────────────────────────────────────────
  console.log('\n=== QE Phase1Coeff Sweep ===');

  const qePhase1Rows = qePhase1Grid.map(phase1Coeff => {
    const strategy = new QuadraticEnergyStrategy(50, bestQeAlpha, 0.001, phase1Coeff);
    return {
      phase1Coeff,
      qeVote: runVariant(threads, raw => makeNodesQE(raw.nodes, true),  strategy, FIX_BRIDGE),
      qeLlm:  runVariant(threads, raw => makeNodesQE(raw.nodes, false), strategy, FIX_BRIDGE),
    };
  });

  const bestQeVotePhase1 = Math.max(...qePhase1Rows.map(r => r.qeVote));
  const bestQeLlmPhase1  = Math.max(...qePhase1Rows.map(r => r.qeLlm));

  console.log('phase1  QE_Vote  QE_LLM');
  for (const r of qePhase1Rows) {
    console.log(
      `${r.phase1Coeff.toFixed(2)}    ${fmt(r.qeVote)}${star(r.qeVote, bestQeVotePhase1)}` +
      `  ${fmt(r.qeLlm)}${star(r.qeLlm, bestQeLlmPhase1)}`
    );
  }

  const bestQePhase1 = qePhase1Rows.reduce((best, r) => r.qeVote > best.qeVote ? r : best).phase1Coeff;

  // ── Sweep 4: Bridge Coeff ────────────────────────────────────────────────
  console.log('\n=== Bridge Coeff Sweep ===');

  const erStrategyBest = new EvidenceRankStrategy(bestErDamping);
  const qeStrategyBest = new QuadraticEnergyStrategy(50, bestQeAlpha, 0.001, bestQePhase1);
  const dmStrategy     = new DampedModularStrategy();

  const bridgeRows = bridgeCoeffGrid.map(coeff => ({
    coeff,
    erVote: runVariant(threads, raw => makeNodesER(raw.nodes, true),  erStrategyBest, coeff),
    erLlm:  runVariant(threads, raw => makeNodesER(raw.nodes, false), erStrategyBest, coeff),
    qeVote: runVariant(threads, raw => makeNodesQE(raw.nodes, true),  qeStrategyBest, coeff),
    qeLlm:  runVariant(threads, raw => makeNodesQE(raw.nodes, false), qeStrategyBest, coeff),
    dmLlm:  runVariant(threads, raw => makeNodesDM(raw.nodes, false), dmStrategy,     coeff),
  }));

  const bestBridgeErVote = Math.max(...bridgeRows.map(r => r.erVote));
  const bestBridgeErLlm  = Math.max(...bridgeRows.map(r => r.erLlm));
  const bestBridgeQeVote = Math.max(...bridgeRows.map(r => r.qeVote));
  const bestBridgeQeLlm  = Math.max(...bridgeRows.map(r => r.qeLlm));
  const bestBridgeDmLlm  = Math.max(...bridgeRows.map(r => r.dmLlm));

  console.log('coeff  ER_Vote  ER_LLM   QE_Vote  QE_LLM   DM_LLM');
  for (const r of bridgeRows) {
    console.log(
      `${r.coeff.toFixed(2)}   ` +
      `${fmt(r.erVote)}${star(r.erVote, bestBridgeErVote)}  ` +
      `${fmt(r.erLlm)}${star(r.erLlm, bestBridgeErLlm)}  ` +
      `${fmt(r.qeVote)}${star(r.qeVote, bestBridgeQeVote)}  ` +
      `${fmt(r.qeLlm)}${star(r.qeLlm, bestBridgeQeLlm)}  ` +
      `${fmt(r.dmLlm)}${star(r.dmLlm, bestBridgeDmLlm)}`
    );
  }

  const bestBridgeCoeff = bridgeRows.reduce((best, r) => r.erVote > best.erVote ? r : best).coeff;

  // ── Summary ───────────────────────────────────────────────────────────────
  console.log(
    `\nBest found: erDamping=${bestErDamping}, qeAlpha=${bestQeAlpha}, ` +
    `qePhase1=${bestQePhase1}, bridgeCoeff=${bestBridgeCoeff}`
  );
}

main();
