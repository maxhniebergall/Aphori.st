import { Pool } from 'pg';
import type {
  V3AnalysisRun,
  V3INode,
  V3SNode,
  V3Edge,
  V3Enthymeme,
  V3SocraticQuestion,
  V3ExtractedValue,
  V3Subgraph,
  V3EngineAnalysis,
  V3HypergraphNode,
  V3HypergraphEdge,
  V3EngineSocraticQuestion,
} from '@chitin/shared';

export const createV3HypergraphRepo = (pool: Pool) => ({
  // ── Analysis Run Management ──

  async createAnalysisRun(
    sourceType: 'post' | 'reply',
    sourceId: string,
    contentHash: string
  ): Promise<V3AnalysisRun> {
    const result = await pool.query(
      `INSERT INTO v3_analysis_runs (source_type, source_id, content_hash, status)
       VALUES ($1, $2, $3, 'pending')
       ON CONFLICT (source_type, source_id, content_hash) DO UPDATE
         SET status = CASE
           WHEN v3_analysis_runs.status = 'failed' THEN 'pending'
           ELSE v3_analysis_runs.status
         END
       RETURNING *`,
      [sourceType, sourceId, contentHash]
    );
    return result.rows[0];
  },

  async findExistingRun(
    sourceType: 'post' | 'reply',
    sourceId: string,
    contentHash: string
  ): Promise<V3AnalysisRun | null> {
    const result = await pool.query(
      `SELECT * FROM v3_analysis_runs
       WHERE source_type = $1 AND source_id = $2 AND content_hash = $3`,
      [sourceType, sourceId, contentHash]
    );
    return result.rows[0] || null;
  },

  async updateRunStatus(
    runId: string,
    status: 'processing' | 'completed' | 'failed',
    errorMessage?: string
  ): Promise<void> {
    await pool.query(
      `UPDATE v3_analysis_runs
       SET status = $2,
           error_message = $3,
           completed_at = CASE WHEN $4 IN ('completed', 'failed') THEN NOW() ELSE NULL END
       WHERE id = $1`,
      [runId, status, errorMessage || null, status]
    );
  },

  async getRunStatus(
    sourceType: 'post' | 'reply',
    sourceId: string
  ): Promise<Pick<V3AnalysisRun, 'status' | 'completed_at'> | null> {
    const result = await pool.query(
      `SELECT status, completed_at FROM v3_analysis_runs
       WHERE source_type = $1 AND source_id = $2
       ORDER BY created_at DESC LIMIT 1`,
      [sourceType, sourceId]
    );
    return result.rows[0] || null;
  },

  // ── Persist Hypergraph (single transaction) ──

  async persistHypergraph(
    runId: string,
    sourceType: 'post' | 'reply',
    sourceId: string,
    analysis: V3EngineAnalysis,
    iNodeEmbeddings?: Map<string, number[]>,
    valueEmbeddings?: Map<string, number[]>
  ): Promise<void> {
    const client = await pool.connect();
    try {
      await client.query('BEGIN');

      const { nodes, edges } = analysis.hypergraph;
      const engineIdToDbId = new Map<string, string>();

      // 1. Batch-insert I-Nodes (adu nodes)
      const aduNodes = nodes.filter((n): n is V3HypergraphNode & { node_type: 'adu' } =>
        n.node_type === 'adu'
      );
      if (aduNodes.length > 0) {
        const iValues = aduNodes.map((_, i) => {
          const base = i * 10;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5}, $${base + 6}, $${base + 7}, $${base + 8}, $${base + 9}, $${base + 10})`;
        }).join(',');

        const iParams = aduNodes.flatMap(n => [
          runId,
          sourceType,
          sourceId,
          n.text || '',
          n.rewritten_text || null,
          n.fvp_type || 'FACT',
          n.fvp_confidence ?? 0,
          n.span_start ?? 0,
          n.span_end ?? 0,
          n.extraction_confidence ?? 0,
        ]);

        const iResult = await client.query(
          `INSERT INTO v3_nodes_i (analysis_run_id, source_type, source_id, content, rewritten_text, epistemic_type, fvp_confidence, span_start, span_end, extraction_confidence)
           VALUES ${iValues}
           RETURNING id`,
          iParams
        );

        for (let i = 0; i < aduNodes.length; i++) {
          engineIdToDbId.set(aduNodes[i]!.node_id, iResult.rows[i]!.id);
        }

        // Update embeddings for I-Nodes if provided
        if (iNodeEmbeddings && iNodeEmbeddings.size > 0) {
          for (const aduNode of aduNodes) {
            const embedding = iNodeEmbeddings.get(aduNode.node_id);
            const dbId = engineIdToDbId.get(aduNode.node_id);
            if (embedding && dbId) {
              await client.query(
                `UPDATE v3_nodes_i SET embedding = $1 WHERE id = $2`,
                [JSON.stringify(embedding), dbId]
              );
            }
          }
        }
      }

      // 2. Batch-insert S-Nodes (scheme nodes)
      const schemeNodes = nodes.filter((n: V3HypergraphNode) => n.node_type === 'scheme');
      if (schemeNodes.length > 0) {
        const sValues = schemeNodes.map((_: V3HypergraphNode, i: number) => {
          const base = i * 5;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4}, $${base + 5})`;
        }).join(',');

        const sParams = schemeNodes.flatMap((n: V3HypergraphNode) => [
          runId,
          n.direction || 'SUPPORT',
          n.logic_type || null,
          n.confidence ?? 0,
          n.gap_detected ?? false,
        ]);

        const sResult = await client.query(
          `INSERT INTO v3_nodes_s (analysis_run_id, direction, logic_type, confidence, gap_detected)
           VALUES ${sValues}
           RETURNING id`,
          sParams
        );

        for (let i = 0; i < schemeNodes.length; i++) {
          engineIdToDbId.set(schemeNodes[i]!.node_id, sResult.rows[i]!.id);
        }
      }

      // 3. Batch-insert Enthymemes (ghost nodes)
      const ghostNodes = nodes.filter((n: V3HypergraphNode) => n.node_type === 'ghost');
      if (ghostNodes.length > 0) {
        const gValues = ghostNodes.map((_: V3HypergraphNode, i: number) => {
          const base = i * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        }).join(',');

        // Ghost nodes reference their parent scheme via node_id pattern "ghost::scheme-xxx::n"
        // We need to find the scheme_id for each ghost
        const gParams = ghostNodes.flatMap((n: V3HypergraphNode) => {
          // Extract scheme node_id from ghost node_id pattern: "ghost::SCHEME_ID::INDEX"
          const parts = n.node_id.split('::');
          const schemeEngineId = parts.length >= 2 ? parts[1]! : '';
          const schemeDbId = engineIdToDbId.get(schemeEngineId);
          return [
            schemeDbId || null,
            n.ghost_text || n.text || '',
            n.ghost_fvp_type || n.fvp_type || 'FACT',
            n.probability ?? 0.5,
          ];
        });

        const gResult = await client.query(
          `INSERT INTO v3_enthymemes (scheme_id, content, fvp_type, probability)
           VALUES ${gValues}
           RETURNING id`,
          gParams
        );

        for (let i = 0; i < ghostNodes.length; i++) {
          engineIdToDbId.set(ghostNodes[i]!.node_id, gResult.rows[i]!.id);
        }
      }

      // 4. Batch-insert Edges (resolve engine node_ids to DB UUIDs)
      if (edges.length > 0) {
        const validEdges = edges.filter((e: V3HypergraphEdge) => {
          const schemeId = engineIdToDbId.get(e.scheme_node_id);
          const nodeId = engineIdToDbId.get(e.node_id);
          return schemeId && nodeId;
        });

        if (validEdges.length > 0) {
          const eValues = validEdges.map((_: V3HypergraphEdge, i: number) => {
            const base = i * 4;
            return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
          }).join(',');

          const eParams = validEdges.flatMap((e: V3HypergraphEdge) => {
            const nodeEngineEntry = nodes.find((n: V3HypergraphNode) => n.node_id === e.node_id);
            const nodeType = nodeEngineEntry?.node_type === 'ghost' ? 'ghost' : 'i_node';
            return [
              engineIdToDbId.get(e.scheme_node_id)!,
              engineIdToDbId.get(e.node_id)!,
              nodeType,
              e.role,
            ];
          });

          await client.query(
            `INSERT INTO v3_edges (scheme_node_id, node_id, node_type, role)
             VALUES ${eValues}`,
            eParams
          );
        }
      }

      // 5. Insert Socratic Questions
      if (analysis.socratic_questions.length > 0) {
        const sqValues = analysis.socratic_questions.map((_: V3EngineSocraticQuestion, i: number) => {
          const base = i * 4;
          return `($${base + 1}, $${base + 2}, $${base + 3}, $${base + 4})`;
        }).join(',');

        const sqParams = analysis.socratic_questions.flatMap((sq: V3EngineSocraticQuestion) => [
          engineIdToDbId.get(sq.scheme_node_id) || null,
          sq.question,
          JSON.stringify(sq.context),
          sq.uncertainty_level,
        ]);

        await client.query(
          `INSERT INTO v3_socratic_questions (scheme_id, question, context, uncertainty_level)
           VALUES ${sqValues}`,
          sqParams
        );
      }

      // 6. Insert Extracted Values
      if (analysis.extracted_values && analysis.extracted_values.length > 0) {
        type ExtractedValueEntry = { source_node_id: string; text: string };
        const evValues = analysis.extracted_values.map((_: ExtractedValueEntry, i: number) => {
          const base = i * 3;
          return `($${base + 1}, $${base + 2}, $${base + 3})`;
        }).join(',');

        const evParams = analysis.extracted_values.flatMap((ev: ExtractedValueEntry) => [
          engineIdToDbId.get(ev.source_node_id) || null,
          ev.text,
          valueEmbeddings?.get(ev.text) ? JSON.stringify(valueEmbeddings.get(ev.text)) : null,
        ]);

        await client.query(
          `INSERT INTO v3_extracted_values (i_node_id, text, embedding)
           VALUES ${evValues}`,
          evParams
        );
      }

      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  },

  // ── Query Methods ──

  async getSubgraphBySource(
    sourceType: 'post' | 'reply',
    sourceId: string
  ): Promise<V3Subgraph> {
    const [iNodes, sNodes, edges, enthymemes, socratic, values] = await Promise.all([
      pool.query<V3INode>(
        `SELECT id, analysis_run_id, source_type, source_id, v2_adu_id, content, rewritten_text,
                epistemic_type, fvp_confidence, span_start, span_end, extraction_confidence, created_at
         FROM v3_nodes_i WHERE source_type = $1 AND source_id = $2
         ORDER BY span_start`,
        [sourceType, sourceId]
      ),
      pool.query<V3SNode>(
        `SELECT s.* FROM v3_nodes_s s
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE r.source_type = $1 AND r.source_id = $2`,
        [sourceType, sourceId]
      ),
      pool.query<V3Edge>(
        `SELECT e.* FROM v3_edges e
         JOIN v3_nodes_s s ON e.scheme_node_id = s.id
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE r.source_type = $1 AND r.source_id = $2`,
        [sourceType, sourceId]
      ),
      pool.query<V3Enthymeme>(
        `SELECT en.* FROM v3_enthymemes en
         JOIN v3_nodes_s s ON en.scheme_id = s.id
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE r.source_type = $1 AND r.source_id = $2`,
        [sourceType, sourceId]
      ),
      pool.query<V3SocraticQuestion>(
        `SELECT sq.* FROM v3_socratic_questions sq
         JOIN v3_nodes_s s ON sq.scheme_id = s.id
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE r.source_type = $1 AND r.source_id = $2`,
        [sourceType, sourceId]
      ),
      pool.query<V3ExtractedValue>(
        `SELECT ev.* FROM v3_extracted_values ev
         JOIN v3_nodes_i i ON ev.i_node_id = i.id
         WHERE i.source_type = $1 AND i.source_id = $2`,
        [sourceType, sourceId]
      ),
    ]);

    return {
      i_nodes: iNodes.rows,
      s_nodes: sNodes.rows,
      edges: edges.rows,
      enthymemes: enthymemes.rows,
      socratic_questions: socratic.rows,
      extracted_values: values.rows,
    };
  },

  async getThreadSubgraph(postId: string): Promise<V3Subgraph> {
    // Aggregate V3 graphs across the post + all its replies
    const [iNodes, sNodes, edges, enthymemes, socratic, values] = await Promise.all([
      pool.query<V3INode>(
        `SELECT i.id, i.analysis_run_id, i.source_type, i.source_id, i.v2_adu_id, i.content,
                i.rewritten_text, i.epistemic_type, i.fvp_confidence, i.span_start, i.span_end,
                i.extraction_confidence, i.created_at
         FROM v3_nodes_i i
         WHERE (i.source_type = 'post' AND i.source_id = $1)
            OR (i.source_type = 'reply' AND i.source_id IN (SELECT id FROM replies WHERE post_id = $1))
         ORDER BY i.created_at, i.span_start`,
        [postId]
      ),
      pool.query<V3SNode>(
        `SELECT s.* FROM v3_nodes_s s
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE (r.source_type = 'post' AND r.source_id = $1)
            OR (r.source_type = 'reply' AND r.source_id IN (SELECT id FROM replies WHERE post_id = $1))`,
        [postId]
      ),
      pool.query<V3Edge>(
        `SELECT e.* FROM v3_edges e
         JOIN v3_nodes_s s ON e.scheme_node_id = s.id
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE (r.source_type = 'post' AND r.source_id = $1)
            OR (r.source_type = 'reply' AND r.source_id IN (SELECT id FROM replies WHERE post_id = $1))`,
        [postId]
      ),
      pool.query<V3Enthymeme>(
        `SELECT en.* FROM v3_enthymemes en
         JOIN v3_nodes_s s ON en.scheme_id = s.id
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE (r.source_type = 'post' AND r.source_id = $1)
            OR (r.source_type = 'reply' AND r.source_id IN (SELECT id FROM replies WHERE post_id = $1))`,
        [postId]
      ),
      pool.query<V3SocraticQuestion>(
        `SELECT sq.* FROM v3_socratic_questions sq
         JOIN v3_nodes_s s ON sq.scheme_id = s.id
         JOIN v3_analysis_runs r ON s.analysis_run_id = r.id
         WHERE (r.source_type = 'post' AND r.source_id = $1)
            OR (r.source_type = 'reply' AND r.source_id IN (SELECT id FROM replies WHERE post_id = $1))`,
        [postId]
      ),
      pool.query<V3ExtractedValue>(
        `SELECT ev.* FROM v3_extracted_values ev
         JOIN v3_nodes_i i ON ev.i_node_id = i.id
         WHERE (i.source_type = 'post' AND i.source_id = $1)
            OR (i.source_type = 'reply' AND i.source_id IN (SELECT id FROM replies WHERE post_id = $1))`,
        [postId]
      ),
    ]);

    return {
      i_nodes: iNodes.rows,
      s_nodes: sNodes.rows,
      edges: edges.rows,
      enthymemes: enthymemes.rows,
      socratic_questions: socratic.rows,
      extracted_values: values.rows,
    };
  },

  async findSimilarINodes(
    embedding: number[],
    threshold: number = 0.75,
    limit: number = 10
  ): Promise<Array<V3INode & { similarity: number }>> {
    const result = await pool.query(
      `SELECT id, analysis_run_id, source_type, source_id, v2_adu_id, content, rewritten_text,
              epistemic_type, fvp_confidence, span_start, span_end, extraction_confidence, created_at,
              (1 - (embedding <=> $1::vector)) as similarity
       FROM v3_nodes_i
       WHERE embedding IS NOT NULL AND (1 - (embedding <=> $1::vector)) > $2
       ORDER BY similarity DESC
       LIMIT $3`,
      [JSON.stringify(embedding), threshold, limit]
    );
    return result.rows;
  },
});

export type V3HypergraphRepo = ReturnType<typeof createV3HypergraphRepo>;
