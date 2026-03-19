import { EventEmitter } from 'events';
import { TelegramClient, Api } from 'telegram';
import { StringSession } from 'telegram/sessions/index.js';
import { NewMessage } from 'telegram/events/index.js';
import type { 
  Platform, 
  Conversation, 
  Message, 
  SendMessageResponse 
} from '../../shared/types.js';

/**
 * Telegram Platform Adapter
 * Uses GramJS (MTProto protocol) for proper API access
 * Requires API ID and API Hash from my.telegram.org
 */

type TelegramStatus = 'disconnected' | 'awaiting_credentials' | 'awaiting_phone' | 'awaiting_code' | 'awaiting_password' | 'connecting' | 'connected' | 'error';

interface TelegramCredentials {
  apiId: number;
  apiHash: string;
  phoneNumber?: string;
  sessionString?: string;
}

export class TelegramAdapter extends EventEmitter {
  readonly platform: Platform = 'telegram';
  
  private client: TelegramClient | null = null;
  private status: TelegramStatus = 'disconnected';
  private credentials: TelegramCredentials | null = null;
  private sessionString: string = '';
  private userId: string | null = null;
  private username: string | null = null;
  private phoneNumber: string | null = null;
  
  // For phone code verification
  private phoneCodeResolver: ((code: string) => void) | null = null;
  private passwordResolver: ((password: string) => void) | null = null;
  
  // Cache
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  private dialogsMap: Map<string, any> = new Map(); // Store dialog entities

  constructor() {
    super();
  }

  getStatus(): TelegramStatus {
    return this.status;
  }

  getUsername(): string | null {
    return this.username;
  }

  getUserId(): string | null {
    return this.userId;
  }

  getSessionString(): string | null {
    return this.sessionString || null;
  }

  connected(): boolean {
    return this.status === 'connected' && this.client !== null;
  }

  /**
   * Set API credentials (step 1)
   */
  setApiCredentials(apiId: string | number, apiHash: string): void {
    this.credentials = {
      apiId: typeof apiId === 'string' ? parseInt(apiId, 10) : apiId,
      apiHash: apiHash,
    };
    this.status = 'awaiting_phone';
    console.log('[TelegramAdapter] API credentials set, apiId:', this.credentials.apiId);
    this.emit('statusChange', { status: 'awaiting_phone', message: 'Enter your phone number' });
  }

  /**
   * Start phone verification (step 2)
   * This starts the connection in background and returns immediately
   */
  async startPhoneVerification(phoneNumber: string): Promise<{ success: boolean; error?: string }> {
    console.log('[TelegramAdapter] startPhoneVerification called with:', phoneNumber);
    
    if (!this.credentials) {
      console.log('[TelegramAdapter] No credentials set!');
      return { success: false, error: 'API credentials not set. Call setApiCredentials first.' };
    }

    this.phoneNumber = phoneNumber;
    this.status = 'connecting';
    console.log('[TelegramAdapter] Status set to connecting');
    this.emit('statusChange', { status: 'connecting', message: 'Connecting to Telegram...' });

    try {
      console.log('[TelegramAdapter] Creating TelegramClient...');
      const stringSession = new StringSession(this.sessionString || '');
      
      this.client = new TelegramClient(
        stringSession,
        this.credentials.apiId,
        this.credentials.apiHash,
        {
          connectionRetries: 5,
          deviceModel: 'Chat Orbitor Desktop',
          systemVersion: 'Windows 10',
          appVersion: '1.0.0',
        }
      );

      // Start the client in background - don't await
      this.client.start({
        phoneNumber: async () => phoneNumber,
        phoneCode: async () => {
          this.status = 'awaiting_code';
          this.emit('statusChange', { status: 'awaiting_code', message: 'Enter the code sent to your phone' });
          
          return new Promise<string>((resolve) => {
            this.phoneCodeResolver = resolve;
          });
        },
        password: async () => {
          this.status = 'awaiting_password';
          this.emit('statusChange', { status: 'awaiting_password', message: 'Enter your 2FA password' });
          
          return new Promise<string>((resolve) => {
            this.passwordResolver = resolve;
          });
        },
        onError: (err) => {
          console.error('[TelegramAdapter] Auth error:', err.message);
          this.status = 'error';
          this.emit('error', { platform: 'telegram', error: err.message });
        },
      }).then(async () => {
        // Connection successful
        this.sessionString = this.client!.session.save() as unknown as string;
        
        // Get user info
        const me = await this.client!.getMe() as Api.User;
        this.userId = me.id.toString();
        this.username = me.username || me.firstName || 'Telegram User';

        this.status = 'connected';
        console.log('[TelegramAdapter] Connected successfully as', this.username);
        
        this.emit('connected');
        this.emit('statusChange', { 
          status: 'connected', 
          username: this.username,
          message: 'Connected to Telegram!' 
        });

        // Set up event handlers
        this.setupEventHandlers();
      }).catch((err) => {
        console.error('[TelegramAdapter] Connection failed:', err.message);
        this.status = 'error';
        this.emit('error', { platform: 'telegram', error: err.message });
      });

      // Wait a bit for the connection to start and code to be requested
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      // Return success - code should be sent by now
      return { success: true };
    } catch (error: any) {
      console.error('[TelegramAdapter] Connection error:', error.message);
      this.status = 'error';
      this.emit('error', { platform: 'telegram', error: error.message });
      return { success: false, error: error.message };
    }
  }

