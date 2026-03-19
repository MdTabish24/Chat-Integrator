import { EventEmitter } from 'events';
import { 
  getTwitterAdapter, 
  getInstagramAdapter, 
  getFacebookAdapter, 
  getLinkedInAdapter, 
  getWhatsAppAdapter, 
  getTelegramAdapter, 
  getDiscordAdapter 
} from '../adapters/index.js';
import type { 
  Platform, 
  Conversation, 
  Message,
  NewMessageEvent 
} from '../../shared/types.js';

/**
 * Message Aggregator
 * Combines conversations from all platforms into a unified view
 * Provides sorting, grouping, and unread count calculations
 */

interface PlatformGroup {
  platform: Platform;
  name: string;
  icon: string;
  color: string;
  conversations: Conversation[];
  unreadCount: number;
  connected: boolean;
}

interface AggregatedData {
  allConversations: Conversation[];
  byPlatform: Record<Platform, PlatformGroup>;
  totalUnreadCount: number;
}

// Platform display configuration
const PLATFORM_CONFIG: Record<Platform, { name: string; icon: string; color: string }> = {
  twitter: { name: 'Twitter/X', icon: '🐦', color: 'bg-sky-500' },
  instagram: { name: 'Instagram', icon: '📷', color: 'bg-pink-500' },
  facebook: { name: 'Facebook', icon: '👥', color: 'bg-blue-600' },
  linkedin: { name: 'LinkedIn', icon: '💼', color: 'bg-blue-700' },
  whatsapp: { name: 'WhatsApp', icon: '💬', color: 'bg-green-500' },
  telegram: { name: 'Telegram', icon: '📱', color: 'bg-blue-500' },
  discord: { name: 'Discord', icon: '🎮', color: 'bg-indigo-600' },
  teams: { name: 'Microsoft Teams', icon: '👥', color: 'bg-purple-600' },
  gmail: { name: 'Gmail', icon: '📧', color: 'bg-red-500' },
};

export class MessageAggregator extends EventEmitter {
  // Platform adapters
  private twitterAdapter = getTwitterAdapter();
  private instagramAdapter = getInstagramAdapter();
  private facebookAdapter = getFacebookAdapter();
  private linkedinAdapter = getLinkedInAdapter();
  private whatsappAdapter = getWhatsAppAdapter();
  private telegramAdapter = getTelegramAdapter();
  private discordAdapter = getDiscordAdapter();
  
  // Cache
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  private lastAggregation: AggregatedData | null = null;

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for new messages
   */
  private setupEventListeners(): void {
    // Listen for new messages from all adapters
    const adapters = [
      this.twitterAdapter,
      this.instagramAdapter,
      this.facebookAdapter,
      this.linkedinAdapter,
      this.whatsappAdapter,
      this.telegramAdapter,
      this.discordAdapter,
    ];

    for (const adapter of adapters) {
      adapter.on('newMessage', (event: NewMessageEvent) => {
        this.handleNewMessage(event);
      });
    }
  }

  /**
   * Handle new message event
   */
  private handleNewMessage(event: NewMessageEvent): void {
    const { platform, conversationId, message } = event;
    
    // Update conversation cache
    const conversation = this.conversationsCache.get(conversationId);
    if (conversation) {
      conversation.lastMessage = message.content;
      conversation.lastMessageAt = message.sentAt;
      if (!message.isOutgoing && !message.isRead) {
        conversation.unreadCount = (conversation.unreadCount || 0) + 1;
      }
      this.conversationsCache.set(conversationId, conversation);
    }
    
    // Update messages cache
    const messages = this.messagesCache.get(conversationId) || [];
    messages.push(message);
    this.messagesCache.set(conversationId, messages);
    
    // Emit update event
    this.emit('conversationUpdated', { conversationId, conversation, message });
  }

