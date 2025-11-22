# Database Migration Guide

## Overview

The database schema and encryption utilities have been successfully implemented for the Multi-Platform Messaging Hub.

## What Was Implemented

### 1. Database Schema Migration System

✅ **Migration Script** (`src/db/migrations/001_initial_schema.sql`)
- Creates all required tables with proper relationships
- Enables pgcrypto extension for encryption support
- Sets up all indexes for performance optimization
- Includes migration tracking table

**Tables Created:**
- `users` - User accounts with email and password
- `connected_accounts` - OAuth-connected platform accounts (with encrypted tokens)
- `conversations` - Message conversations/threads
- `messages` - Individual messages (with encrypted content)
- `api_usage_logs` - API call tracking for rate limiting
- `schema_migrations` - Tracks applied migrations

### 2. Migration Runner (`src/db/migrate.ts`)

✅ **Features:**
- Automatically runs pending migrations
- Transaction-based execution (rollback on failure)
- Tracks applied migrations to prevent duplicates
- Can be run via `npm run migrate`

### 3. Query Helper Functions (`src/db/queryHelpers.ts`)

✅ **Generic Helpers:**
- `query()` - Execute raw SQL queries
- `queryOne()` - Get single row
- `queryMany()` - Get multiple rows
- `insertOne()` - Insert and return row
- `updateById()` - Update by ID
- `deleteById()` - Delete by ID
- `findById()` - Find by ID
- `findWithPagination()` - Paginated queries
- `transaction()` - Transaction wrapper

✅ **Encrypted Data Helpers:**
- `insertConnectedAccount()` - Insert account with encrypted tokens
- `getConnectedAccountById()` - Get account with decrypted tokens
- `updateAccountTokens()` - Update encrypted tokens
- `insertMessage()` - Insert message with encrypted content
- `getMessagesByConversationId()` - Get messages with decrypted content

✅ **Specialized Helpers:**
- `markMessagesAsRead()` - Mark messages as read
- `updateConversationUnreadCount()` - Update unread counts
- `logApiUsage()` - Log API calls
- `getApiUsage()` - Get API usage statistics

### 4. Enhanced Encryption Utilities (`src/utils/encryption.ts`)

✅ **Functions:**
- `encrypt()` - AES-256-CBC encryption with error handling
- `decrypt()` - Decryption with validation
- `hash()` - SHA-256 hashing
- `verifyEncryptionKey()` - Verify encryption configuration

✅ **Security Features:**
- AES-256-CBC encryption algorithm
- Random IV generation for each encryption
- Automatic key derivation (32-byte requirement)
- Comprehensive error handling

### 5. Database Connection Pool (`src/config/database.ts`)

✅ **Already Configured:**
- PostgreSQL connection pool
- Connection timeout and retry settings
- Error handling

### 6. Database Indexes

✅ **Performance Indexes Created:**
- `idx_connected_accounts_user_id` - Fast user account lookups
- `idx_connected_accounts_platform` - Platform filtering
- `idx_conversations_account_id` - Conversation lookups
- `idx_conversations_last_message` - Sorted conversation lists
- `idx_messages_conversation_id` - Message thread queries
- `idx_messages_sent_at` - Time-based sorting
- `idx_messages_is_read` - Unread message filtering
- `idx_api_usage_platform_timestamp` - Rate limit tracking

## How to Use

### Starting the Database

```bash
# Start PostgreSQL and Redis via Docker
docker-compose up -d postgres redis
```

### Running Migrations

```bash
# Navigate to backend directory
cd backend

# Run migrations
npm run migrate
```

### Using Query Helpers in Code

```typescript
import { 
  insertConnectedAccount, 
  getConnectedAccountById,
  insertMessage,
  getMessagesByConversationId 
} from './db';

// Insert account with encrypted tokens
const account = await insertConnectedAccount({
  userId: user.id,
  platform: 'telegram',
  platformUserId: '123456',
  platformUsername: 'johndoe',
  accessToken: 'secret-token',
  refreshToken: 'refresh-token',
  tokenExpiresAt: new Date('2025-12-31')
});

// Tokens are automatically decrypted when retrieved
const retrievedAccount = await getConnectedAccountById(account.id);
console.log(retrievedAccount.access_token); // Decrypted automatically
```

## Requirements Satisfied

✅ **Requirement 1.3** - OAuth token storage with encryption
✅ **Requirement 6.1** - AES-256 encryption for access tokens
✅ **Requirement 6.2** - Message content encryption at rest

## Environment Variables Required

```env
# Database Configuration
DB_HOST=localhost
DB_PORT=5432
DB_NAME=messaging_hub
DB_USER=postgres
DB_PASSWORD=postgres

# Encryption (32 characters recommended)
ENCRYPTION_KEY=your-32-character-encryption-key
```

## Testing the Implementation

### 1. Verify Database Connection

```bash
# Start database
docker-compose up -d postgres

# Run migrations
npm run migrate
```

### 2. Test Encryption

```typescript
import { verifyEncryptionKey } from './utils/encryption';

const isValid = verifyEncryptionKey();
console.log('Encryption working:', isValid); // Should be true
```

### 3. Test Query Helpers

```typescript
import { query } from './db';

// Test basic query
const result = await query('SELECT NOW()');
console.log('Database connected:', result.rows[0]);
```

## Next Steps

The database schema and utilities are ready for use. You can now:

1. ✅ Start implementing user authentication (Task 3)
2. ✅ Build OAuth service for platform connections (Task 4)
3. ✅ Create platform adapters (Task 5-6)

## Files Created/Modified

### New Files:
- `backend/src/db/migrations/001_initial_schema.sql` - Initial schema migration
- `backend/src/db/migrate.ts` - Migration runner
- `backend/src/db/queryHelpers.ts` - Database query helpers
- `backend/src/db/index.ts` - Module exports
- `backend/src/db/README.md` - Documentation
- `backend/MIGRATION_GUIDE.md` - This guide

### Modified Files:
- `backend/package.json` - Added `migrate` script
- `backend/src/utils/encryption.ts` - Enhanced with error handling and verification

## Notes

- The database schema matches the design document exactly
- All sensitive fields (tokens, message content) are encrypted
- Indexes are optimized for the expected query patterns
- Migration system supports incremental schema changes
- Query helpers provide a clean API for database operations
