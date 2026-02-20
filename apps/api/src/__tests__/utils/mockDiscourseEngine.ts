import { vi } from 'vitest';

export interface MockDiscourseEngineConfig {
  embeddingsResponse?: { embeddings_1536: number[][] };
  disambiguateResponse?: Array<{ term: string; matchedConceptId: string | null; newDefinition: string | null }>;
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
    v3_models_loaded: true,
  }));

  const embedContent = vi.fn(async (texts: string[]) => {
    if (defaultConfig.shouldFail) {
      throw defaultConfig.failureError || new Error('discourse-engine error');
    }

    return (
      defaultConfig.embeddingsResponse || {
        embeddings_1536: texts.map(() => Array(1536).fill(0.1)),
      }
    );
  });

  const disambiguateConceptsBatch = vi.fn(async (
    _macroContext: string,
    terms: Array<{ term: string; targetINodeText: string; candidates: unknown[] }>
  ) => {
    if (defaultConfig.shouldFail) {
      throw defaultConfig.failureError || new Error('discourse-engine error');
    }

    return (
      defaultConfig.disambiguateResponse ||
      terms.map(t => ({
        term: t.term,
        matchedConceptId: null,
        newDefinition: `Default definition for ${t.term}`,
      }))
    );
  });

  return {
    healthCheck,
    embedContent,
    disambiguateConceptsBatch,
  };
}

export function mockFetch(implementation: typeof global.fetch) {
  global.fetch = vi.fn(implementation) as any;
}

export function restoreFetch() {
  vi.unmock('global.fetch');
}
