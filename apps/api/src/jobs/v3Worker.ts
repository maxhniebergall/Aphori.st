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
import { enqueueV3Analysis } from './enqueueV3Analysis.js';

// ── V4 helper functions ──

/**
 * Extracts the first URL found in a string of text.
 */
function extractFirstUrl(text: string): string | null {
  const match = text.match(/https?:\/\/[^\s"'<>]+/);
  return match ? match[0]! : null;
}

/**
 * Returns true if the URL belongs to an academic/scientific source.
 */
function isAcademicUrl(url: string): boolean {
  return (
    /doi\.org/i.test(url) ||
    /pubmed\.ncbi\.nlm\.nih\.gov/i.test(url) ||
    /arxiv\.org/i.test(url) ||
    /\.edu\b/i.test(url)
  );
}

/**
 * Extracts the SLD/hostname from a URL for source entity resolution.
 */
function extractDomain(url: string): string | null {
  try {
    const { hostname } = new URL(url);
    return hostname || null;
  } catch {
    return null;
  }
}

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

    // 5. Call discourse engine V3 analysis (delayed job — via BullMQ worker)
    logger.info(`V3 worker: calling discourse engine`, { sourceId, runId: run.id });
    const delayedAnalysisResponse = await argumentService.analyzeText([
      { id: sourceId, text: contentRecord.content }
    ]);

    const analysis = delayedAnalysisResponse.analyses[0];
    if (!analysis) {
      logger.warn(`V3 worker: discourse engine returned NO analysis`, { sourceId, runId: run.id });
      await v3Repo.updateRunStatus(run.id, 'failed', 'Discourse engine returned no analysis');
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
      const delayedAduTermEmbedResponse = await argumentService.embedTexts(allTextsToEmbed);

      if (delayedAduTermEmbedResponse.embeddings_1536.length !== allTextsToEmbed.length) {
        throw new Error(
          `embedTexts returned ${delayedAduTermEmbedResponse.embeddings_1536.length} vectors for ${allTextsToEmbed.length} inputs`
        );
      }

      // Split results back
      for (let i = 0; i < aduNodes.length; i++) {
        if (delayedAduTermEmbedResponse.embeddings_1536[i]) {
          iNodeEmbeddings.set(aduNodes[i]!.node_id, delayedAduTermEmbedResponse.embeddings_1536[i]!);
        }
      }
      for (let i = 0; i < uniqueTerms.length; i++) {
        const idx = aduNodes.length + i;
        if (delayedAduTermEmbedResponse.embeddings_1536[idx]) {
          termEmbeddings.set(uniqueTerms[i]!, delayedAduTermEmbedResponse.embeddings_1536[idx]!);
        }
      }
    }

    await job.updateProgress(60);

    // 7. Generate embeddings for extracted values (separate call — different content type)
    const valueEmbeddings = new Map<string, number[]>();
    if (analysis.extracted_values && analysis.extracted_values.length > 0) {
      const valueTexts = analysis.extracted_values.map((v: { text: string }) => v.text);
      const delayedValueEmbedResponse = await argumentService.embedTexts(valueTexts);

      for (let i = 0; i < analysis.extracted_values.length; i++) {
        if (delayedValueEmbedResponse.embeddings_1536[i]) {
          valueEmbeddings.set(analysis.extracted_values[i]!.text, delayedValueEmbedResponse.embeddings_1536[i]!);
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

    // ── V4: Base Weight + Node Role Assignment ──
    {
      // Build a set of engine IDs that appear as premises in SUPPORT or ATTACK scheme edges
      const premiseRoleMap = new Map<string, 'SUPPORT' | 'ATTACK'>(); // engine_id → role
      const schemeNodes = analysis.hypergraph.nodes.filter(
        (n: V3HypergraphNode) => n.node_type === 'scheme'
      );
      for (const schemeNode of schemeNodes) {
        const direction = schemeNode.direction; // 'SUPPORT' | 'ATTACK'
        if (direction !== 'SUPPORT' && direction !== 'ATTACK') continue;
        const premiseEdges = analysis.hypergraph.edges.filter(
          (e: V3HypergraphEdge) => e.scheme_node_id === schemeNode.node_id && e.role === 'premise'
        );
        for (const edge of premiseEdges) {
          // If already mapped, first assignment wins
          if (!premiseRoleMap.has(edge.node_id)) {
            premiseRoleMap.set(edge.node_id, direction);
          }
        }
      }

      // Detect if this analysis run is for a ghost (assumption-bot) reply
      const isGhostSource =
        sourceType === 'reply' &&
        contentRecord !== null &&
        'author_id' in contentRecord &&
        (contentRecord as { author_id: string }).author_id === 'assumption-bot';

      // Process each I-node
      const updatePromises: Promise<unknown>[] = [];
      for (const aduNode of aduNodes) {
        const dbId = engineIdToDbId.get(aduNode.node_id);
        if (!dbId) continue;

        let factSubtype: string | null = null;
        let baseWeight: number;
        let sourceUrl: string | null = null;

        if (isGhostSource) {
          factSubtype = 'ENTHYMEME';
          baseWeight = 0.5;
        } else {
          const epistemicType = aduNode.fvp_type;
          if (epistemicType === 'VALUE') {
            baseWeight = 1.0;
          } else if (epistemicType === 'POLICY') {
            baseWeight = 0.0;
          } else {
            // FACT — detect URLs
            const textToSearch = [aduNode.rewritten_text, aduNode.text]
              .filter((t): t is string => !!t)
              .join(' ');
            const url = extractFirstUrl(textToSearch);
            if (url) {
              sourceUrl = url;
              if (isAcademicUrl(url)) {
                factSubtype = 'ACADEMIC_REF';
                baseWeight = 5.0;
              } else {
                factSubtype = 'DOCUMENT_REF';
                baseWeight = 2.0;
              }
            } else {
              factSubtype = 'ANECDOTE';
              baseWeight = 1.0;
            }
          }
        }

        // Determine node_role
        const schemeRole = premiseRoleMap.get(aduNode.node_id);
        const nodeRole: string = schemeRole ?? 'ROOT';

        // Source entity resolution for DOCUMENT_REF and ACADEMIC_REF
        if (sourceUrl && (factSubtype === 'DOCUMENT_REF' || factSubtype === 'ACADEMIC_REF')) {
          const domain = extractDomain(sourceUrl);
          if (domain) {
            updatePromises.push(
              pool.query(
                `INSERT INTO v3_sources (level, url, title)
                 VALUES ('DOMAIN', $1, $2)
                 ON CONFLICT (url) DO NOTHING`,
                [domain, domain]
              ).catch((err: unknown) => {
                logger.warn('V4: failed to upsert v3_source', {
                  domain,
                  error: err instanceof Error ? err.message : String(err),
                });
              })
            );
          }
        }

        // Batch UPDATE v3_nodes_i
        updatePromises.push(
          pool.query(
            `UPDATE v3_nodes_i SET fact_subtype = $1, base_weight = $2, node_role = $3 WHERE id = $4`,
            [factSubtype, baseWeight, nodeRole, dbId]
          )
        );
      }

      await Promise.all(updatePromises);

      logger.info('V4: base weight + node role assignment complete', {
        sourceId,
        iNodes: aduNodes.length,
        isGhostSource,
      });
    }

    // ── Create replies from ghost nodes (assumption-bot) ──
    const ghostNodes = analysis.hypergraph.nodes.filter(
      (n: V3HypergraphNode) => n.node_type === 'ghost'
    );
    if (ghostNodes.length > 0) {
      let postId: string;
      let parentReplyId: string | undefined;
      if (sourceType === 'post') {
        postId = sourceId;
      } else {
        const parentReply = await ReplyRepo.findById(sourceId);
        if (!parentReply) {
          logger.warn(`V3 worker: could not find parent reply for ghost nodes`, { sourceId });
          postId = '';
        } else {
          postId = parentReply.post_id;
          parentReplyId = sourceId;
        }
      }

      if (postId) {
        for (const ghostNode of ghostNodes) {
          const ghostText = ghostNode.ghost_text || ghostNode.text || '';
          if (!ghostText) continue;
          try {
            const botReply = await ReplyRepo.create(postId, 'assumption-bot', {
              content: ghostText,
              parent_reply_id: parentReplyId,
            });
            await enqueueV3Analysis('reply', botReply.id, ghostText);
          } catch (err) {
            logger.warn(`V3 worker: failed to create ghost reply for node ${ghostNode.node_id}`, {
              error: err instanceof Error ? err.message : String(err),
            });
          }
        }
        logger.info(`V3 worker: created ${ghostNodes.length} ghost replies as assumption-bot`, { sourceId });
      }
    }

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

      // STEP C: Single HTTP call — discourse engine fans out to parallel Gemini calls (delayed job)
      const MAX_MACRO_CONTEXT_LENGTH = 8000;
      const truncatedContext = contentRecord.content.length > MAX_MACRO_CONTEXT_LENGTH
        ? contentRecord.content.slice(0, MAX_MACRO_CONTEXT_LENGTH)
        : contentRecord.content;
      const delayedDisambResults = await argumentService.disambiguateConcepts(
        truncatedContext,
        termDisambInputs
      );

      // STEP D: Embed novel definitions (0–1 HTTP calls, delayed job)
      const novelTerms = delayedDisambResults.filter(r => r.newDefinition !== null);
      const conceptIdForTerm = new Map<string, string>(); // term → concept UUID

      // First, map matched concepts — validate that LLM didn't hallucinate an unknown ID
      for (const r of delayedDisambResults) {
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
        const delayedNovelDefinitionEmbedResponse = await argumentService.embedTexts(novelTexts);

        await Promise.all(
          novelTerms.map(async (r, idx) => {
            const embedding = delayedNovelDefinitionEmbedResponse.embeddings_1536[idx];
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
    concurrency: 16,
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
