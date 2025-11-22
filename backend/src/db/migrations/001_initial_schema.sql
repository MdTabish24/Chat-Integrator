-- Migration: 001_initial_schema
-- Description: Create initial database schema with all tables and indexes
-- Date: 2025-11-21

-- Enable pgcrypto extension for encryption
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create users table
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);

-- Create connected_accounts table
CREATE TABLE IF NOT EXISTS connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  platform_user_id VARCHAR(255) NOT NULL,
  platform_username VARCHAR(255),
  access_token TEXT NOT NULL,
  refresh_token TEXT,
  token_expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, platform, platform_user_id)
);

CREATE INDEX IF NOT EXISTS idx_connected_accounts_user_id ON connected_accounts(user_id);
CREATE INDEX IF NOT EXISTS idx_connected_accounts_platform ON connected_accounts(platform);

-- Create conversations table
CREATE TABLE IF NOT EXISTS conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform_conversation_id VARCHAR(255) NOT NULL,
  participant_name VARCHAR(255),
  participant_id VARCHAR(255),
  participant_avatar_url TEXT,
  last_message_at TIMESTAMP,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(account_id, platform_conversation_id)
);

CREATE INDEX IF NOT EXISTS idx_conversations_account_id ON conversations(account_id);
CREATE INDEX IF NOT EXISTS idx_conversations_last_message ON conversations(last_message_at DESC);

-- Create messages table
CREATE TABLE IF NOT EXISTS messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  platform_message_id VARCHAR(255) NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  sender_name VARCHAR(255),
  content TEXT NOT NULL,
  message_type VARCHAR(50) DEFAULT 'text',
  media_url TEXT,
  is_outgoing BOOLEAN DEFAULT false,
  is_read BOOLEAN DEFAULT false,
  sent_at TIMESTAMP NOT NULL,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(conversation_id, platform_message_id)
);

CREATE INDEX IF NOT EXISTS idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_messages_sent_at ON messages(sent_at DESC);
CREATE INDEX IF NOT EXISTS idx_messages_is_read ON messages(is_read) WHERE is_read = false;

-- Create api_usage_logs table
CREATE TABLE IF NOT EXISTS api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  request_count INTEGER DEFAULT 1,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_api_usage_platform_timestamp ON api_usage_logs(platform, timestamp);

-- Create migrations tracking table
CREATE TABLE IF NOT EXISTS schema_migrations (
  id SERIAL PRIMARY KEY,
  migration_name VARCHAR(255) UNIQUE NOT NULL,
  applied_at TIMESTAMP DEFAULT NOW()
);

-- Record this migration
INSERT INTO schema_migrations (migration_name) 
VALUES ('001_initial_schema')
ON CONFLICT (migration_name) DO NOTHING;
