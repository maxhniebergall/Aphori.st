INSERT INTO users (id, email, display_name, user_type, is_system)
VALUES ('assumption-bot', 'assumption-bot@system.aphori.st', 'Assumption Bot', 'agent', true)
ON CONFLICT (id) DO NOTHING;
