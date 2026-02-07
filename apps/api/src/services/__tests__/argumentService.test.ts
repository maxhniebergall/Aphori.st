import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import type { ADUResponse, RelationResponse } from '../argumentService.js';

// Simple implementation for testing
class TestDiscourseEngineService {
  private baseUrl: string;
  private timeout: number = 300000;

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(path: string, method: string = 'POST', body?: unknown): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });

      if (!response.ok) {
        await response.text();
        throw new Error(`discourse-engine error: ${response.status}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        throw new Error('discourse-engine timeout');
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  async healthCheck(): Promise<{ status: string; models_loaded: boolean }> {
    return this.request('/health', 'GET');
  }

  async analyzeADUs(texts: Array<{ id: string; text: string }>) {
    return this.request<{ adus: ADUResponse[] }>('/analyze/adus', 'POST', { texts });
  }

  async analyzeRelations(adus: Array<{ id: string; text: string; source_comment_id?: string }>, embeddings: number[][]) {
    return this.request<{ relations: RelationResponse[] }>('/analyze/relations', 'POST', {
      adus,
      embeddings,
    });
  }

  async embedContent(texts: string[]) {
    return this.request<{ embeddings_1536: number[][] }>('/embed/content', 'POST', { texts });
  }

  async validateClaimEquivalence(
    newClaim: string,
    candidates: Array<{ id: string; text: string; similarity: number }>
  ) {
    return this.request<{ is_equivalent: boolean; canonical_claim_id: string | null; explanation: string }>(
      '/validate/claim-equivalence',
      'POST',
      {
        new_claim: newClaim,
        candidates: candidates.map(c => ({
          id: c.id,
          text: c.text,
          similarity: c.similarity,
        })),
      }
    );
  }
}

describe('DiscourseEngineService', () => {
  let service: TestDiscourseEngineService;

  beforeEach(() => {
    vi.clearAllMocks();
    service = new TestDiscourseEngineService('http://localhost:8000');
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('analyzeADUs', () => {
    it('should call discourse-engine with correct payload', async () => {
      const mockResponse = {
        adus: [
          { id: 'adu_1', adu_type: 'claim' as const, text: 'Test claim', span_start: 0, span_end: 10, confidence: 0.95 },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const result = await service.analyzeADUs([{ id: 'test_1', text: 'Test content' }]);

      expect(result.adus).toHaveLength(1);
      expect(result.adus[0]).toMatchObject({
        adu_type: 'claim',
        text: 'Test claim',
        confidence: 0.95,
      });

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/analyze/adus',
        expect.objectContaining({
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
        })
      );
    });

    it('should handle empty ADU response', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify({ adus: [] }), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const result = await service.analyzeADUs([{ id: 'test_1', text: 'No ADUs here' }]);

      expect(result.adus).toHaveLength(0);
    });

    it('should throw on service error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response('Internal server error', {
              status: 500,
            })
          )
        )
      );

      await expect(service.analyzeADUs([{ id: 'test_1', text: 'Test' }])).rejects.toThrow(
        'discourse-engine error: 500'
      );
    });
  });

  describe('analyzeRelations', () => {
    it('should send ADUs and embeddings to service', async () => {
      const mockResponse = {
        relations: [
          {
            source_adu_id: 'adu_1',
            target_adu_id: 'adu_2',
            relation_type: 'support' as const,
            confidence: 0.85,
          },
        ],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const adus = [
        { id: 'adu_1', text: 'Claim 1' },
        { id: 'adu_2', text: 'Claim 2' },
      ];
      const embeddings = [
        Array(1536).fill(0.1),
        Array(1536).fill(0.2),
      ];

      const result = await service.analyzeRelations(adus, embeddings);

      expect(result.relations).toHaveLength(1);
      expect(result.relations[0]).toMatchObject({
        relation_type: 'support',
        confidence: 0.85,
      });
    });
  });

  describe('embedContent', () => {
    it('should request 1536-dimensional embeddings', async () => {
      const mockResponse = {
        embeddings_1536: [Array(1536).fill(0.1), Array(1536).fill(0.2)],
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const result = await service.embedContent(['Text 1', 'Text 2']);

      expect(result.embeddings_1536).toHaveLength(2);
      expect(result.embeddings_1536[0]).toHaveLength(1536);
      expect(result.embeddings_1536[1]).toHaveLength(1536);
    });
  });

  describe('validateClaimEquivalence', () => {
    it('should send candidates with similarity scores to LLM', async () => {
      const mockResponse = {
        is_equivalent: true,
        canonical_claim_id: 'canonical_123',
        explanation: 'Claims are equivalent',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const result = await service.validateClaimEquivalence('New claim text', [
        { id: 'canonical_1', text: 'Existing claim', similarity: 0.82 },
        { id: 'canonical_2', text: 'Another claim', similarity: 0.76 },
      ]);

      expect(result.is_equivalent).toBe(true);
      expect(result.canonical_claim_id).toBe('canonical_123');

      const fetchCall = (fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.candidates).toHaveLength(2);
      expect(body.candidates[0]).toMatchObject({
        text: 'Existing claim',
        similarity: 0.82,
      });
    });

    it('should parse structured output correctly', async () => {
      const mockResponse = {
        is_equivalent: false,
        canonical_claim_id: null,
        explanation: 'Claims diverge on key points',
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const result = await service.validateClaimEquivalence('Claim A', [
        { id: 'canonical_1', text: 'Claim B', similarity: 0.65 },
      ]);

      expect(result.is_equivalent).toBe(false);
      expect(result.canonical_claim_id).toBeNull();
      expect(result.explanation).toContain('diverge');
    });
  });

  describe('health check', () => {
    it('should check service health and model status', async () => {
      const mockResponse = {
        status: 'ok',
        models_loaded: true,
      };

      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response(JSON.stringify(mockResponse), {
              status: 200,
              headers: { 'Content-Type': 'application/json' },
            })
          )
        )
      );

      const health = await service.healthCheck();

      expect(health.status).toBe('ok');
      expect(health.models_loaded).toBe(true);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });
});
