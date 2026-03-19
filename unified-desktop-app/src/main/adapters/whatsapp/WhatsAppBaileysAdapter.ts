/**
 * WhatsApp Adapter using Baileys (Socket-based, no Puppeteer)
 * Fast, lightweight, production-grade implementation
 */

// Polyfill for globalThis.crypto (required by Baileys)
import { webcrypto } from 'crypto';
if (!globalThis.crypto) {
  (globalThis as any).crypto = webcrypto;
}

import { EventEmitter } from 'events';
import makeWASocket, {
  DisconnectReason,
  useMultiFileAuthState,
  fetchLatestBaileysVersion,
  makeCacheableSignalKeyStore,
  WASocket,
  ConnectionState as BaileysConnectionState,
} from '@whiskeysockets/baileys';
import { Boom } from '@hapi/boom';
import * as QRCode from 'qrcode';
import path from 'path';
import { app } from 'electron';
import { mkdirSync, existsSync, rmSync } from 'fs';

import type { Platform, Conversation, Message, SendMessageResponse } from '../../../shared/types.js';
import {
  ConnectionState,
  WhatsAppChat,
  WhatsAppMessage,
  toConversation,
  toMessage,
} from './whatsappTypes.js';
import {
  parseMessage,
  parseChat,
  getBackoffDelay,
} from './whatsappUtils.js';

// Silent logger for Baileys
const logger = {
  level: 'silent',
  info: () => {},
  error: () => {},
  warn: () => {},
  debug: () => {},
  trace: () => {},
  fatal: () => {},
  child: () => logger,
};

/**
 * WhatsApp Adapter - Baileys Implementation
 */
export class WhatsAppBaileysAdapter extends EventEmitter {
  readonly platform: Platform = 'whatsapp';

  private socket: WASocket | null = null;
  private connectionState: ConnectionState = 'OFFLINE';
  private qrCode: string | null = null;
  private phoneNumber: string | null = null;
  private reconnectAttempt: number = 0;
  private maxReconnectAttempts: number = 5;

  // Caches
  private chatsCache: Map<string, WhatsAppChat> = new Map();
  private messagesCache: Map<string, WhatsAppMessage[]> = new Map();
  private contactsCache: Map<string, any> = new Map();
  
  // Track processed message IDs to prevent duplicates
  private processedMessageIds: Set<string> = new Set();
  
  // Track if initial history sync is complete
  private initialSyncDone: boolean = false;
  private myJid: string = '';

  constructor() {
    super();
    console.log('[WhatsAppBaileys] Adapter initialized');
  }

  // ============================================
  // Public Getters
  // ============================================

  getStatus(): ConnectionState {
    return this.connectionState;
  }

  getQRCode(): string | null {
    return this.qrCode;
  }

  getPhoneNumber(): string | null {
    return this.phoneNumber;
  }

  connected(): boolean {
    return this.connectionState === 'CONNECTED' && this.socket !== null;
  }

  // ============================================
  // Connection Management
  // ============================================

