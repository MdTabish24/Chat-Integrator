import { EventEmitter } from 'events';
import https from 'https';
import { BrowserWindow, session } from 'electron';
import type { 
  Platform, 
  Conversation, 
  Message, 
  SendMessageResponse,
  PlatformCredentials 
} from '../../shared/types.js';

/**
 * Discord Platform Adapter
 * Uses Discord REST API + Gateway WebSocket for real-time
 * Token-based authentication (user token)
 */

// Discord API constants
const DISCORD_API_BASE = 'https://discord.com/api/v10';
const DISCORD_GATEWAY_URL = 'wss://gateway.discord.gg/?v=10&encoding=json';

// Gateway opcodes
const GatewayOpcodes = {
  DISPATCH: 0,
  HEARTBEAT: 1,
  IDENTIFY: 2,
  PRESENCE_UPDATE: 3,
  VOICE_STATE_UPDATE: 4,
  RESUME: 6,
  RECONNECT: 7,
  REQUEST_GUILD_MEMBERS: 8,
  INVALID_SESSION: 9,
  HELLO: 10,
  HEARTBEAT_ACK: 11,
};

type DiscordStatus = 'disconnected' | 'connecting' | 'connected' | 'error';

interface DiscordUser {
  id: string;
  username: string;
  global_name?: string;
  avatar?: string;
  discriminator?: string;
}

interface DiscordChannel {
  id: string;
  type: number;
  recipients?: DiscordUser[];
  name?: string;
  icon?: string;
  last_message_id?: string;
}

interface DiscordMessage {
  id: string;
  channel_id: string;
  author: DiscordUser;
  content: string;
  timestamp: string;
  attachments?: any[];
  embeds?: any[];
}

export class DiscordAdapter extends EventEmitter {
  readonly platform: Platform = 'discord';
  
  private token: string | null = null;
  private userId: string | null = null;
  private username: string | null = null;
  private status: DiscordStatus = 'disconnected';
  private loginWindow: BrowserWindow | null = null;
  
  // WebSocket for Gateway
  private ws: WebSocket | null = null;
  private heartbeatInterval: NodeJS.Timeout | null = null;
  private lastSequence: number | null = null;
  private sessionId: string | null = null;
  private resumeGatewayUrl: string | null = null;
  
  // Cache for conversations and messages
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  
  // Rate limiting
  private lastFetchTime: number = 0;
  private readonly MIN_FETCH_INTERVAL = 5000; // 5 seconds

  constructor() {
    super();
  }

  /**
   * Get current status
   */
  getStatus(): DiscordStatus {
    return this.status;
  }

  /**
   * Get user ID
   */
  getUserId(): string | null {
    return this.userId;
  }

  /**
   * Get username
   */
  getUsername(): string | null {
    return this.username;
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.status === 'connected' && this.token !== null;
  }

  /**
   * Connect with token
   */
  async connect(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    if (!credentials.token) {
      return { success: false, error: 'Discord token is required' };
    }

    try {
      this.status = 'connecting';
      this.token = credentials.token;
      console.log('[DiscordAdapter] Connecting with token...');
      
      this.emit('statusChange', { status: 'connecting', message: 'Connecting to Discord...' });

      // Verify token by fetching current user
      const user = await this.makeRequest<DiscordUser>('GET', '/users/@me');
      
      if (!user || !user.id) {
        this.status = 'error';
        this.token = null;
        return { success: false, error: 'Invalid Discord token' };
      }

      this.userId = user.id;
      this.username = user.global_name || user.username;
      this.status = 'connected';
      
      console.log(`[DiscordAdapter] Connected as ${this.username} (${this.userId})`);
      
      this.emit('connected');
      this.emit('statusChange', { 
        status: 'connected', 
        username: this.username,
        message: 'Discord connected!' 
      });

      // Connect to Gateway for real-time events
      this.connectGateway();

      return { 
        success: true, 
        userId: this.userId, 
        username: this.username 
      };

    } catch (error: any) {
      console.error('[DiscordAdapter] Connect error:', error.message);
      this.status = 'error';
      this.token = null;
      
      let errorMessage = error.message;
      if (error.message.includes('401') || error.message.includes('403')) {
        errorMessage = 'Invalid or expired Discord token';
      }

      this.emit('error', { platform: 'discord', error: errorMessage });
      this.emit('statusChange', { status: 'error', message: errorMessage });

      return { success: false, error: errorMessage };
    }
  }

