import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

  async healthCheck(): Promise<{ status: string; v3_models_loaded: boolean }> {
    return this.request('/health', 'GET');
  }

  async embedContent(texts: string[]) {
    return this.request<{ embeddings_1536: number[][] }>('/embed/content', 'POST', { texts });
  }

  async disambiguateConceptsBatch(
    macroContext: string,
    terms: Array<{
      term: string;
      targetINodeText: string;
      candidates: Array<{ id: string; term: string; definition: string; sampleINodeText: string }>;
    }>
  ) {
    const response = await this.request<{
      results: Array<{ term: string; matched_concept_id: string | null; new_definition: string | null }>;
    }>('/v3/disambiguate-concepts', 'POST', {
      macro_context: macroContext,
      terms: terms.map(t => ({
        term: t.term,
        target_i_node_text: t.targetINodeText,
        candidates: t.candidates.map(c => ({
          id: c.id,
          term: c.term,
          definition: c.definition,
          sample_i_node_text: c.sampleINodeText,
        })),
      })),
    });

    return response.results.map(r => ({
      term: r.term,
      matchedConceptId: r.matched_concept_id,
      newDefinition: r.new_definition,
    }));
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

  describe('disambiguateConceptsBatch', () => {
    it('should match term to an existing concept candidate', async () => {
      const mockResponse = {
        results: [
          { term: 'freedom', matched_concept_id: 'concept-123', new_definition: null },
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

      const result = await service.disambiguateConceptsBatch(
        'We need more freedom in this country.',
        [
          {
            term: 'freedom',
            targetINodeText: 'We need more freedom',
            candidates: [
              { id: 'concept-123', term: 'freedom', definition: 'Absence of government coercion', sampleINodeText: 'Freedom means no state control' },
            ],
          },
        ]
      );

      expect(result).toHaveLength(1);
      expect(result[0]!.term).toBe('freedom');
      expect(result[0]!.matchedConceptId).toBe('concept-123');
      expect(result[0]!.newDefinition).toBeNull();

      const fetchCall = (fetch as any).mock.calls[0];
      const body = JSON.parse(fetchCall[1].body);
      expect(body.macro_context).toBe('We need more freedom in this country.');
      expect(body.terms[0].term).toBe('freedom');
      expect(body.terms[0].target_i_node_text).toBe('We need more freedom');
    });

    it('should return a new definition when no candidate matches', async () => {
      const mockResponse = {
        results: [
          { term: 'justice', matched_concept_id: null, new_definition: 'Procedural fairness in legal processes' },
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

      const result = await service.disambiguateConceptsBatch(
        'Justice requires fair trials.',
        [
          {
            term: 'justice',
            targetINodeText: 'Justice requires fair trials',
            candidates: [],
          },
        ]
      );

      expect(result[0]!.matchedConceptId).toBeNull();
      expect(result[0]!.newDefinition).toBe('Procedural fairness in legal processes');
    });

    it('should handle multiple terms in a single call', async () => {
      const mockResponse = {
        results: [
          { term: 'freedom', matched_concept_id: 'concept-1', new_definition: null },
          { term: 'equality', matched_concept_id: null, new_definition: 'Equal treatment under law' },
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

      const result = await service.disambiguateConceptsBatch('Freedom and equality matter.', [
        { term: 'freedom', targetINodeText: 'Freedom matters', candidates: [{ id: 'concept-1', term: 'freedom', definition: 'Liberty', sampleINodeText: 'Liberty from coercion' }] },
        { term: 'equality', targetINodeText: 'Equality matters', candidates: [] },
      ]);

      expect(result).toHaveLength(2);
      expect(result[0]!.matchedConceptId).toBe('concept-1');
      expect(result[1]!.newDefinition).toBe('Equal treatment under law');
    });

    it('should throw on service error', async () => {
      vi.stubGlobal(
        'fetch',
        vi.fn(() =>
          Promise.resolve(
            new Response('Internal server error', { status: 500 })
          )
        )
      );

      await expect(
        service.disambiguateConceptsBatch('context', [{ term: 'test', targetINodeText: 'test', candidates: [] }])
      ).rejects.toThrow('discourse-engine error: 500');
    });
  });

  describe('health check', () => {
    it('should check service health and v3 model status', async () => {
      const mockResponse = {
        status: 'ok',
        v3_models_loaded: true,
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
      expect(health.v3_models_loaded).toBe(true);

      expect(fetch).toHaveBeenCalledWith(
        'http://localhost:8000/health',
        expect.objectContaining({
          method: 'GET',
        })
      );
    });
  });
});
