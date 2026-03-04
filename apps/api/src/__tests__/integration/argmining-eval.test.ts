/**
 * AIFdb QT30 ADU Extraction & Connection Eval (ArgMining Paper Section 6)
 *
 * Tests what Aphorist claims to do: extract ADUs from raw locution text and
 * reconstruct the argument graph as accurately as human AIF annotators did.
 *
 * Run with:
 *   pnpm dev:discourse   # must be running
 *   cd apps/api && pnpm vitest run src/__tests__/integration/argmining-eval.test.ts
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

const QT30_DIR = '/Users/mh/Documents/Argumentmining/qt30';
const TEST_DB = 'chitin_argmining_test';
const GT_DB = 'chitin_argmining_gt';
const RESULTS_FILE = path.join(__dirname, 'argmining-results.json');
const SAMPLE_SIZE = parseInt(process.env.ARGMINING_SAMPLE_SIZE ?? '100', 10);
const COSINE_THRESHOLD = 0.80;

// ---- Types ------------------------------------------------------------------

interface AifNode {
  nodeID: string;
  text: string;
  type: string;
}

interface AifEdge {
  fromID: string;
  toID: string;
}

interface FileGraph {
  fileId: string;
  nodeMap: Map<string, AifNode>;
  outEdges: Map<string, string[]>;
  inEdges: Map<string, string[]>;
}

interface SelectedLocution {
  lNodeId: string;
  fileId: string;
  lText: string;
  iNodeIds: string[];        // AIF I-node IDs connected via YA
  fileGraph: FileGraph;
}

interface TestRecord {
  lNodeId: string;
  testRunId: string;
  extractedINodeDbIds: string[];
  sNodeDbIds: string[];
}

interface GtRecord {
  lNodeId: string;
  gtINodeDbIds: string[];   // DB UUIDs for AIF I-nodes
  aifToDb: Map<string, string>; // aifId → db UUID
}

// ---- Module-level shared state across test blocks ---------------------------

let testPool: Pool;
let gtPool: Pool;
let adminPool: Pool;

let selectedLocutions: SelectedLocution[] = [];
let testRecords: TestRecord[] = [];
let gtRecords: GtRecord[] = [];

// ---- Helpers ----------------------------------------------------------------

function buildFileGraph(raw: { nodes: AifNode[]; edges: AifEdge[] }, fileId: string): FileGraph {
  const nodeMap = new Map<string, AifNode>();
  const outEdges = new Map<string, string[]>();
  const inEdges = new Map<string, string[]>();

  for (const node of raw.nodes || []) {
    nodeMap.set(node.nodeID, node);
  }

  for (const edge of raw.edges || []) {
    if (!outEdges.has(edge.fromID)) outEdges.set(edge.fromID, []);
    outEdges.get(edge.fromID)!.push(edge.toID);
    if (!inEdges.has(edge.toID)) inEdges.set(edge.toID, []);
    inEdges.get(edge.toID)!.push(edge.fromID);
  }

  return { fileId, nodeMap, outEdges, inEdges };
}

/** L → YA → I traversal: returns I-node IDs reachable from this L-node */
function getLNodeINodes(lNodeId: string, g: FileGraph): string[] {
  const result: string[] = [];
  for (const mid of g.outEdges.get(lNodeId) ?? []) {
    if (g.nodeMap.get(mid)?.type === 'YA') {
      for (const iId of g.outEdges.get(mid) ?? []) {
        if (g.nodeMap.get(iId)?.type === 'I') result.push(iId);
      }
    }
  }
  return result;
}

/** Returns I-node IDs that participate in at least one RA or CA node in the graph */
function getINodesWithRelations(g: FileGraph): Set<string> {
  const result = new Set<string>();
  for (const [nodeId, node] of g.nodeMap) {
    if (node.type === 'RA' || node.type === 'CA') {
      // Premises: I-nodes pointing INTO this S-node
      for (const src of g.inEdges.get(nodeId) ?? []) {
        if (g.nodeMap.get(src)?.type === 'I') result.add(src);
      }
      // Conclusions: I-nodes pointed to BY this S-node
      for (const tgt of g.outEdges.get(nodeId) ?? []) {
        if (g.nodeMap.get(tgt)?.type === 'I') result.add(tgt);
      }
    }
  }
  return result;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i]! * b[i]!;
    normA += a[i]! * a[i]!;
    normB += b[i]! * b[i]!;
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
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

