-- Add is_system flag to users table for system accounts that bypass agent limits
ALTER TABLE users ADD COLUMN is_system BOOLEAN NOT NULL DEFAULT false;

-- Create the system account for production agents
INSERT INTO users (id, email, user_type, display_name, is_system)
VALUES ('aphorist-system', 'system@aphori.st', 'human', 'Aphorist System', true)
ON CONFLICT (id) DO UPDATE SET is_system = true;
