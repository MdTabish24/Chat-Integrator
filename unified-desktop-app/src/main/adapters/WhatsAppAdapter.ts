import { EventEmitter } from 'events';
import { app } from 'electron';
import path from 'path';
import type { 
  Platform, 
  Conversation, 
  Message, 
  SendMessageResponse 
} from '../../shared/types.js';

/**
 * WhatsApp Platform Adapter
 * Uses whatsapp-web.js library for QR code authentication
 * Implements real-time message events
 */

// Types for whatsapp-web.js (dynamic import)
interface WhatsAppClient {
  on: (event: string, callback: (...args: any[]) => void) => void;
  initialize: () => Promise<void>;
  destroy: () => Promise<void>;
  getChats: () => Promise<any[]>;
  getChatById: (chatId: string) => Promise<any>;
  sendMessage: (chatId: string, content: string) => Promise<any>;
  info?: {
    wid?: {
      user?: string;
    };
  };
}

type WhatsAppStatus = 'disconnected' | 'connecting' | 'qr_ready' | 'connected' | 'error';

export class WhatsAppAdapter extends EventEmitter {
  readonly platform: Platform = 'whatsapp';
  
  private client: WhatsAppClient | null = null;
  private status: WhatsAppStatus = 'disconnected';
  private qrCode: string | null = null;
  private phoneNumber: string | null = null;
  
  // Cache for conversations and messages
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  private lastFetchTime: number = 0;

  constructor() {
    super();
  }

  /**
   * Get current status
   */
  getStatus(): WhatsAppStatus {
    return this.status;
  }

  /**
   * Get QR code for scanning
   */
  getQRCode(): string | null {
    return this.qrCode;
  }

  /**
   * Get connected phone number
   */
  getPhoneNumber(): string | null {
    return this.phoneNumber;
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.status === 'connected' && this.client !== null;
  }

