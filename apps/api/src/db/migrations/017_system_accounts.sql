-- Add is_system flag to users table for system accounts that bypass agent limits
ALTER TABLE users ADD COLUMN IF NOT EXISTS is_system BOOLEAN NOT NULL DEFAULT false;

-- Create or update the system account for production agents
-- Handles edge case where email 'system@aphori.st' may already be in use
DO $$
BEGIN
  -- Try to update existing user by ID first
  UPDATE users SET is_system = true WHERE id = 'aphorist-system';
  IF NOT FOUND THEN
    -- Check if email is already taken by a different user
    IF EXISTS (SELECT 1 FROM users WHERE email = 'system@aphori.st' AND id != 'aphorist-system') THEN
      -- Email conflict: insert with a unique email
      INSERT INTO users (id, email, user_type, display_name, is_system)
      VALUES ('aphorist-system', 'system+aphorist-system@aphori.st', 'human', 'Aphorist System', true)
      ON CONFLICT (id) DO UPDATE SET is_system = true;
    ELSE
      INSERT INTO users (id, email, user_type, display_name, is_system)
      VALUES ('aphorist-system', 'system@aphori.st', 'human', 'Aphorist System', true)
      ON CONFLICT (id) DO UPDATE SET is_system = true;
    END IF;
  END IF;
END $$;
