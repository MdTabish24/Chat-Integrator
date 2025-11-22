import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById } from '../db/queryHelpers';

interface InstagramConversation {
  id: string;
  participants: {
    data: InstagramUser[];
  };
  updated_time: string;
}

interface InstagramMessage {
  id: string;
  created_time: string;
  from: InstagramUser;
  to: {
    data: InstagramUser[];
  };
  message: string;
  attachments?: {
    data: InstagramAttachment[];
  };
}

interface InstagramUser {
  id: string;
  username?: string;
  name?: string;
}

interface InstagramAttachment {
  id: string;
  mime_type: string;
  name?: string;
  image_data?: {
    url: string;
    preview_url: string;
  };
  video_data?: {
    url: string;
    preview_url: string;
  };
}

/**
 * Instagram Business API adapter using Facebook Graph API
 */
export class InstagramAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    super('instagram');
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
   * Instagram tokens are long-lived (60 days), refresh if needed
   */
  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    // Instagram long-lived tokens expire in 60 days
    // Refresh logic would exchange the token for a new long-lived token
    // For now, we'll assume the token is valid
    // In production, implement token refresh via Facebook Graph API
  }

  /**
   * Fetch messages from Instagram conversations
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      // Get Instagram Business Account ID
      const igAccountId = account!.platform_user_id;
      
      // Fetch conversations
      const conversationsUrl = `${this.baseUrl}/${igAccountId}/conversations`;
      const conversationsResponse = await this.apiClient.get(conversationsUrl, {
        params: {
          access_token: token,
          fields: 'id,participants,updated_time',
        },
      });

      const conversations: InstagramConversation[] = conversationsResponse.data.data || [];
      const allMessages: Message[] = [];

      // Fetch messages for each conversation
      for (const conversation of conversations) {
        const messagesUrl = `${this.baseUrl}/${conversation.id}/messages`;
        
        const params: any = {
          access_token: token,
          fields: 'id,created_time,from,to,message,attachments',
        };

        if (since) {
          params.since = Math.floor(since.getTime() / 1000);
        }

        const messagesResponse = await this.apiClient.get(messagesUrl, {
          params,
        });

        const igMessages: InstagramMessage[] = messagesResponse.data.data || [];

        for (const msg of igMessages) {
          const isOutgoing = msg.from.id === igAccountId;

          allMessages.push({
            id: '',
            conversationId: '',
            platformMessageId: msg.id,
            senderId: msg.from.id,
            senderName: msg.from.username || msg.from.name || msg.from.id,
            content: msg.message || this.getAttachmentDescription(msg),
            messageType: this.getMessageType(msg),
            mediaUrl: this.getMediaUrl(msg),
            isOutgoing,
            isRead: false,
            sentAt: new Date(msg.created_time),
            createdAt: new Date(),
          });
        }
      }

      return allMessages;
    }, accountId);
  }

  /**
   * Send a message to an Instagram conversation
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const igAccountId = account!.platform_user_id;
      const url = `${this.baseUrl}/${igAccountId}/messages`;

      const response = await this.apiClient.post(
        url,
        {
          recipient: {
            id: conversationId,
          },
          message: {
            text: content,
          },
        },
        {
          params: {
            access_token: token,
          },
        }
      );

      const messageId = response.data.message_id || response.data.id;

      return {
        id: '',
        conversationId: '',
        platformMessageId: messageId,
        senderId: igAccountId,
        senderName: account!.platform_username || igAccountId,
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
   * Mark message as read
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    // Instagram Graph API doesn't have a direct endpoint to mark messages as read
    // This is a no-op
  }

  /**
   * Get all conversations
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const igAccountId = account!.platform_user_id;
      const url = `${this.baseUrl}/${igAccountId}/conversations`;
      
      const response = await this.apiClient.get(url, {
        params: {
          access_token: token,
          fields: 'id,participants,updated_time',
        },
      });

      const igConversations: InstagramConversation[] = response.data.data || [];
      const conversations: Conversation[] = [];

      for (const conv of igConversations) {
        // Find the other participant (not the business account)
        const otherParticipant = conv.participants.data.find(
          (p) => p.id !== igAccountId
        );

        if (otherParticipant) {
          conversations.push({
            id: '',
            accountId,
            platformConversationId: conv.id,
            participantName: otherParticipant.username || otherParticipant.name || otherParticipant.id,
            participantId: otherParticipant.id,
            participantAvatarUrl: undefined,
            lastMessageAt: new Date(conv.updated_time),
            unreadCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        }
      }

      return conversations;
    }, accountId);
  }

  /**
   * Get attachment description for messages without text
   */
  private getAttachmentDescription(message: InstagramMessage): string {
    if (!message.attachments?.data || message.attachments.data.length === 0) {
      return '[Message]';
    }

    const attachment = message.attachments.data[0];
    if (attachment.mime_type.includes('image')) {
      return '[Photo]';
    }
    if (attachment.mime_type.includes('video')) {
      return '[Video]';
    }
    return `[File: ${attachment.name || 'attachment'}]`;
  }

  /**
   * Determine message type
   */
  private getMessageType(message: InstagramMessage): 'text' | 'image' | 'video' | 'file' {
    if (!message.attachments?.data || message.attachments.data.length === 0) {
      return 'text';
    }

    const attachment = message.attachments.data[0];
    if (attachment.mime_type.includes('image')) {
      return 'image';
    }
    if (attachment.mime_type.includes('video')) {
      return 'video';
    }

    return 'file';
  }

  /**
   * Get media URL from message
   */
  private getMediaUrl(message: InstagramMessage): string | undefined {
    if (!message.attachments?.data || message.attachments.data.length === 0) {
      return undefined;
    }

    const attachment = message.attachments.data[0];
    if (attachment.image_data) {
      return attachment.image_data.url;
    }
    if (attachment.video_data) {
      return attachment.video_data.url;
    }

    return undefined;
  }
}
