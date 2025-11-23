import { Request, Response } from 'express';
import { messageAggregatorService } from '../services/messageAggregatorService';
import { RateLimitError, PlatformAPIError } from '../adapters/PlatformAdapter';

/**
 * Controller for message-related operations
 */
class MessageController {
  /**
   * Get all messages for the authenticated user
   * @route GET /api/messages
   */
  async getMessages(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const since = req.query.since ? new Date(req.query.since as string) : undefined;
      const messages = await messageAggregatorService.fetchMessagesForUser(userId, since);

      res.json({
        messages,
        count: messages.length
      });
    } catch (error) {
      console.error('Error fetching messages:', error);
      res.status(500).json({ 
        error: 'Failed to fetch messages',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get messages for a specific conversation
   * @route GET /api/messages/:conversationId
   */
  async getConversationMessages(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { conversationId } = req.params;
      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;

      // Verify user has access to this conversation
      const hasAccess = await this.verifyConversationAccess(userId, conversationId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied to this conversation' });
        return;
      }

      const result = await messageAggregatorService.getMessagesByConversation(
        conversationId,
        limit,
        offset
      );

      res.json(result);
    } catch (error) {
      console.error('Error fetching conversation messages:', error);
      res.status(500).json({ 
        error: 'Failed to fetch conversation messages',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Send a message in a conversation
   * @route POST /api/messages/:conversationId/send
   */
  async sendMessage(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { conversationId } = req.params;
      const { content } = req.body;

      if (!content || typeof content !== 'string' || content.trim().length === 0) {
        res.status(400).json({ error: 'Message content is required' });
        return;
      }

      // Verify user has access to this conversation
      const hasAccess = await this.verifyConversationAccess(userId, conversationId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied to this conversation' });
        return;
      }

      // Get conversation details to determine platform and account
      const conversation = await this.getConversationDetails(conversationId);
      if (!conversation) {
        res.status(404).json({ error: 'Conversation not found' });
        return;
      }

      // Send message through platform adapter
      const { AdapterFactory } = await import('../adapters/AdapterFactory');
      const adapter = AdapterFactory.getAdapter(conversation.platform);
      
      const sentMessage = await adapter.sendMessage(
        conversation.accountId,
        conversation.platformConversationId,
        content
      );

      // Store the sent message
      const storedMessage = await messageAggregatorService.storeMessage(
        sentMessage,
        conversation.accountId
      );

      res.status(201).json({
        message: storedMessage,
        success: true
      });
    } catch (error) {
      console.error('Error sending message:', error);
      
      if (error instanceof RateLimitError) {
        res.status(429).json({
          error: 'Rate limit exceeded',
          retryAfter: error.retryAfter,
          message: error.message
        });
        return;
      }

      if (error instanceof PlatformAPIError) {
        res.status(error.statusCode || 500).json({
          error: 'Platform API error',
          message: error.message,
          retryable: error.retryable
        });
        return;
      }

      res.status(500).json({ 
        error: 'Failed to send message',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Mark messages as read
   * @route PATCH /api/messages/:messageId/read
   */
  async markAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { messageId } = req.params;

      // Get message to find conversation
      const message = await this.getMessageDetails(messageId);
      if (!message) {
        res.status(404).json({ error: 'Message not found' });
        return;
      }

      // Verify user has access to this conversation
      const hasAccess = await this.verifyConversationAccess(userId, message.conversationId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Mark message as read
      await messageAggregatorService.markMessagesAsRead(message.conversationId, [messageId]);

      res.json({
        success: true,
        message: 'Message marked as read'
      });
    } catch (error) {
      console.error('Error marking message as read:', error);
      res.status(500).json({ 
        error: 'Failed to mark message as read',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Mark all messages in a conversation as read
   * @route PATCH /api/messages/conversation/:conversationId/read
   */
  async markConversationAsRead(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const { conversationId } = req.params;

      // Verify user has access to this conversation
      const hasAccess = await this.verifyConversationAccess(userId, conversationId);
      if (!hasAccess) {
        res.status(403).json({ error: 'Access denied' });
        return;
      }

      // Mark all messages as read
      await messageAggregatorService.markMessagesAsRead(conversationId);

      res.json({
        success: true,
        message: 'All messages marked as read'
      });
    } catch (error) {
      console.error('Error marking conversation as read:', error);
      res.status(500).json({ 
        error: 'Failed to mark conversation as read',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get all conversations for the authenticated user
   * @route GET /api/conversations
   */
  async getConversations(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const limit = parseInt(req.query.limit as string) || 50;
      const offset = parseInt(req.query.offset as string) || 0;
      const platform = req.query.platform as string | undefined;

      const result = await messageAggregatorService.getConversationsForUser(
        userId,
        limit,
        offset,
        platform as any
      );

      res.json(result);
    } catch (error) {
      console.error('Error fetching conversations:', error);
      res.status(500).json({ 
        error: 'Failed to fetch conversations',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Get unread count for the authenticated user
   * @route GET /api/messages/unread/count
   */
  async getUnreadCount(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const totalUnread = await messageAggregatorService.getTotalUnreadCount(userId);
      const unreadByPlatform = await messageAggregatorService.getUnreadCountByPlatform(userId);

      res.json({
        total: totalUnread,
        byPlatform: Object.fromEntries(unreadByPlatform)
      });
    } catch (error) {
      console.error('Error fetching unread count:', error);
      res.status(500).json({ 
        error: 'Failed to fetch unread count',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Sync messages for all connected accounts
   * @route POST /api/messages/sync
   */
  async syncMessages(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user?.userId;
      if (!userId) {
        res.status(401).json({ error: 'Unauthorized' });
        return;
      }

      const since = req.body.since ? new Date(req.body.since) : undefined;
      const result = await messageAggregatorService.syncMessagesForUser(userId, since);

      res.json({
        success: true,
        ...result
      });
    } catch (error) {
      console.error('Error syncing messages:', error);
      res.status(500).json({ 
        error: 'Failed to sync messages',
        message: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  }

  /**
   * Helper: Verify user has access to a conversation
   */
  private async verifyConversationAccess(userId: string, conversationId: string): Promise<boolean> {
    const { queryOne } = await import('../db/queryHelpers');
    const result = await queryOne(
      `SELECT c.id 
       FROM conversations c
       INNER JOIN connected_accounts ca ON c.account_id = ca.id
       WHERE c.id = $1 AND ca.user_id = $2`,
      [conversationId, userId]
    );
    return result !== null;
  }

  /**
   * Helper: Get conversation details
   */
  private async getConversationDetails(conversationId: string): Promise<any> {
    const { queryOne } = await import('../db/queryHelpers');
    const result = await queryOne(
      `SELECT c.*, ca.platform, ca.id as account_id
       FROM conversations c
       INNER JOIN connected_accounts ca ON c.account_id = ca.id
       WHERE c.id = $1`,
      [conversationId]
    );
    
    if (result) {
      return {
        ...result,
        accountId: result.account_id,
        platformConversationId: result.platform_conversation_id,
        participantName: result.participant_name,
        participantId: result.participant_id,
        lastMessageAt: result.last_message_at,
        unreadCount: result.unread_count,
      };
    }
    return null;
  }

  /**
   * Helper: Get message details
   */
  private async getMessageDetails(messageId: string): Promise<any> {
    const { queryOne } = await import('../db/queryHelpers');
    return queryOne(
      `SELECT * FROM messages WHERE id = $1`,
      [messageId]
    );
  }
}

export default new MessageController();