  /**
   * Make HTTP request to Discord API
   */
  private async makeRequest<T>(method: string, endpoint: string, body?: any): Promise<T> {
    return new Promise((resolve, reject) => {
      const url = new URL(`${DISCORD_API_BASE}${endpoint}`);
      
      const options: https.RequestOptions = {
        hostname: url.hostname,
        path: url.pathname + url.search,
        method,
        headers: {
          'Authorization': this.token!,
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        },
      };

      const req = https.request(options, (res) => {
        let data = '';
        
        res.on('data', (chunk) => {
          data += chunk;
        });
        
        res.on('end', () => {
          if (res.statusCode === 429) {
            // Rate limited
            const retryAfter = JSON.parse(data).retry_after || 5;
            reject(new Error(`Rate limited. Retry after ${retryAfter}s`));
            return;
          }
          
          if (res.statusCode && res.statusCode >= 400) {
            reject(new Error(`Discord API error: ${res.statusCode} - ${data}`));
            return;
          }
          
          if (res.statusCode === 204 || !data) {
            resolve(null as T);
            return;
          }
          
          try {
            resolve(JSON.parse(data));
          } catch {
            reject(new Error('Invalid JSON response'));
          }
        });
      });

      req.on('error', reject);
      
      if (body) {
        req.write(JSON.stringify(body));
      }
      
      req.end();
    });
  }

  /**
   * Connect to Discord Gateway for real-time events
   */
  private connectGateway(): void {
    if (this.ws) {
      this.ws.close();
    }

    try {
      // Use dynamic import for ws module
      import('ws').then(({ default: WebSocket }) => {
        const gatewayUrl = this.resumeGatewayUrl || DISCORD_GATEWAY_URL;
        console.log('[DiscordAdapter] Connecting to Gateway...');
        
        this.ws = new WebSocket(gatewayUrl) as unknown as WebSocket;

        this.ws.onopen = () => {
          console.log('[DiscordAdapter] Gateway connected');
        };

        this.ws.onmessage = (event: any) => {
          this.handleGatewayMessage(JSON.parse(event.data.toString()));
        };

        this.ws.onclose = (event: any) => {
          console.log(`[DiscordAdapter] Gateway closed: ${event.code}`);
          this.stopHeartbeat();
          
          // Attempt reconnect if not intentionally disconnected
          if (this.status === 'connected') {
            setTimeout(() => this.connectGateway(), 5000);
          }
        };

        this.ws.onerror = (error: any) => {
          console.error('[DiscordAdapter] Gateway error:', error.message);
        };
      }).catch((err) => {
        console.error('[DiscordAdapter] Failed to load ws module:', err.message);
      });
    } catch (error: any) {
      console.error('[DiscordAdapter] Gateway connect error:', error.message);
    }
  }

  /**
   * Handle Gateway message
   */
  private handleGatewayMessage(data: any): void {
    const { op, d, s, t } = data;
    
    if (s) {
      this.lastSequence = s;
    }

    switch (op) {
      case GatewayOpcodes.HELLO:
        // Start heartbeat
        const heartbeatInterval = d.heartbeat_interval;
        this.startHeartbeat(heartbeatInterval);
        
        // Send identify
        this.sendIdentify();
        break;

      case GatewayOpcodes.HEARTBEAT_ACK:
        // Heartbeat acknowledged
        break;

      case GatewayOpcodes.DISPATCH:
        this.handleDispatch(t, d);
        break;

      case GatewayOpcodes.RECONNECT:
        console.log('[DiscordAdapter] Gateway requested reconnect');
        this.ws?.close();
        this.connectGateway();
        break;

      case GatewayOpcodes.INVALID_SESSION:
        console.log('[DiscordAdapter] Invalid session, re-identifying');
        this.sessionId = null;
        setTimeout(() => this.sendIdentify(), 1000);
        break;
    }
  }

  /**
   * Handle Gateway dispatch events
   */
  private handleDispatch(eventType: string, data: any): void {
    switch (eventType) {
      case 'READY':
        this.sessionId = data.session_id;
        this.resumeGatewayUrl = data.resume_gateway_url;
        console.log('[DiscordAdapter] Gateway ready');
        break;

      case 'MESSAGE_CREATE':
        this.handleNewMessage(data);
        break;

      case 'MESSAGE_UPDATE':
        // Handle message edits if needed
        break;

      case 'TYPING_START':
        this.emit('typingIndicator', {
          platform: 'discord',
          conversationId: `discord_${data.channel_id}`,
          userId: data.user_id,
          isTyping: true,
        });
        break;
    }
  }

