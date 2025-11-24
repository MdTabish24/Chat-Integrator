import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById, updateAccountTokens } from '../db/queryHelpers';

interface TeamsChat {
  id: string;
  topic?: string;
  createdDateTime: string;
  lastUpdatedDateTime: string;
  chatType: string;
}

interface TeamsChatMessage {
  id: string;
  messageType: string;
  createdDateTime: string;
  lastModifiedDateTime: string;
  from: {
    user?: {
      id: string;
      displayName: string;
    };
  };
  body: {
    contentType: string;
    content: string;
  };
  attachments?: TeamsAttachment[];
}

interface TeamsAttachment {
  id: string;
  contentType: string;
  contentUrl?: string;
  name?: string;
}

interface TeamsUser {
  id: string;
  displayName: string;
  userPrincipalName: string;
}

interface TeamsTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Microsoft Teams adapter using Microsoft Graph API
 */
export class TeamsAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://graph.microsoft.com/v1.0';
  private readonly tokenUrl = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token';

  constructor() {
    super('teams');
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
    
    // Check if token needs refresh (Teams tokens expire in 1 hour)
    await this.refreshTokenIfNeeded(accountId);
    
    // Fetch again after potential refresh
    const refreshedAccount = await getConnectedAccountById(accountId);
    return refreshedAccount!.access_token;
  }

  /**
   * Refresh token if it's expired or about to expire
   */
  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    const account = await getConnectedAccountById(accountId);
    if (!account) {
      throw new Error(`Account ${accountId} not found`);
    }

    // Check if token expires within the next 5 minutes
    const expiresAt = account.token_expires_at;
    if (!expiresAt) {
      return; // No expiry set, assume valid
    }

    const now = new Date();
    const expiryTime = new Date(expiresAt);
    const fiveMinutesFromNow = new Date(now.getTime() + 5 * 60 * 1000);

    if (expiryTime > fiveMinutesFromNow) {
      return; // Token is still valid
    }

    // Refresh the token
    if (!account.refresh_token) {
      throw new Error(`No refresh token available for account ${accountId}`);
    }

    try {
      const clientId = process.env.MICROSOFT_CLIENT_ID;
      const clientSecret = process.env.MICROSOFT_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Microsoft Teams OAuth credentials not configured');
      }

      const response = await axios.post<TeamsTokenResponse>(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: account.refresh_token,
          client_id: clientId,
          client_secret: clientSecret,
          scope: 'Chat.Read Chat.ReadWrite ChatMessage.Send offline_access',
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const newExpiresAt = new Date(Date.now() + expires_in * 1000);

      await updateAccountTokens(accountId, access_token, refresh_token, newExpiresAt);
    } catch (error: any) {
      console.error('Failed to refresh Teams token:', error.response?.data || error.message);
      throw new Error('Failed to refresh Microsoft Teams access token');
    }
  }

  /**
   * Fetch messages from Teams chats
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      // Get all chats for the user
      const chatsUrl = `${this.baseUrl}/me/chats`;
      const chatsResponse = await this.apiClient.get(chatsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });

      const chats: TeamsChat[] = chatsResponse.data.value || [];
      const allMessages: Message[] = [];

      // Fetch messages for each chat
      for (const chat of chats) {
        const messagesUrl = `${this.baseUrl}/chats/${chat.id}/messages`;
        
        const params: any = {
          $top: 50,
          $orderby: 'createdDateTime desc',
        };

        if (since) {
          params.$filter = `createdDateTime gt ${since.toISOString()}`;
        }

        const messagesResponse = await this.apiClient.get(messagesUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
          params,
        });

        const teamsMessages: TeamsChatMessage[] = messagesResponse.data.value || [];

        for (const msg of teamsMessages) {
          if (msg.messageType === 'message') {
            const senderId = msg.from.user?.id || 'unknown';
            const isOutgoing = senderId === account!.platform_user_id;

            allMessages.push({
              id: '',
              conversationId: chat.id, // Use Teams chat ID
              platformMessageId: msg.id,
              senderId,
              senderName: msg.from.user?.displayName || senderId,
              content: this.extractTextContent(msg.body.content),
              messageType: this.getMessageType(msg),
              mediaUrl: this.getMediaUrl(msg),
              isOutgoing,
              isRead: false,
              sentAt: new Date(msg.createdDateTime),
              createdAt: new Date(),
            });
          }
        }
      }

      return allMessages;
    }, accountId);
  }

  /**
   * Send a message to a Teams chat
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const url = `${this.baseUrl}/chats/${conversationId}/messages`;

      const response = await this.apiClient.post(
        url,
        {
          body: {
            contentType: 'text',
            content: content,
          },
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const message = response.data;

      return {
        id: '',
        conversationId: '',
        platformMessageId: message.id,
        senderId: account!.platform_user_id,
        senderName: account!.platform_username || account!.platform_user_id,
        content,
        messageType: 'text',
        isOutgoing: true,
        isRead: false,
        sentAt: new Date(message.createdDateTime),
        deliveredAt: new Date(),
        createdAt: new Date(),
      };
    }, accountId);
  }

  /**
   * Mark message as read (not directly supported by Microsoft Graph API)
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    // Microsoft Graph API doesn't have a direct endpoint to mark chat messages as read
    // Read status is typically managed automatically by the Teams client
    // This is a no-op
  }

  /**
   * Get all conversations (chats)
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const url = `${this.baseUrl}/me/chats`;
      
      const response = await this.apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          $expand: 'members',
        },
      });

      const teamsChats: TeamsChat[] = response.data.value || [];
      const conversations: Conversation[] = [];

      for (const chat of teamsChats) {
        // For one-on-one chats, find the other participant
        let participantName = chat.topic || 'Chat';
        let participantId = chat.id;

        if (chat.chatType === 'oneOnOne') {
          // Get chat members to find the other participant
          try {
            const membersUrl = `${this.baseUrl}/chats/${chat.id}/members`;
            const membersResponse = await this.apiClient.get(membersUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            const members = membersResponse.data.value || [];
            const otherMember = members.find(
              (m: any) => m.userId !== account!.platform_user_id
            );

            if (otherMember) {
              participantId = otherMember.userId;
              participantName = otherMember.displayName || participantId;
            }
          } catch (error) {
            console.error('Failed to fetch Teams chat members:', error);
          }
        }

        conversations.push({
          id: '',
          accountId,
          platformConversationId: chat.id,
          participantName,
          participantId,
          participantAvatarUrl: undefined,
          lastMessageAt: new Date(chat.lastUpdatedDateTime),
          unreadCount: 0,
          createdAt: new Date(),
          updatedAt: new Date(),
        });
      }

      return conversations;
    }, accountId);
  }

  /**
   * Extract plain text from HTML content
   */
  private extractTextContent(htmlContent: string): string {
    // Simple HTML tag removal
    // In production, use a proper HTML parser
    return htmlContent
      .replace(/<[^>]*>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .trim();
  }

  /**
   * Determine message type
   */
  private getMessageType(message: TeamsChatMessage): 'text' | 'image' | 'video' | 'file' {
    if (!message.attachments || message.attachments.length === 0) {
      return 'text';
    }

    const attachment = message.attachments[0];
    if (attachment.contentType.includes('image')) {
      return 'image';
    }
    if (attachment.contentType.includes('video')) {
      return 'video';
    }

    return 'file';
  }

  /**
   * Get media URL from message
   */
  private getMediaUrl(message: TeamsChatMessage): string | undefined {
    if (!message.attachments || message.attachments.length === 0) {
      return undefined;
    }

    return message.attachments[0].contentUrl;
  }

  /**
   * Create a chat subscription for real-time updates
   */
  async createChatSubscription(accountId: string, webhookUrl: string): Promise<string> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      
      const url = `${this.baseUrl}/subscriptions`;

      const response = await this.apiClient.post(
        url,
        {
          changeType: 'created',
          notificationUrl: webhookUrl,
          resource: '/me/chats/getAllMessages',
          expirationDateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour
          clientState: accountId, // Used to verify webhook authenticity
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      return response.data.id;
    }, accountId);
  }

  /**
   * Renew a chat subscription
   */
  async renewChatSubscription(accountId: string, subscriptionId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      
      const url = `${this.baseUrl}/subscriptions/${subscriptionId}`;

      await this.apiClient.patch(
        url,
        {
          expirationDateTime: new Date(Date.now() + 3600000).toISOString(), // 1 hour
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
   * Delete a chat subscription
   */
  async deleteChatSubscription(accountId: string, subscriptionId: string): Promise<void> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      
      const url = `${this.baseUrl}/subscriptions/${subscriptionId}`;

      await this.apiClient.delete(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      });
    }, accountId);
  }
}
