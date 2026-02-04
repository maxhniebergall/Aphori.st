import { vi } from 'vitest';
import type {
  ADUResponse,
  RelationResponse,
  ClaimValidationResult,
} from '../../services/argumentService.js';

export interface MockDiscourseEngineConfig {
  aduResponse?: { adus: ADUResponse[] };
  relationsResponse?: { relations: RelationResponse[] };
  embeddingsResponse?: { embeddings_768: number[][] };
  validationResponse?: ClaimValidationResult;
  shouldFail?: boolean;
  failureError?: Error;
}

export function createMockDiscourseEngine(config?: MockDiscourseEngineConfig) {
  const defaultConfig = {
    shouldFail: false,
    ...config,
  };

  const healthCheck = vi.fn(async () => ({
    status: 'ok',
    models_loaded: true,
  }));

  const analyzeADUs = vi.fn(async (texts: Array<{ id: string; text: string }>) => {
    if (defaultConfig.shouldFail) {
      throw defaultConfig.failureError || new Error('discourse-engine error');
    }

    return (
      defaultConfig.aduResponse || {
        adus: texts.map((t, idx) => ({
          id: `adu_${idx}`,
          adu_type: idx % 2 === 0 ? ('claim' as const) : ('premise' as const),
          text: t.text,
          span_start: 0,
          span_end: t.text.length,
          confidence: 0.95,
        })),
      }
    );
  });

  const analyzeRelations = vi.fn(async (
    adus: Array<{ id: string; text: string }>,
    embeddings: number[][]
  ) => {
    if (defaultConfig.shouldFail) {
      throw defaultConfig.failureError || new Error('discourse-engine error');
    }

    return (
      defaultConfig.relationsResponse || {
        relations: [],
      }
    );
  });

  const embedContent = vi.fn(async (texts: string[]) => {
    if (defaultConfig.shouldFail) {
      throw defaultConfig.failureError || new Error('discourse-engine error');
    }

    return (
      defaultConfig.embeddingsResponse || {
        embeddings_768: texts.map(() => Array(768).fill(0.1)),
      }
    );
  });

  const validateClaimEquivalence = vi.fn(async (
    newClaim: string,
    candidates: Array<{ id: string; text: string; similarity: number }>
  ) => {
    if (defaultConfig.shouldFail) {
      throw defaultConfig.failureError || new Error('discourse-engine error');
    }

    return (
      defaultConfig.validationResponse || {
        is_equivalent: false,
        canonical_claim_id: null,
        explanation: 'Claims are not equivalent',
      }
    );
  });

  return {
    healthCheck,
    analyzeADUs,
    analyzeRelations,
    embedContent,
    validateClaimEquivalence,
  };
}

export function mockFetch(implementation: typeof global.fetch) {
  global.fetch = vi.fn(implementation) as any;
}

export function restoreFetch() {
  vi.unmock('global.fetch');
}
