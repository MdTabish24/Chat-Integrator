import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById, updateAccountTokens } from '../db/queryHelpers';

interface TwitterMention {
  id: string;
  text: string;
  created_at: string;
  author_id: string;
  conversation_id: string;
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
   * Fetch mentions (free tier compatible)
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      console.log(`[twitter] Fetching mentions for account ${accountId}`);
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      const url = `${this.baseUrl}/users/${account?.platform_user_id}/mentions`;
      const params: any = {
        'tweet.fields': 'id,text,created_at,author_id,conversation_id',
        'user.fields': 'id,name,username,profile_image_url',
        expansions: 'author_id',
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

      const mentions = response.data.data || [];
      console.log(`[twitter] Found ${mentions.length} mentions`);
      
      const users: Record<string, TwitterUser> = {};

      // Build user lookup map
      if (response.data.includes?.users) {
        for (const user of response.data.includes.users) {
          users[user.id] = user;
        }
      }

      const messages: Message[] = [];

      for (const mention of mentions) {
        const author = users[mention.author_id];
        const isOutgoing = mention.author_id === account!.platform_user_id;

        messages.push({
          id: '',
          conversationId: '',
          platformMessageId: mention.id,
          senderId: mention.author_id,
          senderName: author ? `@${author.username}` : mention.author_id,
          content: mention.text,
          messageType: 'text',
          isOutgoing,
          isRead: false,
          sentAt: new Date(mention.created_at),
          createdAt: new Date(),
        });
      }

      console.log(`[twitter] Converted ${messages.length} mentions to messages`);
      return messages;
    }, accountId);
  }

  /**
   * Send a reply tweet (free tier compatible)
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      console.log(`[twitter] Sending reply to conversation ${conversationId}`);
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      // Use tweets endpoint to reply
      const url = `${this.baseUrl}/tweets`;

      const response = await this.apiClient.post(
        url,
        {
          text: content,
          reply: {
            in_reply_to_tweet_id: conversationId
          }
        },
        {
          headers: {
            Authorization: `Bearer ${token}`,
            'Content-Type': 'application/json',
          },
        }
      );

      const tweet = response.data.data;
      console.log(`[twitter] Reply sent successfully: ${tweet.id}`);

      return {
        id: '',
        conversationId: '',
        platformMessageId: tweet.id,
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
   * Mark message as read (not supported for mentions)
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    // Mentions don't have a "read" status in Twitter API
    // This is a no-op
    console.log(`[twitter] markAsRead called for ${messageId} (no-op for mentions)`);
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

}