  async connect(): Promise<{ success: boolean; status: ConnectionState; error?: string }> {
    if (this.connectionState === 'CONNECTING') {
      console.log('[WhatsAppBaileys] Already connecting...');
      return { success: true, status: this.connectionState };
    }

    if (this.connectionState === 'CONNECTED' && this.socket) {
      console.log('[WhatsAppBaileys] Already connected');
      return { success: true, status: this.connectionState };
    }

    try {
      this.setConnectionState('CONNECTING');
      console.log('[WhatsAppBaileys] Starting connection...');

      const authDir = path.join(app.getPath('userData'), 'whatsapp-baileys-auth');
      if (!existsSync(authDir)) {
        mkdirSync(authDir, { recursive: true });
      }

      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      console.log('[WhatsAppBaileys] Using WA version:', version.join('.'));

      this.socket = makeWASocket({
        version,
        auth: {
          creds: state.creds,
          keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        printQRInTerminal: false,
        logger,
        browser: ['Chat Orbitor', 'Desktop', '1.0.0'],
        syncFullHistory: true,
        markOnlineOnConnect: true,
      });

      this.setupEventHandlers(saveCreds);

      return { success: true, status: this.connectionState };
    } catch (error: any) {
      console.error('[WhatsAppBaileys] Connection error:', error.message);
      this.setConnectionState('OFFLINE');
      return { success: false, status: 'OFFLINE', error: error.message };
    }
  }

  private setupEventHandlers(saveCreds: () => Promise<void>): void {
    if (!this.socket) return;

    // Connection updates
    this.socket.ev.on('connection.update', async (update) => {
      await this.handleConnectionUpdate(update, saveCreds);
    });

    // Save credentials
    this.socket.ev.on('creds.update', saveCreds);

    // Chats from sync - chats.set gives initial batch
    this.socket.ev.on('chats.set' as any, (data: any) => {
      console.log(`[WhatsAppBaileys] ===== CHATS.SET EVENT: ${data?.chats?.length || 0} chats =====`);
      if (data?.chats) {
        this.handleChatsUpsert(data.chats);
      }
    });

    this.socket.ev.on('chats.upsert', (chats) => {
      this.handleChatsUpsert(chats);
    });

    this.socket.ev.on('chats.update', (updates) => {
      this.handleChatsUpdate(updates);
    });

    // Contacts
    this.socket.ev.on('contacts.upsert', (contacts) => {
      this.handleContactsUpsert(contacts);
    });

    // Messages
    this.socket.ev.on('messages.upsert', (data) => {
      this.handleMessagesUpsert(data);
    });

    this.socket.ev.on('messages.update', (updates) => {
      this.handleMessagesUpdate(updates);
    });

    // History sync - this is where we get all chats
    this.socket.ev.on('messaging-history.set', (data: { chats: any[]; contacts: any[]; messages: any[]; isLatest?: boolean }) => {
      console.log('[WhatsAppBaileys] ===== HISTORY SYNC EVENT FIRED =====');
      this.handleHistorySync(data);
    });
  }

  private async handleConnectionUpdate(
    update: Partial<BaileysConnectionState>,
    saveCreds: () => Promise<void>
  ): Promise<void> {
    const { connection, lastDisconnect, qr } = update;

    // QR Code
    if (qr) {
      console.log('[WhatsAppBaileys] QR code received');
      this.setConnectionState('QR_GENERATED');

      try {
        this.qrCode = await QRCode.toDataURL(qr, { width: 256 });
        console.log('[WhatsAppBaileys] QR converted, emitting...');
        this.emit('qrCode', { qrCode: this.qrCode });
        this.emit('statusChange', {
          status: 'qr_ready',
          qrCode: this.qrCode,
          message: 'Scan QR code with WhatsApp',
        });
      } catch (err: any) {
        console.error('[WhatsAppBaileys] QR error:', err.message);
        this.qrCode = qr;
        this.emit('qrCode', { qrCode: this.qrCode });
      }
    }

    // Connected
    if (connection === 'open') {
      console.log('[WhatsAppBaileys] Connected!');
      this.setConnectionState('CONNECTED');
      this.qrCode = null;
      this.reconnectAttempt = 0;

      this.myJid = this.socket?.user?.id || '';
      this.phoneNumber = this.myJid.split(':')[0] || this.myJid.split('@')[0] || 'Unknown';

      this.emit('connected');
      this.emit('statusChange', {
        status: 'connected',
        phoneNumber: this.phoneNumber,
        message: 'WhatsApp connected! Syncing chats...',
      });

      await saveCreds();
      
      // Wait longer for history sync
      setTimeout(() => {
        if (this.chatsCache.size > 0) {
          console.log(`[WhatsAppBaileys] Emitting ${this.chatsCache.size} chats after connection`);
          this.emitChatsToUI();
        } else {
          console.log('[WhatsAppBaileys] No chats in cache yet, waiting for history sync...');
        }
      }, 5000);
    }

    // Disconnected
    if (connection === 'close') {
      const statusCode = (lastDisconnect?.error as Boom)?.output?.statusCode;
      console.log('[WhatsAppBaileys] Disconnected, code:', statusCode);

      if (statusCode === DisconnectReason.loggedOut || statusCode === 401) {
        // Bad session - clear and reconnect
        console.log('[WhatsAppBaileys] Session invalid, clearing...');
        
        this.setConnectionState('OFFLINE');
        this.socket = null;
        this.reconnectAttempt = 0;
        this.clearLocalData();
        
        const authDir = path.join(app.getPath('userData'), 'whatsapp-baileys-auth');
        try {
          if (existsSync(authDir)) {
            rmSync(authDir, { recursive: true, force: true });
            console.log('[WhatsAppBaileys] Auth cleared');
          }
        } catch (e) {
          console.error('[WhatsAppBaileys] Clear auth error:', e);
        }
        
        this.emit('statusChange', {
          status: 'connecting',
          message: 'Session expired. Generating new QR...',
        });
        
        setTimeout(() => this.connect(), 1500);
      } else if (this.reconnectAttempt < this.maxReconnectAttempts) {
        this.reconnectAttempt++;
        const delay = getBackoffDelay(this.reconnectAttempt);
        
        console.log(`[WhatsAppBaileys] Reconnecting in ${Math.round(delay/1000)}s...`);
        
        this.emit('statusChange', {
          status: 'connecting',
          message: `Reconnecting in ${Math.round(delay/1000)}s...`,
        });

        setTimeout(() => this.connect(), delay);
      } else {
        this.setConnectionState('OFFLINE');
        this.emit('statusChange', {
          status: 'disconnected',
          message: 'Connection failed.',
        });
      }
    }
  }

  /**
   * Handle history sync - this gives us all chats
   */
  private handleHistorySync(data: { chats: any[]; contacts: any[]; messages: any[]; isLatest?: boolean }): void {
    console.log(`[WhatsAppBaileys] History sync: ${data.chats?.length || 0} chats, ${data.contacts?.length || 0} contacts, ${data.messages?.length || 0} messages`);
    
    // Process contacts FIRST - cache all
    if (data.contacts && data.contacts.length > 0) {
      for (const contact of data.contacts) {
        this.contactsCache.set(contact.id, contact);
      }
    }
    
    // Process chats with contact names
    if (data.chats && data.chats.length > 0) {
      for (const chat of data.chats) {
        if (chat.id === 'status@broadcast') continue;
        
        const parsed = parseChat(chat);
        if (parsed.id) {
          // Apply contact name if available
          const contact = this.contactsCache.get(parsed.id);
          if (contact?.notify || contact?.name) {
            parsed.name = contact.notify || contact.name;
          }
          this.chatsCache.set(parsed.id, parsed);
        }
      }
      console.log(`[WhatsAppBaileys] Cached ${this.chatsCache.size} chats`);
    }
    
    // Process messages - update last message AND apply contact names
    if (data.messages && data.messages.length > 0) {
      for (const msg of data.messages) {
        const parsed = parseMessage(msg, this.myJid);
        if (!parsed || !parsed.chatId) continue;
        
        // Apply contact name to sender if available
        if (!parsed.isOutgoing) {
          const contact = this.contactsCache.get(parsed.senderId);
          if (contact?.notify || contact?.name) {
            parsed.senderName = contact.notify || contact.name;
          }
        }
        
        const chat = this.chatsCache.get(parsed.chatId);
        if (chat) {
          if (!chat.lastMessageTime || parsed.timestamp > chat.lastMessageTime) {
            chat.lastMessage = parsed.content;
            chat.lastMessageTime = parsed.timestamp;
            this.chatsCache.set(parsed.chatId, chat);
          }
        }
        
        const chatMessages = this.messagesCache.get(parsed.chatId) || [];
        if (!this.processedMessageIds.has(parsed.id)) {
          chatMessages.push(parsed);
          this.processedMessageIds.add(parsed.id);
        }
        this.messagesCache.set(parsed.chatId, chatMessages);
      }
    }
    
    this.initialSyncDone = true;
    console.log(`[WhatsAppBaileys] History sync complete. Total chats: ${this.chatsCache.size}`);
  }

  private handleChatsUpsert(chats: any[]): void {
    console.log(`[WhatsAppBaileys] Chats upsert: ${chats.length}`);

    for (const chat of chats) {
      if (chat.id === 'status@broadcast') continue;
      
      const parsed = parseChat(chat);
      if (parsed.id) {
        // Merge with existing if we have contact name
        const existing = this.chatsCache.get(parsed.id);
        if (existing && existing.name && existing.name !== 'Unknown') {
          parsed.name = existing.name;
        }
        this.chatsCache.set(parsed.id, parsed);
      }
    }

    if (this.chatsCache.size > 0) {
      this.emitChatsToUI();
    }
  }

  private handleChatsUpdate(updates: any[]): void {
    for (const update of updates) {
      if (!update.id || update.id === 'status@broadcast') continue;
      
      const existing = this.chatsCache.get(update.id);
      if (existing) {
        // Update only changed fields
        if (update.unreadCount !== undefined) {
          existing.unreadCount = update.unreadCount;
        }
        if (update.conversationTimestamp) {
          existing.lastMessageTime = update.conversationTimestamp * 1000;
        }
        this.chatsCache.set(update.id, existing);
      }
    }
  }

  private handleContactsUpsert(contacts: any[]): void {
    // Just cache contacts, don't emit chats on every contact update
    for (const contact of contacts) {
      this.contactsCache.set(contact.id, contact);
      
      const chat = this.chatsCache.get(contact.id);
      if (chat && contact.notify) {
        chat.name = contact.notify;
        this.chatsCache.set(contact.id, chat);
      }
    }
  }

  /**
   * Handle new messages - ONLY emit notifications for real-time messages
   */
  private handleMessagesUpsert(data: { messages: any[]; type: string }): void {
    const { messages, type } = data;
    
    // type === 'notify' means real-time message
    // type === 'append' means history/sync message
    const isRealTime = type === 'notify';
    
    console.log(`[WhatsAppBaileys] Messages: ${messages.length}, type: ${type}, realtime: ${isRealTime}`);

    for (const msg of messages) {
      const parsed = parseMessage(msg, this.myJid);
      if (!parsed || !parsed.chatId) continue;
      
      // Skip if already processed
      if (this.processedMessageIds.has(parsed.id)) continue;
      this.processedMessageIds.add(parsed.id);
      
      // Skip status broadcasts
      if (parsed.chatId === 'status@broadcast') continue;

      // Create or update chat
      let chat = this.chatsCache.get(parsed.chatId);
      if (!chat) {
        const isGroup = parsed.chatId.endsWith('@g.us');
        chat = {
          id: parsed.chatId,
          name: parsed.senderName || parsed.chatId.split('@')[0]?.split(':')[0] || 'Unknown',
          isGroup,
          unreadCount: 0,
          lastMessageTime: parsed.timestamp,
          lastMessage: parsed.content,
        };
      }
      
      // Update chat
      chat.lastMessage = parsed.content;
      chat.lastMessageTime = parsed.timestamp;
      
      // Only increment unread for incoming real-time messages
      if (!parsed.isOutgoing && isRealTime) {
        chat.unreadCount = (chat.unreadCount || 0) + 1;
      }
      
      this.chatsCache.set(parsed.chatId, chat);

      // Cache message
      const chatMessages = this.messagesCache.get(parsed.chatId) || [];
      chatMessages.push(parsed);
      this.messagesCache.set(parsed.chatId, chatMessages);

      // ONLY emit notification for real-time incoming messages
      if (isRealTime && !parsed.isOutgoing) {
        console.log(`[WhatsAppBaileys] New message from ${parsed.senderName}: ${parsed.content.substring(0, 30)}`);
        
        this.emit('newMessage', {
          platform: 'whatsapp',
          conversationId: `whatsapp_${parsed.chatId}`,
          message: toMessage(parsed, parsed.chatId),
        });
      }
    }
    
    // Update UI
    if (this.chatsCache.size > 0) {
      this.emitChatsToUI();
    }
  }

  private handleMessagesUpdate(updates: any[]): void {
    for (const update of updates) {
      if (update.update?.status) {
        this.emit('messageAck', {
          messageId: update.key?.id,
          status: update.update.status,
        });
      }
    }
  }

  // ============================================
  // Data Fetching
  // ============================================

  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected');
    }

