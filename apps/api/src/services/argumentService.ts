import { Agent } from 'undici';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import type { V3AnalyzeTextResponse } from '@chitin/shared';

const undiciAgent = new Agent({ headersTimeout: 0, bodyTimeout: 0 });

class DiscourseEngineService {
  private baseUrl: string;
  private timeout: number = 1800000; // 30 minutes

  constructor(baseUrl: string) {
    this.baseUrl = baseUrl;
  }

  private async request<T>(
    path: string,
    method: string = 'POST',
    body?: unknown
  ): Promise<T> {
    const url = `${this.baseUrl}${path}`;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), this.timeout);

    try {
      const response = await fetch(url, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: body ? JSON.stringify(body) : undefined,
        signal: controller.signal,
        dispatcher: undiciAgent,
      });

      if (!response.ok) {
        const error = await response.text();
        logger.error(`discourse-engine error: ${response.status}`, { url, error });
        throw new Error(`discourse-engine error: ${response.status}`);
      }

      return response.json() as Promise<T>;
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') {
        logger.error('discourse-engine timeout', { url, timeout: this.timeout });
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

  private async _requestEmbeddings(texts: string[]): Promise<{ embeddings_1536: number[][] }> {
    logger.info('Calling discourse-engine /embed/content', { textCount: texts.length });

    const response = await this.request<{ embeddings: number[][] }>(
      '/embed/content',
      'POST',
      { texts }
    );

    // Normalize field name from discourse-engine response
    return { embeddings_1536: response.embeddings };
  }

  /**
   * Embed a single search query for semantic search.
   * Called synchronously in the request-response cycle.
   */
  async embedSearchQuery(query: string): Promise<number[]> {
    const response = await this._requestEmbeddings([query]);
    const embedding = response.embeddings_1536[0];
    if (!embedding) {
      throw new Error('Failed to generate realtime search embedding');
    }
    return embedding;
  }

  /**
   * Embed a batch of texts for argument analysis (ADUs, values, concept definitions).
   * Uses the realtime Gemini embedding API.
   */
  async embedTexts(texts: string[]): Promise<{ embeddings_1536: number[][] }> {
    return this._requestEmbeddings(texts);
  }

  /**
   * Extract neurosymbolic hypergraph from texts via the realtime Gemini API.
   */
  async analyzeText(texts: Array<{ id: string; text: string }>): Promise<V3AnalyzeTextResponse> {
    logger.info('Calling discourse-engine V3 analyze-text', { textCount: texts.length });
    return this.request<V3AnalyzeTextResponse>('/v3/analyze-text', 'POST', { texts });
  }

  /**
   * Disambiguate contested terms against known concept candidates via the realtime Gemini API.
   * Sends 1 HTTP request; discourse engine fans out to N parallel Gemini calls internally.
   */
  async disambiguateConcepts(
    macroContext: string,
    terms: Array<{
      term: string;
      targetINodeText: string;
      candidates: Array<{ id: string; term: string; definition: string; sampleINodeText: string }>;
    }>
  ): Promise<Array<{ term: string; matchedConceptId: string | null; newDefinition: string | null }>> {
    logger.info('Calling discourse-engine disambiguate-concepts', { termCount: terms.length });

    const response = await this.request<{
      results: Array<{ term: string; matched_concept_id: string | null; new_definition: string | null }>;
    }>(
      '/v3/disambiguate-concepts',
      'POST',
      {
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
      }
    );

    return response.results.map(r => ({
      term: r.term,
      matchedConceptId: r.matched_concept_id,
      newDefinition: r.new_definition,
    }));
  }
}

let service: DiscourseEngineService | null = null;

export function getArgumentService(): DiscourseEngineService {
  if (!service) {
    service = new DiscourseEngineService(config.discourseEngineUrl);
  }
  return service;
}

export async function initArgumentService(): Promise<void> {
  const argumentService = getArgumentService();
  const maxAttempts = 12;
  const baseDelayMs = 2000;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      const health = await argumentService.healthCheck();
      logger.info('discourse-engine health check', health);
      if (!health.v3_models_loaded) {
        logger.warn('discourse-engine V3 models still loading, will retry on first request');
      }
      return;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (attempt === maxAttempts) {
        logger.error('discourse-engine unavailable after retries', { error: message, attempts: maxAttempts });
        throw error;
      }
      const delayMs = baseDelayMs * attempt;
      logger.warn('discourse-engine not ready yet, retrying...', { attempt, maxAttempts, delayMs });
      await new Promise(resolve => setTimeout(resolve, delayMs));
    }
  }
}
