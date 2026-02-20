import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'crypto';

// ── Hoisted mocks (must be declared before vi.mock calls) ──

const mockV3Repo = vi.hoisted(() => ({
  findExistingRun: vi.fn(),
  createAnalysisRun: vi.fn(),
  updateRunStatus: vi.fn(),
  persistHypergraph: vi.fn(),
  findSimilarConcepts: vi.fn(),
  createConcept: vi.fn(),
  linkINodeToConcept: vi.fn(),
  getConceptMapsForINodes: vi.fn(),
  createEquivocationFlag: vi.fn(),
}));

const mockArgumentService = vi.hoisted(() => ({
  analyzeV3: vi.fn(),
  embedContent: vi.fn(),
  disambiguateConceptsBatch: vi.fn(),
}));

const mockLogger = vi.hoisted(() => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}));

const mockPostFindById = vi.hoisted(() => vi.fn());

// ── Module mocks ──

vi.mock('bullmq', () => ({
  Worker: vi.fn().mockImplementation(() => ({ on: vi.fn() })),
}));

vi.mock('../redisConnection.js', () => ({
  createBullMQConnection: vi.fn(() => ({})),
}));

vi.mock('../../db/pool.js', () => ({
  getPool: vi.fn(() => ({})),
}));

vi.mock('../../db/repositories/PostRepo.js', () => ({
  PostRepo: { findById: mockPostFindById },
}));

vi.mock('../../db/repositories/ReplyRepo.js', () => ({
  ReplyRepo: { findById: vi.fn() },
}));

vi.mock('../../db/repositories/V3HypergraphRepo.js', () => ({
  createV3HypergraphRepo: vi.fn(() => mockV3Repo),
}));

vi.mock('../../services/argumentService.js', () => ({
  getArgumentService: vi.fn(() => mockArgumentService),
}));

vi.mock('../../utils/logger.js', () => ({
  logger: mockLogger,
}));

// ── Import after mocks ──

import { processV3Analysis } from '../v3Worker.js';

// ── Test helpers ──

const CONTENT = 'test post content for analysis purposes';
const CONTENT_HASH = crypto.createHash('sha256').update(CONTENT).digest('hex');

function makeJob(overrides: Partial<{ sourceType: 'post' | 'reply'; sourceId: string; contentHash: string }> = {}) {
  return {
    id: 'job-test-1',
    data: {
      sourceType: 'post' as const,
      sourceId: 'test-post-1',
      contentHash: CONTENT_HASH,
      ...overrides,
    },
    updateProgress: vi.fn(),
  };
}

function makeAnalysis(hvTerms: string[] = []) {
  return {
    text_id: 'test-post-1',
    hypergraph: {
      nodes: [
        {
          node_id: 'adu-1',
          node_type: 'adu' as const,
          text: CONTENT,
          rewritten_text: 'rewritten content',
          fvp_type: 'FACT' as const,
          fvp_confidence: 0.9,
          span_start: 0,
          span_end: CONTENT.length,
          extraction_confidence: 0.9,
          high_variance_terms: hvTerms,
        },
      ],
      edges: [],
    },
    socratic_questions: [],
    extracted_values: [],
  };
}

// Fake 1536-dim embedding
const FAKE_EMBEDDING = Array(1536).fill(0.1);

beforeEach(() => {
  vi.clearAllMocks();

  // Default happy-path mock setup
  mockPostFindById.mockResolvedValue({ id: 'test-post-1', content: CONTENT });
  mockV3Repo.findExistingRun.mockResolvedValue(null);
  mockV3Repo.createAnalysisRun.mockResolvedValue({ id: 'run-1', status: 'pending' });
  mockV3Repo.updateRunStatus.mockResolvedValue(undefined);
  mockV3Repo.persistHypergraph.mockResolvedValue(new Map([['adu-1', 'db-inode-1']]));
  mockV3Repo.findSimilarConcepts.mockResolvedValue([]);
  mockV3Repo.createConcept.mockResolvedValue({
    id: 'concept-1',
    term: 'test',
    definition: 'test definition',
    created_at: new Date(),
  });
  mockV3Repo.linkINodeToConcept.mockResolvedValue(undefined);
  mockV3Repo.getConceptMapsForINodes.mockResolvedValue([]);
  mockV3Repo.createEquivocationFlag.mockResolvedValue(undefined);

  mockArgumentService.analyzeV3.mockResolvedValue({
    analyses: [makeAnalysis()],
  });
  // Default: correct number of embeddings (1 adu text + 0 terms = 1)
  mockArgumentService.embedContent.mockResolvedValue({
    embeddings_1536: [FAKE_EMBEDDING],
  });
  mockArgumentService.disambiguateConceptsBatch.mockResolvedValue([]);
});

