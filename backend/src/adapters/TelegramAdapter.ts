import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById } from '../db/queryHelpers';

interface TelegramUpdate {
  update_id: number;
  message?: TelegramMessage;
}

interface TelegramMessage {
  message_id: number;
  from: TelegramUser;
  chat: TelegramChat;
  date: number;
  text?: string;
  photo?: TelegramPhotoSize[];
  video?: TelegramVideo;
  document?: TelegramDocument;
}

interface TelegramUser {
  id: number;
  is_bot: boolean;
  first_name: string;
  last_name?: string;
  username?: string;
}

interface TelegramChat {
  id: number;
  type: string;
  title?: string;
  username?: string;
  first_name?: string;
  last_name?: string;
}

interface TelegramPhotoSize {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  file_size?: number;
}

interface TelegramVideo {
  file_id: string;
  file_unique_id: string;
  width: number;
  height: number;
  duration: number;
}

interface TelegramDocument {
  file_id: string;
  file_unique_id: string;
  file_name?: string;
  mime_type?: string;
  file_size?: number;
}

/**
 * Telegram Bot API adapter
 */
export class TelegramAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://api.telegram.org';

  constructor() {
    super('telegram');
    this.apiClient = axios.create({
      timeout: 30000,
    });
  }

  /**
   * Get access token (bot token) for the account
   */
  protected async getAccessToken(accountId: string): Promise<string> {
    const account = await getConnectedAccountById(accountId);
    if (!account || !account.is_active) {
      throw new Error(`Account ${accountId} not found or inactive`);
    }
    return account.access_token;
  }

  /**
   * Telegram bot tokens don't expire, so no refresh needed
   */
  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    // No-op for Telegram
  }

  /**
   * Fetch messages using getUpdates method
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const url = `${this.baseUrl}/bot${token}/getUpdates`;

      // Get updates with offset if we have a since date
      const params: any = {
        timeout: 30,
        allowed_updates: ['message'],
      };

      const response = await this.apiClient.get(url, { params });

      if (!response.data.ok) {
        throw new Error(`Telegram API error: ${response.data.description}`);
      }

      const updates: TelegramUpdate[] = response.data.result;
      const messages: Message[] = [];

      for (const update of updates) {
        if (update.message) {
          const msg = this.convertTelegramMessage(update.message, accountId);
          
          // Filter by date if since is provided
          if (!since || msg.sentAt >= since) {
            messages.push(msg);
          }
        }
      }

      return messages;
    }, accountId);
  }

  /**
   * Send a message using Telegram Bot API
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const url = `${this.baseUrl}/bot${token}/sendMessage`;

      const response = await this.apiClient.post(url, {
        chat_id: conversationId,
        text: content,
      });

      if (!response.data.ok) {
        throw new Error(`Telegram API error: ${response.data.description}`);
      }

      const sentMessage = response.data.result;
      return this.convertTelegramMessage(sentMessage, accountId, true);
    }, accountId);
  }

  /**
   * Mark message as read (not supported by Telegram Bot API)
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    // Telegram Bot API doesn't support marking messages as read
    // This is a no-op
  }

  /**
   * Get conversations (chats) for the account
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      
      // Telegram Bot API doesn't have a direct method to list all chats
      // We need to get updates and extract unique chats from messages
      const url = `${this.baseUrl}/bot${token}/getUpdates`;
      
      const response = await this.apiClient.get(url, {
        params: {
          timeout: 0,
          allowed_updates: ['message'],
        },
      });

      if (!response.data.ok) {
        throw new Error(`Telegram API error: ${response.data.description}`);
      }

      const updates: TelegramUpdate[] = response.data.result;
      const conversationsMap = new Map<string, Conversation>();

      for (const update of updates) {
        if (update.message) {
          const chat = update.message.chat;
          const chatId = chat.id.toString();

          if (!conversationsMap.has(chatId)) {
            conversationsMap.set(chatId, {
              id: '', // Will be set by the database
              accountId,
              platformConversationId: chatId,
              participantName: this.getChatName(chat),
              participantId: chatId,
              participantAvatarUrl: undefined,
              lastMessageAt: new Date(update.message.date * 1000),
              unreadCount: 0,
              createdAt: new Date(),
              updatedAt: new Date(),
            });
          } else {
            // Update last message time if this message is newer
            const existing = conversationsMap.get(chatId)!;
            const messageDate = new Date(update.message.date * 1000);
            if (messageDate > existing.lastMessageAt) {
              existing.lastMessageAt = messageDate;
            }
          }
        }
      }

      return Array.from(conversationsMap.values());
    }, accountId);
  }

  /**
   * Convert Telegram message to our Message format
   */
  private convertTelegramMessage(
    telegramMsg: TelegramMessage,
    accountId: string,
    isOutgoing: boolean = false
  ): Message {
    let content = telegramMsg.text || '';
    let messageType: 'text' | 'image' | 'video' | 'file' = 'text';
    let mediaUrl: string | undefined;

    // Handle media messages
    if (telegramMsg.photo && telegramMsg.photo.length > 0) {
      messageType = 'image';
      // Get the largest photo
      const largestPhoto = telegramMsg.photo[telegramMsg.photo.length - 1];
      mediaUrl = largestPhoto.file_id;
      content = content || '[Photo]';
    } else if (telegramMsg.video) {
      messageType = 'video';
      mediaUrl = telegramMsg.video.file_id;
      content = content || '[Video]';
    } else if (telegramMsg.document) {
      messageType = 'file';
      mediaUrl = telegramMsg.document.file_id;
      content = content || `[File: ${telegramMsg.document.file_name || 'document'}]`;
    }

    return {
      id: '', // Will be set by the database
      conversationId: '', // Will be set by the database
      platformMessageId: telegramMsg.message_id.toString(),
      senderId: telegramMsg.from.id.toString(),
      senderName: this.getUserName(telegramMsg.from),
      content,
      messageType,
      mediaUrl,
      isOutgoing,
      isRead: false,
      sentAt: new Date(telegramMsg.date * 1000),
      createdAt: new Date(),
    };
  }

  /**
   * Get user's display name
   */
  private getUserName(user: TelegramUser): string {
    if (user.username) {
      return `@${user.username}`;
    }
    const parts = [user.first_name];
    if (user.last_name) {
      parts.push(user.last_name);
    }
    return parts.join(' ');
  }

  /**
   * Get chat's display name
   */
  private getChatName(chat: TelegramChat): string {
    if (chat.title) {
      return chat.title;
    }
    if (chat.username) {
      return `@${chat.username}`;
    }
    const parts = [];
    if (chat.first_name) {
      parts.push(chat.first_name);
    }
    if (chat.last_name) {
      parts.push(chat.last_name);
    }
    return parts.join(' ') || 'Unknown';
  }
}
