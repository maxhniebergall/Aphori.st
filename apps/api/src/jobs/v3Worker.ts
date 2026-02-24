import { Worker, Job } from 'bullmq';
import type { V3HypergraphNode, V3HypergraphEdge } from '@chitin/shared';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { PostRepo } from '../db/repositories/PostRepo.js';
import { ReplyRepo } from '../db/repositories/ReplyRepo.js';
import { getArgumentService } from '../services/argumentService.js';
import { getPool } from '../db/pool.js';
import { createBullMQConnection } from './redisConnection.js';

interface V3AnalysisJobData {
  sourceType: 'post' | 'reply';
  sourceId: string;
  contentHash: string;
}

const connection = createBullMQConnection('v3-worker');

export async function processV3Analysis(job: Job<V3AnalysisJobData>): Promise<void> {
  const { sourceType, sourceId, contentHash } = job.data;
  const pool = getPool();
  const v3Repo = createV3HypergraphRepo(pool);
  const argumentService = getArgumentService();

  logger.info(`V3 worker: received job ${job.id}`, {
    sourceType,
    sourceId,
    contentHash: contentHash.substring(0, 8),
    attemptsMade: job.attemptsMade,
  });

  try {
    // 1. Fetch content from DB via repositories
    const contentRecord = sourceType === 'post'
      ? await PostRepo.findById(sourceId)
      : await ReplyRepo.findById(sourceId);

    if (!contentRecord) {
      logger.error(`V3 worker: content NOT FOUND in DB — ${sourceType} ${sourceId}. Job will not retry.`);
      return;
    }

    logger.info(`V3 worker: fetched content (${contentRecord.content.length} chars)`, { sourceType, sourceId });

    // 2. Verify content hash for idempotency
    const currentHash = crypto.createHash('sha256').update(contentRecord.content).digest('hex');
    if (currentHash !== contentHash) {
      logger.warn(`V3 worker: content hash mismatch, skipping`, {
        sourceId,
        expected: contentHash.substring(0, 8),
        actual: currentHash.substring(0, 8),
      });
      return;
    }

    // 3. Check idempotency via analysis runs
    const existingRun = await v3Repo.findExistingRun(sourceType, sourceId, contentHash);
    if (existingRun && existingRun.status === 'completed') {
      logger.info(`V3 worker: already completed for ${sourceId}, skipping`);
      return;
    }

    // 4. Create/get analysis run
    const run = await v3Repo.createAnalysisRun(sourceType, sourceId, contentHash);
    if (run.status !== 'pending') {
      logger.info(`V3 worker: run ${run.id} is ${run.status}, skipping`, { sourceId });
      return;
    }

    await v3Repo.updateRunStatus(run.id, 'processing');
    await job.updateProgress(10);

    // 5. Call discourse engine V3 analysis
    logger.info(`V3 worker: calling discourse engine`, { sourceId, runId: run.id });
    const v3Response = await argumentService.analyzeV3([
      { id: sourceId, text: contentRecord.content }
    ]);

    const analysis = v3Response.analyses[0];
    if (!analysis) {
      logger.warn(`V3 worker: discourse engine returned NO analysis`, { sourceId, runId: run.id });
      await v3Repo.updateRunStatus(run.id, 'completed');
      return;
    }

    logger.info(`V3 worker: discourse engine returned analysis`, {
      sourceId,
      nodes: analysis.hypergraph.nodes.length,
      edges: analysis.hypergraph.edges.length,
      socraticQuestions: analysis.socratic_questions?.length ?? 0,
    });

    await job.updateProgress(40);

    // 6. STEP A: Collect I-Node texts + all unique high_variance_terms,
    //    then embed them all in a single merged call.
    const aduNodes = analysis.hypergraph.nodes.filter(
      (n): n is V3HypergraphNode & { node_type: 'adu' } => n.node_type === 'adu'
    );

    // Gather unique high-variance terms across all I-Nodes
    const termToINodeEngineId = new Map<string, string>(); // term → first I-Node engine ID
    for (const aduNode of aduNodes) {
      const hvt: string[] = aduNode.high_variance_terms ?? [];
      for (const term of hvt) {
        if (!termToINodeEngineId.has(term)) {
          termToINodeEngineId.set(term, aduNode.node_id);
        }
      }
    }
    const uniqueTerms = Array.from(termToINodeEngineId.keys());

    // Build a merged list: [aduTexts..., termTexts...]
    const aduTexts = aduNodes.map(n => n.rewritten_text || n.text || '');
    const termTexts = uniqueTerms; // embed the raw term strings for concept lookup
    const allTextsToEmbed = [...aduTexts, ...termTexts];

    const iNodeEmbeddings = new Map<string, number[]>();
    const termEmbeddings = new Map<string, number[]>();

    if (allTextsToEmbed.length > 0) {
      logger.info(`V3 worker: embedding ${allTextsToEmbed.length} texts (${aduTexts.length} ADUs + ${termTexts.length} terms)`, { sourceId });
      const embedResponse = await argumentService.embedContent(allTextsToEmbed);

      if (embedResponse.embeddings_1536.length !== allTextsToEmbed.length) {
        throw new Error(
          `embedContent returned ${embedResponse.embeddings_1536.length} vectors for ${allTextsToEmbed.length} inputs`
        );
      }

      // Split results back
      for (let i = 0; i < aduNodes.length; i++) {
        if (embedResponse.embeddings_1536[i]) {
          iNodeEmbeddings.set(aduNodes[i]!.node_id, embedResponse.embeddings_1536[i]!);
        }
      }
      for (let i = 0; i < uniqueTerms.length; i++) {
        const idx = aduNodes.length + i;
        if (embedResponse.embeddings_1536[idx]) {
          termEmbeddings.set(uniqueTerms[i]!, embedResponse.embeddings_1536[idx]!);
        }
      }
    }

    await job.updateProgress(60);

    // 7. Generate embeddings for extracted values (separate call — different content type)
    const valueEmbeddings = new Map<string, number[]>();
    if (analysis.extracted_values && analysis.extracted_values.length > 0) {
      const valueTexts = analysis.extracted_values.map((v: { text: string }) => v.text);
      const valEmbedResponse = await argumentService.embedContent(valueTexts);

      for (let i = 0; i < analysis.extracted_values.length; i++) {
        if (valEmbedResponse.embeddings_1536[i]) {
          valueEmbeddings.set(analysis.extracted_values[i]!.text, valEmbedResponse.embeddings_1536[i]!);
        }
      }
    }

    await job.updateProgress(70);

    // 8. Persist hypergraph in single transaction; get engineIdToDbId for concept phase
    logger.info(`V3 worker: persisting hypergraph`, {
      sourceId,
      runId: run.id,
      iNodeEmbeddings: iNodeEmbeddings.size,
      valueEmbeddings: valueEmbeddings.size,
    });
    const engineIdToDbId = await v3Repo.persistHypergraph(
      run.id,
      sourceType,
      sourceId,
      analysis,
      iNodeEmbeddings,
      valueEmbeddings
    );

    await job.updateProgress(80);

    // ── Concept Disambiguation Phase ──
    // Only runs if there are high-variance terms to process.

    if (uniqueTerms.length > 0) {
      logger.info(`V3: Concept phase — ${uniqueTerms.length} unique terms`, { sourceId });

      // STEP B: Parallel DB candidate retrieval (local DB, no HTTP)
      const candidatesPerTerm = new Map<string, Array<{
        id: string; term: string; definition: string; sampleINodeText: string;
      }>>();

      await Promise.all(
        uniqueTerms.map(async (term) => {
          const embedding = termEmbeddings.get(term);
          if (!embedding) {
            candidatesPerTerm.set(term, []);
            return;
          }
          const similar = await v3Repo.findSimilarConcepts(embedding, 0.85, 3);
          candidatesPerTerm.set(
            term,
            similar.map(c => ({
              id: c.id,
              term: c.term,
              definition: c.definition,
              sampleINodeText: c.sampleINodeText,
            }))
          );
        })
      );

      // Build per-term disambiguation inputs (term → I-Node text)
      // Use the first I-Node that contains each term (rewritten_text preferred)
      const termDisambInputs = uniqueTerms.map(term => {
        const iNodeEngineId = termToINodeEngineId.get(term)!;
        const iNodeNode = aduNodes.find(n => n.node_id === iNodeEngineId);
        const targetINodeText: string = iNodeNode?.rewritten_text || iNodeNode?.text || term;
        return {
          term,
          targetINodeText,
          candidates: candidatesPerTerm.get(term) ?? [],
        };
      });

      // STEP C: Single HTTP call — discourse engine fans out to parallel Gemini calls
      const MAX_MACRO_CONTEXT_LENGTH = 8000;
      const truncatedContext = contentRecord.content.length > MAX_MACRO_CONTEXT_LENGTH
        ? contentRecord.content.slice(0, MAX_MACRO_CONTEXT_LENGTH)
        : contentRecord.content;
      const disambResults = await argumentService.disambiguateConceptsBatch(
        truncatedContext,
        termDisambInputs
      );

      // STEP D: Embed novel definitions (0–1 HTTP calls)
      const novelTerms = disambResults.filter(r => r.newDefinition !== null);
      const conceptIdForTerm = new Map<string, string>(); // term → concept UUID

      // First, map matched concepts — validate that LLM didn't hallucinate an unknown ID
      for (const r of disambResults) {
        if (r.matchedConceptId) {
          const knownIds = new Set(
            (candidatesPerTerm.get(r.term) ?? []).map(c => c.id)
          );
          if (!knownIds.has(r.matchedConceptId)) {
            logger.warn(`V3: LLM returned unknown matchedConceptId for term "${r.term}", treating as novel`, {
              matchedConceptId: r.matchedConceptId,
              knownCandidates: Array.from(knownIds),
            });
            // Treat as novel: will be picked up by novelTerms if newDefinition is present
          } else {
            conceptIdForTerm.set(r.term, r.matchedConceptId);
          }
        }
      }

      if (novelTerms.length > 0) {
        const novelTexts = novelTerms.map(r => `${r.term}: ${r.newDefinition}`);
        const novelEmbedResponse = await argumentService.embedContent(novelTexts);

        await Promise.all(
          novelTerms.map(async (r, idx) => {
            const embedding = novelEmbedResponse.embeddings_1536[idx];
            if (!embedding || !r.newDefinition) return;

            const concept = await v3Repo.createConcept(r.term, r.newDefinition, embedding);
            conceptIdForTerm.set(r.term, concept.id);
          })
        );
      }

      // STEP E: Link I-Nodes to concepts (DB only)
      await Promise.all(
        aduNodes.map(async (aduNode) => {
          const dbINodeId = engineIdToDbId.get(aduNode.node_id);
          if (!dbINodeId) return;

          const hvt: string[] = aduNode.high_variance_terms ?? [];
          for (const term of hvt) {
            const conceptId = conceptIdForTerm.get(term);
            if (conceptId) {
              await v3Repo.linkINodeToConcept(dbINodeId, conceptId, term);
            }
          }
        })
      );

      // STEP F: Equivocation check (DB only)
      const allINodeDbIds = aduNodes
        .map(n => engineIdToDbId.get(n.node_id))
        .filter((id): id is string => !!id);

      if (allINodeDbIds.length > 0) {
        const conceptMaps = await v3Repo.getConceptMapsForINodes(allINodeDbIds);

        // Build: iNodeId → Map(term → conceptId)
        const iNodeTermConcept = new Map<string, Map<string, string>>();
        for (const mapping of conceptMaps) {
          if (!iNodeTermConcept.has(mapping.i_node_id)) {
            iNodeTermConcept.set(mapping.i_node_id, new Map());
          }
          iNodeTermConcept.get(mapping.i_node_id)!.set(mapping.term_text, mapping.concept_id);
        }

        // For each scheme node, check premise/conclusion I-Node pairs for equivocation
        const schemeNodes = analysis.hypergraph.nodes.filter(
          (n): n is V3HypergraphNode & { node_type: 'scheme' } => n.node_type === 'scheme'
        );

        for (const schemeNode of schemeNodes) {
          const schemeDbId = engineIdToDbId.get(schemeNode.node_id);
          if (!schemeDbId) continue;

          // Get premise and conclusion I-Node db IDs via edges
          const schemeEdges = analysis.hypergraph.edges.filter(
            (e: V3HypergraphEdge) => e.scheme_node_id === schemeNode.node_id
          );

          if (schemeEdges.length === 0) {
            logger.debug(`V3: No edges found for scheme node ${schemeNode.node_id}, skipping equivocation check`);
            continue;
          }

          const premiseDbIds = schemeEdges
            .filter((e: V3HypergraphEdge) => e.role === 'premise')
            .map((e: V3HypergraphEdge) => engineIdToDbId.get(e.node_id))
            .filter((id): id is string => !!id);

          const conclusionDbId = schemeEdges
            .filter((e: V3HypergraphEdge) => e.role === 'conclusion')
            .map((e: V3HypergraphEdge) => engineIdToDbId.get(e.node_id))
            .find((id): id is string => !!id);

          if (!conclusionDbId || premiseDbIds.length === 0) continue;

          const conclusionConcepts = iNodeTermConcept.get(conclusionDbId);
          if (!conclusionConcepts) continue;

          for (const premiseDbId of premiseDbIds) {
            const premiseConcepts = iNodeTermConcept.get(premiseDbId);
            if (!premiseConcepts) continue;

            // Find shared terms where the concept differs (equivocation)
            for (const [term, premiseConceptId] of premiseConcepts) {
              const conclusionConceptId = conclusionConcepts.get(term);
              if (conclusionConceptId && conclusionConceptId !== premiseConceptId) {
                await v3Repo.createEquivocationFlag(
                  schemeDbId,
                  term,
                  premiseDbId,
                  conclusionDbId,
                  premiseConceptId,
                  conclusionConceptId
                );
              }
            }
          }
        }
      }
    }

    // 9. Mark run as completed
    await v3Repo.updateRunStatus(run.id, 'completed');
    await job.updateProgress(100);

    logger.info(`V3 analysis completed for ${sourceId}`, {
      iNodes: aduNodes.length,
      sNodes: analysis.hypergraph.nodes.filter((n: V3HypergraphNode) => n.node_type === 'scheme').length,
      ghosts: analysis.hypergraph.nodes.filter((n: V3HypergraphNode) => n.node_type === 'ghost').length,
      edges: analysis.hypergraph.edges.length,
      socraticQuestions: analysis.socratic_questions?.length ?? 0,
      uniqueConceptTerms: uniqueTerms.length,
    });
  } catch (error) {
    logger.error(`V3 worker: analysis FAILED for ${sourceId}`, {
      error: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
      jobId: job.id,
      attemptsMade: job.attemptsMade,
    });

    // Try to mark run as failed
    try {
      const run = await v3Repo.findExistingRun(sourceType, sourceId, contentHash);
      if (run) {
        await v3Repo.updateRunStatus(
          run.id,
          'failed',
          error instanceof Error ? error.message : String(error)
        );
      }
    } catch (e) {
      logger.error('V3 worker: failed to update run status to failed', { error: e });
    }

    throw error;
  }
}