  /**
   * Initialize WhatsApp client and start authentication
   */
  async connect(forceNew: boolean = false): Promise<{ success: boolean; status: WhatsAppStatus; error?: string }> {
    // If force new, destroy existing client first
    if (forceNew && this.client) {
      console.log('[WhatsAppAdapter] Force reconnect - destroying existing client');
      try {
        await this.client.destroy();
      } catch (e) {
        // Ignore destroy errors
      }
      this.client = null;
      this.status = 'disconnected';
    }

    // Check if already connecting or connected
    if (this.status === 'connecting') {
      console.log('[WhatsAppAdapter] Already connecting, waiting...');
      return { success: true, status: this.status };
    }
    
    if (this.status === 'connected' && this.client) {
      console.log('[WhatsAppAdapter] Already connected');
      return { success: true, status: this.status };
    }

    try {
      // Dynamically require whatsapp-web.js - handle both ESM and CJS exports
      const wwjs = await import('whatsapp-web.js');
      const Client = wwjs.Client || (wwjs as any).default?.Client;
      const LocalAuth = wwjs.LocalAuth || (wwjs as any).default?.LocalAuth;
      
      if (!Client || !LocalAuth) {
        throw new Error('Could not load whatsapp-web.js Client or LocalAuth');
      }
      
      const qrcodeModule = await import('qrcode');
      const qrcode = qrcodeModule.default || qrcodeModule;

      this.status = 'connecting';
      console.log('[WhatsAppAdapter] Initializing WhatsApp client...');
      
      this.emit('statusChange', { status: 'connecting', message: 'Initializing WhatsApp...' });

      // Get Chrome/Chromium executable path
      let chromePath: string | undefined = undefined;
      
      if (app.isPackaged) {
        // In packaged app, use Electron's bundled Chromium (most reliable for production)
        // This reuses Electron's Chromium - no extra download needed
        const electronPath = process.execPath;
        const electronDir = path.dirname(electronPath);
        
        // Try to find Electron's Chromium (varies by platform)
        const possibleElectronChrome = [
          path.join(electronDir, 'chrome.exe'), // Some Electron builds
          path.join(electronDir, 'resources', 'app.asar.unpacked', 'node_modules', 'puppeteer', '.local-chromium'),
        ];
        
        // Fallback to system browsers (Chrome/Edge)
        const systemBrowsers = [
          // Windows Chrome paths
          'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
          'C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe',
          process.env.LOCALAPPDATA ? path.join(process.env.LOCALAPPDATA, 'Google\\Chrome\\Application\\chrome.exe') : '',
          // Edge as fallback (pre-installed on Windows 10/11)
          'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
          'C:\\Program Files\\Microsoft\\Edge\\Application\\msedge.exe',
        ].filter(Boolean);
        
        const fs = await import('fs');
        
        // First try system browsers
        for (const p of systemBrowsers) {
          if (p && fs.existsSync(p)) {
            chromePath = p;
            console.log('[WhatsAppAdapter] Using system browser:', chromePath);
            break;
          }
        }
        
        if (!chromePath) {
          // Edge is pre-installed on Windows 10/11, so this should rarely happen
          throw new Error('No compatible browser found. Please install Google Chrome or Microsoft Edge.');
        }
      }
      // In development, let Puppeteer use its bundled Chromium (chromePath = undefined)

      // Create WhatsApp client with local authentication
      this.client = new Client({
        authStrategy: new LocalAuth({
          dataPath: path.join(app.getPath('userData'), 'whatsapp-session')
        }),
        puppeteer: {
          headless: true,
          executablePath: chromePath, // undefined in dev (uses bundled), system browser in production
          args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--disable-gpu',
            '--window-size=1280,800'
          ]
        }
      }) as WhatsAppClient;

      // QR Code event - user needs to scan
      this.client.on('qr', async (qr: string) => {
        console.log('[WhatsAppAdapter] QR code received');
        this.status = 'qr_ready';

        try {
          // Handle both ESM and CJS qrcode exports
          const toDataURL = qrcode.toDataURL || (qrcode as any).default?.toDataURL;
          if (toDataURL) {
            this.qrCode = await toDataURL(qr, { width: 256 });
          } else {
            this.qrCode = qr; // Fallback to raw QR string
          }
          console.log('[WhatsAppAdapter] QR code generated');
          
          this.emit('qrCode', { qrCode: this.qrCode });
          this.emit('statusChange', { 
            status: 'qr_ready', 
            qrCode: this.qrCode,
            message: 'Scan QR code with WhatsApp' 
          });
        } catch (err: any) {
          console.error('[WhatsAppAdapter] QR generation error:', err);
          this.qrCode = qr; // Use raw QR on error
          this.emit('qrCode', { qrCode: this.qrCode });
        }
      });

      // Ready event - connected successfully
      this.client.on('ready', async () => {
        console.log('[WhatsAppAdapter] Connected successfully!');
        this.status = 'connected';
        this.qrCode = null;

        // Get user info
        this.phoneNumber = this.client?.info?.wid?.user || 'Unknown';

        this.emit('connected');
        this.emit('statusChange', { 
          status: 'connected', 
          phoneNumber: this.phoneNumber,
          message: 'WhatsApp connected!' 
        });

        // Pre-fetch chats in background (don't block UI)
        console.log('[WhatsAppAdapter] Starting background chat fetch...');
        this.fetchConversations().then(convs => {
          console.log(`[WhatsAppAdapter] Background fetch complete: ${convs.length} chats cached`);
        }).catch(err => {
          console.error('[WhatsAppAdapter] Background fetch error:', err.message);
        });
      });

      // Listen for incoming messages (real-time)
      this.client.on('message', async (msg: any) => {
        console.log('[WhatsAppAdapter] 📩 New message received');
        await this.handleIncomingMessage(msg, false);
      });

      // Listen for sent messages (real-time)
      this.client.on('message_create', async (msg: any) => {
        if (msg.fromMe) {
          console.log('[WhatsAppAdapter] 📤 Message sent');
          await this.handleIncomingMessage(msg, true);
        }
      });

      // Listen for message acknowledgement
      this.client.on('message_ack', async (msg: any, ack: number) => {
        const ackStatus = ['ERROR', 'SENT', 'DELIVERED', 'READ'][ack] || 'UNKNOWN';
        console.log(`[WhatsAppAdapter] Message status: ${ackStatus}`);
        
        this.emit('messageAck', { 
          messageId: msg.id?._serialized, 
          status: ackStatus 
        });
      });

      // Authentication failure
      this.client.on('auth_failure', async (msg: string) => {
        console.error('[WhatsAppAdapter] Authentication failed:', msg);
        this.status = 'error';
        
        // Clear session on auth failure
        try {
          const sessionPath = path.join(app.getPath('userData'), 'whatsapp-session');
          const fs = await import('fs');
          if (fs.existsSync(sessionPath)) {
            console.log('[WhatsAppAdapter] Clearing corrupted session...');
            fs.rmSync(sessionPath, { recursive: true, force: true });
          }
        } catch (e) {
          console.error('[WhatsAppAdapter] Failed to clear session:', e);
        }
        
        this.emit('error', { platform: 'whatsapp', error: 'Authentication failed' });
        this.emit('statusChange', { 
          status: 'error', 
          message: 'Authentication failed. Please try again.' 
        });
      });

      // Disconnected
      this.client.on('disconnected', (reason: string) => {
        console.log('[WhatsAppAdapter] Disconnected:', reason);
        this.status = 'disconnected';
        this.phoneNumber = null;
        
        this.emit('disconnected');
        this.emit('statusChange', { 
          status: 'disconnected', 
          message: 'WhatsApp disconnected: ' + reason 
        });
      });

      // Initialize the client
      await this.client.initialize();

      return { success: true, status: this.status };

    } catch (error: any) {
      console.error('[WhatsAppAdapter] Init error:', error.message);
      this.status = 'error';

      let errorMessage = 'WhatsApp init failed: ' + error.message;
      
      if (error.message.includes("Cannot find module 'whatsapp-web.js'")) {
        errorMessage = 'WhatsApp module not installed. Run: npm install whatsapp-web.js qrcode';
      }

      this.emit('error', { platform: 'whatsapp', error: errorMessage });
      this.emit('statusChange', { status: 'error', message: errorMessage });

      return { success: false, status: 'error', error: errorMessage };
    }
  }

  /**
   * Handle incoming/outgoing message
   */
  private async handleIncomingMessage(msg: any, isFromMe: boolean): Promise<void> {
    try {
      const chatId = isFromMe ? msg.to : msg.from;
      const chat = await this.client?.getChatById(chatId);
      const chatName = chat?.name || chat?.pushname || chatId?.split('@')[0] || 'Unknown';

      const message: Message = {
        id: msg.id?._serialized || msg.id?.id || `msg_${Date.now()}`,
        conversationId: chat?.id?._serialized || chatId,
        platformMessageId: msg.id?._serialized,
        senderId: msg.from || '',
        senderName: isFromMe ? 'You' : (msg._data?.notifyName || chatName),
        content: msg.body || (msg.hasMedia ? '[Media]' : ''),
        messageType: msg.hasMedia ? 'file' : 'text',
        isOutgoing: isFromMe,
        isRead: false,
        sentAt: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
      };

      // Update cache
      const convId = chat?.id?._serialized || chatId;
      const existingMessages = this.messagesCache.get(convId) || [];
      existingMessages.push(message);
      this.messagesCache.set(convId, existingMessages);

      // Emit new message event
      this.emit('newMessage', {
        platform: 'whatsapp',
        conversationId: `whatsapp_${convId}`,
        message,
      });

    } catch (error: any) {
      console.error('[WhatsAppAdapter] Handle message error:', error.message);
    }
  }

  /**
   * Disconnect from WhatsApp
   */
  async disconnect(): Promise<void> {
    try {
      if (this.client) {
        await this.client.destroy();
        this.client = null;
      }
    } catch (error: any) {
      console.error('[WhatsAppAdapter] Destroy error:', error.message);
    }

    this.status = 'disconnected';
    this.qrCode = null;
    this.phoneNumber = null;
    this.conversationsCache.clear();
    this.messagesCache.clear();

    console.log('[WhatsAppAdapter] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Fetch all conversations (chats) - with caching
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected() || !this.client) {
      throw new Error('Not connected to WhatsApp');
    }

    // Return cached if available and fresh (less than 5 MINUTES old)
    if (this.conversationsCache.size > 0 && this.lastFetchTime && 
        (Date.now() - this.lastFetchTime) < 300000) {
      console.log(`[WhatsAppAdapter] Returning ${this.conversationsCache.size} cached conversations`);
      return Array.from(this.conversationsCache.values());
    }

    try {
      const startTime = Date.now();
      console.log('[WhatsAppAdapter] Fetching chats...');
      
      const chats = await this.client.getChats();
      console.log(`[WhatsAppAdapter] getChats() took ${Date.now() - startTime}ms - found ${chats.length} chats`);

      const conversations: Conversation[] = [];

      // Process ALL chats since getChats() already fetched them
      for (const chat of chats) {
        try {
          const chatName = chat.name || (chat as any).pushname || chat.id?.user || 'Unknown';
          const chatId = chat.id?._serialized || '';
          
          // Get last message from chat object directly (no extra API call)
          const lastMsg = (chat as any).lastMessage;
          const lastMessageContent = lastMsg?.body || lastMsg?._data?.body || '';
          const lastMessageTime = lastMsg?.timestamp 
            ? new Date(lastMsg.timestamp * 1000).toISOString() 
            : new Date().toISOString();

          const conversation: Conversation = {
            id: `whatsapp_${chatId}`,
            platform: 'whatsapp',
            platformConversationId: chatId,
            participantName: chatName,
            participantId: chatId,
            participantAvatarUrl: undefined,
            lastMessage: lastMessageContent || 'No messages',
            lastMessageAt: lastMessageTime,
            unreadCount: chat.unreadCount || 0,
          };

          conversations.push(conversation);
          this.conversationsCache.set(chatId, conversation);

        } catch (chatErr: any) {
          console.error(`[WhatsAppAdapter] Error processing chat: ${chatErr.message}`);
          continue;
        }
      }

      // Sort by last message time
      conversations.sort((a, b) => 
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );

      // Update last fetch time for caching
      this.lastFetchTime = Date.now();

      console.log(`[WhatsAppAdapter] Processed ${conversations.length} chats (${Date.now() - startTime}ms)`);
      return conversations;

    } catch (error: any) {
      console.error('[WhatsAppAdapter] fetchConversations error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch messages for a specific conversation - loads on demand
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected() || !this.client) {
      throw new Error('Not connected to WhatsApp');
    }

    // Return cached messages if available
    const cached = this.messagesCache.get(conversationId);
    if (cached && cached.length > 0) {
      console.log(`[WhatsAppAdapter] Returning ${cached.length} cached messages for ${conversationId}`);
      return cached;
    }

    // Fetch messages for this specific chat
    try {
      console.log(`[WhatsAppAdapter] Fetching messages for ${conversationId}...`);
      const startTime = Date.now();
      
      const chat = await this.client.getChatById(conversationId);
      if (!chat) {
        console.log(`[WhatsAppAdapter] Chat not found: ${conversationId}`);
        return [];
      }

      const messages = await chat.fetchMessages({ limit: 50 });
      const chatName = chat.name || (chat as any).pushname || chat.id?.user || 'Unknown';

      const parsedMessages: Message[] = messages.map((msg: any) => ({
        id: msg.id?._serialized || msg.id?.id || `msg_${Date.now()}`,
        conversationId: conversationId,
        platformMessageId: msg.id?._serialized,
        senderId: msg.from || '',
        senderName: msg.fromMe ? 'You' : (msg._data?.notifyName || chatName),
        content: msg.body || (msg.hasMedia ? '[Media]' : ''),
        messageType: msg.hasMedia ? 'file' : 'text',
        isOutgoing: msg.fromMe || false,
        isRead: true,
        sentAt: msg.timestamp ? new Date(msg.timestamp * 1000).toISOString() : new Date().toISOString(),
      }));

      // Sort messages oldest first
      parsedMessages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

      // Cache messages
      this.messagesCache.set(conversationId, parsedMessages);

      console.log(`[WhatsAppAdapter] Fetched ${parsedMessages.length} messages (${Date.now() - startTime}ms)`);
      return parsedMessages;

    } catch (error: any) {
      console.error(`[WhatsAppAdapter] fetchMessages error: ${error.message}`);
      return [];
    }
  }

  /**
   * Send a message
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected() || !this.client) {
      return { success: false, error: 'Not connected to WhatsApp' };
    }

    try {
      const result = await this.client.sendMessage(conversationId, content);
      
      return {
        success: true,
        messageId: result.id?._serialized,
        sentAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[WhatsAppAdapter] sendMessage error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Get cached conversations
   */
  getCachedConversations(): Conversation[] {
    return Array.from(this.conversationsCache.values());
  }

  /**
   * Get cached messages for a conversation
   */
  getCachedMessages(conversationId: string): Message[] {
    return this.messagesCache.get(conversationId) || [];
  }
}

// Export singleton instance
let whatsappAdapter: WhatsAppAdapter | null = null;

export function getWhatsAppAdapter(): WhatsAppAdapter {
  if (!whatsappAdapter) {
    whatsappAdapter = new WhatsAppAdapter();
  }
  return whatsappAdapter;
}
