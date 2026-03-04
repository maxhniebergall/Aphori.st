/**
 * IBM ArgKP Deduplication Evaluation (NLP-Debater-Project/IBM-Debater-ArgKP)
 *
 * Tests Aphorist I-node deduplication accuracy against the IBM Argument Key Point
 * Analysis dataset. Each row with label=1 maps a short atomic argument to a key point.
 * Two arguments sharing the same (topic, key_point) should be deduplicated.
 *
 * This is a tighter semantic fit than ArgSum Task_1: arguments are already short
 * atomic claims (34–244 chars), and key_point groups are semantically equivalent
 * arguments — not just "supporting the same topic."
 *
 * Pipeline per argument (mirrors production v3Worker dedup phase):
 *   1. Embed the argument text directly (already an atomic claim — no extraction needed)
 *   2. Insert I-node into DB
 *   3. findSimilarINodesAcrossSource() — global semantic search, top-5, threshold
 *   4. deduplicateINodes() — LLM validation via discourse-engine
 *   5. setCanonicalINode() if match confirmed
 *
 * Metric: per-argument dedup F1
 *   For each argument (skipping the first of each key_point cluster):
 *     TP = correctly merged to the existing canonical of its key_point cluster
 *     FP = merged to a different cluster's canonical (or spurious merge when none existed)
 *     FN = should have merged but wasn't
 *     TN = correctly identified as novel (first of its cluster)
 *
 * Download dataset once:
 *   cd discourse-engine && source .venv/bin/activate
 *   pip install datasets -q
 *   python3 -c "from datasets import load_dataset; \
 *     ds = load_dataset('NLP-Debater-Project/IBM-Debater-ArgKP'); \
 *     ds['train'].to_csv('/tmp/argkp_train.csv'); print('Done')"
 *
 * Run with:
 *   pnpm dev:discourse   # must be running
 *   cd apps/api && pnpm vitest run src/__tests__/integration/argkp-eval.test.ts
 *
 * Dry run (first topic only):
 *   ARGKP_TOPIC_LIMIT=1 pnpm vitest run src/__tests__/integration/argkp-eval.test.ts
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

const DATASET_FILE = '/tmp/argkp_train.csv';
const TEST_DB = 'chitin_argkp_dedup_test';
const RESULTS_FILE = path.join(__dirname, 'argkp-eval-results.json');
const TOPIC_LIMIT = parseInt(process.env.ARGKP_TOPIC_LIMIT ?? '0', 10); // 0 = all topics
const VECTOR_THRESHOLD = parseFloat(process.env.DEDUP_THRESHOLD ?? '0.78');
const CANDIDATE_LIMIT = 5;
const MAX_MACRO_CONTEXT_LENGTH = 8000;

// ---- Types ------------------------------------------------------------------

interface ArgKPItem {
  id: string;         // synthetic: topic_idx + arg_idx
  topic: string;
  argument: string;   // short atomic argument text (34–244 chars)
  keyPoint: string;   // ground-truth cluster label
  stance: number;
  dbINodeId?: string;
}

// ---- Module-level shared state ----------------------------------------------

let testPool: Pool;
let adminPool: Pool;
let v3Repo: ReturnType<typeof createV3HypergraphRepo>;

const items: ArgKPItem[] = [];

// ---- Helpers ----------------------------------------------------------------

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

(process.env.SKIP_DEDUP_EVAL ? describe.skip : describe)('IBM ArgKP Deduplication Evaluation', () => {

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
  // Phase 1: Parse dataset
  // --------------------------------------------------------------------------

  it('parses IBM ArgKP train CSV', () => {
    console.log('\n=== Phase 1: Parsing IBM ArgKP dataset ===');

    expect(fs.existsSync(DATASET_FILE), `Dataset not found at ${DATASET_FILE}`).toBe(true);

    const content = fs.readFileSync(DATASET_FILE, 'utf-8');
    const rows = parseCSV(content);
    console.log(`Parsed ${rows.length} rows total`);

    // Filter to label=1 (argument matched to key point)
    const positive = rows.filter(r => r['label'] === '1');
    console.log(`Label=1 (positive matches): ${positive.length}`);

    const allTopics = [...new Set(positive.map(r => r['topic']!))].sort();
    console.log(`Topics: ${allTopics.length}`);

    // Deduplicate: a unique (topic, argument) → one item per unique argument per topic.
    // The dataset has multiple rows per argument (one per key_point match), take the first.
    const seen = new Set<string>();
    for (const row of positive) {
      const key = `${row['topic']}|||${row['argument']}`;
      if (seen.has(key)) continue;
      seen.add(key);
      items.push({
        id: `t${allTopics.indexOf(row['topic']!)}_a${items.length}`,
        topic: row['topic']!,
        argument: row['argument']!,
        keyPoint: row['key_point']!,
        stance: parseInt(row['stance'] ?? '0', 10),
      });
    }

    console.log(`Unique (topic, argument) items: ${items.length}`);

    const kpCount = new Set(items.map(i => `${i.topic}|||${i.keyPoint}`)).size;
    console.log(`Unique (topic, key_point) clusters: ${kpCount}`);

    if (TOPIC_LIMIT > 0) {
      const limitedTopics = new Set(allTopics.slice(0, TOPIC_LIMIT));
      console.log(`\nDry run: limiting to ${TOPIC_LIMIT} topic(s): ${[...limitedTopics].map(t => `"${t.slice(0, 50)}"`).join(', ')}`);
      const before = items.length;
      items.splice(0, items.length, ...items.filter(i => limitedTopics.has(i.topic)));
      console.log(`Filtered to ${items.length}/${before} items`);
    }

    const finalKps = new Set(items.map(i => `${i.topic}|||${i.keyPoint}`)).size;
    console.log(`Items: ${items.length}, clusters: ${finalKps}`);
    expect(items.length).toBeGreaterThan(0);
  }, 30_000);

  // --------------------------------------------------------------------------
  // Phase 2: Ingest arguments with organic dedup (production pipeline)
  // --------------------------------------------------------------------------

  it('ingests arguments with organic dedup', async () => {
    expect(items.length).toBeGreaterThan(0);

    const argumentService = getArgumentService();
    console.log(`\n=== Phase 2: Ingesting ${items.length} arguments with organic dedup ===`);
    console.log(`  (vector threshold=${VECTOR_THRESHOLD}, candidate limit=${CANDIDATE_LIMIT})`);

    // Arguments are already short atomic claims — embed directly (no extraction needed).
    console.log(`  Embedding ${items.length} argument texts...`);
    const { embeddings_1536: embeddings } = await argumentService.embedTexts(items.map(i => i.argument));
    console.log(`  Embeddings done.`);

    // Insert + dedup each argument sequentially so earlier insertions become candidates.
    let dedupCount = 0;
    for (let idx = 0; idx < items.length; idx++) {
      const item = items[idx]!;
      const embedding = embeddings[idx]!;

      if ((idx + 1) % 50 === 0 || idx === 0 || idx === items.length - 1) {
        console.log(`  [${idx + 1}/${items.length}] "${item.argument.slice(0, 70)}..."`);
      }

      // Each argument is its own "post" with a unique source_id
      const sourceId = crypto.randomUUID();
      const contentHash = crypto.createHash('sha256').update(item.argument).digest('hex');

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
         VALUES ($1, $2, 'post', $3, $4, $4, 'FACT', 1.0, 0, $5, 1.0, 1.0, 1.0, $6)`,
        [dbId, runId, sourceId, item.argument.substring(0, 4000), item.argument.length, JSON.stringify(embedding)]
      );
      item.dbINodeId = dbId;

      // D1: find similar canonical I-nodes across all sources
      const candidates = await v3Repo.findSimilarINodesAcrossSource(
        embedding, 'post', sourceId, VECTOR_THRESHOLD, CANDIDATE_LIMIT
      );

      if (candidates.length === 0) continue;

      // D2: LLM dedup validation — topic as macro context (helps LLM understand domain)
      const macroContext = item.topic.length > MAX_MACRO_CONTEXT_LENGTH
        ? item.topic.slice(0, MAX_MACRO_CONTEXT_LENGTH)
        : item.topic;

      const [dedupResult] = await argumentService.deduplicateINodes(macroContext, [{
        newINodeId: dbId,
        newINodeText: item.argument,
        epistemicType: 'FACT',
        candidates: candidates.map(c => ({ id: c.id, text: c.content, epistemicType: c.epistemic_type })),
      }]);

      if (!dedupResult || dedupResult.dedupFailed || !dedupResult.canonicalINodeId) continue;

      const knownIds = new Set(candidates.map(c => c.id));
      if (!knownIds.has(dedupResult.canonicalINodeId)) continue;

      await v3Repo.setCanonicalINode(dbId, dedupResult.canonicalINodeId);
      dedupCount++;
    }

    console.log(`Ingest complete. ${dedupCount}/${items.length} arguments deduplicated.`);
    expect(items.filter(i => i.dbINodeId).length).toBe(items.length);
  }, 600_000);

  // --------------------------------------------------------------------------
  // Phase 3: Compute per-argument dedup F1
  // --------------------------------------------------------------------------

  it('computes per-argument dedup F1', async () => {
    const inserted = items.filter(i => i.dbINodeId);
    expect(inserted.length).toBeGreaterThan(0);

    console.log('\n=== Phase 3: Computing per-argument dedup F1 ===');

    const { rows } = await testPool.query<{ id: string; canonical_i_node_id: string | null }>(
      `SELECT id, canonical_i_node_id FROM v3_nodes_i WHERE id = ANY($1)`,
      [inserted.map(i => i.dbINodeId)]
    );
    const canonicalOf = new Map<string, string | null>();
    for (const row of rows) canonicalOf.set(row.id, row.canonical_i_node_id);

    // Cluster key = topic + keyPoint (unique per topic)
    const firstCanonicalOfCluster = new Map<string, string>(); // clusterKey → first root dbId

    let tp = 0, fp = 0, fn = 0, tn = 0;

    for (const item of inserted) {
      const dbId = item.dbINodeId!;
      const clusterKey = `${item.topic}|||${item.keyPoint}`;
      const canonical = canonicalOf.get(dbId) ?? null;
      const clusterCanonical = firstCanonicalOfCluster.get(clusterKey);

      const shouldMerge = clusterCanonical !== undefined;
      const didMerge = canonical !== null;

      if (shouldMerge && didMerge && canonical === clusterCanonical) tp++;
      else if (shouldMerge && !didMerge) fn++;
      else if (!shouldMerge && !didMerge) tn++;
      else fp++; // merged to wrong cluster or spurious merge

      if (!clusterCanonical && canonical === null) {
        firstCanonicalOfCluster.set(clusterKey, dbId);
      }
    }

    function metrics(tp: number, fp: number, fn: number, tn: number) {
      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
      return { precision, recall, f1, tp, fp, fn, tn };
    }

    const allMetrics = metrics(tp, fp, fn, tn);

    // Per-topic breakdown
    const topics = [...new Set(inserted.map(i => i.topic))];
    const byTopic: Record<string, ReturnType<typeof metrics>> = {};
    for (const topic of topics) {
      const topicItems = inserted.filter(i => i.topic === topic);
      const firstOfCluster = new Map<string, string>();
      let ttp = 0, tfp = 0, tfn = 0, ttn = 0;
      for (const item of topicItems) {
        const dbId = item.dbINodeId!;
        const clusterKey = `${item.topic}|||${item.keyPoint}`;
        const canonical = canonicalOf.get(dbId) ?? null;
        const clusterCanonical = firstOfCluster.get(clusterKey);
        const shouldMerge = clusterCanonical !== undefined;
        const didMerge = canonical !== null;
        if      (shouldMerge && didMerge && canonical === clusterCanonical) ttp++;
        else if (shouldMerge && !didMerge)  tfn++;
        else if (!shouldMerge && !didMerge) ttn++;
        else                                tfp++;
        if (!clusterCanonical && canonical === null) firstOfCluster.set(clusterKey, dbId);
      }
      byTopic[topic] = metrics(ttp, tfp, tfn, ttn);
    }

    // Per-cluster size breakdown (to see if small/large clusters behave differently)
    const clusterSizes = new Map<string, number>();
    for (const item of inserted) {
      const key = `${item.topic}|||${item.keyPoint}`;
      clusterSizes.set(key, (clusterSizes.get(key) ?? 0) + 1);
    }
    const sizes = [...clusterSizes.values()];
    const avgClusterSize = sizes.reduce((a, b) => a + b, 0) / sizes.length;

    const output = {
      timestamp: new Date().toISOString(),
      dataset: 'IBM-ArgKP-train',
      itemsIngested: inserted.length,
      topicsEvaluated: topics.length,
      clustersEvaluated: clusterSizes.size,
      avgClusterSize: Math.round(avgClusterSize * 10) / 10,
      vectorThreshold: VECTOR_THRESHOLD,
      candidateLimit: CANDIDATE_LIMIT,
      metric: 'per-argument-dedup-F1',
      note: 'TP=correctly merged to same key_point cluster canonical, FP=wrong cluster or spurious, FN=should merge but did not, TN=correctly novel (first of cluster)',
      allItems: allMetrics,
      byTopic,
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));

    console.log(`\nArguments ingested: ${inserted.length} across ${topics.length} topic(s), ${clusterSizes.size} clusters`);
    console.log(`Avg cluster size: ${avgClusterSize.toFixed(1)}`);
    console.log('\nPer-argument dedup F1 (all items):');
    console.log(`  Precision: ${allMetrics.precision.toFixed(3)}`);
    console.log(`  Recall:    ${allMetrics.recall.toFixed(3)}`);
    console.log(`  F1:        ${allMetrics.f1.toFixed(3)}`);
    console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}`);
    console.log('\nPer-topic breakdown:');
    for (const [topic, m] of Object.entries(byTopic)) {
      console.log(`  "${topic.slice(0, 55)}"`);
      console.log(`    P=${m.precision.toFixed(3)} R=${m.recall.toFixed(3)} F1=${m.f1.toFixed(3)}  TP=${m.tp} FP=${m.fp} FN=${m.fn} TN=${m.tn}`);
    }
    console.log(`\nResults written to: ${RESULTS_FILE}`);

    expect(output.itemsIngested).toBeGreaterThan(0);
    expect(output.allItems.recall).toBeGreaterThan(0);
  }, 30_000);
});
