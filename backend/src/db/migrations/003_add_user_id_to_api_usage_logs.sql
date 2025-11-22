-- Migration: 003_add_user_id_to_api_usage_logs
-- Description: Add user_id column to api_usage_logs for user-level rate limiting
-- Date: 2025-11-22

-- Add user_id column to api_usage_logs
ALTER TABLE api_usage_logs 
ADD COLUMN IF NOT EXISTS user_id UUID REFERENCES users(id) ON DELETE CASCADE;

-- Create index for user_id lookups
CREATE INDEX IF NOT EXISTS idx_api_usage_user_timestamp ON api_usage_logs(user_id, timestamp);

-- Make account_id nullable since we now support both user-level and account-level logging
ALTER TABLE api_usage_logs 
ALTER COLUMN account_id DROP NOT NULL;

-- Record this migration
INSERT INTO schema_migrations (migration_name) 
VALUES ('003_add_user_id_to_api_usage_logs')
ON CONFLICT (migration_name) DO NOTHING;
