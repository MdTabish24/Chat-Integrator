import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById } from '../db/queryHelpers';

interface WhatsAppMessage {
  id: string;
  from: string;
  timestamp: string;
  type: string;
  text?: {
    body: string;
  };
  image?: {
    id: string;
    mime_type: string;
    sha256: string;
  };
  video?: {
    id: string;
    mime_type: string;
    sha256: string;
  };
  document?: {
    id: string;
    filename: string;
    mime_type: string;
    sha256: string;
  };
}

interface WhatsAppContact {
  profile: {
    name: string;
  };
  wa_id: string;
}

interface WhatsAppConversation {
  id: string;
  contact: WhatsAppContact;
  last_message_timestamp: string;
}

/**
 * WhatsApp Business Cloud API adapter
 */
export class WhatsAppAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    super('whatsapp');
    this.apiClient = axios.create({
      timeout: 30000,
    });
  }

  /**
   * Get access token for the account
   */
  protected async getAccessToken(accountId: string): Promise<string> {
    const account = await getConnectedAccountById(accountId);
    if (!account || !account.is_active) {
      throw new Error(`Account ${accountId} not found or inactive`);
    }
    return account.access_token;
  }

  /**
   * WhatsApp system user tokens don't expire
   */
  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    // WhatsApp system user tokens are permanent
    // No refresh needed
  }

  /**
   * Fetch messages from WhatsApp
   * Note: WhatsApp primarily uses webhooks for incoming messages
   * This method is for fetching historical messages if needed
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      // WhatsApp Business API doesn't have a direct endpoint to fetch all messages
      // Messages are primarily received via webhooks
      // This is a placeholder that would need to be implemented based on
      // stored webhook data or specific conversation queries
      
      // For now, return empty array as messages are handled via webhooks
      console.log('WhatsApp messages are primarily received via webhooks');
      return [];
    }, accountId);
  }

  /**
   * Send a message via WhatsApp Business API
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      // Get phone number ID from account
      const phoneNumberId = account!.platform_user_id;
      const url = `${this.baseUrl}/${phoneNumberId}/messages`;

      // Check if we're within the 24-hour messaging window
      // If not, we need to use a message template
      // For simplicity, we'll send a text message assuming we're within the window
      
      const response = await this.apiClient.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversationId, // conversationId is the recipient's phone number
          type: 'text',
          text: {
            preview_url: false,
            body: content,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const messageId = response.data.messages[0].id;

      return {
        id: '',
        conversationId: '',
        platformMessageId: messageId,
        senderId: phoneNumberId,
        senderName: account!.platform_username || phoneNumberId,
        content,
        messageType: 'text',
        isOutgoing: true,
        isRead: false,
        sentAt: new Date(),
        deliveredAt: new Date(),
        createdAt: new Date(),
      };
    }, accountId);
  }

  /**
   * Send a template message (required for messages outside 24-hour window)
   */
  async sendTemplateMessage(
    accountId: string,
    conversationId: string,
    templateName: string,
    templateParams: string[]
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const phoneNumberId = account!.platform_user_id;
      const url = `${this.baseUrl}/${phoneNumberId}/messages`;

      const response = await this.apiClient.post(
        url,
        {
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: conversationId,
          type: 'template',
          template: {
            name: templateName,
            language: {
              code: 'en',
            },
            components: [
              {
                type: 'body',
                parameters: templateParams.map((param) => ({
                  type: 'text',
                  text: param,
                })),
              },
            ],
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const messageId = response.data.messages[0].id;

      return {
        id: '',
        conversationId: '',
        platformMessageId: messageId,
        senderId: phoneNumberId,
        senderName: account!.platform_username || phoneNumberId,
        content: `[Template: ${templateName}]`,
        messageType: 'text',
        isOutgoing: true,
        isRead: false,
        sentAt: new Date(),
        deliveredAt: new Date(),
        createdAt: new Date(),
      };
    }, accountId);
  }

  /**
   * Mark message as read
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const phoneNumberId = account!.platform_user_id;
      const url = `${this.baseUrl}/${phoneNumberId}/messages`;

      await this.apiClient.post(
        url,
        {
          messaging_product: 'whatsapp',
          status: 'read',
          message_id: messageId,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );
    }, accountId);
  }

  /**
   * Get conversations
   * Note: WhatsApp doesn't have a direct API to list conversations
   * Conversations are tracked based on incoming webhook messages
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      // WhatsApp Business API doesn't provide an endpoint to list conversations
      // Conversations must be tracked based on webhook messages received
      // This would typically query the local database for conversations
      // associated with this account
      
      console.log('WhatsApp conversations are tracked via webhook messages');
      return [];
    }, accountId);
  }

  /**
   * Process incoming webhook message
   * This is called by the webhook handler
   */
  processWebhookMessage(webhookData: any): Message | null {
    try {
      const entry = webhookData.entry?.[0];
      const changes = entry?.changes?.[0];
      const value = changes?.value;

      if (!value?.messages || value.messages.length === 0) {
        return null;
      }

      const whatsappMsg: WhatsAppMessage = value.messages[0];
      const contact: WhatsAppContact = value.contacts?.[0];

      let content = '';
      let messageType: 'text' | 'image' | 'video' | 'file' = 'text';
      let mediaUrl: string | undefined;

      switch (whatsappMsg.type) {
        case 'text':
          content = whatsappMsg.text?.body || '';
          break;
        case 'image':
          messageType = 'image';
          mediaUrl = whatsappMsg.image?.id;
          content = '[Photo]';
          break;
        case 'video':
          messageType = 'video';
          mediaUrl = whatsappMsg.video?.id;
          content = '[Video]';
          break;
        case 'document':
          messageType = 'file';
          mediaUrl = whatsappMsg.document?.id;
          content = `[File: ${whatsappMsg.document?.filename || 'document'}]`;
          break;
        default:
          content = `[${whatsappMsg.type}]`;
      }

      return {
        id: '',
        conversationId: '',
        platformMessageId: whatsappMsg.id,
        senderId: whatsappMsg.from,
        senderName: contact?.profile?.name || whatsappMsg.from,
        content,
        messageType,
        mediaUrl,
        isOutgoing: false,
        isRead: false,
        sentAt: new Date(parseInt(whatsappMsg.timestamp) * 1000),
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Error processing WhatsApp webhook message:', error);
      return null;
    }
  }

  /**
   * Download media file
   */
  async downloadMedia(accountId: string, mediaId: string): Promise<Buffer> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      
      // First, get the media URL
      const mediaInfoUrl = `${this.baseUrl}/${mediaId}`;
      const mediaInfoResponse = await this.apiClient.get(mediaInfoUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const mediaUrl = mediaInfoResponse.data.url;

      // Download the media
      const mediaResponse = await this.apiClient.get(mediaUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        responseType: 'arraybuffer',
      });

      return Buffer.from(mediaResponse.data);
    }, accountId);
  }
}
