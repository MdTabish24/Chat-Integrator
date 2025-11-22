import crypto from 'crypto';
import { Platform } from '../types';
import { messageAggregatorService } from './messageAggregatorService';

/**
 * Base webhook service for handling incoming webhook notifications
 */
export class WebhookService {
  /**
   * Verify webhook signature for Telegram
   * @param payload - The webhook payload (not used for Telegram, kept for interface consistency)
   * @param signature - The signature from headers
   * @param secret - The bot token or secret
   * @returns True if signature is valid
   */
  verifyTelegramSignature(_payload: string, signature: string, secret: string): boolean {
    // Telegram uses a secret token sent in X-Telegram-Bot-Api-Secret-Token header
    return signature === secret;
  }

  /**
   * Verify webhook signature for Twitter/X
   * @param payload - The webhook payload
   * @param signature - The signature from headers
   * @param secret - The consumer secret
   * @returns True if signature is valid
   */
  verifyTwitterSignature(payload: string, signature: string, secret: string): boolean {
    // Twitter uses HMAC-SHA256
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = 'sha256=' + hmac.digest('base64');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Verify webhook signature for LinkedIn
   * @param payload - The webhook payload
   * @param signature - The signature from headers
   * @param secret - The client secret
   * @returns True if signature is valid
   */
  verifyLinkedInSignature(payload: string, signature: string, secret: string): boolean {
    // LinkedIn uses HMAC-SHA256
    const hmac = crypto.createHmac('sha256', secret);
    hmac.update(payload);
    const expectedSignature = hmac.digest('hex');
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Verify webhook signature for Instagram/WhatsApp/Facebook (all use Facebook Graph API)
   * @param payload - The webhook payload
   * @param signature - The signature from headers
   * @param appSecret - The Facebook app secret
   * @returns True if signature is valid
   */
  verifyFacebookSignature(payload: string, signature: string, appSecret: string): boolean {
    // Facebook uses sha256=<signature> format
    const expectedSignature = 'sha256=' + crypto
      .createHmac('sha256', appSecret)
      .update(payload)
      .digest('hex');
    
    return crypto.timingSafeEqual(
      Buffer.from(signature),
      Buffer.from(expectedSignature)
    );
  }

  /**
   * Verify webhook signature for Microsoft Teams
   * @param token - The JWT token from Authorization header
   * @param expectedAudience - The expected audience (app ID)
   * @returns True if token is valid
   */
  verifyTeamsSignature(token: string, expectedAudience: string): boolean {
    // Microsoft Teams uses JWT tokens
    // In production, you would verify the JWT signature using Microsoft's public keys
    // For now, we'll do basic validation
    try {
      const parts = token.split('.');
      if (parts.length !== 3) return false;
      
      const payload = JSON.parse(Buffer.from(parts[1], 'base64').toString());
      return payload.aud === expectedAudience;
    } catch (error) {
      return false;
    }
  }

  /**
   * Process incoming webhook message
   * Common pipeline for all platforms
   * @param accountId - The connected account ID
   * @param messageData - The parsed message data
   * @param platform - The platform name (for retry queue)
   * @param originalPayload - The original webhook payload (for retry queue)
   * @returns The stored message
   */
  async processIncomingMessage(
    accountId: string,
    messageData: any,
    platform?: Platform,
    originalPayload?: any
  ) {
    try {
      // Store the message using message aggregator
      const storedMessage = await messageAggregatorService.storeMessage(
        messageData,
        accountId
      );

      console.log(`Webhook message processed: ${storedMessage.id} from account ${accountId}`);
      
      // Emit WebSocket event for real-time updates
      await this.emitMessageEvent(storedMessage, accountId);

      return storedMessage;
    } catch (error) {
      console.error('Error processing webhook message:', error);

      // If platform and payload are provided, add to retry queue
      if (platform && originalPayload) {
        try {
          const { webhookRetryService } = await import('./webhookRetryService');
          await webhookRetryService.addToRetryQueue(
            platform,
            accountId,
            messageData,
            originalPayload
          );
          console.log(`Added failed webhook to retry queue for ${platform}`);
        } catch (retryError) {
          console.error('Failed to add webhook to retry queue:', retryError);
        }
      }

      throw error;
    }
  }

  /**
   * Emit WebSocket event for a new message
   * @param message - The stored message
   * @param accountId - The connected account ID
   */
  private async emitMessageEvent(message: any, accountId: string): Promise<void> {
    try {
      const { websocketService } = await import('./websocketService');
      const { queryOne } = await import('../db/queryHelpers');

      // Get the user ID from the account
      const account = await queryOne(
        'SELECT user_id FROM connected_accounts WHERE id = $1',
        [accountId]
      );

      if (!account) {
        console.warn(`Account ${accountId} not found for WebSocket emission`);
        return;
      }

      // Get the conversation details
      const conversation = await queryOne(
        'SELECT * FROM conversations WHERE id = $1',
        [message.conversationId]
      );

      // Emit new message event
      websocketService.emitNewMessage(account.user_id, message, conversation);

      // Get and emit updated unread counts
      const unreadCounts = await messageAggregatorService.getUnreadCountByPlatform(account.user_id);
      const totalUnread = await messageAggregatorService.getTotalUnreadCount(account.user_id);
      
      websocketService.emitUnreadCountUpdate(account.user_id, unreadCounts, totalUnread);

    } catch (error) {
      console.error('Error emitting WebSocket event:', error);
      // Don't throw - WebSocket emission failure shouldn't break message processing
    }
  }

  /**
   * Log webhook failure for monitoring
   * @param platform - The platform name
   * @param error - The error that occurred
   * @param payload - The webhook payload (for debugging)
   */
  logWebhookFailure(platform: Platform, error: Error, payload?: any): void {
    console.error(`Webhook failure for ${platform}:`, {
      error: error.message,
      stack: error.stack,
      payload: payload ? JSON.stringify(payload).substring(0, 500) : 'N/A',
      timestamp: new Date().toISOString()
    });

    // TODO: Send to monitoring service (e.g., Sentry)
  }

  /**
   * Validate webhook payload structure
   * @param payload - The webhook payload
   * @param requiredFields - Array of required field names
   * @returns True if all required fields are present
   */
  validatePayload(payload: any, requiredFields: string[]): boolean {
    if (!payload || typeof payload !== 'object') {
      return false;
    }

    return requiredFields.every(field => {
      const keys = field.split('.');
      let value = payload;
      
      for (const key of keys) {
        if (value && typeof value === 'object' && key in value) {
          value = value[key];
        } else {
          return false;
        }
      }
      
      return value !== undefined && value !== null;
    });
  }
}

// Export singleton instance
export const webhookService = new WebhookService();