/**
 * Create and start the BullMQ worker.
 * Called only after the discourse engine is confirmed ready, so that jobs
 * pulled from the queue are not immediately rejected with "fetch failed".
 */
export function createV3Worker(): Worker {
  const worker = new Worker('v3-analysis', processV3Analysis, {
    connection,
    concurrency: 2,
    settings: {
      backoffStrategy: async (attemptsMade: number) => {
        return Math.pow(2, Math.min(attemptsMade, 4)) * 1000;
      },
    },
  });

  worker.waitUntilReady().then(() => {
    logger.info('V3 worker: Redis connection ready, listening for jobs');
  }).catch((err) => {
    logger.error('V3 worker: Redis connection FAILED', {
      error: err instanceof Error ? err.message : String(err),
    });
  });

  worker.on('completed', job => {
    logger.info(`V3 worker: completed job ${job.id}`);
  });

  worker.on('failed', (job, err) => {
    logger.error(`V3 worker: FAILED job ${job?.id}`, {
      error: err.message,
      attemptsMade: job?.attemptsMade,
      attemptsTotal: job?.opts?.attempts,
    });
  });

  worker.on('error', err => {
    logger.error('V3 worker: fatal error', { error: err instanceof Error ? err.message : String(err) });
  });

  return worker;
}
