import { Message, Conversation, ConnectedAccount, Platform } from '../types';
import { AdapterFactory } from '../adapters/AdapterFactory';
import { PlatformAPIError, RateLimitError } from '../adapters/PlatformAdapter';
import { encrypt, decrypt } from '../utils/encryption';
import {
  query,
  queryOne,
  queryMany,
  insertOne,
  getConnectedAccountById,
  logApiUsage
} from '../db/queryHelpers';

/**
 * Service for aggregating messages from all connected platforms
 */
export class MessageAggregatorService {
  /**
   * Fetch messages from all connected accounts for a user
   * @param userId - The user ID
   * @param since - Optional date to fetch messages since
   * @returns Array of messages from all platforms
   */
  async fetchMessagesForUser(userId: string, since?: Date): Promise<Message[]> {
    const accounts = await this.getActiveAccountsForUser(userId);
    const allMessages: Message[] = [];

    for (const account of accounts) {
      try {
        const messages = await this.fetchMessagesForAccount(account.id, since);
        allMessages.push(...messages);
      } catch (error) {
        console.error(`Error fetching messages for account ${account.id}:`, error);
        // Continue with other accounts even if one fails
      }
    }

    // Sort by sent_at descending (newest first)
    return allMessages.sort((a, b) => b.sentAt.getTime() - a.sentAt.getTime());
  }

  /**
   * Fetch messages for a specific connected account
   * @param accountId - The connected account ID
   * @param since - Optional date to fetch messages since
   * @returns Array of messages
   */
  async fetchMessagesForAccount(accountId: string, since?: Date): Promise<Message[]> {
    const account = await getConnectedAccountById(accountId);
    
    if (!account || !account.is_active) {
      throw new Error(`Account ${accountId} not found or inactive`);
    }

    const adapter = AdapterFactory.getAdapter(account.platform as Platform);
    
    try {
      // Fetch messages from platform API
      const platformMessages = await adapter.fetchMessages(accountId, since);
      
      // Log API usage
      await logApiUsage(accountId, account.platform, 'fetchMessages');

      // Store messages in database
      const storedMessages: Message[] = [];
      for (const message of platformMessages) {
        try {
          const stored = await this.storeMessage(message, accountId);
          storedMessages.push(stored);
        } catch (error) {
          console.error(`Error storing message ${message.platformMessageId}:`, error);
          // Continue with other messages
        }
      }

      return storedMessages;
    } catch (error) {
      if (error instanceof RateLimitError) {
        console.warn(`Rate limit hit for ${account.platform}, retry after ${error.retryAfter}s`);
        throw error;
      }
      
      if (error instanceof PlatformAPIError) {
        console.error(`Platform API error for ${account.platform}:`, error.message);
        throw error;
      }

      throw error;
    }
  }

  /**
   * Store a message in the database with encryption
   * Creates or updates conversation as needed
   * @param message - The message to store
   * @param accountId - The connected account ID
   * @returns The stored message
   */
  async storeMessage(message: Message, accountId: string): Promise<Message> {
    // Ensure conversation exists
    const conversation = await this.ensureConversation(message, accountId);

    // Check if message already exists
    const existing = await queryOne(
      `SELECT id FROM messages 
       WHERE conversation_id = $1 AND platform_message_id = $2`,
      [conversation.id, message.platformMessageId]
    );

    if (existing) {
      // Message already exists, return it with decrypted content
      const existingMessage = await queryOne(
        `SELECT * FROM messages WHERE id = $1`,
        [existing.id]
      );
      return {
        ...existingMessage,
        content: decrypt(existingMessage.content)
      };
    }

    // Encrypt message content
    const encryptedContent = encrypt(message.content);

    // Insert message
    const stored = await insertOne('messages', {
      conversation_id: conversation.id,
      platform_message_id: message.platformMessageId,
      sender_id: message.senderId,
      sender_name: message.senderName,
      content: encryptedContent,
      message_type: message.messageType || 'text',
      media_url: message.mediaUrl,
      is_outgoing: message.isOutgoing || false,
      is_read: false,
      sent_at: message.sentAt,
      delivered_at: message.deliveredAt
    });

    // Update conversation last_message_at and unread count
    await this.updateConversationAfterMessage(conversation.id, message.sentAt, message.isOutgoing);

    const decryptedMessage = {
      ...stored,
      content: message.content // Return with original unencrypted content
    };

    // Emit WebSocket event for new message (only for incoming messages)
    if (!message.isOutgoing) {
      await this.emitNewMessageEvent(decryptedMessage, accountId, conversation);
    }

    return decryptedMessage;
  }