  /**
   * Verify phone code (step 3)
   */
  async verifyCode(code: string): Promise<{ success: boolean; needPassword?: boolean; error?: string }> {
    console.log('[TelegramAdapter] verifyCode called with code');
    if (this.phoneCodeResolver) {
      this.phoneCodeResolver(code);
      this.phoneCodeResolver = null;
      console.log('[TelegramAdapter] Code resolver called, waiting for connection...');
      
      // Wait for connection to complete
      let attempts = 0;
      while (this.status !== 'connected' && this.status !== 'error' && this.status !== 'awaiting_password' && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
        console.log('[TelegramAdapter] Waiting for connection... status:', this.status, 'attempt:', attempts);
      }
      
      if (this.status === 'awaiting_password') {
        return { success: true, needPassword: true };
      }
      
      if (this.status === 'connected') {
        return { success: true };
      }
      
      return { success: false, error: 'Connection failed or timed out' };
    }
    return { success: false, error: 'No pending code verification' };
  }

  /**
   * Verify 2FA password (step 4, if needed)
   */
  async verifyPassword(password: string): Promise<{ success: boolean; error?: string }> {
    console.log('[TelegramAdapter] verifyPassword called');
    if (this.passwordResolver) {
      this.passwordResolver(password);
      this.passwordResolver = null;
      
      // Wait for connection to complete
      let attempts = 0;
      while (this.status !== 'connected' && this.status !== 'error' && attempts < 30) {
        await new Promise(resolve => setTimeout(resolve, 500));
        attempts++;
        console.log('[TelegramAdapter] Waiting for connection after password... status:', this.status);
      }
      
      if (this.status === 'connected') {
        return { success: true };
      }
      
      return { success: false, error: 'Connection failed after password' };
    }
    return { success: false, error: 'No pending password verification' };
  }

