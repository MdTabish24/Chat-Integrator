import axios, { AxiosInstance } from 'axios';
import { BasePlatformAdapter } from './BasePlatformAdapter';
import { Message, Conversation } from '../types';
import { getConnectedAccountById } from '../db/queryHelpers';

interface LinkedInConversation {
  entityUrn: string;
  participants: string[];
  lastActivityAt: number;
}

interface LinkedInMessage {
  entityUrn: string;
  conversationUrn: string;
  from: string;
  createdAt: number;
  body: string;
  attachments?: LinkedInAttachment[];
}

interface LinkedInAttachment {
  mediaType: string;
  reference: string;
}

interface LinkedInProfile {
  id: string;
  firstName: string;
  lastName: string;
  profilePicture?: {
    displayImage: string;
  };
}

/**
 * LinkedIn Messaging API adapter
 */
export class LinkedInAdapter extends BasePlatformAdapter {
  private apiClient: AxiosInstance;
  private readonly baseUrl = 'https://api.linkedin.com/v2';

  constructor() {
    super('linkedin');
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
   * LinkedIn tokens expire in 60 days, refresh if needed
   */
  protected async refreshTokenIfNeeded(accountId: string): Promise<void> {
    // LinkedIn tokens are long-lived (60 days)
    // Refresh logic would be similar to Twitter but with different expiry
    // For now, we'll assume the token is valid
    // In production, implement refresh logic similar to TwitterAdapter
  }

  /**
   * Fetch messages from LinkedIn Business Pages
   * Note: Works ONLY for Business Pages where user is admin
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    return this.executeWithRetry(async () => {
      const token = await this.getAccessToken(accountId);
      const account = await getConnectedAccountById(accountId);
      
      try {
        // Step 1: Get organizations (Business Pages) user manages
        const orgsResponse = await this.apiClient.get(
          `${this.baseUrl}/organizationalEntityAcls?q=roleAssignee&role=ADMINISTRATOR&projection=(elements*(organizationalTarget~(localizedName,id)))`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
              'LinkedIn-Version': '202311',
            },
          }
        );

        const organizations = orgsResponse.data.elements || [];
        
        if (organizations.length === 0) {
          console.log('[linkedin] No Business Pages found. User must be admin of a Company Page.');
          return [];
        }

        console.log(`[linkedin] Found ${organizations.length} Business Page(s)`);
        
        const allMessages: Message[] = [];

        // Step 2: Fetch messages for each Business Page
        for (const org of organizations) {
          const orgId = org['organizationalTarget~']?.id;
          const orgName = org['organizationalTarget~']?.localizedName;
          
          if (!orgId) continue;

          console.log(`[linkedin] Fetching messages for page: ${orgName}`);

          // Get conversations for this organization
          const conversationsUrl = `${this.baseUrl}/socialActions?q=actor&actor=urn:li:organization:${orgId}&count=50`;
          
          const conversationsResponse = await this.apiClient.get(conversationsUrl, {
            headers: {
              Authorization: `Bearer ${token}`,
              'LinkedIn-Version': '202311',
            },
          });

          const conversations = conversationsResponse.data.elements || [];
          
          // Process each conversation
          for (const conv of conversations) {
            // Extract message data
            if (conv.commentary) {
              const message: Message = {
                id: '',
                conversationId: orgId,
                platformMessageId: conv.id || conv.$URN,
                senderId: conv.actor || 'unknown',
                senderName: orgName || 'LinkedIn User',
                content: conv.commentary,
                messageType: 'text',
                isOutgoing: false,
                isRead: false,
                sentAt: new Date(conv.created?.time || Date.now()),
                createdAt: new Date(),
              };

              // Filter by date if provided
              if (!since || message.sentAt >= since) {
                allMessages.push(message);
              }
            }
          }
        }

        console.log(`[linkedin] Fetched ${allMessages.length} messages from Business Pages`);
        return allMessages;
        
      } catch (error: any) {
        if (error.response?.status === 403) {
          console.log('[linkedin] Access denied. Make sure you are admin of a Business Page and have correct permissions.');
          return [];
        }
        throw error;
      }
    }, accountId);
  }

  /**
   * Send a message (not supported - requires Business Page)
   */
  async sendMessage(
    accountId: string,
    conversationId: string,
    content: string
  ): Promise<Message> {
    throw new Error('LinkedIn messaging requires Business Page access. Personal account messaging is not supported.');
  }

  /**
   * Mark message as read (not supported)
   */
  async markAsRead(accountId: string, messageId: string): Promise<void> {
    console.log(`[linkedin] markAsRead not supported for personal accounts`);
  }

  /**
   * Get all conversations (placeholder - requires Business Page)
   * Note: LinkedIn messaging only works for Business Pages
   */
  async getConversations(accountId: string): Promise<Conversation[]> {
    console.log(`[linkedin] LinkedIn messaging requires Business Page access`);
    console.log(`[linkedin] Personal account messaging is not supported by LinkedIn API`);
    // Return empty array - LinkedIn messaging not available for personal accounts
    return [];
  }

  /**
   * Extract ID from LinkedIn URN format
   */
  private extractIdFromUrn(urn: string): string {
    const parts = urn.split(':');
    return parts[parts.length - 1];
  }

  /**
   * Determine message type
   */
  private getMessageType(message: LinkedInMessage): 'text' | 'image' | 'video' | 'file' {
    if (!message.attachments || message.attachments.length === 0) {
      return 'text';
    }

    const attachment = message.attachments[0];
    if (attachment.mediaType.includes('image')) {
      return 'image';
    }
    if (attachment.mediaType.includes('video')) {
      return 'video';
    }

    return 'file';
  }

  /**
   * Get media URL from message
   */
  private getMediaUrl(message: LinkedInMessage): string | undefined {
    if (!message.attachments || message.attachments.length === 0) {
      return undefined;
    }

    return message.attachments[0].reference;
  }
}
