-- Drop V2 analysis_status field from posts and replies
-- V3 analysis completion is tracked in v3_analysis_runs table

ALTER TABLE posts DROP COLUMN analysis_status;
ALTER TABLE replies DROP COLUMN analysis_status;

DROP TYPE analysis_status;
