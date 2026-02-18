import { Worker, Job } from 'bullmq';
import crypto from 'crypto';
import { logger } from '../utils/logger.js';
import { createV3HypergraphRepo } from '../db/repositories/V3HypergraphRepo.js';
import { getArgumentService } from '../services/argumentService.js';
import { getPool } from '../db/pool.js';
import { createBullMQConnection } from './redisConnection.js';

interface V3AnalysisJobData {
  sourceType: 'post' | 'reply';
  sourceId: string;
  contentHash: string;
}

const connection = createBullMQConnection('v3-worker');

async function processV3Analysis(job: Job<V3AnalysisJobData>): Promise<void> {
  const { sourceType, sourceId, contentHash } = job.data;
  const pool = getPool();
  const v3Repo = createV3HypergraphRepo(pool);
  const argumentService = getArgumentService();

  logger.info(`Processing V3 analysis job ${job.id}`, { sourceType, sourceId });

  try {
    // 1. Fetch content from DB
    const table = sourceType === 'post' ? 'posts' : 'replies';
    const result = await pool.query(`SELECT * FROM ${table} WHERE id = $1`, [sourceId]);
    const content = result.rows[0];

    if (!content) {
      logger.warn(`Content not found: ${sourceType} ${sourceId}`);
      return;
    }

    // 2. Verify content hash for idempotency
    const currentHash = crypto.createHash('sha256').update(content.content).digest('hex');
    if (currentHash !== contentHash) {
      logger.info(`V3: Content hash mismatch, skipping: ${sourceId}`);
      return;
    }

    // 3. Check idempotency via analysis runs
    const existingRun = await v3Repo.findExistingRun(sourceType, sourceId, contentHash);
    if (existingRun && existingRun.status === 'completed') {
      logger.info(`V3: Already completed for ${sourceId}, skipping`);
      return;
    }

    // 4. Create/get analysis run
    const run = await v3Repo.createAnalysisRun(sourceType, sourceId, contentHash);
    if (run.status !== 'pending') {
      logger.info(`V3: Run ${run.id} is ${run.status}, skipping`);
      return;
    }

    await v3Repo.updateRunStatus(run.id, 'processing');
    await job.updateProgress(10);

    // 5. Call discourse engine V3 analysis
    logger.info(`V3: Calling engine for ${sourceId}`);
    const v3Response = await argumentService.analyzeV3([
      { id: sourceId, text: content.content }
    ]);

    const analysis = v3Response.analyses[0];
    if (!analysis) {
      logger.info(`V3: No analysis returned for ${sourceId}`);
      await v3Repo.updateRunStatus(run.id, 'completed');
      return;
    }

    await job.updateProgress(40);

    // 6. Generate embeddings for I-Node texts
    const aduNodes = analysis.hypergraph.nodes.filter(
      (n: { node_type: string }) => n.node_type === 'adu'
    );
    const iNodeEmbeddings = new Map<string, number[]>();

    if (aduNodes.length > 0) {
      const texts = aduNodes.map(
        (n: { rewritten_text?: string; text?: string }) => n.rewritten_text || n.text || ''
      );
      const embedResponse = await argumentService.embedContent(texts);

      for (let i = 0; i < aduNodes.length; i++) {
        if (embedResponse.embeddings_1536[i]) {
          iNodeEmbeddings.set(aduNodes[i]!.node_id, embedResponse.embeddings_1536[i]!);
        }
      }
    }

    await job.updateProgress(60);

    // 7. Generate embeddings for extracted values
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

    await job.updateProgress(80);

    // 8. Persist hypergraph in single transaction
    await v3Repo.persistHypergraph(
      run.id,
      sourceType,
      sourceId,
      analysis,
      iNodeEmbeddings,
      valueEmbeddings
    );

    // 9. Mark run as completed
    await v3Repo.updateRunStatus(run.id, 'completed');
    await job.updateProgress(100);

    logger.info(`V3 analysis completed for ${sourceId}`, {
      iNodes: aduNodes.length,
      sNodes: analysis.hypergraph.nodes.filter((n: { node_type: string }) => n.node_type === 'scheme').length,
      ghosts: analysis.hypergraph.nodes.filter((n: { node_type: string }) => n.node_type === 'ghost').length,
      edges: analysis.hypergraph.edges.length,
      socraticQuestions: analysis.socratic_questions.length,
    });
  } catch (error) {
    logger.error(`V3 analysis failed for ${sourceId}`, { error });

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
      logger.error('Failed to update V3 run status to failed', { error: e });
    }

    throw error;
  }
}

export const v3Worker = new Worker('v3-analysis', processV3Analysis, {
  connection,
  concurrency: 2,
  settings: {
    backoffStrategy: async (attemptsMade: number) => {
      return Math.pow(2, Math.min(attemptsMade, 4)) * 1000;
    },
  },
});

v3Worker.on('completed', job => {
  logger.info(`V3 worker completed job ${job.id}`);
});

v3Worker.on('failed', (job, err) => {
  logger.error(`V3 worker failed job ${job?.id}`, { error: err.message });
});

v3Worker.on('error', err => {
  logger.error('V3 worker error', { error: err });
});