  /**
   * Connect with existing session
   */
  async connectWithSession(credentials: { apiId: string | number; apiHash: string; sessionString: string }): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    try {
      this.status = 'connecting';
      this.emit('statusChange', { status: 'connecting', message: 'Reconnecting to Telegram...' });

      const apiId = typeof credentials.apiId === 'string' ? parseInt(credentials.apiId, 10) : credentials.apiId;
      const stringSession = new StringSession(credentials.sessionString);

      this.client = new TelegramClient(
        stringSession,
        apiId,
        credentials.apiHash,
        {
          connectionRetries: 5,
          deviceModel: 'Chat Orbitor Desktop',
          systemVersion: 'Windows 10',
          appVersion: '1.0.0',
        }
      );

      await this.client.connect();

      // Verify session is valid
      const me = await this.client.getMe() as Api.User;
      this.userId = me.id.toString();
      this.username = me.username || me.firstName || 'Telegram User';
      this.sessionString = credentials.sessionString;
      this.credentials = { apiId, apiHash: credentials.apiHash };

      this.status = 'connected';
      console.log('[TelegramAdapter] Reconnected as', this.username);

      this.emit('connected');
      this.emit('statusChange', { 
        status: 'connected', 
        username: this.username,
        message: 'Connected to Telegram!' 
      });

      this.setupEventHandlers();

      return { success: true, userId: this.userId, username: this.username };
    } catch (error: any) {
      console.error('[TelegramAdapter] Session reconnect error:', error.message);
      this.status = 'error';
      return { success: false, error: error.message };
    }
  }

  /**
   * Set up real-time event handlers
   */
  private setupEventHandlers(): void {
    if (!this.client) return;

    // Handle new messages
    this.client.addEventHandler(async (event) => {
      const message = event.message;
      if (!message) return;

      try {
        const chat = await message.getChat();
        if (!chat) return;

        const sender = await message.getSender();
        const isOutgoing = message.out || false;

        const chatId = chat.id.toString();
        const conversationId = `telegram_${chatId}`;

        const newMessage: Message = {
          id: message.id.toString(),
          conversationId: conversationId,
          platformMessageId: message.id.toString(),
          senderId: sender ? (sender as any).id?.toString() || 'unknown' : 'unknown',
          senderName: isOutgoing ? 'You' : ((sender as any)?.firstName || (sender as any)?.title || 'Unknown'),
          content: message.text || '[Media]',
          messageType: 'text',
          isOutgoing: isOutgoing,
          isRead: !message.mentioned,
          sentAt: new Date(message.date * 1000).toISOString(),
        };

        // Update cache
        const cached = this.messagesCache.get(chatId) || [];
        cached.push(newMessage);
        this.messagesCache.set(chatId, cached);

        // Emit event
        this.emit('newMessage', {
          platform: 'telegram',
          conversationId: conversationId,
          message: newMessage,
        });

        console.log('[TelegramAdapter] New message from', newMessage.senderName);
      } catch (err: any) {
        console.error('[TelegramAdapter] Error processing message:', err.message);
      }
    }, new NewMessage({}));

    console.log('[TelegramAdapter] Event handlers set up');
  }

  /**
   * Fetch conversations (dialogs)
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.client || !this.connected()) {
      throw new Error('Not connected to Telegram');
    }

    try {
      const dialogs = await this.client.getDialogs({ limit: 30 });
      const conversations: Conversation[] = [];

      for (const dialog of dialogs) {
        const entity = dialog.entity;
        if (!entity) continue;

        const chatId = entity.id.toString();
        const isUser = entity.className === 'User';
        const isGroup = entity.className === 'Chat' || entity.className === 'Channel';

        let name = 'Unknown';
        let avatarUrl: string | undefined;

        if (isUser) {
          const user = entity as Api.User;
          name = user.firstName || user.username || 'Unknown';
          if (user.lastName) name += ' ' + user.lastName;
        } else if (isGroup) {
          name = (entity as any).title || 'Group';
        }

        // Get last message
        let lastMessage = '';
        let lastMessageAt = new Date().toISOString();
        
        if (dialog.message) {
          lastMessage = dialog.message.message || '[Media]';
          lastMessageAt = new Date(dialog.message.date * 1000).toISOString();
        }

        const conversation: Conversation = {
          id: `telegram_${chatId}`,
          platform: 'telegram',
          platformConversationId: chatId,
          participantName: name,
          participantId: chatId,
          participantAvatarUrl: avatarUrl,
          lastMessage: lastMessage,
          lastMessageAt: lastMessageAt,
          unreadCount: dialog.unreadCount || 0,
        };

        conversations.push(conversation);
        this.conversationsCache.set(chatId, conversation);
        this.dialogsMap.set(chatId, dialog);
      }

      // Sort by last message time
      conversations.sort((a, b) => 
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );

      console.log(`[TelegramAdapter] Fetched ${conversations.length} conversations`);
      return conversations;
    } catch (error: any) {
      console.error('[TelegramAdapter] fetchConversations error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch messages for a conversation
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.client || !this.connected()) {
      throw new Error('Not connected to Telegram');
    }

    try {
      const chatId = conversationId.replace('telegram_', '');
      const dialog = this.dialogsMap.get(chatId);
      
      if (!dialog || !dialog.entity) {
        // Try to get entity directly
        const entity = await this.client.getEntity(chatId);
        if (!entity) {
          return this.messagesCache.get(chatId) || [];
        }
      }

      const entity = dialog?.entity || await this.client.getEntity(chatId);
      const messages = await this.client.getMessages(entity, { limit: 50 });
      
      const formattedMessages: Message[] = [];

      for (const msg of messages) {
        if (!msg) continue;

        const sender = await msg.getSender();
        const isOutgoing = msg.out || false;

        formattedMessages.push({
          id: msg.id.toString(),
          conversationId: conversationId,
          platformMessageId: msg.id.toString(),
          senderId: sender ? (sender as any).id?.toString() || 'unknown' : 'unknown',
          senderName: isOutgoing ? 'You' : ((sender as any)?.firstName || (sender as any)?.title || 'Unknown'),
          content: msg.text || '[Media]',
          messageType: 'text',
          isOutgoing: isOutgoing,
          isRead: true,
          sentAt: new Date(msg.date * 1000).toISOString(),
        });
      }

      // Sort oldest first
      formattedMessages.sort((a, b) => 
        new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime()
      );

      this.messagesCache.set(chatId, formattedMessages);
      console.log(`[TelegramAdapter] Fetched ${formattedMessages.length} messages for ${chatId}`);
      
      return formattedMessages;
    } catch (error: any) {
      console.error('[TelegramAdapter] fetchMessages error:', error.message);
      return this.messagesCache.get(conversationId.replace('telegram_', '')) || [];
    }
  }

  /**
   * Send a message
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.client || !this.connected()) {
      return { success: false, error: 'Not connected to Telegram' };
    }

    try {
      const chatId = conversationId.replace('telegram_', '');
      const dialog = this.dialogsMap.get(chatId);
      
      const entity = dialog?.entity || await this.client.getEntity(chatId);
      if (!entity) {
        return { success: false, error: 'Chat not found' };
      }

      const result = await this.client.sendMessage(entity, { message: content });
      
      console.log('[TelegramAdapter] Message sent successfully');

      // Add to cache
      const newMessage: Message = {
        id: result.id.toString(),
        conversationId: conversationId,
        platformMessageId: result.id.toString(),
        senderId: this.userId || 'me',
        senderName: 'You',
        content: content,
        messageType: 'text',
        isOutgoing: true,
        isRead: true,
        sentAt: new Date().toISOString(),
      };

      const cached = this.messagesCache.get(chatId) || [];
      cached.push(newMessage);
      this.messagesCache.set(chatId, cached);

      // Update conversation
      const conv = this.conversationsCache.get(chatId);
      if (conv) {
        conv.lastMessage = content;
        conv.lastMessageAt = newMessage.sentAt;
        this.conversationsCache.set(chatId, conv);
      }

      return { success: true, messageId: result.id.toString() };
    } catch (error: any) {
      console.error('[TelegramAdapter] sendMessage error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark messages as read
   */
  async markAsRead(conversationId: string): Promise<void> {
    if (!this.client || !this.connected()) return;

    try {
      const chatId = conversationId.replace('telegram_', '');
      const dialog = this.dialogsMap.get(chatId);
      
      if (dialog?.entity) {
        await this.client.markAsRead(dialog.entity);
        console.log('[TelegramAdapter] Marked as read:', chatId);
      }
    } catch (error: any) {
      console.error('[TelegramAdapter] markAsRead error:', error.message);
    }
  }

  /**
   * Disconnect
   */
  async disconnect(): Promise<void> {
    if (this.client) {
      try {
        await this.client.disconnect();
      } catch (e) {
        // Ignore disconnect errors
      }
      this.client = null;
    }

    this.status = 'disconnected';
    this.userId = null;
    this.username = null;
    this.conversationsCache.clear();
    this.messagesCache.clear();
    this.dialogsMap.clear();

    console.log('[TelegramAdapter] Disconnected');
    this.emit('disconnected');
    this.emit('statusChange', { status: 'disconnected', message: 'Disconnected from Telegram' });
  }

  /**
   * Get session for persistence
   */
  getSession(): { sessionString: string; apiId: number; apiHash: string } | null {
    if (!this.sessionString || !this.credentials) return null;
    return {
      sessionString: this.sessionString,
      apiId: this.credentials.apiId,
      apiHash: this.credentials.apiHash,
    };
  }

  // Legacy method for browser login - redirect to proper flow
  async openLogin(): Promise<{ success: boolean; error?: string }> {
    this.status = 'awaiting_credentials';
    this.emit('statusChange', { 
      status: 'awaiting_credentials', 
      message: 'Enter your Telegram API credentials from my.telegram.org' 
    });
    return { success: false, error: 'Use setApiCredentials and startPhoneVerification instead' };
  }

  getCachedConversations(): Conversation[] {
    return Array.from(this.conversationsCache.values());
  }

  getCachedMessages(conversationId: string): Message[] {
    return this.messagesCache.get(conversationId.replace('telegram_', '')) || [];
  }
}

// Singleton
let telegramAdapter: TelegramAdapter | null = null;

export function getTelegramAdapter(): TelegramAdapter {
  if (!telegramAdapter) {
    telegramAdapter = new TelegramAdapter();
  }
  return telegramAdapter;
}
