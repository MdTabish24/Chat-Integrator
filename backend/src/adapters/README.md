# Platform Adapters

This directory contains the platform adapter interface and base implementation for integrating with various messaging platforms.

## Architecture

### PlatformAdapter Interface
Defines the contract that all platform adapters must implement:
- `fetchMessages(accountId, since?)` - Fetch messages from the platform
- `sendMessage(accountId, conversationId, content)` - Send a message
- `markAsRead(accountId, messageId)` - Mark a message as read
- `getConversations(accountId)` - Get all conversations

### BasePlatformAdapter
Abstract base class providing common functionality:
- **Rate Limiting**: Automatic rate limit enforcement using Redis
- **Retry Logic**: Exponential backoff for failed API calls (max 3 retries)
- **Error Handling**: Standardized error wrapping and classification

## Rate Limits

Platform-specific rate limits are configured in `PLATFORM_RATE_LIMITS`:

| Platform  | Requests | Window      |
|-----------|----------|-------------|
| Telegram  | 30       | 1 second    |
| Twitter   | 300      | 15 minutes  |
| LinkedIn  | 100      | 1 day       |
| Instagram | 200      | 1 hour      |
| WhatsApp  | 80       | 1 second    |
| Facebook  | 200      | 1 hour      |
| Teams     | 10,000   | 10 minutes  |

## Creating a New Adapter

To create a new platform adapter:

1. Extend `BasePlatformAdapter`
2. Implement the abstract methods
3. Implement `getAccessToken()` and `refreshTokenIfNeeded()`
4. Use `executeWithRetry()` for all API calls

Example:

```typescript
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';

export class TelegramAdapter extends BasePlatformAdapter {
  constructor() {
    super('telegram');
  }

  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      // Make API call to Telegram
      // Transform response to Message[]
      return messages;
    }, accountId);
  }

  async sendMessage(accountId: string, conversationId: string, content: string): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      // Make API call to send message
      return message;
    }, accountId);
  }

  async markAsRead(accountId: string, messageId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      // Make API call to mark as read
    }, accountId);
  }

  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      // Make API call to get conversations
      return conversations;
    }, accountId);
  }

  protected async getAccessToken(accountId: string): Promise<string> {
    // Fetch and decrypt token from database
    return token;
  }

  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    // Check token expiry and refresh if needed
  }
}
```

## Error Handling

The base adapter provides two custom error types:

- `PlatformAPIError`: General API errors with retry information
- `RateLimitError`: Rate limit exceeded errors with retry-after time

Errors are automatically classified as retryable or non-retryable based on:
- Network errors (ECONNRESET, ETIMEDOUT, ENOTFOUND)
- HTTP 5xx errors
- HTTP 429 (Too Many Requests)
- HTTP 408 (Request Timeout)

## Testing

When testing adapters:
1. Mock the Redis client for rate limit tests
2. Mock platform API responses
3. Test retry logic with simulated failures
4. Verify rate limit enforcement