  /**
   * Ensure a conversation exists for the message
   * Creates conversation if it doesn't exist
   * @param message - The message
   * @param accountId - The connected account ID
   * @returns The conversation
   */
  private async ensureConversation(message: Message, accountId: string): Promise<Conversation> {
    // Try to find existing conversation
    const existing = await queryOne<Conversation>(
      `SELECT * FROM conversations 
       WHERE account_id = $1 AND platform_conversation_id = $2`,
      [accountId, message.conversationId]
    );

    if (existing) {
      return existing;
    }

    // Create new conversation
    const conversation = await insertOne<Conversation>('conversations', {
      account_id: accountId,
      platform_conversation_id: message.conversationId,
      participant_name: message.senderName,
      participant_id: message.senderId,
      participant_avatar_url: null,
      last_message_at: message.sentAt,
      unread_count: message.isOutgoing ? 0 : 1
    });

    return conversation;
  }

  /**
   * Update conversation after a new message
   * Updates last_message_at and unread count
   * @param conversationId - The conversation ID
   * @param messageTime - The message timestamp
   * @param isOutgoing - Whether the message is outgoing
   */
  private async updateConversationAfterMessage(
    conversationId: string,
    messageTime: Date,
    isOutgoing: boolean
  ): Promise<void> {
    if (isOutgoing) {
      // For outgoing messages, just update last_message_at
      await query(
        `UPDATE conversations 
         SET last_message_at = $1, updated_at = NOW()
         WHERE id = $2`,
        [messageTime, conversationId]
      );
    } else {
      // For incoming messages, update last_message_at and increment unread count
      await query(
        `UPDATE conversations 
         SET last_message_at = $1, 
             unread_count = unread_count + 1,
             updated_at = NOW()
         WHERE id = $2`,
        [messageTime, conversationId]
      );
    }
  }

