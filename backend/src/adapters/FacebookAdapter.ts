import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById } from '../db/queryHelpers';

interface FacebookConversation {
  id: string;
  participants: {
    data: FacebookUser[];
  };
  updated_time: string;
  unread_count?: number;
}

interface FacebookMessage {
  id: string;
  created_time: string;
  from: FacebookUser;
  to: {
    data: FacebookUser[];
  };
  message: string;
  attachments?: {
    data: FacebookAttachment[];
  };
}

interface FacebookUser {
  id: string;
  name: string;
  email?: string;
}

interface FacebookAttachment {
  id: string;
  mime_type: string;
  name?: string;
  image_data?: {
    url: string;
    preview_url: string;
    width: number;
    height: number;
  };
  video_data?: {
    url: string;
    preview_url: string;
    width: number;
    height: number;
  };
  file_url?: string;
}

/**
 * Facebook Pages Messaging API adapter
 */
export class FacebookAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://graph.facebook.com/v18.0';

  constructor() {
    super('facebook');
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
   * Facebook page tokens are long-lived (60 days), refresh if needed
   */
  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    // Facebook page access tokens expire in 60 days
    // Refresh logic would exchange the token for a new long-lived token
    // For now, we'll assume the token is valid
    // In production, implement token refresh via Facebook Graph API
  }

  /**
   * Fetch messages from Facebook Page conversations
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      // Get Page ID
      const pageId = account!.platform_user_id;
      
      // Fetch conversations
      const conversationsUrl = `${this.baseUrl}/${pageId}/conversations`;
      const conversationsResponse = await this.apiClient.get(conversationsUrl, {
        params: {
          access_token: token,
          fields: 'id,participants,updated_time',
        },
      });

      const conversations: FacebookConversation[] = conversationsResponse.data.data || [];
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

        const fbMessages: FacebookMessage[] = messagesResponse.data.data || [];

        for (const msg of fbMessages) {
          const isOutgoing = msg.from.id === pageId;

          allMessages.push({
            id: '',
            conversationId: '',
            platformMessageId: msg.id,
            senderId: msg.from.id,
            senderName: msg.from.name,
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
   * Send a message to a Facebook Page conversation
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const pageId = account!.platform_user_id;
      
      // Get the recipient's PSID (Page-Scoped ID) from the conversation
      // First, fetch conversation details to get the recipient
      const conversationUrl = `${this.baseUrl}/${conversationId}`;
      const conversationResponse = await this.apiClient.get(conversationUrl, {
        params: {
          access_token: token,
          fields: 'participants',
        },
      });

      const participants = conversationResponse.data.participants.data;
      const recipient = participants.find((p: FacebookUser) => p.id !== pageId);

      if (!recipient) {
        throw new Error('Could not find recipient in conversation');
      }

      // Send message using Send API
      const url = `${this.baseUrl}/${pageId}/messages`;

      const response = await this.apiClient.post(
        url,
        {
          recipient: {
            id: recipient.id,
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

      const messageId = response.data.message_id;

      return {
        id: '',
        conversationId: '',
        platformMessageId: messageId,
        senderId: pageId,
        senderName: account!.platform_username || pageId,
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
    // Facebook Messenger API doesn't have a direct endpoint to mark messages as read
    // from the page side. Read receipts are typically sent automatically.
    // This is a no-op
  }

  /**
   * Get all conversations
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const pageId = account!.platform_user_id;
      const url = `${this.baseUrl}/${pageId}/conversations`;
      
      const response = await this.apiClient.get(url, {
        params: {
          access_token: token,
          fields: 'id,participants,updated_time,unread_count',
        },
      });

      const fbConversations: FacebookConversation[] = response.data.data || [];
      const conversations: Conversation[] = [];

      for (const conv of fbConversations) {
        // Find the other participant (not the page)
        const otherParticipant = conv.participants.data.find(
          (p) => p.id !== pageId
        );

        if (otherParticipant) {
          // Fetch participant profile picture
          let avatarUrl: string | undefined;
          try {
            const profileUrl = `${this.baseUrl}/${otherParticipant.id}/picture`;
            const profileResponse = await this.apiClient.get(profileUrl, {
              params: {
                access_token: token,
                redirect: false,
                type: 'normal',
              },
            });
            avatarUrl = profileResponse.data.data?.url;
          } catch (error) {
            // If profile picture fetch fails, continue without it
            console.error('Failed to fetch Facebook profile picture:', error);
          }

          conversations.push({
            id: '',
            accountId,
            platformConversationId: conv.id,
            participantName: otherParticipant.name,
            participantId: otherParticipant.id,
            participantAvatarUrl: avatarUrl,
            lastMessageAt: new Date(conv.updated_time),
            unreadCount: conv.unread_count || 0,
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
  private getAttachmentDescription(message: FacebookMessage): string {
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
  private getMessageType(message: FacebookMessage): 'text' | 'image' | 'video' | 'file' {
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
  private getMediaUrl(message: FacebookMessage): string | undefined {
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
    if (attachment.file_url) {
      return attachment.file_url;
    }

    return undefined;
  }

  /**
   * Process incoming webhook message
   * This is called by the webhook handler
   */
  processWebhookMessage(webhookData: any): Message | null {
    try {
      const entry = webhookData.entry?.[0];
      const messaging = entry?.messaging?.[0];

      if (!messaging?.message) {
        return null;
      }

      const message = messaging.message;
      const sender = messaging.sender;
      const recipient = messaging.recipient;

      let content = message.text || '';
      let messageType: 'text' | 'image' | 'video' | 'file' = 'text';
      let mediaUrl: string | undefined;

      if (message.attachments && message.attachments.length > 0) {
        const attachment = message.attachments[0];
        
        switch (attachment.type) {
          case 'image':
            messageType = 'image';
            mediaUrl = attachment.payload?.url;
            content = content || '[Photo]';
            break;
          case 'video':
            messageType = 'video';
            mediaUrl = attachment.payload?.url;
            content = content || '[Video]';
            break;
          case 'file':
            messageType = 'file';
            mediaUrl = attachment.payload?.url;
            content = content || '[File]';
            break;
        }
      }

      return {
        id: '',
        conversationId: '',
        platformMessageId: message.mid,
        senderId: sender.id,
        senderName: sender.id,
        content,
        messageType,
        mediaUrl,
        isOutgoing: false,
        isRead: false,
        sentAt: new Date(messaging.timestamp),
        createdAt: new Date(),
      };
    } catch (error) {
      console.error('Error processing Facebook webhook message:', error);
      return null;
    }
  }
}
