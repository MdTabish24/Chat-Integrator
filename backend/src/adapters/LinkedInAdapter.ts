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
   * Fetch messages from LinkedIn (placeholder - requires Business Page)
   * Note: LinkedIn messaging only works for Business Pages, not personal accounts
   */
  async fetchMessages(accountId: string, since?: Date): Promise<Message[]> {
    console.log(`[linkedin] LinkedIn messaging requires Business Page access`);
    console.log(`[linkedin] Personal account messaging is not supported by LinkedIn API`);
    // Return empty array - LinkedIn messaging not available for personal accounts
    return [];

      const conversations: LinkedInConversation[] = conversationsResponse.data.elements || [];
      const allMessages: Message[] = [];

      // Fetch messages for each conversation
      for (const conversation of conversations) {
        const conversationId = this.extractIdFromUrn(conversation.entityUrn);
        const messagesUrl = `${this.baseUrl}/conversationMessages`;
        
        const params: any = {
          q: 'conversation',
          conversation: conversation.entityUrn,
          sortOrder: 'DESCENDING',
        };

        if (since) {
          params.createdAfter = since.getTime();
        }

        const messagesResponse = await this.apiClient.get(messagesUrl, {
          headers: {
            Authorization: `Bearer ${token}`,
            'X-Restli-Protocol-Version': '2.0.0',
          },
          params,
        });

        const linkedInMessages: LinkedInMessage[] = messagesResponse.data.elements || [];

        for (const msg of linkedInMessages) {
          const senderId = this.extractIdFromUrn(msg.from);
          const isOutgoing = senderId === account!.platform_user_id;

          allMessages.push({
            id: '',
            conversationId: '',
            platformMessageId: this.extractIdFromUrn(msg.entityUrn),
            senderId,
            senderName: senderId,
            content: msg.body,
            messageType: this.getMessageType(msg),
            mediaUrl: this.getMediaUrl(msg),
            isOutgoing,
            isRead: false,
            sentAt: new Date(msg.createdAt),
            createdAt: new Date(),
          });
        }
      }

      return allMessages;
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

      const linkedInConversations: LinkedInConversation[] = response.data.elements || [];
      const conversations: Conversation[] = [];

      for (const conv of linkedInConversations) {
        // Find the other participant
        const otherParticipantUrn = conv.participants.find(
          (p) => !p.includes(account!.platform_user_id)
        );

        if (otherParticipantUrn) {
          const participantId = this.extractIdFromUrn(otherParticipantUrn);
          
          // Fetch participant profile for name
          let participantName = participantId;
          let avatarUrl: string | undefined;

          try {
            const profileUrl = `${this.baseUrl}/people/${participantId}`;
            const profileResponse = await this.apiClient.get(profileUrl, {
              headers: {
                Authorization: `Bearer ${token}`,
              },
            });

            const profile: LinkedInProfile = profileResponse.data;
            participantName = `${profile.firstName} ${profile.lastName}`;
            avatarUrl = profile.profilePicture?.displayImage;
          } catch (error) {
            // If profile fetch fails, use ID as name
            console.error('Failed to fetch LinkedIn profile:', error);
          }

          conversations.push({
            id: '',
            accountId,
            platformConversationId: this.extractIdFromUrn(conv.entityUrn),
            participantName,
            participantId,
            participantAvatarUrl: avatarUrl,
            lastMessageAt: new Date(conv.lastActivityAt),
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
