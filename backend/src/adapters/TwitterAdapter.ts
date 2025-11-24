import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById, updateAccountTokens } from '../db/queryHelpers';

interface TwitterDMEvent {
  id: string;
  text: string;
  event_type: string;
  created_at: string;
  sender_id: string;
  participant_ids: string[];
  conversation_id: string;
  attachments?: TwitterAttachment[];
}

interface TwitterAttachment {
  type: string;
  media_key?: string;
  url?: string;
}

interface TwitterConversation {
  id: string;
  participant_ids: string[];
}

interface TwitterUser {
  id: string;
  name: string;
  username: string;
  profile_image_url?: string;
}

interface TwitterTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
}

/**
 * Twitter/X API v2 adapter for Direct Messages
 */
export class TwitterAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://api.twitter.com/2';
  private readonly tokenUrl = 'https://api.twitter.com/2/oauth2/token';

  constructor() {
    super('twitter');
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
    
    // Check if token needs refresh (Twitter tokens expire in 2 hours)
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
      const clientId = process.env.TWITTER_CLIENT_ID;
      const clientSecret = process.env.TWITTER_CLIENT_SECRET;

      if (!clientId || !clientSecret) {
        throw new Error('Twitter OAuth credentials not configured');
      }

      const response = await axios.post<TwitterTokenResponse>(
        this.tokenUrl,
        new URLSearchParams({
          grant_type: 'refresh_token',
          refresh_token: account.refresh_token,
          client_id: clientId,
        }),
        {
          headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          auth: {
            username: clientId,
            password: clientSecret,
          },
        }
      );

      const { access_token, refresh_token, expires_in } = response.data;
      const newExpiresAt = new Date(Date.now() + expires_in * 1000);

      await updateAccountTokens(accountId, access_token, refresh_token, newExpiresAt);
    } catch (error: any) {
      console.error('Failed to refresh Twitter token:', error.response?.data || error.message);
      throw new Error('Failed to refresh Twitter access token');
    }
  }

  /**
   * Fetch direct messages
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const url = `${this.baseUrl}/dm_events`;
      const params: any = {
        'dm_event.fields': 'id,text,event_type,created_at,sender_id,participant_ids,attachments',
        'user.fields': 'id,name,username,profile_image_url',
        expansions: 'sender_id,participant_ids',
        max_results: 100,
      };

      if (since) {
        params.start_time = since.toISOString();
      }

      const response = await this.apiClient.get(url, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params,
      });

      const events: TwitterDMEvent[] = response.data.data || [];
      const users: Record<string, TwitterUser> = {};

      // Build user lookup map
      if (response.data.includes?.users) {
        for (const user of response.data.includes.users) {
          users[user.id] = user;
        }
      }

      const messages: Message[] = [];

      for (const event of events) {
        if (event.event_type === 'MessageCreate') {
          const sender = users[event.sender_id];
          const isOutgoing = event.sender_id === account!.platform_user_id;

          messages.push({
            id: '',
            conversationId: '',
            platformMessageId: event.id,
            senderId: event.sender_id,
            senderName: sender ? `@${sender.username}` : event.sender_id,
            content: event.text,
            messageType: this.getMessageType(event),
            mediaUrl: this.getMediaUrl(event),
            isOutgoing,
            isRead: false,
            sentAt: new Date(event.created_at),
            createdAt: new Date(),
          });
        }
      }

      return messages;
    }, accountId);
  }

  /**
   * Send a direct message
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const url = `${this.baseUrl}/dm_conversations/${conversationId}/messages`;

      const response = await this.apiClient.post(
        url,
        {
          text: content,
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const event = response.data.data;

      return {
        id: '',
        conversationId: '',
        platformMessageId: event.dm_event_id,
        senderId: account!.platform_user_id,
        senderName: account!.platform_username || account!.platform_user_id,
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
   * Mark message as read (not directly supported by Twitter API v2)
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    // Twitter API v2 doesn't have a direct endpoint to mark DMs as read
    // This would require using the v1.1 API or is not supported
    // This is a no-op for now
  }

  /**
   * Get conversations (using Mentions instead of DMs for free tier)
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      console.log(`[twitter] Fetching mentions for account ${accountId}`);
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      console.log(`[twitter] Account details: ${account?.platform_username} (${account?.platform_user_id})`);
      
      // Use mentions endpoint instead of DMs (free tier compatible)
      const mentionsUrl = `${this.baseUrl}/users/${account?.platform_user_id}/mentions`;
      console.log(`[twitter] Calling API: ${mentionsUrl}`);
      
      const response = await this.apiClient.get(mentionsUrl, {
        headers: {
          Authorization: `Bearer ${token}`,
        },
        params: {
          'tweet.fields': 'id,text,created_at,author_id,conversation_id',
          'user.fields': 'id,name,username,profile_image_url',
          expansions: 'author_id',
          max_results: 100,
        },
      });
      
      console.log(`[twitter] API Response status: ${response.status}`);

      const mentions = response.data.data || [];
      console.log(`[twitter] Found ${mentions.length} mentions`);
      
      const users: Record<string, TwitterUser> = {};

      if (response.data.includes?.users) {
        for (const user of response.data.includes.users) {
          users[user.id] = user;
        }
        console.log(`[twitter] Found ${Object.keys(users).length} users in response`);
      }

      const conversationsMap = new Map<string, Conversation>();

      for (const mention of mentions) {
        const conversationId = mention.conversation_id || mention.id;
        const authorId = mention.author_id;
        
        if (!conversationsMap.has(conversationId)) {
          const author = users[authorId];
          
          conversationsMap.set(conversationId, {
            id: '',
            accountId,
            platformConversationId: conversationId,
            participantName: author ? `@${author.username}` : authorId,
            participantId: authorId,
            participantAvatarUrl: author?.profile_image_url,
            lastMessageAt: new Date(mention.created_at),
            unreadCount: 0,
            createdAt: new Date(),
            updatedAt: new Date(),
          });
        } else {
          // Update last message time if newer
          const existing = conversationsMap.get(conversationId)!;
          const messageDate = new Date(mention.created_at);
          if (messageDate > existing.lastMessageAt) {
            existing.lastMessageAt = messageDate;
          }
        }
      }

      const conversations = Array.from(conversationsMap.values());
      console.log(`[twitter] Extracted ${conversations.length} unique conversations`);
      return conversations;
    }, accountId);
  }

  /**
   * Determine message type from event
   */
  private getMessageType(event: TwitterDMEvent): 'text' | 'image' | 'video' | 'file' {
    if (!event.attachments || event.attachments.length === 0) {
      return 'text';
    }

    const attachment = event.attachments[0];
    if (attachment.type === 'media') {
      // Would need to check media type from media_key
      return 'image';
    }

    return 'file';
  }

  /**
   * Get media URL from event
   */
  private getMediaUrl(event: TwitterDMEvent): string | undefined {
    if (!event.attachments || event.attachments.length === 0) {
      return undefined;
    }

    const attachment = event.attachments[0];
    return attachment.media_key || attachment.url;
  }
}
