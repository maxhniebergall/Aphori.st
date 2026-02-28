-- Consolidate v3_epistemic_notifications into the existing notifications table

-- Add discriminator and epistemic columns to the existing notifications table
ALTER TABLE notifications
  ADD COLUMN category VARCHAR(20) NOT NULL DEFAULT 'SOCIAL',
  ADD COLUMN epistemic_type VARCHAR(50) CHECK (epistemic_type IN (
    'STREAM_HALTED','BOUNTY_STOLEN','BOUNTY_PAID','BOUNTY_LANGUISHED','UPSTREAM_DEFEATED'
  )),
  ADD COLUMN payload JSONB,
  ADD COLUMN is_read BOOLEAN NOT NULL DEFAULT FALSE;

-- Migrate epistemic rows from old table into unified table
INSERT INTO notifications (id, user_id, category, epistemic_type, payload, is_read, created_at, updated_at)
SELECT id, user_id, 'EPISTEMIC', type, payload, is_read, created_at, created_at
FROM v3_epistemic_notifications
ON CONFLICT (id) DO NOTHING;

-- Drop old table
DROP TABLE v3_epistemic_notifications;

-- Add indexes for unified queries
CREATE INDEX idx_notifications_unread ON notifications(user_id, is_read) WHERE is_read = FALSE;
CREATE INDEX idx_notifications_category ON notifications(user_id, category, updated_at DESC);
