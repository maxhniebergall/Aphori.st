-- V3 Batch Pipeline Tracking
-- Persists pipeline run state and Gemini batch job names to GCS/DB so
-- Cloud Run instances can resume in-flight work after a cold restart.

-- Pipeline-level run tracker
CREATE TABLE v3_batch_pipeline_runs (
    run_id        VARCHAR(64)  PRIMARY KEY,
    status        VARCHAR(20)  NOT NULL DEFAULT 'running'
                               CHECK (status IN ('running', 'completed', 'failed')),
    source_type   VARCHAR(10)  NOT NULL DEFAULT 'all',
    text_count    INT          NOT NULL DEFAULT 0,
    created_at    TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    completed_at  TIMESTAMPTZ,
    error_message TEXT
);

-- Per-stage Gemini batch job tracking (for reconnecting after restart)
CREATE TABLE v3_batch_checkpoints (
    run_id           VARCHAR(64)  NOT NULL
                     REFERENCES v3_batch_pipeline_runs(run_id) ON DELETE CASCADE,
    stage            VARCHAR(30)  NOT NULL,  -- 'stage0', 'stage1-fvp', 'stage2-rewrite', etc.
    gemini_job_name  TEXT,                   -- Gemini Batch API job name (for re-polling)
    request_count    INT          NOT NULL DEFAULT 0,
    gcs_path         TEXT,                   -- GCS object path for parsed checkpoint JSON
    completed        BOOLEAN      NOT NULL DEFAULT FALSE,
    created_at       TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    PRIMARY KEY (run_id, stage)
);

CREATE INDEX idx_v3_pipeline_runs_status ON v3_batch_pipeline_runs(status);