  /**
   * Fetch and aggregate all conversations from connected platforms
   */
  async aggregateConversations(): Promise<AggregatedData> {
    console.log('[MessageAggregator] Aggregating conversations...');
    
    const allConversations: Conversation[] = [];
    const byPlatform: Record<string, PlatformGroup> = {};
    
    // Initialize platform groups
    const platforms: Platform[] = ['twitter', 'instagram', 'facebook', 'linkedin', 'whatsapp', 'telegram', 'discord'];
    
    for (const platform of platforms) {
      const config = PLATFORM_CONFIG[platform];
      byPlatform[platform] = {
        platform,
        name: config.name,
        icon: config.icon,
        color: config.color,
        conversations: [],
        unreadCount: 0,
        connected: this.isPlatformConnected(platform),
      };
    }
    
    // Fetch from each connected platform
    const fetchPromises: Promise<void>[] = [];
    
    if (this.twitterAdapter.connected()) {
      fetchPromises.push(
        this.twitterAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['twitter'].conversations = convs;
            byPlatform['twitter'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] Twitter fetch error:', err.message))
      );
    }
    
    if (this.instagramAdapter.connected()) {
      fetchPromises.push(
        this.instagramAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['instagram'].conversations = convs;
            byPlatform['instagram'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] Instagram fetch error:', err.message))
      );
    }
    
    if (this.facebookAdapter.connected()) {
      fetchPromises.push(
        this.facebookAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['facebook'].conversations = convs;
            byPlatform['facebook'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] Facebook fetch error:', err.message))
      );
    }
    
    if (this.linkedinAdapter.connected()) {
      fetchPromises.push(
        this.linkedinAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['linkedin'].conversations = convs;
            byPlatform['linkedin'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] LinkedIn fetch error:', err.message))
      );
    }
    
    if (this.whatsappAdapter.connected()) {
      fetchPromises.push(
        this.whatsappAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['whatsapp'].conversations = convs;
            byPlatform['whatsapp'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] WhatsApp fetch error:', err.message))
      );
    }
    
    if (this.telegramAdapter.connected()) {
      fetchPromises.push(
        this.telegramAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['telegram'].conversations = convs;
            byPlatform['telegram'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] Telegram fetch error:', err.message))
      );
    }
    
    if (this.discordAdapter.connected()) {
      fetchPromises.push(
        this.discordAdapter.fetchConversations()
          .then(convs => {
            allConversations.push(...convs);
            byPlatform['discord'].conversations = convs;
            byPlatform['discord'].unreadCount = this.calculateUnreadCount(convs);
          })
          .catch(err => console.error('[MessageAggregator] Discord fetch error:', err.message))
      );
    }
    
    // Wait for all fetches to complete
    await Promise.allSettled(fetchPromises);
    
    // Sort all conversations by last message time (newest first)
    allConversations.sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );
    
    // Sort conversations within each platform group
    for (const platform of platforms) {
      byPlatform[platform].conversations.sort((a, b) => 
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );
    }
    
    // Calculate total unread count
    const totalUnreadCount = platforms.reduce((sum, platform) => 
      sum + byPlatform[platform].unreadCount, 0
    );
    
    // Update cache
    for (const conv of allConversations) {
      this.conversationsCache.set(conv.id, conv);
    }
    
    // Store aggregation result
    this.lastAggregation = {
      allConversations,
      byPlatform: byPlatform as Record<Platform, PlatformGroup>,
      totalUnreadCount,
    };
    
    console.log(`[MessageAggregator] Aggregated ${allConversations.length} conversations, ${totalUnreadCount} unread`);
    
