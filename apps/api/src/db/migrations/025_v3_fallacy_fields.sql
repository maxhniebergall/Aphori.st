-- Migration 025: Add fallacy detection fields to V3 scheme nodes
-- These columns store the result of the 2-step LLM fallacy classification pipeline.

ALTER TABLE v3_nodes_s
  ADD COLUMN IF NOT EXISTS fallacy_type        TEXT,          -- e.g. 'AD_HOMINEM', 'STRAWMAN', 'NONE', 'EQUIVOCATION'
  ADD COLUMN IF NOT EXISTS fallacy_explanation TEXT;          -- 1-sentence LLM explanation of the detected fallacy