(process.env.SKIP_ARGMINING_EVAL ? describe.skip : describe)('AIFdb QT30 Evaluation', () => {

  beforeAll(async () => {
    adminPool = new Pool({
      host: process.env.DB_HOST || 'localhost',
      port: parseInt(process.env.DB_PORT || '5432', 10),
      user: process.env.DB_USER || 'chitin',
      password: process.env.DB_PASSWORD || 'chitin_dev',
      database: process.env.DB_NAME || 'chitin',
    });

    [testPool, gtPool] = await Promise.all([
      createDb(adminPool, TEST_DB),
      createDb(adminPool, GT_DB),
    ]);
  }, 60_000);

  afterAll(async () => {
    if (testPool && gtPool) {
      await Promise.all([
        dropDb(adminPool, testPool, TEST_DB),
        dropDb(adminPool, gtPool, GT_DB),
      ]);
    }
    if (adminPool) await adminPool.end();
  });

  // --------------------------------------------------------------------------
  // Phase 1: Parse QT30 & select 100 locutions
  // --------------------------------------------------------------------------

  it('parses QT30 and selects 100 eligible locutions', () => {
    console.log('\n=== Phase 1: Parsing AIFdb JSON files ===');

    const jsonFiles = fs.readdirSync(QT30_DIR).filter(f => f.endsWith('.json'));
    console.log(`Found ${jsonFiles.length} JSON files`);

    const eligible: SelectedLocution[] = [];

    for (const file of jsonFiles) {
      const fileId = file.replace('.json', '');
      const raw = JSON.parse(fs.readFileSync(path.join(QT30_DIR, file), 'utf-8'));
      const g = buildFileGraph(raw, fileId);

      const iNodesWithRel = getINodesWithRelations(g);

      for (const [nodeId, node] of g.nodeMap) {
        if (node.type !== 'L') continue;
        const iNodeIds = getLNodeINodes(nodeId, g);
        if (iNodeIds.length === 0) continue;
        if (!iNodeIds.some(id => iNodesWithRel.has(id))) continue;

        eligible.push({
          lNodeId: nodeId,
          fileId,
          lText: node.text,
          iNodeIds,
          fileGraph: g,
        });
      }
    }

    console.log(`Eligible L-nodes: ${eligible.length}`);

    // Shuffle deterministically by sorting on hash, then shuffle with Math.random
    const shuffled = eligible.sort(() => Math.random() - 0.5);
    const sampled = shuffled.slice(0, SAMPLE_SIZE);

    // Sort by fileId, then by lNodeId within file (stable ordering for context)
    sampled.sort((a, b) => {
      if (a.fileId !== b.fileId) return a.fileId.localeCompare(b.fileId);
      return a.lNodeId.localeCompare(b.lNodeId);
    });

    selectedLocutions = sampled;

    console.log(`Selected ${selectedLocutions.length} locutions from ${new Set(sampled.map(l => l.fileId)).size} debate files`);
    expect(selectedLocutions.length).toBe(SAMPLE_SIZE);
  }, 30_000);

  // --------------------------------------------------------------------------
  // Phase 3: Ingest via Aphorist pipeline into test_db
  // --------------------------------------------------------------------------

  it('ingests 100 locutions via Aphorist pipeline', async () => {
    expect(selectedLocutions.length).toBe(SAMPLE_SIZE);

    const argumentService = getArgumentService();
    console.log('\n=== Phase 3: Aphorist pipeline ingest ===');

    // Track per-debate: sourceIds already inserted, for context retrieval
    const debateSourceIds = new Map<string, string[]>(); // fileId → sourceId[]

    for (let idx = 0; idx < selectedLocutions.length; idx++) {
      const loc = selectedLocutions[idx]!;
      const { lNodeId, fileId, lText } = loc;

      console.log(`  [${idx + 1}/${SAMPLE_SIZE}] file=${fileId} lNode=${lNodeId}`);

      // 1. Create analysis run for this locution
      const contentHash = crypto.createHash('sha256').update(`${fileId}:${lNodeId}`).digest('hex');
      const sourceId = crypto.randomUUID();
      const runResult = await testPool.query(
        `INSERT INTO v3_analysis_runs (source_type, source_id, content_hash, status)
         VALUES ('post', $1, $2, 'completed')
         RETURNING id`,
        [sourceId, contentHash]
      );
      const runId: string = runResult.rows[0].id;

      // 2. Get context nodes from same debate (top-10 by similarity to lText)
      const sameDebateSrcIds = debateSourceIds.get(fileId) ?? [];
      let contextNodes: Array<{ id: string; text: string }> = [];

      if (sameDebateSrcIds.length > 0) {
        try {
          const [locEmb] = (await argumentService.embedTexts([lText.substring(0, 2000)])).embeddings_1536;
          if (locEmb && locEmb.length > 0) {
            const vecStr = `[${locEmb.join(',')}]`;
            const ctxRows = await testPool.query<{ id: string; content: string }>(
              `SELECT id, content FROM v3_nodes_i
               WHERE source_id = ANY($1::uuid[]) AND embedding IS NOT NULL
               ORDER BY embedding <=> $2::vector
               LIMIT 10`,
              [sameDebateSrcIds, vecStr]
            );
            contextNodes = ctxRows.rows.map(r => ({ id: r.id, text: r.content }));
          }
        } catch (err) {
          console.warn(`    Context retrieval failed: ${(err as Error).message}`);
        }
      }

      // 3. analyzeText
      let analysis: { hypergraph?: { nodes?: any[]; edges?: any[] } } | null = null;
      try {
        const resp = await argumentService.analyzeText([{
          id: lNodeId,
          text: lText.substring(0, 4000),
          context_nodes: contextNodes.slice(0, 10),
        }]);
        analysis = resp.analyses?.[0] ?? null;
      } catch (err) {
        console.warn(`    analyzeText failed: ${(err as Error).message}`);
      }

      // 4. Extract ADU nodes from hypergraph
      const aduNodes: Array<{ tempId: string; text: string; fvpType: string; fvpConf: number }> = [];
      const sNodes: Array<{ direction: string; premiseTempIds: string[]; conclusionTempIds: string[] }> = [];

      if (analysis?.hypergraph) {
        const hg = analysis.hypergraph;
        const nodesByTempId = new Map<string, { node_type: string; fvp_type?: string; fvp_confidence?: number; content?: string; text?: string }>();
        for (const n of hg.nodes ?? []) {
          nodesByTempId.set(n.id ?? n.temp_id, n);
          if (n.node_type === 'adu') {
            aduNodes.push({
              tempId: n.id ?? n.temp_id,
              text: (n.content ?? n.text ?? '').substring(0, 4000),
              fvpType: n.fvp_type ?? 'FACT',
              fvpConf: n.fvp_confidence ?? 1.0,
            });
          }
        }
        for (const e of hg.edges ?? []) {
          if (e.edge_type === 'SUPPORT' || e.edge_type === 'ATTACK') {
            sNodes.push({
              direction: e.edge_type,
              premiseTempIds: Array.isArray(e.premise_ids) ? e.premise_ids : (e.premise_id ? [e.premise_id] : []),
              conclusionTempIds: Array.isArray(e.conclusion_ids) ? e.conclusion_ids : (e.conclusion_id ? [e.conclusion_id] : []),
            });
          }
        }
      }

      // 5. Embed ADU texts
      const aduDbIds: string[] = [];
      const tempToDbId = new Map<string, string>();

      if (aduNodes.length > 0) {
        let embeddings: number[][] = [];
        try {
          const resp = await argumentService.embedTexts(aduNodes.map(n => n.text));
          embeddings = resp.embeddings_1536;
        } catch (err) {
          console.warn(`    embedTexts failed: ${(err as Error).message}`);
          embeddings = aduNodes.map(() => []);
        }

        for (let j = 0; j < aduNodes.length; j++) {
          const adu = aduNodes[j]!;
          const dbId = crypto.randomUUID();
          tempToDbId.set(adu.tempId, dbId);
          aduDbIds.push(dbId);

          const vec = embeddings[j];
          const vecStr = vec && vec.length > 0 ? `[${vec.join(',')}]` : null;

          await testPool.query(
            `INSERT INTO v3_nodes_i (id, analysis_run_id, source_type, source_id,
               content, epistemic_type, fvp_confidence, span_start, span_end,
               extraction_confidence, base_weight, evidence_rank${vecStr ? ', embedding' : ''})
             VALUES ($1, $2, 'post', $3, $4, $5, $6, 0, 1, 1.0, 1.0, 1.0${vecStr ? ', $7::vector' : ''})`,
            vecStr
              ? [dbId, runId, sourceId, adu.text, adu.fvpType, adu.fvpConf, vecStr]
              : [dbId, runId, sourceId, adu.text, adu.fvpType, adu.fvpConf]
          );
        }
      }

      // 6. Insert S-nodes from hypergraph
      const insertedSNodeIds: string[] = [];
      for (const sn of sNodes) {
        const premDbIds = sn.premiseTempIds.map(t => tempToDbId.get(t)).filter(Boolean) as string[];
        const concDbIds = sn.conclusionTempIds.map(t => tempToDbId.get(t)).filter(Boolean) as string[];
        if (premDbIds.length === 0 || concDbIds.length === 0) continue;

        const sDbId = crypto.randomUUID();
        try {
          await testPool.query(
            `INSERT INTO v3_nodes_s (id, analysis_run_id, direction, confidence, gap_detected)
             VALUES ($1, $2, $3, 1.0, false)`,
            [sDbId, runId, sn.direction]
          );
          for (const pid of premDbIds) {
            await testPool.query(
              `INSERT INTO v3_edges (scheme_node_id, node_id, node_type, role) VALUES ($1, $2, 'i_node', 'premise')`,
              [sDbId, pid]
            );
          }
          for (const cid of concDbIds) {
            await testPool.query(
              `INSERT INTO v3_edges (scheme_node_id, node_id, node_type, role) VALUES ($1, $2, 'i_node', 'conclusion')`,
              [sDbId, cid]
            );
          }
          insertedSNodeIds.push(sDbId);
        } catch (err) {
          console.warn(`    S-node insert failed: ${(err as Error).message}`);
        }
      }

      // 7. Dedup new I-nodes against earlier same-debate I-nodes
      if (aduDbIds.length > 0 && sameDebateSrcIds.length > 0) {
        try {
          // Load new I-nodes with embeddings
          const newIRows = await testPool.query<{ id: string; content: string; epistemic_type: string; embedding: string }>(
            `SELECT id, content, epistemic_type, embedding FROM v3_nodes_i WHERE id = ANY($1::uuid[]) AND embedding IS NOT NULL`,
            [aduDbIds]
          );

          for (const newI of newIRows.rows) {
            // Find top-5 canonical candidates from other sources in same debate
            const candRows = await testPool.query<{ id: string; content: string; epistemic_type: string }>(
              `SELECT id, content, epistemic_type FROM v3_nodes_i
               WHERE source_id = ANY($1::uuid[]) AND canonical_i_node_id IS NULL AND id != $2
               ORDER BY embedding <=> $3::vector
               LIMIT 5`,
              [sameDebateSrcIds, newI.id, newI.embedding]
            );

            if (candRows.rows.length === 0) continue;

            const dedupResults = await argumentService.deduplicateINodes(
              lText.substring(0, 500),
              [{
                newINodeId: newI.id,
                newINodeText: newI.content,
                epistemicType: newI.epistemic_type,
                candidates: candRows.rows.map(r => ({
                  id: r.id,
                  text: r.content,
                  epistemicType: r.epistemic_type,
                })),
              }]
            );

            for (const result of dedupResults) {
              if (result.canonicalINodeId && !result.dedupFailed) {
                await testPool.query(
                  `UPDATE v3_nodes_i SET canonical_i_node_id = $1 WHERE id = $2`,
                  [result.canonicalINodeId, result.newINodeId]
                );
              }
            }
          }
        } catch (err) {
          console.warn(`    Dedup failed: ${(err as Error).message}`);
        }
      }

      // Track sourceId for future context queries in same debate
      if (!debateSourceIds.has(fileId)) debateSourceIds.set(fileId, []);
      debateSourceIds.get(fileId)!.push(sourceId);

      testRecords.push({
        lNodeId,
        testRunId: runId,
        extractedINodeDbIds: aduDbIds,
        sNodeDbIds: insertedSNodeIds,
      });
    }

    console.log(`Pipeline ingest complete. Records: ${testRecords.length}`);
    expect(testRecords.length).toBe(SAMPLE_SIZE);
  }, 1_800_000);

  // --------------------------------------------------------------------------
  // Phase 4: Ingest AIF ground truth directly into gt_db
  // --------------------------------------------------------------------------

  it('ingests 100 locutions via direct AIF load', async () => {
    expect(selectedLocutions.length).toBe(SAMPLE_SIZE);

    console.log('\n=== Phase 4: Direct AIF ground truth ingest ===');

    // Collect all AIF I-node IDs that appear in our 100 locutions
    const allSelectedINodeAifIds = new Set<string>();
    for (const loc of selectedLocutions) {
      for (const iId of loc.iNodeIds) allSelectedINodeAifIds.add(iId);
    }

    // Single shared analysis run for the GT DB
    const gtRunResult = await gtPool.query(
      `INSERT INTO v3_analysis_runs (source_type, source_id, content_hash, status)
       VALUES ('post', uuid_generate_v4(), $1, 'completed')
       RETURNING id`,
      [crypto.createHash('sha256').update('qt30-aif-gt').digest('hex')]
    );
    const gtRunId: string = gtRunResult.rows[0].id;

    // Map aifId → dbId for all I-nodes in our set
    const globalAifToDb = new Map<string, string>();
    for (const aifId of allSelectedINodeAifIds) {
      globalAifToDb.set(aifId, crypto.randomUUID());
    }

    // Insert all I-nodes
    for (const loc of selectedLocutions) {
      const g = loc.fileGraph;
      for (const aifId of loc.iNodeIds) {
        const dbId = globalAifToDb.get(aifId)!;
        const node = g.nodeMap.get(aifId)!;
        const sourceId = crypto.randomUUID();
        try {
          await gtPool.query(
            `INSERT INTO v3_nodes_i (id, analysis_run_id, source_type, source_id,
               content, epistemic_type, fvp_confidence, span_start, span_end,
               extraction_confidence, base_weight, evidence_rank)
             VALUES ($1, $2, 'post', $3, $4, 'FACT', 1.0, 0, 1, 1.0, 1.0, 1.0)
             ON CONFLICT (id) DO NOTHING`,
            [dbId, gtRunId, sourceId, (node.text ?? '').substring(0, 4000)]
          );
        } catch (err) {
          // May already exist if multiple locutions share an I-node
        }
      }

      // Insert S-nodes for RA/CA relations where both sides are in our set
      const g2 = loc.fileGraph;
      for (const [nodeId, node] of g2.nodeMap) {
        if (node.type !== 'RA' && node.type !== 'CA') continue;

        const direction = node.type === 'RA' ? 'SUPPORT' : 'ATTACK';
        const premAifIds = (g2.inEdges.get(nodeId) ?? []).filter(id => g2.nodeMap.get(id)?.type === 'I');
        const concAifIds = (g2.outEdges.get(nodeId) ?? []).filter(id => g2.nodeMap.get(id)?.type === 'I');

        // Only include if all endpoints are in our selected set
        if (!premAifIds.every(id => allSelectedINodeAifIds.has(id))) continue;
        if (!concAifIds.every(id => allSelectedINodeAifIds.has(id))) continue;
        if (premAifIds.length === 0 || concAifIds.length === 0) continue;

        const sDbId = crypto.randomUUID();
        try {
          await gtPool.query(
            `INSERT INTO v3_nodes_s (id, analysis_run_id, direction, confidence, gap_detected)
             VALUES ($1, $2, $3, 1.0, false)`,
            [sDbId, gtRunId, direction]
          );
          for (const aifId of premAifIds) {
            const dbId = globalAifToDb.get(aifId);
            if (!dbId) continue;
            await gtPool.query(
              `INSERT INTO v3_edges (scheme_node_id, node_id, node_type, role) VALUES ($1, $2, 'i_node', 'premise')`,
              [sDbId, dbId]
            );
          }
          for (const aifId of concAifIds) {
            const dbId = globalAifToDb.get(aifId);
            if (!dbId) continue;
            await gtPool.query(
              `INSERT INTO v3_edges (scheme_node_id, node_id, node_type, role) VALUES ($1, $2, 'i_node', 'conclusion')`,
              [sDbId, dbId]
            );
          }
        } catch (err) {
          // Skip on conflict or error
        }
      }

      gtRecords.push({
        lNodeId: loc.lNodeId,
        gtINodeDbIds: loc.iNodeIds.map(aifId => globalAifToDb.get(aifId)!).filter(Boolean),
        aifToDb: globalAifToDb,
      });
    }

    console.log(`GT ingest complete. Records: ${gtRecords.length}`);
    expect(gtRecords.length).toBe(SAMPLE_SIZE);
  }, 60_000);

  // --------------------------------------------------------------------------
  // Phase 5: Compute and report metrics
  // --------------------------------------------------------------------------

  it('computes and reports ADU F1 + Edge F1', async () => {
    expect(testRecords.length).toBe(SAMPLE_SIZE);
    expect(gtRecords.length).toBe(SAMPLE_SIZE);

    console.log('\n=== Phase 5: Computing metrics ===');

    const argumentService = getArgumentService();

    // Load all GT I-nodes with text (need to embed them for matching)
    const allGtDbIds = [...new Set(gtRecords.flatMap(r => r.gtINodeDbIds))];
    const gtINodeRows = await gtPool.query<{ id: string; content: string }>(
      `SELECT id, content FROM v3_nodes_i WHERE id = ANY($1::uuid[])`,
      [allGtDbIds]
    );
    const gtINodeMap = new Map<string, string>(gtINodeRows.rows.map(r => [r.id, r.content]));

    // Embed all GT I-node texts in batches
    const EMBED_BATCH = 50;
    const gtEmbeddings = new Map<string, number[]>(); // dbId → embedding
    const gtIds = [...gtINodeMap.keys()];

    console.log(`Embedding ${gtIds.length} GT I-nodes...`);
    for (let i = 0; i < gtIds.length; i += EMBED_BATCH) {
      const batch = gtIds.slice(i, i + EMBED_BATCH);
      const texts = batch.map(id => (gtINodeMap.get(id) ?? '').substring(0, 2000));
      try {
        const { embeddings_1536 } = await argumentService.embedTexts(texts);
        for (let j = 0; j < batch.length; j++) {
          const emb = embeddings_1536[j];
          if (emb && emb.length > 0) gtEmbeddings.set(batch[j]!, emb);
        }
      } catch (err) {
        console.warn(`  GT embed batch ${i} failed: ${(err as Error).message}`);
      }
    }

    // Load all test I-nodes with embeddings
    const allTestDbIds = [...new Set(testRecords.flatMap(r => r.extractedINodeDbIds))];
    let testINodeRows: Array<{ id: string; content: string; embedding_raw: string }> = [];
    if (allTestDbIds.length > 0) {
      const rows = await testPool.query<{ id: string; content: string; embedding: string }>(
        `SELECT id, content, embedding::text as embedding FROM v3_nodes_i WHERE id = ANY($1::uuid[]) AND embedding IS NOT NULL`,
        [allTestDbIds]
      );
      testINodeRows = rows.rows.map(r => ({ id: r.id, content: r.content, embedding_raw: r.embedding }));
    }

    // Parse test embeddings
    const testEmbeddings = new Map<string, number[]>();
    for (const row of testINodeRows) {
      try {
        // PostgreSQL vector format: [0.1,0.2,...] or {0.1,0.2,...}
        const str = row.embedding_raw.replace(/[{}\[\]]/g, '');
        const vec = str.split(',').map(Number);
        testEmbeddings.set(row.id, vec);
      } catch {
        // skip
      }
    }

    console.log(`GT I-nodes: ${allGtDbIds.length}, embedded: ${gtEmbeddings.size}`);
    console.log(`Test I-nodes: ${allTestDbIds.length}, with embeddings: ${testEmbeddings.size}`);

    // ---- ADU Detection F1 ---------------------------------------------------
    let totalPrecision = 0, totalRecall = 0, totalF1 = 0;
    let locutionsWithGt = 0;

    // Build matched pairs: gtId → testId (greedy, by cosine desc)
    for (let i = 0; i < SAMPLE_SIZE; i++) {
      const tr = testRecords[i]!;
      const gr = gtRecords[i]!;

      const gtIds = gr.gtINodeDbIds.filter(id => gtEmbeddings.has(id));
      const testIds = tr.extractedINodeDbIds.filter(id => testEmbeddings.has(id));

      if (gtIds.length === 0) continue;
      locutionsWithGt++;

      // Greedy 1:1 matching by cosine similarity
      const usedTestIds = new Set<string>();
      let matched = 0;

      for (const gId of gtIds) {
        const gEmb = gtEmbeddings.get(gId)!;
        let bestSim = -1, bestTId = '';
        for (const tId of testIds) {
          if (usedTestIds.has(tId)) continue;
          const tEmb = testEmbeddings.get(tId)!;
          const sim = cosineSim(gEmb, tEmb);
          if (sim > bestSim) { bestSim = sim; bestTId = tId; }
        }
        if (bestSim >= COSINE_THRESHOLD && bestTId) {
          usedTestIds.add(bestTId);
          matched++;
        }
      }

      const precision = testIds.length > 0 ? matched / testIds.length : 0;
      const recall = gtIds.length > 0 ? matched / gtIds.length : 0;
      const f1 = precision + recall > 0 ? 2 * precision * recall / (precision + recall) : 0;

      totalPrecision += precision;
      totalRecall += recall;
      totalF1 += f1;
    }

    const aduPrecision = locutionsWithGt > 0 ? totalPrecision / locutionsWithGt : 0;
    const aduRecall = locutionsWithGt > 0 ? totalRecall / locutionsWithGt : 0;
    const aduF1 = locutionsWithGt > 0 ? totalF1 / locutionsWithGt : 0;

    // ---- Edge F1 ------------------------------------------------------------

    // Load GT edges (S-nodes + their connected I-node DB IDs)
    const gtSNodeRows = await gtPool.query<{ s_id: string; direction: string; node_id: string; role: string }>(
      `SELECT ns.id as s_id, ns.direction, e.node_id, e.role
       FROM v3_nodes_s ns
       JOIN v3_edges e ON e.scheme_node_id = ns.id AND e.node_type = 'i_node'`
    );

    // Build gt edge set: {direction, premiseIds, conclusionIds} per S-node
    const gtSMap = new Map<string, { direction: string; premIds: Set<string>; concIds: Set<string> }>();
    for (const row of gtSNodeRows.rows) {
      if (!gtSMap.has(row.s_id)) gtSMap.set(row.s_id, { direction: row.direction, premIds: new Set(), concIds: new Set() });
      const info = gtSMap.get(row.s_id)!;
      if (row.role === 'premise') info.premIds.add(row.node_id);
      else if (row.role === 'conclusion') info.concIds.add(row.node_id);
    }

    // Load test edges
    const testSNodeRows = await testPool.query<{ s_id: string; direction: string; node_id: string; role: string }>(
      `SELECT ns.id as s_id, ns.direction, e.node_id, e.role
       FROM v3_nodes_s ns
       JOIN v3_edges e ON e.scheme_node_id = ns.id AND e.node_type = 'i_node'`
    );

    const testSMap = new Map<string, { direction: string; premIds: Set<string>; concIds: Set<string> }>();
    for (const row of testSNodeRows.rows) {
      if (!testSMap.has(row.s_id)) testSMap.set(row.s_id, { direction: row.direction, premIds: new Set(), concIds: new Set() });
      const info = testSMap.get(row.s_id)!;
      if (row.role === 'premise') info.premIds.add(row.node_id);
      else if (row.role === 'conclusion') info.concIds.add(row.node_id);
    }

    // For edge matching: build reverse GT I-node embedding lookup
    // Map each gtId → best matching testId (if cosine ≥ threshold)
    const gtToTestMatch = new Map<string, string>();
    for (const [gId, gEmb] of gtEmbeddings) {
      let bestSim = -1, bestTId = '';
      for (const [tId, tEmb] of testEmbeddings) {
        const sim = cosineSim(gEmb, tEmb);
        if (sim > bestSim) { bestSim = sim; bestTId = tId; }
      }
      if (bestSim >= COSINE_THRESHOLD && bestTId) {
        gtToTestMatch.set(gId, bestTId);
      }
    }

    // For each GT S-node, check if test_db has a matching S-node
    let gtEdgesMatched = 0;
    const totalGtEdges = gtSMap.size;

    for (const [, gtInfo] of gtSMap) {
      // Map GT I-node IDs to test I-node IDs
      const mappedPremIds = [...gtInfo.premIds].map(id => gtToTestMatch.get(id)).filter(Boolean) as string[];
      const mappedConcIds = [...gtInfo.concIds].map(id => gtToTestMatch.get(id)).filter(Boolean) as string[];

      if (mappedPremIds.length === 0 || mappedConcIds.length === 0) continue;

      // Check if test_db has an S-node of same direction connecting these mapped nodes
      const mappedPremSet = new Set(mappedPremIds);
      const mappedConcSet = new Set(mappedConcIds);

      for (const [, testInfo] of testSMap) {
        if (testInfo.direction !== gtInfo.direction) continue;
        const premOverlap = [...testInfo.premIds].filter(id => mappedPremSet.has(id)).length;
        const concOverlap = [...testInfo.concIds].filter(id => mappedConcSet.has(id)).length;
        if (premOverlap > 0 && concOverlap > 0) {
          gtEdgesMatched++;
          break;
        }
      }
    }

    const totalTestEdges = testSMap.size;
    // Count test edges that have at least one GT match
    let testEdgesCorrect = 0;
    for (const [, testInfo] of testSMap) {
      // Reverse: map test I-node IDs to GT I-node IDs
      const testToGt = new Map<string, string>();
      for (const [gId, tId] of gtToTestMatch) testToGt.set(tId, gId);

      const mappedPremIds = [...testInfo.premIds].map(id => testToGt.get(id)).filter(Boolean) as string[];
      const mappedConcIds = [...testInfo.concIds].map(id => testToGt.get(id)).filter(Boolean) as string[];

      if (mappedPremIds.length === 0 || mappedConcIds.length === 0) continue;

      const mappedPremSet = new Set(mappedPremIds);
      const mappedConcSet = new Set(mappedConcIds);

      for (const [, gtInfo] of gtSMap) {
        if (gtInfo.direction !== testInfo.direction) continue;
        const premOverlap = [...gtInfo.premIds].filter(id => mappedPremSet.has(id)).length;
        const concOverlap = [...gtInfo.concIds].filter(id => mappedConcSet.has(id)).length;
        if (premOverlap > 0 && concOverlap > 0) {
          testEdgesCorrect++;
          break;
        }
      }
    }

    const edgePrecision = totalTestEdges > 0 ? testEdgesCorrect / totalTestEdges : 0;
    const edgeRecall = totalGtEdges > 0 ? gtEdgesMatched / totalGtEdges : 0;
    const edgeF1 = edgePrecision + edgeRecall > 0
      ? 2 * edgePrecision * edgeRecall / (edgePrecision + edgeRecall) : 0;

    // ---- Dedup Rate ---------------------------------------------------------
    const dedupRow = await testPool.query<{ total: string; deduped: string }>(
      `SELECT COUNT(*) as total, COUNT(canonical_i_node_id) as deduped FROM v3_nodes_i`
    );
    const totalTestINodes = parseInt(dedupRow.rows[0]!.total, 10);
    const dedupedINodes = parseInt(dedupRow.rows[0]!.deduped, 10);
    const dedupRate = totalTestINodes > 0 ? dedupedINodes / totalTestINodes : 0;

    // ---- Report -------------------------------------------------------------
    const results = {
      timestamp: new Date().toISOString(),
      dataset: 'QT30',
      locutionsProcessed: SAMPLE_SIZE,
      cosineThreshold: COSINE_THRESHOLD,
      aduDetection: {
        precision: aduPrecision,
        recall: aduRecall,
        f1: aduF1,
        locutionsWithGroundTruth: locutionsWithGt,
      },
      edgeF1: {
        precision: edgePrecision,
        recall: edgeRecall,
        f1: edgeF1,
        totalGtEdges,
        totalTestEdges,
        gtEdgesMatched,
        testEdgesCorrect,
      },
      dedupRate: {
        rate: dedupRate,
        totalINodes: totalTestINodes,
        dedupedINodes,
      },
    };

    fs.writeFileSync(RESULTS_FILE, JSON.stringify(results, null, 2));

    console.log('\n=== Results ===');
    console.log('ADU Detection:');
    console.log(`  Precision: ${aduPrecision.toFixed(3)}`);
    console.log(`  Recall:    ${aduRecall.toFixed(3)}`);
    console.log(`  F1:        ${aduF1.toFixed(3)}`);
    console.log('Edge F1:');
    console.log(`  Precision: ${edgePrecision.toFixed(3)} (${testEdgesCorrect}/${totalTestEdges})`);
    console.log(`  Recall:    ${edgeRecall.toFixed(3)} (${gtEdgesMatched}/${totalGtEdges})`);
    console.log(`  F1:        ${edgeF1.toFixed(3)}`);
    console.log(`Dedup Rate: ${(dedupRate * 100).toFixed(1)}% (${dedupedINodes}/${totalTestINodes})`);
    console.log(`\nResults written to: ${RESULTS_FILE}`);

    // Sanity assertions
    expect(results.locutionsProcessed).toBe(SAMPLE_SIZE);
    expect(results.aduDetection.recall).toBeGreaterThan(0);
  }, 60_000);
});