    return this.lastAggregation;
  }

  /**
   * Check if a platform is connected
   */
  private isPlatformConnected(platform: Platform): boolean {
    switch (platform) {
      case 'twitter': return this.twitterAdapter.connected();
      case 'instagram': return this.instagramAdapter.connected();
      case 'facebook': return this.facebookAdapter.connected();
      case 'linkedin': return this.linkedinAdapter.connected();
      case 'whatsapp': return this.whatsappAdapter.connected();
      case 'telegram': return this.telegramAdapter.connected();
      case 'discord': return this.discordAdapter.connected();
      default: return false;
    }
  }

  /**
   * Calculate unread count for a list of conversations
   */
  private calculateUnreadCount(conversations: Conversation[]): number {
    return conversations.reduce((sum, conv) => sum + (conv.unreadCount || 0), 0);
  }

  /**
   * Get all conversations (from cache or fetch)
   */
  async getAllConversations(forceRefresh: boolean = false): Promise<Conversation[]> {
    if (!forceRefresh && this.lastAggregation) {
      return this.lastAggregation.allConversations;
    }
    
    const data = await this.aggregateConversations();
    return data.allConversations;
  }

  /**
   * Get conversations grouped by platform
   */
  async getConversationsByPlatform(forceRefresh: boolean = false): Promise<Record<Platform, PlatformGroup>> {
    if (!forceRefresh && this.lastAggregation) {
      return this.lastAggregation.byPlatform;
    }
    
    const data = await this.aggregateConversations();
    return data.byPlatform;
  }

  /**
   * Get conversations for a specific platform
   */
  async getPlatformConversations(platform: Platform): Promise<Conversation[]> {
    if (this.lastAggregation) {
      return this.lastAggregation.byPlatform[platform]?.conversations || [];
    }
    
    const data = await this.aggregateConversations();
    return data.byPlatform[platform]?.conversations || [];
  }

  /**
   * Get total unread count across all platforms
   */
  async getTotalUnreadCount(): Promise<number> {
    if (this.lastAggregation) {
      return this.lastAggregation.totalUnreadCount;
    }
    
    const data = await this.aggregateConversations();
    return data.totalUnreadCount;
  }

  /**
   * Get unread count for a specific platform
   */
  async getPlatformUnreadCount(platform: Platform): Promise<number> {
    if (this.lastAggregation) {
      return this.lastAggregation.byPlatform[platform]?.unreadCount || 0;
    }
    
    const data = await this.aggregateConversations();
    return data.byPlatform[platform]?.unreadCount || 0;
  }

  /**
   * Get messages for a conversation
   */
  async getMessages(conversationId: string, platform: Platform): Promise<Message[]> {
    // Check cache first
    const cached = this.messagesCache.get(conversationId);
    if (cached && cached.length > 0) {
      return cached;
    }
    
    // Fetch from adapter
    const platformConvId = conversationId.replace(`${platform}_`, '');
    let messages: Message[] = [];
    
    switch (platform) {
      case 'twitter':
        if (this.twitterAdapter.connected()) {
          messages = await this.twitterAdapter.fetchMessages(platformConvId);
        }
        break;
      case 'instagram':
        if (this.instagramAdapter.connected()) {
          messages = await this.instagramAdapter.fetchMessages(platformConvId);
        }
        break;
      case 'facebook':
        if (this.facebookAdapter.connected()) {
          messages = await this.facebookAdapter.fetchMessages(platformConvId);
        }
        break;
      case 'linkedin':
        if (this.linkedinAdapter.connected()) {
          messages = await this.linkedinAdapter.fetchMessages(platformConvId);
        }
        break;
      case 'whatsapp':
        if (this.whatsappAdapter.connected()) {
          messages = await this.whatsappAdapter.fetchMessages(platformConvId);
        }
        break;
      case 'telegram':
        if (this.telegramAdapter.connected()) {
          messages = await this.telegramAdapter.fetchMessages(platformConvId);
        }
        break;
      case 'discord':
        if (this.discordAdapter.connected()) {
          messages = await this.discordAdapter.fetchMessages(platformConvId);
        }
        break;
    }
    
    // Cache messages
    if (messages.length > 0) {
      this.messagesCache.set(conversationId, messages);
    }
    
    return messages;
  }

  /**
   * Mark conversation as read
   */
  markConversationAsRead(conversationId: string): void {
    const conversation = this.conversationsCache.get(conversationId);
    if (conversation) {
      conversation.unreadCount = 0;
      this.conversationsCache.set(conversationId, conversation);
      
      // Update platform group unread count
      if (this.lastAggregation) {
        const platformGroup = this.lastAggregation.byPlatform[conversation.platform];
        if (platformGroup) {
          platformGroup.unreadCount = this.calculateUnreadCount(platformGroup.conversations);
          this.lastAggregation.totalUnreadCount = Object.values(this.lastAggregation.byPlatform)
            .reduce((sum, group) => sum + group.unreadCount, 0);
        }
      }
      
      this.emit('unreadCountUpdated', {
        conversationId,
        platform: conversation.platform,
        totalUnreadCount: this.lastAggregation?.totalUnreadCount || 0,
      });
    }
  }

  /**
   * Get conversation by ID
   */
  getConversation(conversationId: string): Conversation | undefined {
    return this.conversationsCache.get(conversationId);
  }

  /**
   * Search conversations by participant name
   */
  searchConversations(query: string): Conversation[] {
    if (!query.trim()) {
      return this.lastAggregation?.allConversations || [];
    }
    
    const lowerQuery = query.toLowerCase();
    const allConversations = this.lastAggregation?.allConversations || [];
    
    return allConversations.filter(conv => 
      conv.participantName.toLowerCase().includes(lowerQuery) ||
      conv.lastMessage?.toLowerCase().includes(lowerQuery)
    );
  }

  /**
   * Clear all caches
   */
  clearCache(): void {
    this.conversationsCache.clear();
    this.messagesCache.clear();
    this.lastAggregation = null;
  }

  /**
   * Get platform configuration
   */
  getPlatformConfig(platform: Platform): { name: string; icon: string; color: string } {
    return PLATFORM_CONFIG[platform];
  }

  /**
   * Get all platform configurations
   */
  getAllPlatformConfigs(): Record<Platform, { name: string; icon: string; color: string }> {
    return PLATFORM_CONFIG;
  }
}

// Export singleton instance
let messageAggregator: MessageAggregator | null = null;

export function getMessageAggregator(): MessageAggregator {
  if (!messageAggregator) {
    messageAggregator = new MessageAggregator();
  }
  return messageAggregator;
}
