import { Message, Conversation, Platform } from '../types';

/**
 * Interface that all platform adapters must implement
 */
export interface PlatformAdapter {
  /**
   * Fetch messages from the platform API
   * @param accountId - The connected account ID
   * @param since - Optional date to fetch messages since
   * @returns Array of messages
   */
  fetchMessages(accountId: string, since?: Date): Promise<Message[]>;

  /**
   * Send a message through the platform API
   * @param accountId - The connected account ID
   * @param conversationId - The conversation/chat ID
   * @param content - The message content to send
   * @returns The sent message
   */
  sendMessage(accountId: string, conversationId: string, content: string): Promise<Message>;

  /**
   * Mark a message as read on the platform
   * @param accountId - The connected account ID
   * @param messageId - The platform-specific message ID
   */
  markAsRead(accountId: string, messageId: string): Promise<void>;

  /**
   * Get all conversations for the account
   * @param accountId - The connected account ID
   * @returns Array of conversations
   */
  getConversations(accountId: string): Promise<Conversation[]>;
}

/**
 * Error thrown when a platform API call fails
 */
export class PlatformAPIError extends Error {
  constructor(
    message: string,
    public platform: Platform,
    public statusCode?: number,
    public retryable: boolean = false,
    public originalError?: any
  ) {
    super(message);
    this.name = 'PlatformAPIError';
  }
}

/**
 * Error thrown when rate limit is exceeded
 */
export class RateLimitError extends Error {
  constructor(
    message: string,
    public platform: Platform,
    public retryAfter: number // seconds until rate limit resets
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}
