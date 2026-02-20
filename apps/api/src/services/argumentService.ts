import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import type { V3AnalyzeTextResponse } from '@chitin/shared';

export type ADUType = 'MajorClaim' | 'Supporting' | 'Opposing' | 'Evidence';

export interface ADUResponse {
  source_id: string;
  adu_type: ADUType;
  text: string;
  span_start: number;
  span_end: number;
  confidence: number;
  target_index: number | null; // Array index of parent ADU
  rewritten_text?: string; // Anaphora-resolved version
}

// Legacy relation response - kept for cross-post relations
export interface RelationResponse {
  source_adu_id: string;
  target_adu_id: string;
  relation_type: 'support' | 'attack';
  confidence: number;
}

export interface ClaimValidationResult {
  is_equivalent: boolean;
  canonical_claim_id: string | null;
  explanation: string;
}

class DiscourseEngineService {
  private baseUrl: string;
  private timeout: number = 300000; // 5 minutes for model warmup

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

  async healthCheck(): Promise<{ status: string; models_loaded: boolean }> {
    return this.request('/health', 'GET');
  }

  /**
   * Analyze text to extract ADUs with V2 ontology (hierarchical types)
   * Returns ADUs with target_index for building argument trees
   */
  async analyzeADUs(texts: Array<{ id: string; text: string }>) {
    logger.info('Calling discourse-engine analyzeADUs', { textCount: texts.length });

    const response = await this.request<{ adus: ADUResponse[] }>(
      '/analyze/adus',
      'POST',
      { texts }
    );

    return response;
  }

  async analyzeRelations(
    adus: Array<{ id: string; text: string; source_comment_id?: string }>,
    embeddings: number[][]
  ) {
    logger.info('Calling discourse-engine analyzeRelations', {
      aduCount: adus.length,
      embeddingDim: embeddings[0]?.length,
    });

    const response = await this.request<{ relations: RelationResponse[] }>(
      '/analyze/relations',
      'POST',
      { adus, embeddings }
    );

    return response;
  }

  async embedContent(texts: string[]) {
    logger.info('Calling discourse-engine embedContent', { textCount: texts.length });

    const response = await this.request<{ embeddings: number[][] }>(
      '/embed/content',
      'POST',
      { texts }
    );

    // Normalize field name from discourse-engine response
    return { embeddings_1536: response.embeddings };
  }

  /**
   * V3 analysis: extract neurosymbolic hypergraph from texts
   */
  async analyzeV3(texts: Array<{ id: string; text: string }>): Promise<V3AnalyzeTextResponse> {
    logger.info('Calling discourse-engine V3 analyze-text', { textCount: texts.length });
    return this.request<V3AnalyzeTextResponse>('/v3/analyze-text', 'POST', { texts });
  }

  async validateClaimEquivalence(
    newClaim: string,
    candidates: Array<{ id: string; text: string; similarity: number }>
  ): Promise<ClaimValidationResult> {
    logger.info('Calling discourse-engine validateClaimEquivalence', {
      newClaim,
      candidateCount: candidates.length,
    });

    const response = await this.request<ClaimValidationResult>(
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

    logger.info('LLM validation result', {
      is_equivalent: response.is_equivalent,
      canonical_claim_id: response.canonical_claim_id,
    });

    return response;
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

  try {
    const health = await argumentService.healthCheck();
    logger.info('discourse-engine health check', health);

    if (!health.models_loaded) {
      logger.warn('discourse-engine models still loading, will retry on first request');
    }
  } catch (error) {
    logger.error('discourse-engine healthcheck failed', { error });
    throw error;
  }
}
