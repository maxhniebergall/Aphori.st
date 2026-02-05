import { Worker, Job } from 'bullmq';
import { Redis } from 'ioredis';
import crypto from 'crypto';
import { config } from '../config.js';
import { logger } from '../utils/logger.js';
import { createArgumentRepo } from '../db/repositories/ArgumentRepo.js';
import { getArgumentService } from '../services/argumentService.js';
import { getPool } from '../db/pool.js';

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
    const statusColumn = sourceType === 'post' ? 'posts' : 'replies';
    await pool.query(
      `UPDATE ${statusColumn} SET analysis_status = 'processing' WHERE id = $1`,
      [sourceId]
    );

    // 4. Extract ADUs from text
    await job.updateProgress(10);
    logger.info(`Extracting ADUs from ${sourceId}`);

    const aduResponse = await argumentService.analyzeADUs([
      { id: sourceId, text: content.content }
    ]);

    if (aduResponse.adus.length === 0) {
      logger.info(`No ADUs found in ${sourceId}`);
      await pool.query(
        `UPDATE ${statusColumn} SET analysis_status = 'completed' WHERE id = $1`,
        [sourceId]
      );
      return;
    }

    // 5. Generate embeddings for ADUs (768-dim Gemini)
    await job.updateProgress(30);
    const aduTexts = aduResponse.adus.map(adu => adu.text);
    const aduEmbeddingsResponse = await argumentService.embedContent(aduTexts);

    // 6. Store ADUs in database
    await job.updateProgress(40);
    const createdADUs = await argumentRepo.createADUs(sourceType, sourceId, aduResponse.adus);

    // 7. Store ADU embeddings
    await argumentRepo.createADUEmbeddings(
      createdADUs.map((adu, idx) => ({
        adu_id: adu.id,
        embedding: aduEmbeddingsResponse.embeddings_768[idx]!,
      }))
    );

    // 8. Canonical claim deduplication with RAG pipeline (claims only)
    await job.updateProgress(50);
    const claims = createdADUs.filter(adu => adu.adu_type === 'claim');

    for (let i = 0; i < claims.length; i++) {
      const claim = claims[i]!;
      const claimIndex = createdADUs.findIndex(adu => adu.id === claim.id);
      const embedding = aduEmbeddingsResponse.embeddings_768[claimIndex]!;

      // Step 8a: Retrieve top-5 similar canonical claims (cosine > 0.75)
      const similarClaims = await argumentRepo.findSimilarCanonicalClaims(embedding, 0.75, 5);

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
            claim.text,
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

            await argumentRepo.linkADUToCanonical(claim.id, validation.canonical_claim_id, matchedSimilarity);

            logger.info('Linked claim to canonical (LLM-validated)', {
              claimId: claim.id,
              canonicalId: validation.canonical_claim_id,
              explanation: validation.explanation,
            });
          } else {
            // LLM said not equivalent, create new canonical claim
            const canonical = await argumentRepo.createCanonicalClaim(
              claim.text,
              embedding,
              content.author_id
            );
            await argumentRepo.linkADUToCanonical(claim.id, canonical.id, 1.0);

            logger.info('Created new canonical claim (no LLM match)', {
              claimId: claim.id,
              canonicalId: canonical.id,
              authorId: content.author_id,
            });
          }
        } catch (error) {
          logger.error('LLM validation failed, creating new canonical claim', {
            claimId: claim.id,
            error,
          });

          // Fallback: create new canonical claim
          const canonical = await argumentRepo.createCanonicalClaim(
            claim.text,
            embedding,
            content.author_id
          );
          await argumentRepo.linkADUToCanonical(claim.id, canonical.id, 1.0);
        }
      } else {
        // No similar claims found in vector search, create new
        const canonical = await argumentRepo.createCanonicalClaim(
          claim.text,
          embedding,
          content.author_id
        );
        await argumentRepo.linkADUToCanonical(claim.id, canonical.id, 1.0);

        logger.info('Created new canonical claim (no vector matches)', {
          claimId: claim.id,
          canonicalId: canonical.id,
          authorId: content.author_id,
        });
      }
    }

    // 9. Detect argument relations using ADU embeddings
    await job.updateProgress(70);
    if (createdADUs.length >= 2) {
      const relations = await argumentService.analyzeRelations(
        createdADUs.map(adu => ({
          id: adu.id,
          text: adu.text,
          source_comment_id: adu.source_id, // Python code expects this field name
        })),
        aduEmbeddingsResponse.embeddings_768
      );
      await argumentRepo.createRelations(relations.relations);
    }

    // 10. Generate content embedding for semantic search (768-dim Gemini)
    await job.updateProgress(80);
    const contentEmbed = await argumentService.embedContent([content.content]);
    await argumentRepo.createContentEmbedding(sourceType, sourceId, contentEmbed.embeddings_768[0]!);

    // 11. Mark as completed
    await job.updateProgress(100);
    await pool.query(
      `UPDATE ${statusColumn} SET analysis_status = 'completed' WHERE id = $1`,
      [sourceId]
    );

    logger.info(`Analysis completed for ${sourceId}`, {
      aduCount: createdADUs.length,
      claimCount: claims.length,
    });
  } catch (error) {
    logger.error(`Analysis failed for ${sourceId}`, { error });

    // Update status to failed
    const statusColumn = sourceType === 'post' ? 'posts' : 'replies';
    await pool.query(
      `UPDATE ${statusColumn} SET analysis_status = 'failed' WHERE id = $1`,
      [sourceId]
    ).catch(e => logger.error('Failed to update status to failed', { error: e }));

    // Re-throw to trigger BullMQ retry
    throw error;
  }
}

export const argumentWorker = new Worker('argument-analysis', processAnalysis, {
  connection,
  concurrency: 2,
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