describe('v3Worker — embedding length assertion', () => {
  it('throws when embedContent returns fewer vectors than inputs', async () => {
    const HV_TERMS = ['justice'];
    mockArgumentService.analyzeV3.mockResolvedValue({
      analyses: [makeAnalysis(HV_TERMS)],
    });
    // 1 adu + 1 term = 2 inputs, but we return only 1 vector → mismatch
    mockArgumentService.embedContent.mockResolvedValue({
      embeddings_1536: [FAKE_EMBEDDING], // should be 2
    });

    const job = makeJob();
    await expect(processV3Analysis(job as any)).rejects.toThrow(
      /embedContent returned 1 vectors for 2 inputs/
    );
  });

  it('does not throw when embedContent returns the correct number of vectors', async () => {
    const HV_TERMS = ['democracy'];
    mockArgumentService.analyzeV3.mockResolvedValue({
      analyses: [makeAnalysis(HV_TERMS)],
    });
    // 1 adu + 1 term = 2 inputs, return 2 vectors
    mockArgumentService.embedContent.mockResolvedValue({
      embeddings_1536: [FAKE_EMBEDDING, FAKE_EMBEDDING],
    });
    mockArgumentService.disambiguateConceptsBatch.mockResolvedValue([
      { term: 'democracy', matchedConceptId: null, newDefinition: 'Rule by the people' },
    ]);
    // novelTerms embed call returns 1 vector
    mockArgumentService.embedContent
      .mockResolvedValueOnce({ embeddings_1536: [FAKE_EMBEDDING, FAKE_EMBEDDING] })
      .mockResolvedValueOnce({ embeddings_1536: [FAKE_EMBEDDING] });

    const job = makeJob();
    await expect(processV3Analysis(job as any)).resolves.toBeUndefined();
  });
});

describe('v3Worker — matchedConceptId validation', () => {
  it('logs a warning and treats unknown matchedConceptId as novel', async () => {
    const HV_TERMS = ['equity'];
    mockArgumentService.analyzeV3.mockResolvedValue({
      analyses: [makeAnalysis(HV_TERMS)],
    });
    // 1 adu + 1 term = 2 embeddings
    mockArgumentService.embedContent.mockResolvedValue({
      embeddings_1536: [FAKE_EMBEDDING, FAKE_EMBEDDING],
    });
    // No candidates found in DB for 'equity'
    mockV3Repo.findSimilarConcepts.mockResolvedValue([]);
    // LLM hallucinated an unknown concept ID
    const hallucinatedId = 'unknown-concept-id-xyz';
    mockArgumentService.disambiguateConceptsBatch.mockResolvedValue([
      { term: 'equity', matchedConceptId: hallucinatedId, newDefinition: null },
    ]);

    const job = makeJob();
    await processV3Analysis(job as any);

    // Warning must be logged
    expect(mockLogger.warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown matchedConceptId'),
      expect.objectContaining({ matchedConceptId: hallucinatedId })
    );
    // createConcept should NOT be called (no newDefinition and matchedConceptId was invalid)
    expect(mockV3Repo.createConcept).not.toHaveBeenCalled();
  });

  it('uses a valid matchedConceptId without calling createConcept', async () => {
    const HV_TERMS = ['freedom'];
    const validConceptId = 'existing-concept-uuid';
    mockArgumentService.analyzeV3.mockResolvedValue({
      analyses: [makeAnalysis(HV_TERMS)],
    });
    mockArgumentService.embedContent.mockResolvedValue({
      embeddings_1536: [FAKE_EMBEDDING, FAKE_EMBEDDING],
    });
    // DB returns one candidate with our validConceptId
    mockV3Repo.findSimilarConcepts.mockResolvedValue([
      { id: validConceptId, term: 'freedom', definition: 'Absence of coercion', sampleINodeText: 'some text' },
    ]);
    // LLM matched to the valid candidate
    mockArgumentService.disambiguateConceptsBatch.mockResolvedValue([
      { term: 'freedom', matchedConceptId: validConceptId, newDefinition: null },
    ]);

    const job = makeJob();
    await processV3Analysis(job as any);

    // createConcept should NOT be called for matched terms
    expect(mockV3Repo.createConcept).not.toHaveBeenCalled();
    // linkINodeToConcept should be called with the matched concept id
    expect(mockV3Repo.linkINodeToConcept).toHaveBeenCalledWith(
      'db-inode-1',
      validConceptId,
      'freedom'
    );
  });
});

