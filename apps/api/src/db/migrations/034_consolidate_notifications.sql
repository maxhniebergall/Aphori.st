-- Consolidate v3_epistemic_notifications into the existing notifications table

-- Make target_type and target_id nullable to allow EPISTEMIC notifications without a target
ALTER TABLE notifications
  ALTER COLUMN target_type DROP NOT NULL,
  ALTER COLUMN target_id DROP NOT NULL;

-- Add discriminator and epistemic columns to the existing notifications table
ALTER TABLE notifications
  ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'SOCIAL' CHECK (category IN ('SOCIAL', 'EPISTEMIC')),
  ADD COLUMN epistemic_type VARCHAR(50) CHECK (epistemic_type IN (
    'STREAM_HALTED','BOUNTY_STOLEN','BOUNTY_PAID','BOUNTY_LANGUISHED','UPSTREAM_DEFEATED'
  )),
  ADD COLUMN payload JSONB,
  ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT FALSE;

-- Migrate epistemic rows from old table into unified table
INSERT INTO notifications (id, user_id, category, epistemic_type, payload, is_read, created_at, updated_at)
SELECT id, user_id, 'EPISTEMIC', type, payload, is_read, created_at, updated_at
FROM v3_epistemic_notifications
ON CONFLICT (id) DO NOTHING;

-- Drop old table
DROP TABLE v3_epistemic_notifications;

-- Enforce category-dependent integrity constraints
-- SOCIAL rows must have target fields; EPISTEMIC rows must have epistemic_type
ALTER TABLE notifications
  ADD CONSTRAINT chk_social_requires_target CHECK (
    category = 'EPISTEMIC' OR (target_type IS NOT NULL AND target_id IS NOT NULL)
  ),
  ADD CONSTRAINT chk_epistemic_requires_type CHECK (
    category = 'SOCIAL' OR epistemic_type IS NOT NULL
  );

-- Add indexes for unified queries
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_category ON notifications(user_id, category, updated_at DESC);
