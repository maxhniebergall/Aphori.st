#!/usr/bin/env node
import { getPool, closePool } from '../db/pool.js';
import { enqueueV3Analysis } from './enqueueV3Analysis.js';

async function main() {
  const pool = getPool();
  const { rows } = await pool.query(`
    SELECT r.id, r.post_id, r.parent_reply_id, r.content
    FROM replies r
    LEFT JOIN v3_analysis_runs ar ON ar.source_id = r.id AND ar.source_type = 'reply'
    WHERE r.created_at > NOW() - INTERVAL '8 hours'
      AND (ar.id IS NULL OR ar.status NOT IN ('completed', 'processing'))
    ORDER BY r.created_at
  `);
  console.log(`Re-enqueuing ${rows.length} replies...`);
  let count = 0;
  for (const row of rows) {
    const parent = row.parent_reply_id
      ? { sourceType: 'reply' as const, sourceId: row.parent_reply_id }
      : { sourceType: 'post' as const, sourceId: row.post_id };
    try {
      await enqueueV3Analysis('reply', row.id, row.content, parent);
      count++;
    } catch (_) {}
  }
  console.log(`Enqueued ${count} jobs`);
  await closePool();
}
main().catch(e => { console.error(e); process.exit(1); });
