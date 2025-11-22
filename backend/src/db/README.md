# Database Module

This module provides database migration utilities and query helpers for the Multi-Platform Messaging Hub.

## Features

- **Migration System**: Version-controlled database schema migrations
- **Query Helpers**: Simplified database operations with built-in encryption
- **Connection Pool**: Optimized PostgreSQL connection management
- **Encryption**: Automatic encryption/decryption for sensitive data

## Migration System

### Running Migrations

```bash
# Run all pending migrations
npm run migrate
```

### Creating New Migrations

1. Create a new SQL file in `src/db/migrations/` with format: `XXX_description.sql`
2. Add your SQL statements
3. Run `npm run migrate` to apply

Example migration file (`002_add_user_preferences.sql`):
```sql
-- Migration: 002_add_user_preferences
-- Description: Add user preferences table

CREATE TABLE user_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  theme VARCHAR(50) DEFAULT 'light',
  notifications_enabled BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW()
);
```

## Query Helpers

### Basic Operations

```typescript
import { query, queryOne, queryMany, findById } from './db';

// Execute a raw query
const result = await query('SELECT * FROM users WHERE email = $1', ['user@example.com']);

// Get a single row
const user = await queryOne('SELECT * FROM users WHERE id = $1', [userId]);

// Get multiple rows
const users = await queryMany('SELECT * FROM users WHERE is_active = $1', [true]);

// Find by ID
const user = await findById('users', userId);
```

### Insert, Update, Delete

```typescript
import { insertOne, updateById, deleteById } from './db';

// Insert a record
const newUser = await insertOne('users', {
  email: 'user@example.com',
  password_hash: hashedPassword
});

// Update a record
const updatedUser = await updateById('users', userId, {
  email: 'newemail@example.com'
});

// Delete a record
const deleted = await deleteById('users', userId);
```

### Pagination

```typescript
import { findWithPagination } from './db';

const { rows, total } = await findWithPagination('messages', {
  where: 'conversation_id = $1 AND is_read = false',
  params: [conversationId],
  orderBy: 'sent_at DESC',
  limit: 50,
  offset: 0
});
```

### Encrypted Data Operations

```typescript
import { 
  insertConnectedAccount, 
  getConnectedAccountById,
  updateAccountTokens,
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

// Get account with decrypted tokens
const account = await getConnectedAccountById(accountId);
console.log(account.access_token); // Automatically decrypted

// Update tokens
await updateAccountTokens(
  accountId,
  'new-access-token',
  'new-refresh-token',
  new Date('2026-01-31')
);

// Insert message with encrypted content
const message = await insertMessage({
  conversationId: conv.id,
  platformMessageId: 'msg-123',
  senderId: 'user-456',
  senderName: 'John Doe',
  content: 'Hello, this will be encrypted',
  messageType: 'text',
  isOutgoing: false,
  sentAt: new Date()
});

// Get messages with decrypted content
const messages = await getMessagesByConversationId(conversationId, 50, 0);
```

### Transactions

```typescript
import { transaction } from './db';

await transaction(async (client) => {
  // All queries within this callback are part of the same transaction
  await client.query('INSERT INTO users (email) VALUES ($1)', ['user@example.com']);
  await client.query('INSERT INTO user_preferences (user_id) VALUES ($1)', [userId]);
  // If any query fails, all changes are rolled back
});
```

### API Usage Tracking

```typescript
import { logApiUsage, getApiUsage } from './db';

// Log an API call
await logApiUsage(accountId, 'telegram', '/getUpdates', 1);

// Get usage count for the last hour
const since = new Date(Date.now() - 60 * 60 * 1000);
const count = await getApiUsage(accountId, 'telegram', since);
```

### Message Operations

```typescript
import { 
  markMessagesAsRead, 
  updateConversationUnreadCount 
} from './db';

// Mark specific messages as read
await markMessagesAsRead(conversationId, [messageId1, messageId2]);

// Mark all messages in a conversation as read
await markMessagesAsRead(conversationId);

// Update unread count for a conversation
await updateConversationUnreadCount(conversationId);
```

## Database Schema

### Tables

- **users**: User accounts
- **connected_accounts**: OAuth-connected platform accounts (tokens encrypted)
- **conversations**: Message conversations/threads
- **messages**: Individual messages (content encrypted)
- **api_usage_logs**: API call tracking for rate limiting
- **schema_migrations**: Migration tracking

### Indexes

Performance indexes are automatically created for:
- User lookups by email
- Account lookups by user_id and platform
- Conversation lookups by account_id
- Message lookups by conversation_id and read status
- API usage lookups by platform and timestamp

## Security

### Encryption

All sensitive data is encrypted using AES-256-CBC:
- OAuth access tokens
- OAuth refresh tokens
- Message content

The encryption key is configured via the `ENCRYPTION_KEY` environment variable.

### Best Practices

1. Always use parameterized queries to prevent SQL injection
2. Never log decrypted sensitive data
3. Rotate encryption keys periodically
4. Use transactions for multi-step operations
5. Monitor API usage logs for unusual patterns

## Environment Variables

Required environment variables:

```env
DB_HOST=localhost
DB_PORT=5432
DB_NAME=messaging_hub
DB_USER=postgres
DB_PASSWORD=postgres
ENCRYPTION_KEY=your-32-character-encryption-key
```

## Testing

To test the database connection and encryption:

```typescript
import pool from '../config/database';
import { verifyEncryptionKey } from '../utils/encryption';

// Test database connection
await pool.query('SELECT NOW()');

// Verify encryption is working
const isValid = verifyEncryptionKey();
console.log('Encryption key valid:', isValid);
```
