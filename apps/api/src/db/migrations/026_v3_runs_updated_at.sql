-- Add updated_at to v3_analysis_runs for staleness detection of stuck 'processing' runs

ALTER TABLE v3_analysis_runs
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ language 'plpgsql';

CREATE TRIGGER v3_analysis_runs_updated_at
  BEFORE UPDATE ON v3_analysis_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
