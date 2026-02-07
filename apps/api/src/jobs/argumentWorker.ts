import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createArgumentRepo, type ADUType, type CanonicalClaimType } from '../db/repositories/ArgumentRepo.js';
import { getArgumentService } from '../services/argumentService.js';
import { getPool } from '../db/pool.js';

// ADU types that can be deduplicated into canonical claims
// Evidence is NOT deduplicated as it's context-specific
const DEDUPLICATABLE_TYPES: ADUType[] = ['MajorClaim', 'Supporting', 'Opposing'];

// Map ADU type to canonical claim type
function toCanonicalClaimType(aduType: ADUType): CanonicalClaimType {
  if (aduType === 'Evidence') {
    throw new Error('Evidence cannot be converted to canonical claim type');
  }
  return aduType;
}

interface AnalysisJobData {
  sourceType: 'post' | 'reply';
  sourceId: string;
  contentHash: string;
}

const connection = new Redis(config.redis.url, {
  maxRetriesPerRequest: null,
});

async function processAnalysis(job: Job<AnalysisJobData>): Promise<void> {
  const { sourceType, sourceId, contentHash } = job.data;
  const pool = getPool();
  const argumentRepo = createArgumentRepo(pool);
  const argumentService = getArgumentService();

  logger.info(`Processing analysis job ${job.id}`, { sourceType, sourceId });

  const statusTable = sourceType === 'post' ? 'posts' : 'replies';

  try {
    // 1. Get the content from database
    let content;
    if (sourceType === 'post') {
      const result = await pool.query('SELECT * FROM posts WHERE id = $1', [sourceId]);
      content = result.rows[0];
    } else {
      const result = await pool.query('SELECT * FROM replies WHERE id = $1', [sourceId]);
      content = result.rows[0];
    }

    if (!content) {
      logger.warn(`Content not found: ${sourceType} ${sourceId}`);
      return;
    }

    // 2. Verify hash for idempotency
    const currentHash = crypto.createHash('sha256').update(content.content).digest('hex');
    if (currentHash !== contentHash) {
      logger.info(`Content hash mismatch, skipping: ${sourceId}`);
      return;
    }

    // 3. Update status to processing
    await pool.query(
      `UPDATE ${statusTable} SET analysis_status = 'processing' WHERE id = $1`,
      [sourceId]
    );

    // 4. Extract ADUs with V2 ontology (hierarchical types)
    await job.updateProgress(10);
    logger.info(`Extracting ADUs from ${sourceId}`);

    const aduResponse = await argumentService.analyzeADUs([
      { id: sourceId, text: content.content }
    ]);

    if (aduResponse.adus.length === 0) {
      logger.info(`No ADUs found in ${sourceId}`);
      await pool.query(
        `UPDATE ${statusTable} SET analysis_status = 'completed' WHERE id = $1`,
        [sourceId]
      );
      return;
    }

    // 5. Generate embeddings for ADUs (1536-dim Gemini)
    // Use rewritten_text for embedding if available (anaphora-resolved)
    await job.updateProgress(30);
    const aduTexts = aduResponse.adus.map(adu => adu.rewritten_text || adu.text);
    const aduEmbeddingsResponse = await argumentService.embedContent(aduTexts);

    // 6. Store ADUs with hierarchy (two-pass: create then link)
    await job.updateProgress(40);
    const createdADUs = await argumentRepo.createADUsWithHierarchy(
      sourceType,
      sourceId,
      aduResponse.adus.map(adu => ({
        adu_type: adu.adu_type,
        text: adu.text,
        span_start: adu.span_start,
        span_end: adu.span_end,
        confidence: adu.confidence,
        target_index: adu.target_index,
      }))
    );

    // 7. Store ADU embeddings
    await argumentRepo.createADUEmbeddings(
      createdADUs.map((adu, idx) => ({
        adu_id: adu.id,
        embedding: aduEmbeddingsResponse.embeddings_1536[idx]!,
      }))
    );

    // 8. Canonical claim deduplication with RAG pipeline
    // Deduplicate MajorClaim, Supporting, Opposing - but NOT Evidence
    await job.updateProgress(50);
    const deduplicatableADUs = createdADUs.filter(
      adu => DEDUPLICATABLE_TYPES.includes(adu.adu_type)
    );

    for (let i = 0; i < deduplicatableADUs.length; i++) {
      const adu = deduplicatableADUs[i]!;
      const aduIndex = createdADUs.findIndex(a => a.id === adu.id);
      const embedding = aduEmbeddingsResponse.embeddings_1536[aduIndex]!;

      // Step 8a: Retrieve top-5 similar canonical claims using configured threshold
      const similarClaims = await argumentRepo.findSimilarCanonicalClaims(
        embedding,
        config.argumentAnalysis.claimDeduplicationThreshold,
        5
      );

      if (similarClaims.length > 0) {
        // Step 8b: Fetch full canonical claim texts
        const canonicalTexts = await argumentRepo.getCanonicalClaimsByIds(
          similarClaims.map(c => c.canonical_claim_id)
        );

        // Create mapping from id to similarity (order might not match)
        const similarityMap = new Map(
          similarClaims.map(c => [c.canonical_claim_id, c.similarity])
        );

        // Step 8c: Validate with Gemini Flash LLM
        try {
          const validation = await argumentService.validateClaimEquivalence(
            adu.text,
            canonicalTexts.map(c => ({
              id: c.id,
              text: c.representative_text,
              similarity: similarityMap.get(c.id) ?? 0,
            }))
          );

          if (validation.is_equivalent && validation.canonical_claim_id) {
            // Link to existing canonical claim (LLM-validated)
            const matchedSimilarity =
              similarClaims.find(s => s.canonical_claim_id === validation.canonical_claim_id)
                ?.similarity || 1.0;

            await argumentRepo.linkADUToCanonical(adu.id, validation.canonical_claim_id, matchedSimilarity);

            logger.info('Linked ADU to canonical (LLM-validated)', {
              aduId: adu.id,
              aduType: adu.adu_type,
              canonicalId: validation.canonical_claim_id,
              explanation: validation.explanation,
            });
          } else {
            // LLM said not equivalent, create new canonical claim
            const canonical = await argumentRepo.createCanonicalClaim(
              adu.text,
              embedding,
              content.author_id,
              toCanonicalClaimType(adu.adu_type)
            );
            await argumentRepo.linkADUToCanonical(adu.id, canonical.id, 1.0);

            logger.info('Created new canonical claim (no LLM match)', {
              aduId: adu.id,
              aduType: adu.adu_type,
              canonicalId: canonical.id,
              authorId: content.author_id,
            });
          }
        } catch (error) {
          logger.error('LLM validation failed, creating new canonical claim', {
            aduId: adu.id,
            error,
          });

          // Fallback: create new canonical claim
          const canonical = await argumentRepo.createCanonicalClaim(
            adu.text,
            embedding,
            content.author_id,
            toCanonicalClaimType(adu.adu_type)
          );
          await argumentRepo.linkADUToCanonical(adu.id, canonical.id, 1.0);
        }
      } else {
        // No similar claims found in vector search, create new
        const canonical = await argumentRepo.createCanonicalClaim(
          adu.text,
          embedding,
          content.author_id,
          toCanonicalClaimType(adu.adu_type)
        );
        await argumentRepo.linkADUToCanonical(adu.id, canonical.id, 1.0);

        logger.info('Created new canonical claim (no vector matches)', {
          aduId: adu.id,
          aduType: adu.adu_type,
          canonicalId: canonical.id,
          authorId: content.author_id,
        });
      }
    }

    // 9. Skip relation detection - relations are now implicit in ADU types
    // (Supporting = support relation to target, Opposing = attack relation to target)
    // The argument_relations table is kept for cross-post relations only
    await job.updateProgress(70);

    // 10. Generate content embedding for semantic search (1536-dim Gemini)
    await job.updateProgress(80);
    const contentEmbed = await argumentService.embedContent([content.content]);
    await argumentRepo.createContentEmbedding(sourceType, sourceId, contentEmbed.embeddings_1536[0]!);

    // 11. Mark as completed
    await job.updateProgress(100);
    await pool.query(
      `UPDATE ${statusTable} SET analysis_status = 'completed' WHERE id = $1`,
      [sourceId]
    );

    logger.info(`Analysis completed for ${sourceId}`, {
      aduCount: createdADUs.length,
      deduplicatedCount: deduplicatableADUs.length,
      evidenceCount: createdADUs.length - deduplicatableADUs.length,
    });
  } catch (error) {
    logger.error(`Analysis failed for ${sourceId}`, { error });

    // Update status to failed
    await pool.query(
      `UPDATE ${statusTable} SET analysis_status = 'failed' WHERE id = $1`,
      [sourceId]
    ).catch(e => logger.error('Failed to update status to failed', { error: e }));

    // Re-throw to trigger BullMQ retry
    throw error;
  }
}

export const argumentWorker = new Worker('argument-analysis', processAnalysis, {
  connection,
  concurrency: 2,
  settings: {
    // Exponential backoff retry: 1s, 2s, 4s, 8s, 16s
    backoffStrategy: async (attemptsMade: number) => {
      return Math.pow(2, Math.min(attemptsMade, 4)) * 1000;
    },
  },
});

argumentWorker.on('completed', job => {
  logger.info(`Worker completed job ${job.id}`);
});

argumentWorker.on('failed', (job, err) => {
  logger.error(`Worker failed job ${job?.id}`, { error: err.message });
});

argumentWorker.on('error', err => {
  logger.error('Worker error', { error: err });
});
