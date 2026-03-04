/**
 * MultiPIT Pairwise Paraphrase Deduplication Evaluation
 *
 * Tests Aphorist I-node deduplication accuracy against the MultiPIT expert-annotated
 * Twitter paraphrase detection dataset. Each row has sentence1, sentence2, label
 * (1=paraphrase, 0=not). The eval tests whether our dedup pipeline makes correct
 * per-pair DUPLICATE/NOVEL decisions.
 *
 * Algorithm — Iterative Sequential Ingestion (mirrors production):
 *   Sentences stream in one by one. Pairs are evaluated post-hoc by checking
 *   whether the two sentences share the same canonical root.
 *
 * Dataset: multipit_expert/test.csv (557 pairs, ~54% pos)
 *   Download: https://github.com/jpwahle/multipit
 *
 * Run with:
 *   pnpm dev:discourse   # must be running
 *   cd apps/api && pnpm vitest run src/__tests__/integration/multipit-eval.test.ts
 *
 * Dry run (50 pairs):
 *   MULTIPIT_LIMIT=50 pnpm vitest run src/__tests__/integration/multipit-eval.test.ts
 *
 * Skip in CI: SKIP_DEDUP_EVAL=1
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { Pool } from 'pg';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import crypto from 'crypto';
import { getArgumentService } from '../../services/argumentService.js';
import { createV3HypergraphRepo } from '../../db/repositories/V3HypergraphRepo.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const DATASET_FILE = '/Users/mh/Documents/Argumentmining/multipit_expert/test.csv';
const TEST_DB = 'chitin_multipit_dedup_test';
const RESULTS_FILE = path.join(__dirname, 'multipit-eval-results.json');
const PAIR_LIMIT = parseInt(process.env.MULTIPIT_LIMIT ?? '0', 10); // 0 = all pairs
const VECTOR_THRESHOLD = parseFloat(process.env.DEDUP_THRESHOLD ?? '0.78');
const CANDIDATE_LIMIT = 5;

// ---- Types ------------------------------------------------------------------

interface MultiPITPair {
  sentence1: string;
  sentence2: string;
  label: number; // 1=paraphrase, 0=not
}

interface StreamItem {
  text: string;
  streamIndex: number;
  dbINodeId?: string;
}

// ---- Module-level shared state ----------------------------------------------

let testPool: Pool;
let adminPool: Pool;
let v3Repo: ReturnType<typeof createV3HypergraphRepo>;

const pairs: MultiPITPair[] = [];
const streamItems: StreamItem[] = []; // ordered unique sentences
const textToDbId = new Map<string, string>(); // text → dbId after ingestion

// ---- Helpers ----------------------------------------------------------------

function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') { current += '"'; i++; }
      else inQuotes = !inQuotes;
    } else if (ch === ',' && !inQuotes) {
      fields.push(current); current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current);
  return fields;
}

function parseCSV(content: string): Record<string, string>[] {
  const lines = content.split('\n');
  if (lines.length === 0) return [];
  const headers = parseCSVLine(lines[0]!);
  const rows: Record<string, string>[] = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]!.trim();
    if (!line) continue;
    const values = parseCSVLine(line);
    const row: Record<string, string> = {};
    for (let j = 0; j < headers.length; j++) row[headers[j]!] = values[j] ?? '';
    rows.push(row);
  }
  return rows;
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

(process.env.SKIP_DEDUP_EVAL ? describe.skip : describe)('MultiPIT Pairwise Paraphrase Deduplication Evaluation', () => {

  beforeAll(async () => {
    adminPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'chitin',
      password: process.env.DB_PASSWORD || 'chitin_dev',
      database: process.env.DB_NAME || 'chitin',
    });
    testPool = await createDb(adminPool, TEST_DB);
    v3Repo = createV3HypergraphRepo(testPool);
  }, 60_000);

  afterAll(async () => {
    if (testPool) await dropDb(adminPool, testPool, TEST_DB);
    if (adminPool) await adminPool.end();
  });

  // --------------------------------------------------------------------------
  // Phase 1: Parse dataset and build ordered stream
  // --------------------------------------------------------------------------

  it('parses MultiPIT test CSV and builds sentence stream', () => {
    console.log('\n=== Phase 1: Parsing MultiPIT dataset ===');

    expect(fs.existsSync(DATASET_FILE), `Dataset not found at ${DATASET_FILE}`).toBe(true);

    const content = fs.readFileSync(DATASET_FILE, 'utf-8');
    const rows = parseCSV(content);
    console.log(`Parsed ${rows.length} rows total`);

    // Load all pairs
    for (const row of rows) {
      const s1 = row['sentence1']?.trim();
      const s2 = row['sentence2']?.trim();
      const label = parseInt(row['label'] ?? '0', 10);
      if (!s1 || !s2) continue;
      pairs.push({ sentence1: s1, sentence2: s2, label });
    }

    const positiveCount = pairs.filter(p => p.label === 1).length;
    console.log(`Total pairs: ${pairs.length} (pos=${positiveCount}, neg=${pairs.length - positiveCount})`);

    // Apply limit
    if (PAIR_LIMIT > 0) {
      pairs.splice(PAIR_LIMIT);
      console.log(`Dry run: limited to ${pairs.length} pairs`);
    }

    // Build flat ordered stream of unique sentences:
    // iterate pairs in CSV order, adding s1 then s2, dedup by exact text (first occurrence wins)
    const seen = new Set<string>();
    let streamIndex = 0;
    for (const pair of pairs) {
      for (const text of [pair.sentence1, pair.sentence2]) {
        if (!seen.has(text)) {
          seen.add(text);
          streamItems.push({ text, streamIndex: streamIndex++ });
        }
      }
    }

    console.log(`Unique sentences in stream: ${streamItems.length}`);
    expect(pairs.length).toBeGreaterThan(0);
    expect(streamItems.length).toBeGreaterThan(0);
    // s1 always appears before or at same position as s2 in stream
    // (same position only when s1 === s2, which is a valid dataset edge case)
    for (const pair of pairs) {
      const idx1 = streamItems.find(s => s.text === pair.sentence1)!.streamIndex;
      const idx2 = streamItems.find(s => s.text === pair.sentence2)!.streamIndex;
      expect(idx1).toBeLessThanOrEqual(idx2);
    }
    console.log('Stream ordering verified: s1 always precedes or equals s2 for each pair.');
  }, 30_000);

  // --------------------------------------------------------------------------
  // Phase 2: Ingest stream with organic dedup (production pipeline)
  // --------------------------------------------------------------------------

  it('ingests sentence stream with organic dedup', async () => {
    expect(streamItems.length).toBeGreaterThan(0);

    const argumentService = getArgumentService();
    console.log(`\n=== Phase 2: Ingesting ${streamItems.length} sentences with organic dedup ===`);
    console.log(`  (vector threshold=${VECTOR_THRESHOLD}, candidate limit=${CANDIDATE_LIMIT})`);

    // Rewrite sentences — tweets use informal references that benefit from self-contextualization.
    // source_text = the sentence itself (no external context available for tweets).
    console.log(`  Rewriting ${streamItems.length} sentence texts...`);
    const rewriteResults = await argumentService.rewriteAdus(
      streamItems.map((item, idx) => ({ id: String(idx), text: item.text, sourceText: item.text }))
    );
    const rewrittenOf = new Map(
      rewriteResults.map(r => [r.id, r.rewriteFailed ? null : r.rewrittenText])
    );
    console.log(`  Rewrites done. Failed: ${rewriteResults.filter(r => r.rewriteFailed).length}`);

    // Embed rewritten texts (fall back to original on failure).
    const textsToEmbed = streamItems.map((item, idx) => rewrittenOf.get(String(idx)) ?? item.text);
    console.log(`  Embedding ${streamItems.length} sentence texts...`);
    const { embeddings_1536: embeddings } = await argumentService.embedTexts(textsToEmbed);
    console.log(`  Embeddings done.`);

    // Insert + dedup each sentence sequentially so earlier insertions become candidates.
    let dedupCount = 0;
    for (let idx = 0; idx < streamItems.length; idx++) {
      const item = streamItems[idx]!;
      const embedding = embeddings[idx]!;
      const rewrittenText = rewrittenOf.get(String(idx)) ?? item.text;

      if ((idx + 1) % 50 === 0 || idx === 0 || idx === streamItems.length - 1) {
        console.log(`  [${idx + 1}/${streamItems.length}] "${item.text.slice(0, 70)}..."`);
      }

      // Each sentence is its own "post" with a unique source_id
      const sourceId = crypto.randomUUID();
      const contentHash = crypto.createHash('sha256').update(item.text).digest('hex');

      const { rows: [run] } = await testPool.query<{ id: string }>(
        `INSERT INTO v3_analysis_runs (source_type, source_id, content_hash, status)
         VALUES ('post', $1, $2, 'completed') RETURNING id`,
        [sourceId, contentHash]
      );
      const runId = run!.id;

      const dbId = crypto.randomUUID();
      await testPool.query(
        `INSERT INTO v3_nodes_i (id, analysis_run_id, source_type, source_id,
           content, rewritten_text, epistemic_type, fvp_confidence,
           span_start, span_end, extraction_confidence, base_weight, evidence_rank,
           embedding)
         VALUES ($1, $2, 'post', $3, $4, $5, 'FACT', 1.0, 0, $6, 1.0, 1.0, 1.0, $7)`,
        [dbId, runId, sourceId, item.text.substring(0, 4000), rewrittenText.substring(0, 4000), item.text.length, JSON.stringify(embedding)]
      );
      item.dbINodeId = dbId;
      textToDbId.set(item.text, dbId);

      // D1: find similar canonical I-nodes across all sources
      const candidates = await v3Repo.findSimilarINodesAcrossSource(
        embedding, 'post', sourceId, VECTOR_THRESHOLD, CANDIDATE_LIMIT
      );

      if (candidates.length === 0) continue;

      // D2: LLM dedup validation — no macro context for tweets (no external topic context)
      const [dedupResult] = await argumentService.deduplicateINodes('', [{
        newINodeId: dbId,
        newINodeText: rewrittenText,
        epistemicType: 'FACT',
        candidates: candidates.map(c => ({ id: c.id, text: c.content, epistemicType: c.epistemic_type })),
      }]);

      if (!dedupResult || dedupResult.dedupFailed || !dedupResult.canonicalINodeId) continue;

      const knownIds = new Set(candidates.map(c => c.id));
      if (!knownIds.has(dedupResult.canonicalINodeId)) continue;

      await v3Repo.setCanonicalINode(dbId, dedupResult.canonicalINodeId);
      dedupCount++;
    }

    console.log(`Ingest complete. ${dedupCount}/${streamItems.length} sentences deduplicated.`);
    expect(streamItems.filter(i => i.dbINodeId).length).toBe(streamItems.length);
  }, 3_600_000); // 1 hour — full run ~1000 LLM calls at ~1s each

  // --------------------------------------------------------------------------
  // Phase 3: Compute per-pair metrics
  // --------------------------------------------------------------------------

  it('computes per-pair dedup metrics', async () => {
    expect(streamItems.filter(i => i.dbINodeId).length).toBeGreaterThan(0);

    console.log('\n=== Phase 3: Computing per-pair dedup metrics ===');

    // Load canonical mappings for all inserted I-nodes
    const allDbIds = streamItems.map(i => i.dbINodeId!).filter(Boolean);
    const { rows } = await testPool.query<{ id: string; canonical_i_node_id: string | null }>(
      `SELECT id, canonical_i_node_id FROM v3_nodes_i WHERE id = ANY($1)`,
      [allDbIds]
    );
    const canonicalOf = new Map<string, string | null>();
    for (const row of rows) canonicalOf.set(row.id, row.canonical_i_node_id);

    // Hub-and-spoke: canonical_i_node_id is always NULL for root nodes (one level deep).
    // getRoot: if canonical_i_node_id is NULL, this IS the root; otherwise follow one hop.
    function getRoot(dbId: string): string {
      return canonicalOf.get(dbId) ?? dbId;
    }

    // Per-pair classification
    let tp = 0, fp = 0, fn = 0, tn = 0;

    for (const pair of pairs) {
      const s1DbId = textToDbId.get(pair.sentence1);
      const s2DbId = textToDbId.get(pair.sentence2);
      if (!s1DbId || !s2DbId) continue;

      const root1 = getRoot(s1DbId);
      const root2 = getRoot(s2DbId);
      const sameCanonical = root1 === root2;

      if (pair.label === 1 && sameCanonical)  tp++;
      else if (pair.label === 1 && !sameCanonical) fn++;
      else if (pair.label === 0 && !sameCanonical) tn++;
      else fp++; // label=0 but same canonical → false positive
    }

    const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
    const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
    const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
    const accuracy  = (tp + tn) / (tp + fp + fn + tn);

    const output = {
      timestamp: new Date().toISOString(),
      dataset: 'MultiPIT-expert-test',
      pairsEvaluated: pairs.length,
      sentencesIngested: streamItems.length,
      vectorThreshold: VECTOR_THRESHOLD,
      candidateLimit: CANDIDATE_LIMIT,
      metric: 'per-pair-paraphrase-dedup',
      note: 'TP=label=1 & same_canonical, FN=label=1 & diff_canonical, TN=label=0 & diff_canonical, FP=label=0 & same_canonical',
      results: { precision, recall, f1, accuracy, tp, fp, fn, tn },
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));

    console.log(`\nPairs evaluated: ${pairs.length} (${tp + fn} pos, ${tn + fp} neg)`);
    console.log(`Sentences ingested: ${streamItems.length}`);
    console.log('\nPer-pair paraphrase dedup metrics:');
    console.log(`  Precision: ${precision.toFixed(3)}`);
    console.log(`  Recall:    ${recall.toFixed(3)}`);
    console.log(`  F1:        ${f1.toFixed(3)}`);
    console.log(`  Accuracy:  ${accuracy.toFixed(3)}`);
    console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}`);
    console.log(`\nResults written to: ${RESULTS_FILE}`);

    expect(output.pairsEvaluated).toBeGreaterThan(0);
    expect(output.results.recall).toBeGreaterThan(0);
  }, 30_000);
});