  /**
   * Handle new message from Gateway
   */
  private handleNewMessage(data: DiscordMessage): void {
    // Only handle DM messages (channel type 1 or 3)
    // We can't check channel type from MESSAGE_CREATE, so we process all
    
    const message: Message = {
      id: `discord_${data.channel_id}_${data.id}`,
      conversationId: data.channel_id,
      platformMessageId: data.id,
      senderId: data.author.id,
      senderName: data.author.global_name || data.author.username,
      content: data.content || '',
      messageType: this.getMessageType(data),
      mediaUrl: data.attachments?.[0]?.url,
      isOutgoing: data.author.id === this.userId,
      isRead: false,
      sentAt: data.timestamp,
    };

    // Update cache
    const cachedMessages = this.messagesCache.get(data.channel_id) || [];
    cachedMessages.push(message);
    this.messagesCache.set(data.channel_id, cachedMessages);

    // Emit new message event
    this.emit('newMessage', {
      platform: 'discord',
      conversationId: `discord_${data.channel_id}`,
      message,
    });

    console.log(`[DiscordAdapter] 📩 New message from ${message.senderName}`);
  }

  /**
   * Get message type from Discord message
   */
  private getMessageType(msg: DiscordMessage): 'text' | 'image' | 'video' | 'file' {
    if (msg.attachments && msg.attachments.length > 0) {
      const contentType = msg.attachments[0].content_type || '';
      if (contentType.startsWith('image/')) return 'image';
      if (contentType.startsWith('video/')) return 'video';
      return 'file';
    }
    return 'text';
  }

  /**
   * Send identify payload to Gateway
   */
  private sendIdentify(): void {
    if (!this.ws || !this.token) return;

    const identify = {
      op: GatewayOpcodes.IDENTIFY,
      d: {
        token: this.token,
        intents: 4096 + 512, // DIRECT_MESSAGES + GUILD_MESSAGES
        properties: {
          os: 'windows',
          browser: 'chrome',
          device: 'desktop',
        },
      },
    };

    this.ws.send(JSON.stringify(identify));
    console.log('[DiscordAdapter] Sent identify');
  }

  /**
   * Start heartbeat interval
   */
  private startHeartbeat(interval: number): void {
    this.stopHeartbeat();
    
    // Send first heartbeat after jitter
    setTimeout(() => {
      this.sendHeartbeat();
    }, interval * Math.random());

    this.heartbeatInterval = setInterval(() => {
      this.sendHeartbeat();
    }, interval);
  }

  /**
   * Stop heartbeat interval
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
    }
  }

  /**
   * Send heartbeat to Gateway
   */
  private sendHeartbeat(): void {
    if (!this.ws) return;

    const heartbeat = {
      op: GatewayOpcodes.HEARTBEAT,
      d: this.lastSequence,
    };

    this.ws.send(JSON.stringify(heartbeat));
  }


  /**
   * Disconnect from Discord
   */
  async disconnect(): Promise<void> {
    this.stopHeartbeat();

    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }

    this.status = 'disconnected';
    this.token = null;
    this.userId = null;
    this.username = null;
    this.sessionId = null;
    this.resumeGatewayUrl = null;
    this.conversationsCache.clear();
    this.messagesCache.clear();

