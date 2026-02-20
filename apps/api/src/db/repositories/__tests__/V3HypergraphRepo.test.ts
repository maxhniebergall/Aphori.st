import { describe, it, expect, beforeEach } from 'vitest';
import { v4 as uuidv4 } from 'uuid';
import { createV3HypergraphRepo } from '../V3HypergraphRepo.js';

// Use the global testDb set up by setup.ts
function getRepo() {
  return createV3HypergraphRepo(globalThis.testDb.getPool());
}

// Helper to create a fake 1536-dim embedding (all zeros except one slot)
function fakeEmbedding(seed: number = 0): number[] {
  const emb = new Array(1536).fill(0);
  emb[seed % 1536] = 1;
  return emb;
}

// Helper: insert an analysis run and return its id
async function createRun(
  sourceType: 'post' | 'reply' = 'post',
  sourceId?: string,
  contentHash?: string
): Promise<string> {
  const repo = getRepo();
  const run = await repo.createAnalysisRun(
    sourceType,
    sourceId ?? uuidv4(),
    contentHash ?? uuidv4()
  );
  return run.id;
}

// Helper: insert a minimal i-node and return its id
async function createINode(runId: string, sourceId?: string): Promise<string> {
  const pool = globalThis.testDb.getPool();
  const result = await pool.query(
    `INSERT INTO v3_nodes_i (analysis_run_id, source_type, source_id, content, epistemic_type, fvp_confidence, span_start, span_end, extraction_confidence)
     VALUES ($1, 'post', $2, 'test content', 'FACT', 0.9, 0, 12, 0.9)
     RETURNING id`,
    [runId, sourceId ?? uuidv4()]
  );
  return result.rows[0].id;
}

describe('V3HypergraphRepo — createConcept', () => {
  it('inserts a concept and returns it', async () => {
    const repo = getRepo();
    const emb = fakeEmbedding(1);
    const concept = await repo.createConcept('justice', 'Fairness in treatment', emb);

    expect(concept.id).toBeTruthy();
    expect(concept.term).toBe('justice');
    expect(concept.definition).toBe('Fairness in treatment');
    expect(concept.created_at).toBeInstanceOf(Date);
  });

  it('is idempotent: calling twice with the same term updates definition and returns consistent shape', async () => {
    const repo = getRepo();
    const emb1 = fakeEmbedding(1);
    const emb2 = fakeEmbedding(2);

    const first = await repo.createConcept('liberty', 'Freedom from constraint', emb1);
    const second = await repo.createConcept('liberty', 'Freedom of action', emb2);

    // Both calls must return the same id (ON CONFLICT DO UPDATE)
    expect(second.id).toBe(first.id);
    expect(second.term).toBe('liberty');
    // Definition should reflect the updated value
    expect(second.definition).toBe('Freedom of action');
  });

  it('concurrent inserts with the same term do not create duplicates', async () => {
    const repo = getRepo();
    const pool = globalThis.testDb.getPool();
    const emb = fakeEmbedding(3);

    // Serial simulation of concurrent inserts
    await repo.createConcept('equality', 'Sameness of rights', emb);
    await repo.createConcept('equality', 'Equal treatment under law', emb);

    const result = await pool.query(
      `SELECT COUNT(*) as cnt FROM v3_concept_nodes WHERE term = $1`,
      ['equality']
    );
    expect(parseInt(result.rows[0].cnt)).toBe(1);
  });
});

describe('V3HypergraphRepo — findSimilarConcepts', () => {
  beforeEach(async () => {
    // Insert a known concept with a non-zero embedding
    const repo = getRepo();
    await repo.createConcept('democracy', 'Rule by the people', fakeEmbedding(10));
    await repo.createConcept('monarchy', 'Rule by a monarch', fakeEmbedding(100));
  });

  it('returns a concept above the similarity threshold', async () => {
    const repo = getRepo();
    // Use the exact same embedding as 'democracy' → similarity = 1.0
    const results = await repo.findSimilarConcepts(fakeEmbedding(10), 0.85, 3);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const match = results.find(r => r.term === 'democracy');
    expect(match).toBeDefined();
    expect(match!.similarity).toBeGreaterThanOrEqual(0.85);
  });

  it('respects the limit parameter', async () => {
    const repo = getRepo();
    // Both concepts exist; ask for limit=1
    const results = await repo.findSimilarConcepts(fakeEmbedding(10), 0.0, 1);
    expect(results.length).toBeLessThanOrEqual(1);
  });

  it('filters out concepts below the threshold', async () => {
    const repo = getRepo();
    // fakeEmbedding(10) is orthogonal to fakeEmbedding(100),
    // so cosine similarity between them is 0 < 0.85 threshold
    const results = await repo.findSimilarConcepts(fakeEmbedding(10), 0.85, 3);
    const monarchy = results.find(r => r.term === 'monarchy');
    expect(monarchy).toBeUndefined();
  });
});

describe('V3HypergraphRepo — linkINodeToConcept', () => {
  it('links an i-node to a concept', async () => {
    const repo = getRepo();
    const pool = globalThis.testDb.getPool();

    const runId = await createRun();
    const iNodeId = await createINode(runId);
    const concept = await repo.createConcept('freedom', 'Absence of coercion', fakeEmbedding(5));

    await repo.linkINodeToConcept(iNodeId, concept.id, 'freedom');

    const result = await pool.query(
      `SELECT * FROM v3_i_node_concept_map WHERE i_node_id = $1`,
      [iNodeId]
    );
    expect(result.rows.length).toBe(1);
    expect(result.rows[0].concept_id).toBe(concept.id);
    expect(result.rows[0].term_text).toBe('freedom');
  });

  it('is idempotent (ON CONFLICT DO NOTHING)', async () => {
    const repo = getRepo();
    const pool = globalThis.testDb.getPool();

    const runId = await createRun();
    const iNodeId = await createINode(runId);
    const concept = await repo.createConcept('truth', 'Correspondence with reality', fakeEmbedding(6));

    await repo.linkINodeToConcept(iNodeId, concept.id, 'truth');
    await repo.linkINodeToConcept(iNodeId, concept.id, 'truth'); // should not throw

    const result = await pool.query(
      `SELECT COUNT(*) as cnt FROM v3_i_node_concept_map WHERE i_node_id = $1 AND term_text = 'truth'`,
      [iNodeId]
    );
    expect(parseInt(result.rows[0].cnt)).toBe(1);
  });
});

describe('V3HypergraphRepo — getConceptMapsForINodes', () => {
  it('returns mappings for given i-node IDs', async () => {
    const repo = getRepo();

    const runId = await createRun();
    const iNodeId = await createINode(runId);
    const concept = await repo.createConcept('power', 'Ability to act', fakeEmbedding(7));

    await repo.linkINodeToConcept(iNodeId, concept.id, 'power');

    const maps = await repo.getConceptMapsForINodes([iNodeId]);
    expect(maps.length).toBe(1);
    expect(maps[0]!.i_node_id).toBe(iNodeId);
    expect(maps[0]!.concept_id).toBe(concept.id);
    expect(maps[0]!.term_text).toBe('power');
  });

  it('returns empty array for empty input', async () => {
    const repo = getRepo();
    const maps = await repo.getConceptMapsForINodes([]);
    expect(maps).toEqual([]);
  });
});