  /**
   * Get messages for a conversation with pagination
   * @param conversationId - The conversation ID
   * @param limit - Number of messages to return
   * @param offset - Number of messages to skip
   * @returns Paginated messages with decrypted content
   */
  async getMessagesByConversation(
    conversationId: string,
    limit: number = 50,
    offset: number = 0
  ): Promise<{ messages: Message[]; total: number; hasMore: boolean }> {
    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count FROM messages WHERE conversation_id = $1`,
      [conversationId]
    );
    const total = parseInt(countResult?.count || '0');

    // Get paginated messages
    const messages = await queryMany<Message>(
      `SELECT * FROM messages 
       WHERE conversation_id = $1 
       ORDER BY sent_at DESC 
       LIMIT $2 OFFSET $3`,
      [conversationId, limit, offset]
    );

    // Decrypt message content
    const decryptedMessages = messages.map(msg => ({
      ...msg,
      content: decrypt(msg.content)
    }));

    const hasMore = offset + messages.length < total;

    return {
      messages: decryptedMessages,
      total,
      hasMore
    };
  }

  /**
   * Get all conversations for a user with unread counts
   * @param userId - The user ID
   * @param limit - Number of conversations to return
   * @param offset - Number of conversations to skip
   * @returns Paginated conversations
   */
  async getConversationsForUser(
    userId: string,
    limit: number = 50,
    offset: number = 0,
    platform?: Platform
  ): Promise<{ conversations: Conversation[]; total: number; hasMore: boolean }> {
    // Build query with optional platform filter
    const whereClause = platform 
      ? 'WHERE ca.user_id = $1 AND ca.platform = $2'
      : 'WHERE ca.user_id = $1';
    
    const params = platform ? [userId, platform] : [userId];

    // Get total count
    const countResult = await queryOne<{ count: string }>(
      `SELECT COUNT(*) as count 
       FROM conversations c
       INNER JOIN connected_accounts ca ON c.account_id = ca.id
       ${whereClause}`,
      params
    );
    const total = parseInt(countResult?.count || '0');

    // Get paginated conversations
    const queryParams = platform 
      ? [userId, platform, limit, offset]
      : [userId, limit, offset];
    
    const limitOffset = platform ? '$3 OFFSET $4' : '$2 OFFSET $3';

    const conversations = await queryMany<Conversation>(
      `SELECT c.id, c.account_id, c.platform_conversation_id, 
              c.participant_name, c.participant_id, c.participant_avatar_url,
              c.last_message_at, c.unread_count, c.created_at, c.updated_at,
              ca.platform, ca.platform_username
       FROM conversations c
       INNER JOIN connected_accounts ca ON c.account_id = ca.id
       ${whereClause}
       ORDER BY c.last_message_at DESC NULLS LAST
       LIMIT ${limitOffset}`,
      queryParams
    );

    const hasMore = offset + conversations.length < total;

    return {
      conversations,
      total,
      hasMore
    };
  }

  /**
   * Mark messages as read and update unread count
   * @param conversationId - The conversation ID
   * @param messageIds - Optional array of specific message IDs to mark as read
   */
  async markMessagesAsRead(conversationId: string, messageIds?: string[]): Promise<void> {
    if (messageIds && messageIds.length > 0) {
      // Mark specific messages as read
      await query(
        `UPDATE messages 
         SET is_read = true 
         WHERE conversation_id = $1 AND id = ANY($2) AND is_read = false`,
        [conversationId, messageIds]
      );
    } else {
      // Mark all unread messages in conversation as read
      await query(
        `UPDATE messages 
         SET is_read = true 
         WHERE conversation_id = $1 AND is_read = false AND is_outgoing = false`,
        [conversationId]
      );
    }

    // Recalculate unread count
    await this.updateConversationUnreadCount(conversationId);

    // Emit WebSocket events for message status updates
    await this.emitMessageReadEvents(conversationId, messageIds);
  }

  /**
   * Emit WebSocket events when messages are marked as read
   * @param conversationId - The conversation ID
   * @param messageIds - Optional array of specific message IDs
   */
  private async emitMessageReadEvents(conversationId: string, messageIds?: string[]): Promise<void> {
    try {
      const { websocketService } = await import('./websocketService');

      // Get the conversation and account to find the user
      const conversation = await queryOne(
        `SELECT c.*, ca.user_id 
         FROM conversations c
         INNER JOIN connected_accounts ca ON c.account_id = ca.id
         WHERE c.id = $1`,
        [conversationId]
      );

      if (!conversation) {
        console.warn(`Conversation ${conversationId} not found for WebSocket emission`);
        return;
      }

      // Emit message status updates
      if (messageIds && messageIds.length > 0) {
        for (const messageId of messageIds) {
          websocketService.emitMessageStatusUpdate(
            conversation.user_id,
            messageId,
            'read',
            conversationId
          );
        }
      }

      // Get and emit updated unread counts
      const unreadCounts = await this.getUnreadCountByPlatform(conversation.user_id);
      const totalUnread = await this.getTotalUnreadCount(conversation.user_id);
      
      websocketService.emitUnreadCountUpdate(conversation.user_id, unreadCounts, totalUnread);

      // Emit conversation update
      const updatedConversation = await queryOne(
        'SELECT * FROM conversations WHERE id = $1',
        [conversationId]
      );
      
      if (updatedConversation) {
        websocketService.emitConversationUpdate(conversation.user_id, updatedConversation);
      }

    } catch (error) {
      console.error('Error emitting message read events:', error);
      // Don't throw - WebSocket emission failure shouldn't break message processing
    }
  }

  /**
   * Update the unread count for a conversation
   * @param conversationId - The conversation ID
   */
  async updateConversationUnreadCount(conversationId: string): Promise<void> {
    await query(
      `UPDATE conversations 
       SET unread_count = (
         SELECT COUNT(*) FROM messages 
         WHERE conversation_id = $1 AND is_read = false AND is_outgoing = false
       ),
       updated_at = NOW()
       WHERE id = $1`,
      [conversationId]
    );
  }

  /**
   * Get total unread count for a user across all platforms
   * @param userId - The user ID
   * @returns Total unread message count
   */
  async getTotalUnreadCount(userId: string): Promise<number> {
    const result = await queryOne<{ total: string }>(
      `SELECT COALESCE(SUM(c.unread_count), 0) as total
       FROM conversations c
       INNER JOIN connected_accounts ca ON c.account_id = ca.id
       WHERE ca.user_id = $1 AND ca.is_active = true`,
      [userId]
    );

    return parseInt(result?.total || '0');
  }

  /**
   * Get unread count by platform for a user
   * @param userId - The user ID
   * @returns Map of platform to unread count
   */
  async getUnreadCountByPlatform(userId: string): Promise<Map<Platform, number>> {
    const results = await queryMany<{ platform: Platform; total: string }>(
      `SELECT ca.platform, COALESCE(SUM(c.unread_count), 0) as total
       FROM connected_accounts ca
       LEFT JOIN conversations c ON c.account_id = ca.id
       WHERE ca.user_id = $1 AND ca.is_active = true
       GROUP BY ca.platform`,
      [userId]
    );

    const countMap = new Map<Platform, number>();
    for (const result of results) {
      countMap.set(result.platform, parseInt(result.total));
    }

    return countMap;
  }

  /**
   * Get active connected accounts for a user
   * @param userId - The user ID
   * @returns Array of active connected accounts
   */
  private async getActiveAccountsForUser(userId: string): Promise<ConnectedAccount[]> {
    return queryMany<ConnectedAccount>(
      `SELECT * FROM connected_accounts 
       WHERE user_id = $1 AND is_active = true`,
      [userId]
    );
  }

  /**
   * Emit WebSocket event for a new message
   * @param message - The stored message
   * @param accountId - The connected account ID
   * @param conversation - The conversation
   */
  private async emitNewMessageEvent(
    message: Message,
    accountId: string,
    conversation: Conversation
  ): Promise<void> {
    try {
      const { websocketService } = await import('./websocketService');

      // Get the user ID from the account
      const account = await queryOne(
        'SELECT user_id FROM connected_accounts WHERE id = $1',
        [accountId]
      );

      if (!account) {
        console.warn(`Account ${accountId} not found for WebSocket emission`);
        return;
      }

      // Emit new message event
      websocketService.emitNewMessage(account.user_id, message, conversation);

      // Get and emit updated unread counts
      const unreadCounts = await this.getUnreadCountByPlatform(account.user_id);
      const totalUnread = await this.getTotalUnreadCount(account.user_id);
      
      websocketService.emitUnreadCountUpdate(account.user_id, unreadCounts, totalUnread);

    } catch (error) {
      console.error('Error emitting WebSocket event:', error);
      // Don't throw - WebSocket emission failure shouldn't break message processing
    }
  }

  /**
   * Sync messages for all connected accounts of a user
   * This is typically called by a polling service
   * @param userId - The user ID
   * @param since - Optional date to fetch messages since
   * @returns Summary of sync results
   */
  async syncMessagesForUser(
    userId: string,
    since?: Date
  ): Promise<{
    totalMessages: number;
    accountResults: Array<{
      accountId: string;
      platform: Platform;
      messageCount: number;
      success: boolean;
      error?: string;
    }>;
  }> {
    const accounts = await this.getActiveAccountsForUser(userId);
    const accountResults: Array<{
      accountId: string;
      platform: Platform;
      messageCount: number;
      success: boolean;
      error?: string;
    }> = [];

    let totalMessages = 0;

    for (const account of accounts) {
      try {
        const messages = await this.fetchMessagesForAccount(account.id, since);
        accountResults.push({
          accountId: account.id,
          platform: account.platform as Platform,
          messageCount: messages.length,
          success: true
        });
        totalMessages += messages.length;
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        accountResults.push({
          accountId: account.id,
          platform: account.platform as Platform,
          messageCount: 0,
          success: false,
          error: errorMessage
        });
        console.error(`Failed to sync messages for account ${account.id}:`, error);
      }
    }

    return {
      totalMessages,
      accountResults
    };
  }
}

// Export singleton instance
export const messageAggregatorService = new MessageAggregatorService();