    // ONLY show chats that have actual messages
    const validChats = Array.from(this.chatsCache.values())
      .filter(c => {
        if (!c.id || c.id === 'status@broadcast') return false;
        // Skip newsletter/channel broadcasts
        if (c.id.includes('@newsletter')) return false;
        // MUST have at least one message OR be a group
        const hasMessages = this.messagesCache.has(c.id) && this.messagesCache.get(c.id)!.length > 0;
        return hasMessages || c.isGroup;
      })
      .map(toConversation)
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    // Fetch profile pictures for top 20 chats
    const top20 = validChats.slice(0, 20);
    await Promise.all(top20.map(async (chat) => {
      try {
        const chatId = chat.id.replace('whatsapp_', '');
        const ppUrl = await this.socket?.profilePictureUrl(chatId, 'image');
        if (ppUrl) {
          chat.participantAvatarUrl = ppUrl;
        }
      } catch (e) {
        // No profile pic available
      }
    }));

    console.log(`[WhatsAppBaileys] Returning ${validChats.length} chats with messages (filtered from ${this.chatsCache.size})`);
    return validChats;
  }

  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected() || !this.socket) {
      throw new Error('Not connected');
    }

    // conversationId is already cleaned by main.ts (no whatsapp_ prefix)
    const cached = this.messagesCache.get(conversationId);
    
    if (cached && cached.length > 0) {
      console.log(`[WhatsAppBaileys] Returning ${cached.length} cached messages for ${conversationId}`);
      return cached
        .sort((a, b) => a.timestamp - b.timestamp)
        .map(m => toMessage(m, conversationId));
    }

    console.log(`[WhatsAppBaileys] No cached messages found for ${conversationId}`);
    return [];
  }

  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected() || !this.socket) {
      return { success: false, error: 'Not connected' };
    }

    // conversationId is already cleaned by main.ts (no whatsapp_ prefix)

    try {
      const result = await this.socket.sendMessage(conversationId, { text: content });

      return {
        success: true,
        messageId: result?.key?.id,
        sentAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[WhatsAppBaileys] Send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Disconnect & Cleanup
  // ============================================

  async disconnect(): Promise<void> {
    console.log('[WhatsAppBaileys] Disconnecting...');
    this.setConnectionState('DISCONNECTING');

    try {
      if (this.socket) {
        this.socket.end(undefined);
        this.socket = null;
      }
    } catch (error: any) {
      console.error('[WhatsAppBaileys] Disconnect error:', error.message);
    }

    this.clearLocalData();
    this.setConnectionState('OFFLINE');
    this.emit('disconnected');
  }

  private clearLocalData(): void {
    this.chatsCache.clear();
    this.messagesCache.clear();
    this.contactsCache.clear();
    this.processedMessageIds.clear();
    this.qrCode = null;
    this.phoneNumber = null;
    this.initialSyncDone = false;
  }

  private setConnectionState(state: ConnectionState): void {
    this.connectionState = state;
    console.log(`[WhatsAppBaileys] State: ${state}`);
  }

  private async emitChatsToUI(): Promise<void> {
    // ONLY emit chats that have actual messages
    const validChats = Array.from(this.chatsCache.values())
      .filter(c => {
        if (!c.id || c.id === 'status@broadcast') return false;
        // Skip newsletter/channel broadcasts
        if (c.id.includes('@newsletter')) return false;
        // MUST have messages OR be a group
        const hasMessages = this.messagesCache.has(c.id) && this.messagesCache.get(c.id)!.length > 0;
        return hasMessages || c.isGroup;
      })
      .map(c => {
        const conv = toConversation(c);
        // Apply contact name if available
        const contact = this.contactsCache.get(c.id);
        if (contact?.notify || contact?.name) {
          conv.participantName = contact.notify || contact.name;
        }
        return conv;
      })
      .sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());

    // Fetch profile pictures for top 20 chats
    const top20 = validChats.slice(0, 20);
    await Promise.all(top20.map(async (chat) => {
      try {
        const chatId = chat.id.replace('whatsapp_', '');
        const ppUrl = await this.socket?.profilePictureUrl(chatId, 'image');
        if (ppUrl) chat.participantAvatarUrl = ppUrl;
      } catch (e) {}
    }));

    console.log(`[WhatsAppBaileys] Emitting ${validChats.length} chats to UI (filtered from ${this.chatsCache.size})`);
    this.emit('chatsReady', { conversations: validChats });
  }

  getCachedConversations(): Conversation[] {
    return Array.from(this.chatsCache.values())
      .filter(c => c.id && c.id !== 'status@broadcast')
      .map(toConversation);
  }

  getCachedMessages(conversationId: string): Message[] {
    // conversationId may or may not have whatsapp_ prefix
    const chatId = conversationId.replace('whatsapp_', '');
    const cached = this.messagesCache.get(chatId) || [];
    return cached.map(m => toMessage(m, chatId));
  }
}

// Singleton
let adapter: WhatsAppBaileysAdapter | null = null;

export function getWhatsAppBaileysAdapter(): WhatsAppBaileysAdapter {
  if (!adapter) {
    adapter = new WhatsAppBaileysAdapter();
  }
  return adapter;
}
