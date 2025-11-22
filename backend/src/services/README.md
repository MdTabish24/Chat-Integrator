# Services

This directory contains the core business logic services for the Multi-Platform Messaging Hub.

## Message Aggregator Service

The `messageAggregatorService` is responsible for aggregating messages from all connected social media platforms into a unified inbox.

### Features

1. **Fetch Messages from All Platforms**
   - Fetches messages from all connected accounts for a user
   - Supports filtering by date (fetch messages since a specific time)
   - Handles errors gracefully per account

2. **Message Storage with Encryption**
   - Stores messages in the database with AES-256 encryption
   - Prevents duplicate messages using platform message IDs
   - Automatically creates conversations when needed

3. **Conversation Management**
   - Creates conversations automatically when new messages arrive
   - Updates conversation metadata (last message time, unread count)
   - Tracks participant information

4. **Unread Count Tracking**
   - Calculates unread counts per conversation
   - Provides total unread count across all platforms
   - Provides unread count breakdown by platform

5. **Pagination Support**
   - Retrieves messages with pagination for performance
   - Supports offset-based pagination
   - Returns total count and hasMore flag

### Usage Examples

#### Fetch Messages for a User

```typescript
import { messageAggregatorService } from './services';

// Fetch all messages for a user
const messages = await messageAggregatorService.fetchMessagesForUser(userId);

// Fetch messages since a specific date
const since = new Date('2024-01-01');
const recentMessages = await messageAggregatorService.fetchMessagesForUser(userId, since);
```

#### Get Conversations with Pagination

```typescript
// Get first 50 conversations
const result = await messageAggregatorService.getConversationsForUser(userId, 50, 0);
console.log(`Total conversations: ${result.total}`);
console.log(`Has more: ${result.hasMore}`);
console.log(`Conversations:`, result.conversations);
```

#### Get Messages for a Conversation

```typescript
const result = await messageAggregatorService.getMessagesByConversation(
  conversationId,
  50,  // limit
  0    // offset
);

console.log(`Messages:`, result.messages);
console.log(`Total: ${result.total}`);
console.log(`Has more: ${result.hasMore}`);
```

#### Mark Messages as Read

```typescript
// Mark specific messages as read
await messageAggregatorService.markMessagesAsRead(conversationId, [messageId1, messageId2]);

// Mark all messages in a conversation as read
await messageAggregatorService.markMessagesAsRead(conversationId);
```

#### Get Unread Counts

```typescript
// Get total unread count
const totalUnread = await messageAggregatorService.getTotalUnreadCount(userId);

// Get unread count by platform
const unreadByPlatform = await messageAggregatorService.getUnreadCountByPlatform(userId);
console.log(`Telegram unread: ${unreadByPlatform.get('telegram')}`);
console.log(`Twitter unread: ${unreadByPlatform.get('twitter')}`);
```

#### Sync Messages (for Polling Service)

```typescript
// Sync messages for all connected accounts
const result = await messageAggregatorService.syncMessagesForUser(userId);

console.log(`Total messages synced: ${result.totalMessages}`);
result.accountResults.forEach(account => {
  console.log(`${account.platform}: ${account.messageCount} messages (${account.success ? 'success' : 'failed'})`);
  if (!account.success) {
    console.error(`Error: ${account.error}`);
  }
});
```

### API Endpoints

The message aggregator service is exposed through the following REST API endpoints:

#### Messages

- `GET /api/messages` - Get all messages for authenticated user
- `GET /api/messages/:conversationId` - Get messages for a conversation
- `POST /api/messages/:conversationId/send` - Send a message
- `PATCH /api/messages/:messageId/read` - Mark a message as read
- `PATCH /api/messages/conversation/:conversationId/read` - Mark all messages in conversation as read
- `GET /api/messages/unread/count` - Get unread message counts
- `POST /api/messages/sync` - Sync messages from all platforms

#### Conversations

- `GET /api/conversations` - Get all conversations for authenticated user

### Error Handling

The service handles various error scenarios:

1. **Rate Limit Errors**: Throws `RateLimitError` with retry information
2. **Platform API Errors**: Throws `PlatformAPIError` with platform-specific details
3. **Account Not Found**: Throws error if account doesn't exist or is inactive
4. **Encryption Errors**: Logs critical errors and fails securely

### Security

- All message content is encrypted at rest using AES-256
- Access tokens are encrypted in the database
- User authentication required for all API endpoints
- Conversation access is verified before operations

### Performance Considerations

- Uses database indexes for efficient queries
- Implements pagination to handle large message volumes
- Batches message storage operations
- Continues processing even if individual accounts fail

