-- Remove epistemic_score column — it's just the sum of the 3 karma types
-- Display pioneer_karma + builder_karma + critic_karma directly instead
ALTER TABLE users DROP COLUMN IF EXISTS epistemic_score;
