-- Backfill v3_analysis_runs: mark 'completed' runs with no analysis data as 'failed'.
-- These runs were created by a bug where the worker marked a run complete even when
-- the discourse engine returned no analysis, causing empty posts to appear in the feed.

UPDATE v3_analysis_runs
SET
    status        = 'failed',
    error_message = 'Backfill: discourse engine returned no analysis (no nodes found)',
    updated_at    = NOW()
WHERE status = 'completed'
  AND NOT EXISTS (
      SELECT 1 FROM v3_nodes_i WHERE analysis_run_id = v3_analysis_runs.id
  )
  AND NOT EXISTS (
      SELECT 1 FROM v3_nodes_s WHERE analysis_run_id = v3_analysis_runs.id
  );
