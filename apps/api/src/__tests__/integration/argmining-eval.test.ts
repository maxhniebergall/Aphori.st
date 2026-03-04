/**
 * Argument Annotated Essays Evaluation (Stab & Gurevych)
 *
 * Tests Aphorist ADU extraction and edge detection against 90 persuasive essays
 * with ground-truth character-offset spans and typed relations.
 *
 * Run with:
 *   pnpm dev:discourse   # must be running
 *   cd apps/api && pnpm vitest run src/__tests__/integration/argmining-eval.test.ts
 *
 * Dry run (3 essays):
 *   ARGMINING_SAMPLE_SIZE=3 pnpm vitest run src/__tests__/integration/argmining-eval.test.ts
 *
 * Skip in CI by setting SKIP_ARGMINING_EVAL=1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getArgumentService } from '../../services/argumentService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const ESSAYS_DIR = '/Users/mh/Documents/Argumentmining/ArgumentAnnotatedEssays-1.0/brat-project';
const TEST_DB = 'chitin_argmining_essays_test';
const RESULTS_FILE = path.join(__dirname, 'argmining-results.json');
const SAMPLE_SIZE = parseInt(process.env.ARGMINING_SAMPLE_SIZE ?? '90', 10);
const SPAN_IOU_THRESHOLD = 0.5;

// ---- Types ------------------------------------------------------------------

interface GTComponent {
  id: string;           // T1, T2, …
  type: 'MajorClaim' | 'Claim' | 'Premise';
  start: number;
  end: number;
  text: string;
}

interface GTRelation {
  id: string;           // R1, R2, …
  type: 'supports' | 'attacks';
  arg1: string;         // component id
  arg2: string;
}

interface Essay {
  id: string;           // essay01
  text: string;
  components: GTComponent[];
  relations: GTRelation[];
}

interface EssayRecord {
  essayId: string;
  testRunId: string;
  iNodeDbIds: string[];               // all inserted I-node DB UUIDs
  iNodeSpans: Map<string, { start: number; end: number }>; // dbId → span
  sNodeDbIds: string[];
}

// ---- Module-level shared state ----------------------------------------------

let testPool: Pool;
let adminPool: Pool;

let essays: Essay[] = [];
let essayRecords: EssayRecord[] = [];

// ---- Helpers ----------------------------------------------------------------

function spanIoU(a: { start: number; end: number }, b: { start: number; end: number }): number {
  const overlap = Math.max(0, Math.min(a.end, b.end) - Math.max(a.start, b.start));
  const union = Math.max(a.end, b.end) - Math.min(a.start, b.start);
  return union === 0 ? 0 : overlap / union;
}

function parseAnn(annText: string, essayText: string): { components: GTComponent[]; relations: GTRelation[] } {
  const components: GTComponent[] = [];
  const relations: GTRelation[] = [];

  for (const line of annText.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    if (trimmed.startsWith('T')) {
      // T1\tClaim 78 140\tcompetition can ...
      const match = trimmed.match(/^(T\d+)\t(MajorClaim|Claim|Premise)\s+(\d+)\s+(\d+)\t(.*)$/);
      if (match) {
        components.push({
          id: match[1]!,
          type: match[2] as GTComponent['type'],
          start: parseInt(match[3]!, 10),
          end: parseInt(match[4]!, 10),
          text: match[5]!,
        });
      }
    } else if (trimmed.startsWith('R')) {
      // R1\tsupports Arg1:T3 Arg2:T1
      const match = trimmed.match(/^(R\d+)\t(supports|attacks)\s+Arg1:(T\d+)\s+Arg2:(T\d+)/);
      if (match) {
        relations.push({
          id: match[1]!,
          type: match[2] as GTRelation['type'],
          arg1: match[3]!,
          arg2: match[4]!,
        });
      }
    }
    // A lines (stance) are ignored
  }

  return { components, relations };
}

async function createDb(adminPool: Pool, dbName: string): Promise<Pool> {
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid != pg_backend_pid()`
  );
  await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
  await adminPool.query(`CREATE DATABASE ${dbName}`);

  const pool = new Pool({
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    user: process.env.DB_USER || 'chitin',
    password: process.env.DB_PASSWORD || 'chitin_dev',
    database: dbName,
  });

  await pool.query('CREATE EXTENSION IF NOT EXISTS vector');
  await pool.query('CREATE EXTENSION IF NOT EXISTS "uuid-ossp"');
  await pool.query('CREATE EXTENSION IF NOT EXISTS ltree');

  const migrationsDir = path.resolve(__dirname, '../../db/migrations');
  const files = fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort();
  for (const file of files) {
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf-8');
    await pool.query(sql);
  }

  return pool;
}

async function dropDb(adminPool: Pool, pool: Pool, dbName: string): Promise<void> {
  await pool.end();
  await adminPool.query(
    `SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = '${dbName}' AND pid != pg_backend_pid()`
  );
  await adminPool.query(`DROP DATABASE IF EXISTS ${dbName}`);
}

// ---- Test Suite -------------------------------------------------------------

(process.env.SKIP_ARGMINING_EVAL ? describe.skip : describe)('Argument Annotated Essays Evaluation', () => {

  beforeAll(async () => {
    adminPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'chitin',
      password: process.env.DB_PASSWORD || 'chitin_dev',
      database: process.env.DB_NAME || 'chitin',
    });

    testPool = await createDb(adminPool, TEST_DB);
  }, 60_000);

  afterAll(async () => {
    if (testPool) await dropDb(adminPool, testPool, TEST_DB);
    if (adminPool) await adminPool.end();
  });

  // --------------------------------------------------------------------------
  // Phase 1: Parse essays and select sample
  // --------------------------------------------------------------------------

  it('parses essays and selects sample', () => {
    console.log('\n=== Phase 1: Parsing Argument Annotated Essays ===');

    const txtFiles = fs.readdirSync(ESSAYS_DIR)
      .filter(f => f.match(/^essay\d+\.txt$/))
      .sort();

    console.log(`Found ${txtFiles.length} essay files`);

    const allEssays: Essay[] = [];

    for (const txtFile of txtFiles) {
      const essayId = txtFile.replace('.txt', '');
      const annFile = txtFile.replace('.txt', '.ann');

      const txtPath = path.join(ESSAYS_DIR, txtFile);
      const annPath = path.join(ESSAYS_DIR, annFile);

      if (!fs.existsSync(annPath)) {
        console.warn(`  Missing annotation file for ${txtFile}, skipping`);
        continue;
      }

      const text = fs.readFileSync(txtPath, 'utf-8');
      const annText = fs.readFileSync(annPath, 'utf-8');
      const { components, relations } = parseAnn(annText, text);

      if (components.length === 0) {
        console.warn(`  No components in ${txtFile}, skipping`);
        continue;
      }

      allEssays.push({ id: essayId, text, components, relations });
    }

    console.log(`Parsed ${allEssays.length} essays`);

    // Take first SAMPLE_SIZE (already sorted by filename)
    essays = allEssays.slice(0, SAMPLE_SIZE);

    const totalComponents = essays.reduce((s, e) => s + e.components.length, 0);
    const totalRelations = essays.reduce((s, e) => s + e.relations.length, 0);
    console.log(`Selected ${essays.length} essays, ${totalComponents} GT components, ${totalRelations} GT relations`);

    expect(essays.length).toBe(SAMPLE_SIZE);
  }, 30_000);

  // --------------------------------------------------------------------------
  // Phase 2: Ingest essays via Aphorist pipeline
  // --------------------------------------------------------------------------

  it('ingests essays via Aphorist pipeline', async () => {
    expect(essays.length).toBe(SAMPLE_SIZE);

    const argumentService = getArgumentService();
    console.log('\n=== Phase 2: Aphorist pipeline ingest ===');

    for (let idx = 0; idx < essays.length; idx++) {
      const essay = essays[idx]!;
      console.log(`  [${idx + 1}/${essays.length}] ${essay.id} (${essay.text.length} chars, ${essay.components.length} GT components)`);

      // Create analysis run
      const contentHash = crypto.createHash('sha256').update(essay.text).digest('hex');
      const sourceId = crypto.randomUUID();
      const runResult = await testPool.query(
        `INSERT INTO v3_analysis_runs (source_type, source_id, content_hash, status)
         VALUES ('post', $1, $2, 'completed')
         RETURNING id`,
        [sourceId, contentHash]
      );
      const runId: string = runResult.rows[0].id;

      // analyzeText with the full essay
      let analysis: { hypergraph?: { nodes?: any[]; edges?: any[] } } | null = null;
      try {
        const resp = await argumentService.analyzeText([{
          id: essay.id,
          text: essay.text,
        }]);
        analysis = resp.analyses?.[0] ?? null;
      } catch (err) {
        console.warn(`    analyzeText failed: ${(err as Error).message}`);
      }

      // Extract I-nodes and S-nodes from hypergraph
      const iNodeDbIds: string[] = [];
      const iNodeSpans = new Map<string, { start: number; end: number }>();
      const sNodeDbIds: string[] = [];
      const tempToDbId = new Map<string, string>();

      if (analysis?.hypergraph) {
        const hg = analysis.hypergraph;

        // The response uses node_id (not id/temp_id) as the node identifier.
        // node_type: 'adu' → I-node; node_type: 'scheme' → S-node (with direction)
        // Edges are flat: {scheme_node_id, node_id, role}

        // Build map: response node_id → db UUID (for adu nodes only)
        const nodeIdToDbId = new Map<string, string>();

        // Insert I-nodes (ADUs) with real span_start / span_end
        for (const n of hg.nodes ?? []) {
          if (n.node_type !== 'adu') continue;

          const responseNodeId: string = n.node_id ?? n.id ?? n.temp_id;
          const dbId = crypto.randomUUID();
          nodeIdToDbId.set(responseNodeId, dbId);
          // Also map by legacy temp_id field if present
          if (n.id) nodeIdToDbId.set(n.id, dbId);
          if (n.temp_id) nodeIdToDbId.set(n.temp_id, dbId);

          const spanStart = typeof n.span_start === 'number' ? n.span_start : 0;
          const spanEnd = typeof n.span_end === 'number' ? n.span_end : 0;
          const content = (n.content ?? n.text ?? '').substring(0, 4000);
          const fvpType = n.fvp_type ?? 'FACT';
          const fvpConf = n.fvp_confidence ?? 1.0;

          try {
            await testPool.query(
              `INSERT INTO v3_nodes_i (id, analysis_run_id, source_type, source_id,
                 content, rewritten_text, epistemic_type, fvp_confidence,
                 span_start, span_end, extraction_confidence, base_weight, evidence_rank)
               VALUES ($1, $2, 'post', $3, $4, $4, $5, $6, $7, $8, 1.0, 1.0, 1.0)`,
              [dbId, runId, sourceId, content, fvpType, fvpConf, spanStart, spanEnd]
            );
            iNodeDbIds.push(dbId);
            iNodeSpans.set(dbId, { start: spanStart, end: spanEnd });
          } catch (err) {
            console.warn(`    I-node insert failed: ${(err as Error).message}`);
          }
        }

        // Build map: scheme_node_id → {direction, dbId}
        // scheme nodes have node_type: 'scheme' and direction: 'SUPPORT'|'ATTACK'
        const schemeNodeIdToInfo = new Map<string, { direction: string; dbId: string }>();
        for (const n of hg.nodes ?? []) {
          if (n.node_type !== 'scheme') continue;
          const direction: string = n.direction;
          if (direction !== 'SUPPORT' && direction !== 'ATTACK') continue;
          const schemeId: string = n.node_id ?? n.id;
          const sDbId = crypto.randomUUID();
          schemeNodeIdToInfo.set(schemeId, { direction, dbId: sDbId });
          try {
            await testPool.query(
              `INSERT INTO v3_nodes_s (id, analysis_run_id, direction, confidence, gap_detected)
               VALUES ($1, $2, $3, 1.0, false)`,
              [sDbId, runId, direction]
            );
          } catch (err) {
            console.warn(`    S-node insert failed: ${(err as Error).message}`);
          }
        }

        // Insert edges: flat {scheme_node_id, node_id, role} rows
        // Only wire edges between adu nodes (not ghost nodes)
        for (const e of hg.edges ?? []) {
          const schemeInfo = schemeNodeIdToInfo.get(e.scheme_node_id);
          if (!schemeInfo) continue; // no matching scheme node (ghost edges etc.)

          const iNodeDbId = nodeIdToDbId.get(e.node_id);
          if (!iNodeDbId) continue; // not an adu node (ghost, etc.)

          const role: string = e.role === 'premise' ? 'premise' : 'conclusion';
          try {
            await testPool.query(
              `INSERT INTO v3_edges (scheme_node_id, node_id, node_type, role) VALUES ($1, $2, 'i_node', $3)`,
              [schemeInfo.dbId, iNodeDbId, role]
            );
          } catch (err) {
            // ignore duplicates
          }
        }

        // Collect inserted S-node DB IDs
        for (const { dbId } of schemeNodeIdToInfo.values()) {
          sNodeDbIds.push(dbId);
        }
      }

      essayRecords.push({
        essayId: essay.id,
        testRunId: runId,
        iNodeDbIds,
        iNodeSpans,
        sNodeDbIds,
      });

      console.log(`    → ${iNodeDbIds.length} I-nodes, ${sNodeDbIds.length} S-nodes`);
    }

    console.log(`Pipeline ingest complete. Essays processed: ${essayRecords.length}`);
    expect(essayRecords.length).toBe(SAMPLE_SIZE);
  }, 1_800_000);

  // --------------------------------------------------------------------------
  // Phase 3: Compute and report ADU F1 + Edge F1
  // --------------------------------------------------------------------------

  it('computes and reports ADU F1 + Edge F1', async () => {
    expect(essayRecords.length).toBe(SAMPLE_SIZE);

    console.log('\n=== Phase 3: Computing metrics ===');

    // Per-type counters for ADU component F1
    type TypeKey = 'MajorClaim' | 'Claim' | 'Premise';
    const byType: Record<TypeKey, { tp: number; fp: number; fn: number }> = {
      MajorClaim: { tp: 0, fp: 0, fn: 0 },
      Claim: { tp: 0, fp: 0, fn: 0 },
      Premise: { tp: 0, fp: 0, fn: 0 },
    };

    // Global ADU counters (macro-averaged over essays)
    let totalAduPrecision = 0, totalAduRecall = 0, totalAduF1 = 0;
    let totalEdgePrecision = 0, totalEdgeRecall = 0, totalEdgeF1 = 0;
    let roleAlignmentCorrect = 0, roleAlignmentTotal = 0;

    // IoU tracking across all matched pairs and all GT-test pairs
    const allMatchedIoUs: number[] = [];   // IoU of matched pairs (≥ threshold)
    const allBestIoUs: number[] = [];      // best IoU for each GT component regardless of threshold

    for (let i = 0; i < essays.length; i++) {
      const essay = essays[i]!;
      const record = essayRecords[i]!;

      const gtComponents = essay.components;
      const testSpans = [...record.iNodeSpans.entries()].map(([id, span]) => ({ id, ...span }));

      // --- ADU Component F1 (span IoU matching) ---

      // Greedy 1:1 matching: for each GT component find best-IoU test span
      const usedTestIds = new Set<string>();
      const matchedGtToTest = new Map<string, string>(); // gtId → testDbId

      // Sort GT by descending span length for stable greedy matching
      const sortedGt = [...gtComponents].sort((a, b) => (b.end - b.start) - (a.end - a.start));

      for (const gt of sortedGt) {
        let bestIoU = 0, bestTestId = '';
        for (const ts of testSpans) {
          if (usedTestIds.has(ts.id)) continue;
          const iou = spanIoU({ start: gt.start, end: gt.end }, { start: ts.start, end: ts.end });
          if (iou > bestIoU) { bestIoU = iou; bestTestId = ts.id; }
        }
        allBestIoUs.push(bestIoU); // track best IoU for every GT component
        if (bestIoU >= SPAN_IOU_THRESHOLD && bestTestId) {
          usedTestIds.add(bestTestId);
          matchedGtToTest.set(gt.id, bestTestId);
          allMatchedIoUs.push(bestIoU);
        }
      }

      const matchedCount = matchedGtToTest.size;
      const precision = testSpans.length > 0 ? matchedCount / testSpans.length : 0;
      const recall = gtComponents.length > 0 ? matchedCount / gtComponents.length : 0;
      const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

      totalAduPrecision += precision;
      totalAduRecall += recall;
      totalAduF1 += f1;

      // Per-type breakdown
      for (const gt of gtComponents) {
        const t = gt.type;
        if (matchedGtToTest.has(gt.id)) {
          byType[t].tp++;
        } else {
          byType[t].fn++;
        }
      }
      // FP: test spans that didn't match any GT
      const unmatchedTestCount = testSpans.length - matchedCount;
      // Distribute FP proportionally (approximate: can't know type of unmatched test spans)
      // Just track globally for overall metrics; per-type precision uses tp/(tp+fp) below

      // --- Role alignment (bonus metric) ---
      // For matched GT→test pairs, check that the test I-node has the right role
      if (record.sNodeDbIds.length > 0) {
        // Load edges for this run
        const edgeRows = await testPool.query<{ node_id: string; role: string }>(
          `SELECT e.node_id, e.role FROM v3_edges e
           JOIN v3_nodes_s ns ON ns.id = e.scheme_node_id
           WHERE ns.analysis_run_id = $1 AND e.node_type = 'i_node'`,
          [record.testRunId]
        );
        const nodeRoles = new Map<string, Set<string>>();
        for (const row of edgeRows.rows) {
          if (!nodeRoles.has(row.node_id)) nodeRoles.set(row.node_id, new Set());
          nodeRoles.get(row.node_id)!.add(row.role);
        }

        for (const [gtId, testId] of matchedGtToTest) {
          const gt = gtComponents.find(c => c.id === gtId)!;
          const roles = nodeRoles.get(testId);
          roleAlignmentTotal++;
          if (gt.type === 'Premise') {
            if (roles?.has('premise')) roleAlignmentCorrect++;
          } else {
            // Claim / MajorClaim → expect 'conclusion'
            if (roles?.has('conclusion')) roleAlignmentCorrect++;
          }
        }
      }

      // --- Edge F1 ---

      // Build GT edge set using matched GT→test I-node mapping
      const gtEdges = essay.relations;
      let gtEdgeMatched = 0;
      let testEdgeCorrect = 0;

      // Load test S-nodes for this essay
      if (record.sNodeDbIds.length > 0) {
        const testSRows = await testPool.query<{ s_id: string; direction: string; node_id: string; role: string }>(
          `SELECT ns.id as s_id, ns.direction, e.node_id, e.role
           FROM v3_nodes_s ns
           JOIN v3_edges e ON e.scheme_node_id = ns.id AND e.node_type = 'i_node'
           WHERE ns.analysis_run_id = $1`,
          [record.testRunId]
        );

        const testSMap = new Map<string, { direction: string; premIds: Set<string>; concIds: Set<string> }>();
        for (const row of testSRows.rows) {
          if (!testSMap.has(row.s_id)) testSMap.set(row.s_id, { direction: row.direction, premIds: new Set(), concIds: new Set() });
          const info = testSMap.get(row.s_id)!;
          if (row.role === 'premise') info.premIds.add(row.node_id);
          else info.concIds.add(row.node_id);
        }

        // For each GT relation, check if there's a matching test S-node
        for (const rel of gtEdges) {
          const testArg1 = matchedGtToTest.get(rel.arg1);
          const testArg2 = matchedGtToTest.get(rel.arg2);
          if (!testArg1 || !testArg2) continue; // GT endpoints not matched

          const expectedDir = rel.type === 'supports' ? 'SUPPORT' : 'ATTACK';

          for (const [, si] of testSMap) {
            if (si.direction !== expectedDir) continue;
            if (si.premIds.has(testArg1) && si.concIds.has(testArg2)) {
              gtEdgeMatched++;
              break;
            }
          }
        }

        // For each test S-node, check if it matches a GT relation
        const gtRelMap = new Map<string, GTRelation[]>();
        for (const rel of gtEdges) {
          const k = `${rel.arg1}:${rel.arg2}:${rel.type}`;
          if (!gtRelMap.has(k)) gtRelMap.set(k, []);
          gtRelMap.get(k)!.push(rel);
        }

        // Build reverse: testDbId → gtComponentId
        const testToGt = new Map<string, string>();
        for (const [gtId, testId] of matchedGtToTest) testToGt.set(testId, gtId);

        for (const [, si] of testSMap) {
          const expectedType = si.direction === 'SUPPORT' ? 'supports' : 'attacks';
          for (const premId of si.premIds) {
            for (const concId of si.concIds) {
              const gtPremId = testToGt.get(premId);
              const gtConcId = testToGt.get(concId);
              if (!gtPremId || !gtConcId) continue;
              const k = `${gtPremId}:${gtConcId}:${expectedType}`;
              if (gtRelMap.has(k)) {
                testEdgeCorrect++;
                break;
              }
            }
            break; // only check first prem/conc pair per S-node for efficiency
          }
        }

        const totalTestEdges = testSMap.size;
        const totalGtEdges = gtEdges.length;

        const ep = totalTestEdges > 0 ? testEdgeCorrect / totalTestEdges : 0;
        const er = totalGtEdges > 0 ? gtEdgeMatched / totalGtEdges : 0;
        const ef1 = ep + er > 0 ? 2 * ep * er / (ep + er) : 0;

        totalEdgePrecision += ep;
        totalEdgeRecall += er;
        totalEdgeF1 += ef1;
      }
    }

    const N = essays.length;
    const aduPrecision = N > 0 ? totalAduPrecision / N : 0;
    const aduRecall = N > 0 ? totalAduRecall / N : 0;
    const aduF1 = N > 0 ? totalAduF1 / N : 0;

    const edgePrecision = N > 0 ? totalEdgePrecision / N : 0;
    const edgeRecall = N > 0 ? totalEdgeRecall / N : 0;
    const edgeF1 = N > 0 ? totalEdgeF1 / N : 0;

    const roleAlignmentAccuracy = roleAlignmentTotal > 0
      ? roleAlignmentCorrect / roleAlignmentTotal : 0;

    // Per-type F1
    function typeF1(t: TypeKey) {
      const { tp, fp, fn } = byType[t];
      const p = tp + fp > 0 ? tp / (tp + fp) : 0;
      const r = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f = p + r > 0 ? 2 * p * r / (p + r) : 0;
      return { precision: p, recall: r, f1: f };
    }

    const meanMatchedIoU = allMatchedIoUs.length > 0
      ? allMatchedIoUs.reduce((s, v) => s + v, 0) / allMatchedIoUs.length : 0;
    const meanBestIoU = allBestIoUs.length > 0
      ? allBestIoUs.reduce((s, v) => s + v, 0) / allBestIoUs.length : 0;

    const results = {
      timestamp: new Date().toISOString(),
      dataset: 'ArgumentAnnotatedEssays',
      essaysProcessed: N,
      spanIoUThreshold: SPAN_IOU_THRESHOLD,
      aduF1: {
        precision: aduPrecision,
        recall: aduRecall,
        f1: aduF1,
        byType: {
          MajorClaim: typeF1('MajorClaim'),
          Claim: typeF1('Claim'),
          Premise: typeF1('Premise'),
        },
        spanIoU: {
          meanOfMatched: meanMatchedIoU,   // avg IoU among matched pairs (all ≥ threshold)
          meanBestPerGt: meanBestIoU,      // avg best-available IoU per GT component (incl. unmatched)
          matchedPairs: allMatchedIoUs.length,
          totalGtComponents: allBestIoUs.length,
        },
      },
      edgeF1: {
        precision: edgePrecision,
        recall: edgeRecall,
        f1: edgeF1,
      },
      roleAlignment: {
        accuracy: roleAlignmentAccuracy,
        correct: roleAlignmentCorrect,
        total: roleAlignmentTotal,
      },
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    console.log('\n=== Results ===');
    console.log(`Essays processed: ${N}`);
    console.log('ADU Component F1 (macro-avg):');
    console.log(`  Precision: ${aduPrecision.toFixed(3)}`);
    console.log(`  Recall:    ${aduRecall.toFixed(3)}`);
    console.log(`  F1:        ${aduF1.toFixed(3)}`);
    console.log('  By type:');
    for (const t of ['MajorClaim', 'Claim', 'Premise'] as TypeKey[]) {
      const m = typeF1(t);
      console.log(`    ${t.padEnd(12)}: P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)}`);
    }
    console.log(`  Span IoU (matched pairs):  mean=${meanMatchedIoU.toFixed(3)} over ${allMatchedIoUs.length} matches`);
    console.log(`  Span IoU (best per GT):    mean=${meanBestIoU.toFixed(3)} over ${allBestIoUs.length} GT components`);
    console.log('Edge F1 (macro-avg):');
    console.log(`  Precision: ${edgePrecision.toFixed(3)}`);
    console.log(`  Recall:    ${edgeRecall.toFixed(3)}`);
    console.log(`  F1:        ${edgeF1.toFixed(3)}`);
    console.log(`Role Alignment: ${(roleAlignmentAccuracy * 100).toFixed(1)}% (${roleAlignmentCorrect}/${roleAlignmentTotal})`);
    console.log(`\nResults written to: ${RESULTS_FILE}`);

    // Sanity assertions
    expect(results.essaysProcessed).toBe(SAMPLE_SIZE);
    expect(results.aduF1.recall).toBeGreaterThan(0);
  }, 60_000);
});