describe('v3Worker — novel concept creation', () => {
  it('calls createConcept and linkINodeToConcept for a novel term', async () => {
    const HV_TERMS = ['sovereignty'];
    mockArgumentService.analyzeV3.mockResolvedValue({
      analyses: [makeAnalysis(HV_TERMS)],
    });
    // 1 adu + 1 term = 2 embeddings for first call
    mockArgumentService.embedContent
      .mockResolvedValueOnce({ embeddings_1536: [FAKE_EMBEDDING, FAKE_EMBEDDING] }) // main embed
      .mockResolvedValueOnce({ embeddings_1536: [FAKE_EMBEDDING] }); // novel definition embed
    mockV3Repo.findSimilarConcepts.mockResolvedValue([]);
    mockArgumentService.disambiguateConceptsBatch.mockResolvedValue([
      { term: 'sovereignty', matchedConceptId: null, newDefinition: 'Supreme authority over a territory' },
    ]);
    const newConceptId = 'new-concept-uuid';
    mockV3Repo.createConcept.mockResolvedValue({
      id: newConceptId,
      term: 'sovereignty',
      definition: 'Supreme authority over a territory',
      created_at: new Date(),
    });

    const job = makeJob();
    await processV3Analysis(job as any);

    expect(mockV3Repo.createConcept).toHaveBeenCalledWith(
      'sovereignty',
      'Supreme authority over a territory',
      expect.any(Array)
    );
    expect(mockV3Repo.linkINodeToConcept).toHaveBeenCalledWith(
      'db-inode-1',
      newConceptId,
      'sovereignty'
    );
  });
});

describe('v3Worker — macro_context truncation', () => {
  it('passes truncated context when content exceeds 8000 chars', async () => {
    const longContent = 'x'.repeat(10000);
    const longHash = crypto.createHash('sha256').update(longContent).digest('hex');
    mockPostFindById.mockResolvedValue({ id: 'test-post-1', content: longContent });

    const HV_TERMS = ['term'];
    mockArgumentService.analyzeV3.mockResolvedValue({
      analyses: [makeAnalysis(HV_TERMS)],
    });
    // 1 adu + 1 term = 2 embeddings
    mockArgumentService.embedContent
      .mockResolvedValueOnce({ embeddings_1536: [FAKE_EMBEDDING, FAKE_EMBEDDING] })
      .mockResolvedValueOnce({ embeddings_1536: [FAKE_EMBEDDING] });
    mockArgumentService.disambiguateConceptsBatch.mockResolvedValue([
      { term: 'term', matchedConceptId: null, newDefinition: 'some definition' },
    ]);

    const job = makeJob({ contentHash: longHash });
    await processV3Analysis(job as any);

    // Verify disambiguateConceptsBatch was called with truncated context (≤ 8000 chars)
    const [[calledContext]] = mockArgumentService.disambiguateConceptsBatch.mock.calls;
    expect(typeof calledContext).toBe('string');
    expect((calledContext as string).length).toBeLessThanOrEqual(8000);
  });
});
