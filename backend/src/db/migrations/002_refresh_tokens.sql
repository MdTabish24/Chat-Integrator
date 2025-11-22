-- Migration: 002_refresh_tokens
-- Description: Create refresh_tokens table for JWT refresh token management
-- Date: 2025-11-21

-- Create refresh_tokens table
CREATE TABLE IF NOT EXISTS refresh_tokens (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  token VARCHAR(500) UNIQUE NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  revoked_at TIMESTAMP
);

CREATE INDEX IF NOT EXISTS idx_refresh_tokens_user_id ON refresh_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_token ON refresh_tokens(token);
CREATE INDEX IF NOT EXISTS idx_refresh_tokens_expires_at ON refresh_tokens(expires_at);

-- Record this migration
INSERT INTO schema_migrations (migration_name) 
VALUES ('002_refresh_tokens')
ON CONFLICT (migration_name) DO NOTHING;