    console.log('[DiscordAdapter] Disconnected');
    this.emit('disconnected');
    this.emit('statusChange', { status: 'disconnected', message: 'Discord disconnected' });
  }

  /**
   * Open browser login window for Discord
   * Extracts token from network requests after login
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<{ token: string } | null> {
    return new Promise((resolve) => {
      const discordSession = session.fromPartition('discord-login');
      
      console.log('[DiscordAdapter] Opening login window...');
      
      this.loginWindow = new BrowserWindow({
        width: 500,
        height: 750,
        resizable: true,
        title: 'Discord Login',
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: discordSession,
        },
      });

      this.loginWindow.show();
      this.loginWindow.focus();
      
      console.log('[DiscordAdapter] Loading Discord...');
      this.loginWindow.loadURL('https://discord.com/login');
      
      let isResolved = false;
      let extractedToken: string | null = null;
      
      // Intercept network requests to extract token from Authorization header
      discordSession.webRequest.onBeforeSendHeaders(
        { urls: ['https://discord.com/api/*', 'https://*.discord.com/api/*'] },
        (details, callback) => {
          const authHeader = details.requestHeaders['Authorization'];
          if (authHeader && !authHeader.startsWith('Bot ') && authHeader.length > 50) {
            console.log('[DiscordAdapter] Token intercepted from network request!');
            extractedToken = authHeader;
          }
          callback({ requestHeaders: details.requestHeaders });
        }
      );
      
      const checkForLogin = async () => {
        if (isResolved) return;
        
        try {
          if (!this.loginWindow || this.loginWindow.isDestroyed()) {
            return;
          }

          const currentURL = this.loginWindow.webContents.getURL();
          
          // Check if user is logged in (redirected to app or channels)
          if (currentURL.includes('discord.com/channels') || 
              currentURL.includes('discord.com/app')) {
            
            // If we have token from network intercept, use it
            if (extractedToken) {
              isResolved = true;
              console.log('[DiscordAdapter] Login successful, token extracted from network!');

              if (!this.loginWindow.isDestroyed()) {
                this.loginWindow.close();
              }

              resolve({ token: extractedToken });
              return;
            }
            
            // Fallback: Try localStorage methods
            const token = await this.loginWindow.webContents.executeJavaScript(`
              (function() {
                // Method 1: Try to get from localStorage
                const localStorageToken = localStorage.getItem('token');
                if (localStorageToken) {
                  return localStorageToken.replace(/"/g, '');
                }
                
                // Method 2: Try iframe trick
                try {
                  const iframe = document.createElement('iframe');
                  document.body.appendChild(iframe);
                  const token = iframe.contentWindow.localStorage.getItem('token');
                  iframe.remove();
                  if (token) {
                    return token.replace(/"/g, '');
                  }
                } catch(e) {}
                
                // Method 3: Try to find in webpack modules (Discord stores token there)
                try {
                  const m = webpackChunkdiscord_app.push([[Symbol()],{},e=>{m=[];for(let c in e.c)m.push(e.c[c])}]);
                  for (let mod of m) {
                    if (mod?.exports?.default?.getToken) {
                      return mod.exports.default.getToken();
                    }
                  }
                } catch(e) {}
                
                return null;
              })();
            `);

            if (token) {
              isResolved = true;
              console.log('[DiscordAdapter] Login successful, token extracted from localStorage!');

              if (!this.loginWindow.isDestroyed()) {
                this.loginWindow.close();
              }

              resolve({ token });
              return;
            }
          }
          
          // Keep checking every 2 seconds
          setTimeout(checkForLogin, 2000);
          
        } catch (err: any) {
          console.error('[DiscordAdapter] Login check error:', err.message);
          setTimeout(checkForLogin, 2000);
        }
      };

      this.loginWindow.webContents.on('did-finish-load', () => {
        setTimeout(checkForLogin, 2000);
      });
      
      this.loginWindow.webContents.on('did-navigate', () => {
        setTimeout(checkForLogin, 1000);
      });

      this.loginWindow.on('closed', () => {
        this.loginWindow = null;
        if (!isResolved) {
          isResolved = true;
          resolve(null);
        }
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!isResolved && this.loginWindow && !this.loginWindow.isDestroyed()) {
          console.log('[DiscordAdapter] Login timeout - closing window');
          this.loginWindow.close();
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Fetch all DM conversations
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected() || !this.token) {
      throw new Error('Not connected to Discord');
    }

    // Rate limiting
    const now = Date.now();
    if (now - this.lastFetchTime < this.MIN_FETCH_INTERVAL) {
      console.log('[DiscordAdapter] Rate limited, returning cached conversations');
      return Array.from(this.conversationsCache.values());
    }
    this.lastFetchTime = now;

    try {
      console.log('[DiscordAdapter] Fetching DM channels...');
      
      const channels = await this.makeRequest<DiscordChannel[]>('GET', '/users/@me/channels');
      console.log(`[DiscordAdapter] Found ${channels.length} channels`);

      const conversations: Conversation[] = [];

      for (const channel of channels) {
        // Only process DM channels (type 1) and Group DMs (type 3)
        if (channel.type !== 1 && channel.type !== 3) {
          continue;
        }

        try {
          const recipients = channel.recipients || [];
          let participantName: string;
          let participantId: string;
          let avatarUrl: string | undefined;

          if (channel.type === 1 && recipients.length > 0) {
            // Direct DM
            const recipient = recipients[0];
            participantName = recipient.global_name || recipient.username;
            participantId = recipient.id;
            avatarUrl = this.getAvatarUrl(recipient);
          } else if (channel.type === 3) {
            // Group DM
            participantName = channel.name || `Group (${recipients.length} members)`;
            participantId = channel.id;
            if (channel.icon) {
              avatarUrl = `https://cdn.discordapp.com/channel-icons/${channel.id}/${channel.icon}.png`;
            }
          } else {
            continue;
          }

          // Fetch recent messages for this channel
          const messages = await this.makeRequest<DiscordMessage[]>(
            'GET', 
            `/channels/${channel.id}/messages?limit=10`
          );

          const parsedMessages: Message[] = messages.map((msg) => ({
            id: `discord_${channel.id}_${msg.id}`,
            conversationId: channel.id,
            platformMessageId: msg.id,
            senderId: msg.author.id,
            senderName: msg.author.id === this.userId ? 'You' : (msg.author.global_name || msg.author.username),
            content: msg.content || (msg.attachments?.length ? '[Attachment]' : ''),
            messageType: this.getMessageType(msg),
            mediaUrl: msg.attachments?.[0]?.url,
            isOutgoing: msg.author.id === this.userId,
            isRead: true,
            sentAt: msg.timestamp,
          }));

          // Sort messages oldest first
          parsedMessages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

          const lastMessage = parsedMessages[parsedMessages.length - 1];

          const conversation: Conversation = {
            id: `discord_${channel.id}`,
            platform: 'discord',
            platformConversationId: channel.id,
            participantName,
            participantId,
            participantAvatarUrl: avatarUrl,
            lastMessage: lastMessage?.content,
            lastMessageAt: lastMessage?.sentAt || new Date().toISOString(),
            unreadCount: 0, // Discord doesn't provide unread count via API
          };

          conversations.push(conversation);
          
          // Cache
          this.conversationsCache.set(channel.id, conversation);
          this.messagesCache.set(channel.id, parsedMessages);

          console.log(`[DiscordAdapter] Processed: ${participantName} (${parsedMessages.length} messages)`);

        } catch (channelErr: any) {
          console.error(`[DiscordAdapter] Error processing channel ${channel.id}: ${channelErr.message}`);
          continue;
        }
      }

      // Sort by last message time
      conversations.sort((a, b) => 
        new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
      );

      return conversations;

    } catch (error: any) {
      console.error('[DiscordAdapter] fetchConversations error:', error.message);
      throw error;
    }
  }

  /**
   * Get Discord avatar URL for a user
   */
  private getAvatarUrl(user: DiscordUser): string {
    if (user.avatar) {
      const ext = user.avatar.startsWith('a_') ? 'gif' : 'png';
      return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${ext}`;
    }
    // Default avatar
    const discriminator = user.discriminator || '0';
    if (discriminator === '0') {
      // New username system
      return `https://cdn.discordapp.com/embed/avatars/${(parseInt(user.id) >> 22) % 6}.png`;
    }
    return `https://cdn.discordapp.com/embed/avatars/${parseInt(discriminator) % 5}.png`;
  }

  /**
   * Fetch messages for a specific conversation
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected() || !this.token) {
      throw new Error('Not connected to Discord');
    }

    // Return cached messages if available
    const cached = this.messagesCache.get(conversationId);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      console.log(`[DiscordAdapter] Fetching messages for ${conversationId}...`);
      
      const messages = await this.makeRequest<DiscordMessage[]>(
        'GET',
        `/channels/${conversationId}/messages?limit=50`
      );

      const parsedMessages: Message[] = messages.map((msg) => ({
        id: `discord_${conversationId}_${msg.id}`,
        conversationId: conversationId,
        platformMessageId: msg.id,
        senderId: msg.author.id,
        senderName: msg.author.id === this.userId ? 'You' : (msg.author.global_name || msg.author.username),
        content: msg.content || (msg.attachments?.length ? '[Attachment]' : ''),
        messageType: this.getMessageType(msg),
        mediaUrl: msg.attachments?.[0]?.url,
        isOutgoing: msg.author.id === this.userId,
        isRead: true,
        sentAt: msg.timestamp,
      }));

      // Sort oldest first
      parsedMessages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

      // Cache
      this.messagesCache.set(conversationId, parsedMessages);

      return parsedMessages;

    } catch (error: any) {
      console.error('[DiscordAdapter] fetchMessages error:', error.message);
      throw error;
    }
  }

  /**
   * Send a message
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected() || !this.token) {
      return { success: false, error: 'Not connected to Discord' };
    }

    try {
      console.log(`[DiscordAdapter] Sending message to ${conversationId}...`);
      
      const message = await this.makeRequest<DiscordMessage>(
        'POST',
        `/channels/${conversationId}/messages`,
        { content }
      );
      
      console.log(`[DiscordAdapter] Message sent, id: ${message.id}`);
      
      return {
        success: true,
        messageId: message.id,
        sentAt: message.timestamp,
      };
    } catch (error: any) {
      console.error('[DiscordAdapter] sendMessage error:', error.message);
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
let discordAdapter: DiscordAdapter | null = null;

export function getDiscordAdapter(): DiscordAdapter {
  if (!discordAdapter) {
    discordAdapter = new DiscordAdapter();
  }
  return discordAdapter;
}
