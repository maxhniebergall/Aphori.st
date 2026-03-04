/**
 * ArgSum Deduplication Evaluation (HaoBytes/ArgSum-Dataset Task_1)
 *
 * Tests Aphorist I-node deduplication accuracy against ArgSum key point analysis dataset.
 *
 * Pipeline per evidence item (mirrors production v3Worker dedup phase):
 *   1. Embed the evidence text (stands in for rewritten ADU — extraction/rewriting skipped
 *      since ArgSum evidence items are already argument units)
 *   2. Insert I-node into DB
 *   3. findSimilarINodesAcrossSource() — global semantic search, top-5, threshold 0.78
 *   4. deduplicateINodes() — LLM validation via discourse-engine
 *   5. setCanonicalINode() if match confirmed
 *
 * Metric: per-item dedup F1
 *   After all items are ingested, for each item (skipping the first of each group):
 *     TP = correctly merged to the existing canonical of its key_point_id group
 *     FP = merged to the wrong group's canonical (or spurious merge when no prior existed)
 *     FN = should have merged (prior group member exists) but was left as a new canonical
 *     TN = correctly identified as novel (first of its group, stays canonical)
 *
 * Run with:
 *   pnpm dev:discourse   # must be running
 *   cd apps/api && pnpm vitest run src/__tests__/integration/dedup-eval.test.ts
 *
 * Dry run (first topic only):
 *   DEDUP_TOPIC_LIMIT=1 pnpm vitest run src/__tests__/integration/dedup-eval.test.ts
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

const DATASET_FILE = '/tmp/ArgSum-Dataset/Dataset/Task_1/evidence_devset.csv';
const TEST_DB = 'chitin_argmining_dedup_test';
const RESULTS_FILE = path.join(__dirname, 'dedup-eval-results.json');
const TOPIC_LIMIT = parseInt(process.env.DEDUP_TOPIC_LIMIT ?? '0', 10); // 0 = all topics
const VECTOR_THRESHOLD = parseFloat(process.env.DEDUP_THRESHOLD ?? '0.78');
const CANDIDATE_LIMIT = 5;
const MAX_MACRO_CONTEXT_LENGTH = 8000;

// ---- Types ------------------------------------------------------------------

interface EvidenceItem {
  id: string;         // evi_4_0
  keyPointId: string; // kp_4_0 — ground truth cluster
  text: string;       // evidence passage
  topic: string;
  label: number;      // 0 or 1 quality rating
  dbINodeIds: string[]; // assigned after insertion (one per extracted ADU)
}

// ---- Module-level shared state ----------------------------------------------

let testPool: Pool;
let adminPool: Pool;
let v3Repo: ReturnType<typeof createV3HypergraphRepo>;

const evidenceItems: EvidenceItem[] = [];

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

(process.env.SKIP_DEDUP_EVAL ? describe.skip : describe)('ArgSum Deduplication Evaluation', () => {

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

  it('parses ArgSum evidence_devset.csv', () => {
    console.log('\n=== Phase 1: Parsing ArgSum Task_1 evidence_devset ===');

    expect(fs.existsSync(DATASET_FILE), `Dataset not found at ${DATASET_FILE}`).toBe(true);

    const content = fs.readFileSync(DATASET_FILE, 'utf-8');
    const rows = parseCSV(content);
    console.log(`Parsed ${rows.length} rows`);

    const allTopics = new Set<string>();
    for (const row of rows) {
      allTopics.add(row['topic']!);
      evidenceItems.push({
        id: row['evidence_id']!,
        keyPointId: row['key_point_id']!,
        text: row['evidence']!,
        topic: row['topic']!,
        label: parseInt(row['label'] ?? '0', 10),
        dbINodeIds: [],
      });
    }

    const uniqueTopics = [...allTopics];
    const kpIds = new Set(evidenceItems.map(e => e.keyPointId));
    console.log(`Topics (${uniqueTopics.length}): ${uniqueTopics.map(t => `"${t.slice(0, 40)}"`).join(', ')}`);
    console.log(`Unique key points: ${kpIds.size}`);
    console.log(`Evidence items: ${evidenceItems.length} (label=1: ${evidenceItems.filter(e => e.label === 1).length})`);

    if (TOPIC_LIMIT > 0) {
      const limitedTopics = new Set(uniqueTopics.slice(0, TOPIC_LIMIT));
      console.log(`\nDry run: limiting to ${TOPIC_LIMIT} topic(s): ${[...limitedTopics].map(t => `"${t.slice(0, 40)}"`).join(', ')}`);
      const before = evidenceItems.length;
      evidenceItems.splice(0, evidenceItems.length, ...evidenceItems.filter(e => limitedTopics.has(e.topic)));
      console.log(`Filtered to ${evidenceItems.length}/${before} evidence items`);
    }

    expect(evidenceItems.length).toBeGreaterThan(0);
  }, 30_000);

  // --------------------------------------------------------------------------
  // Phase 2: Ingest evidence items with organic dedup (production pipeline)
  // --------------------------------------------------------------------------

  it('ingests evidence items with organic dedup', async () => {
    expect(evidenceItems.length).toBeGreaterThan(0);

    const argumentService = getArgumentService();
    console.log(`\n=== Phase 2: Ingesting ${evidenceItems.length} evidence items with organic dedup ===`);
    console.log(`  (vector threshold=${VECTOR_THRESHOLD}, candidate limit=${CANDIDATE_LIMIT})`);

    // Run full V3 extraction on each evidence passage (mirrors production pipeline).
    // Extract in batches of 10 to avoid overwhelming the service.
    const EXTRACT_BATCH = 10;
    // Map from ev.id → list of {aduText, epistemicType}
    const extractedAdus = new Map<string, Array<{ text: string; rewrittenText: string; epistemicType: string }>>();

    console.log(`  Extracting ADUs from ${evidenceItems.length} evidence passages...`);
    for (let i = 0; i < evidenceItems.length; i += EXTRACT_BATCH) {
      const batch = evidenceItems.slice(i, i + EXTRACT_BATCH);
      const response = await argumentService.analyzeText(
        batch.map(e => ({ id: e.id, text: e.text }))
      );
      for (const analysis of response.analyses) {
        const adus = analysis.hypergraph.nodes
          .filter(n => n.node_type === 'adu' && n.text)
          .map(n => ({
            text: n.text!,
            rewrittenText: n.rewritten_text || n.text!,
            epistemicType: n.fvp_type ?? 'FACT',
          }));
        extractedAdus.set(analysis.text_id, adus.length > 0 ? adus : []);
      }
      console.log(`  Extracted ${Math.min(i + EXTRACT_BATCH, evidenceItems.length)}/${evidenceItems.length}`);
    }

    const totalAdus = [...extractedAdus.values()].reduce((s, a) => s + a.length, 0);
    const noAdus = evidenceItems.filter(e => (extractedAdus.get(e.id)?.length ?? 0) === 0).length;
    console.log(`  Extraction done. ${totalAdus} ADUs from ${evidenceItems.length} passages (${noAdus} passages yielded no ADUs).`);

    // Build flat list of (evidenceItem, aduIndex, aduText) for batch embedding.
    // Items with no ADUs fall back to their raw text.
    const aduRows: Array<{ evId: string; text: string; rewrittenText: string; epistemicType: string }> = [];
    for (const ev of evidenceItems) {
      const adus = extractedAdus.get(ev.id) ?? [];
      if (adus.length === 0) {
        aduRows.push({ evId: ev.id, text: ev.text, rewrittenText: ev.text, epistemicType: 'FACT' });
      } else {
        for (const adu of adus) {
          aduRows.push({ evId: ev.id, text: adu.text, rewrittenText: adu.rewrittenText, epistemicType: adu.epistemicType });
        }
      }
    }

    console.log(`  Embedding ${aduRows.length} ADU texts...`);
    const { embeddings_1536: embeddings } = await argumentService.embedTexts(aduRows.map(r => r.rewrittenText));
    console.log(`  Embeddings done.`);

    // Insert + dedup each ADU sequentially (organic production behaviour).
    // Group ADUs by evidence item so we use the same source_id per item.
    const sourceIdOf = new Map<string, string>(evidenceItems.map(e => [e.id, crypto.randomUUID()]));
    const runIdOf = new Map<string, string>();

    // Pre-create one analysis run per evidence item
    for (const ev of evidenceItems) {
      const contentHash = crypto.createHash('sha256').update(ev.text).digest('hex');
      const { rows: [run] } = await testPool.query<{ id: string }>(
        `INSERT INTO v3_analysis_runs (source_type, source_id, content_hash, status)
         VALUES ('post', $1, $2, 'completed') RETURNING id`,
        [sourceIdOf.get(ev.id), contentHash]
      );
      runIdOf.set(ev.id, run!.id);
    }

    let dedupCount = 0;
    for (let idx = 0; idx < aduRows.length; idx++) {
      const row = aduRows[idx]!;
      const ev = evidenceItems.find(e => e.id === row.evId)!;
      const embedding = embeddings[idx]!;
      const sourceId = sourceIdOf.get(row.evId)!;
      const runId = runIdOf.get(row.evId)!;

      if (idx % 20 === 0 || idx === aduRows.length - 1) {
        console.log(`  [${idx + 1}/${aduRows.length}] ${row.evId}: "${row.rewrittenText.slice(0, 60)}..."`);
      }

      const dbId = crypto.randomUUID();
      await testPool.query(
        `INSERT INTO v3_nodes_i (id, analysis_run_id, source_type, source_id,
           content, rewritten_text, epistemic_type, fvp_confidence,
           span_start, span_end, extraction_confidence, base_weight, evidence_rank,
           embedding)
         VALUES ($1, $2, 'post', $3, $4, $5, $6, 1.0, 0, $7, 1.0, 1.0, 1.0, $8)`,
        [dbId, runId, sourceId, row.text.substring(0, 4000), row.rewrittenText.substring(0, 4000),
         row.epistemicType, row.rewrittenText.length, JSON.stringify(embedding)]
      );
      ev.dbINodeIds.push(dbId);

      // D1: find similar canonical I-nodes across all sources
      const candidates = await v3Repo.findSimilarINodesAcrossSource(
        embedding, 'post', sourceId, VECTOR_THRESHOLD, CANDIDATE_LIMIT
      );

      if (candidates.length === 0) continue;

      // D2: LLM dedup validation
      const macroContext = ev.text.length > MAX_MACRO_CONTEXT_LENGTH
        ? ev.text.slice(0, MAX_MACRO_CONTEXT_LENGTH)
        : ev.text;

      const [dedupResult] = await argumentService.deduplicateINodes(macroContext, [{
        newINodeId: dbId,
        newINodeText: row.rewrittenText,
        epistemicType: row.epistemicType,
        candidates: candidates.map(c => ({ id: c.id, text: c.content, epistemicType: c.epistemic_type })),
      }]);

      if (!dedupResult || dedupResult.dedupFailed || !dedupResult.canonicalINodeId) continue;

      const knownIds = new Set(candidates.map(c => c.id));
      if (!knownIds.has(dedupResult.canonicalINodeId)) continue;

      await v3Repo.setCanonicalINode(dbId, dedupResult.canonicalINodeId);
      dedupCount++;
    }

    console.log(`Ingest complete. ${dedupCount}/${aduRows.length} ADUs deduplicated.`);
    expect(evidenceItems.filter(e => e.dbINodeIds.length > 0).length).toBe(evidenceItems.length);
  }, 600_000);

  // --------------------------------------------------------------------------
  // Phase 3: Compute per-item dedup F1
  // --------------------------------------------------------------------------

  it('computes per-item dedup F1', async () => {
    const inserted = evidenceItems.filter(e => e.dbINodeIds.length > 0);
    expect(inserted.length).toBeGreaterThan(0);

    console.log('\n=== Phase 3: Computing per-item dedup F1 ===');

    // Fetch final canonical_i_node_id for every inserted ADU I-node
    const allDbIds = inserted.flatMap(e => e.dbINodeIds);
    const { rows } = await testPool.query<{ id: string; canonical_i_node_id: string | null }>(
      `SELECT id, canonical_i_node_id FROM v3_nodes_i WHERE id = ANY($1)`,
      [allDbIds]
    );
    const canonicalOf = new Map<string, string | null>();
    for (const row of rows) canonicalOf.set(row.id, row.canonical_i_node_id);

    // Per-item classification.
    // Each evidence item may have multiple ADU I-nodes. An item "merged correctly" if
    // ANY of its ADU I-nodes was merged to the correct group canonical.
    // The group canonical is the first ADU I-node (of any evidence item with the same
    // key_point_id) that has canonical_i_node_id IS NULL.
    const firstCanonicalOfGroup = new Map<string, string>(); // keyPointId → first root dbId

    function classifyItem(ev: EvidenceItem): 'tp' | 'fp' | 'fn' | 'tn' {
      const groupCanonical = firstCanonicalOfGroup.get(ev.keyPointId);
      const shouldMerge = groupCanonical !== undefined;

      // Check each ADU I-node for this item
      const canonicals = ev.dbINodeIds.map(id => canonicalOf.get(id) ?? null);
      const anyCorrectMerge = canonicals.some(c => c !== null && c === groupCanonical);
      const anyMerge = canonicals.some(c => c !== null);

      // Register new group canonical from this item's roots (if none yet)
      if (!groupCanonical) {
        const firstRoot = ev.dbINodeIds.find(id => (canonicalOf.get(id) ?? null) === null);
        if (firstRoot) firstCanonicalOfGroup.set(ev.keyPointId, firstRoot);
      }

      if (shouldMerge && anyCorrectMerge) return 'tp';
      if (shouldMerge && !anyMerge) return 'fn';
      if (!shouldMerge && !anyMerge) return 'tn';
      return 'fp'; // wrong merge or spurious merge
    }

    let tp = 0, fp = 0, fn = 0, tn = 0;
    let tp1 = 0, fp1 = 0, fn1 = 0, tn1 = 0;

    for (const ev of inserted) {
      const verdict = classifyItem(ev);
      if (verdict === 'tp') { tp++; if (ev.label === 1) tp1++; }
      else if (verdict === 'fp') { fp++; if (ev.label === 1) fp1++; }
      else if (verdict === 'fn') { fn++; if (ev.label === 1) fn1++; }
      else { tn++; if (ev.label === 1) tn1++; }
    }

    function metrics(tp: number, fp: number, fn: number, tn: number) {
      const precision = tp + fp > 0 ? tp / (tp + fp) : 0;
      const recall    = tp + fn > 0 ? tp / (tp + fn) : 0;
      const f1        = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;
      return { precision, recall, f1, tp, fp, fn, tn };
    }

    const allMetrics  = metrics(tp,  fp,  fn,  tn);
    const label1Metrics = metrics(tp1, fp1, fn1, tn1);

    // Per-topic breakdown
    const topics = [...new Set(inserted.map(e => e.topic))];
    const byTopic: Record<string, ReturnType<typeof metrics>> = {};
    for (const topic of topics) {
      const topicItems = inserted.filter(e => e.topic === topic);
      const topicGroupCanonical = new Map<string, string>();
      let ttp = 0, tfp = 0, tfn = 0, ttn = 0;
      for (const ev of topicItems) {
        const tGroupCanonical = topicGroupCanonical.get(ev.keyPointId);
        const tShouldMerge = tGroupCanonical !== undefined;
        const tCanonicals = ev.dbINodeIds.map(id => canonicalOf.get(id) ?? null);
        const tAnyCorrect = tCanonicals.some(c => c !== null && c === tGroupCanonical);
        const tAnyMerge = tCanonicals.some(c => c !== null);
        if (!tGroupCanonical) {
          const firstRoot = ev.dbINodeIds.find(id => (canonicalOf.get(id) ?? null) === null);
          if (firstRoot) topicGroupCanonical.set(ev.keyPointId, firstRoot);
        }
        if      (tShouldMerge && tAnyCorrect)  ttp++;
        else if (tShouldMerge && !tAnyMerge)   tfn++;
        else if (!tShouldMerge && !tAnyMerge)  ttn++;
        else                                    tfp++;
      }
      byTopic[topic] = metrics(ttp, tfp, tfn, ttn);
    }

    const output = {
      timestamp: new Date().toISOString(),
      dataset: 'ArgSum-Task1-devset',
      itemsIngested: inserted.length,
      adusExtracted: inserted.reduce((s, e) => s + e.dbINodeIds.length, 0),
      topicsEvaluated: topics.length,
      vectorThreshold: VECTOR_THRESHOLD,
      candidateLimit: CANDIDATE_LIMIT,
      metric: 'per-item-dedup-F1',
      note: 'TP=correctly merged to existing group canonical, FP=merged to wrong group or spurious merge, FN=should have merged but did not, TN=correctly novel',
      allItems: allMetrics,
      label1Only: label1Metrics,
      byTopic,
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(output, null, 2));

    console.log(`\nItems ingested: ${inserted.length} across ${topics.length} topic(s)`);
    console.log('\nPer-item dedup F1 (all items):');
    console.log(`  Precision: ${allMetrics.precision.toFixed(3)}`);
    console.log(`  Recall:    ${allMetrics.recall.toFixed(3)}`);
    console.log(`  F1:        ${allMetrics.f1.toFixed(3)}`);
    console.log(`  TP=${tp}  FP=${fp}  FN=${fn}  TN=${tn}`);
    console.log('\nPer-item dedup F1 (label=1 only):');
    console.log(`  Precision: ${label1Metrics.precision.toFixed(3)}`);
    console.log(`  Recall:    ${label1Metrics.recall.toFixed(3)}`);
    console.log(`  F1:        ${label1Metrics.f1.toFixed(3)}`);
    console.log(`  TP=${tp1}  FP=${fp1}  FN=${fn1}  TN=${tn1}`);
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
