import axios, { AxiosInstance } from 'axios';
import { EventEmitter } from 'events';
import { BrowserWindow, session } from 'electron';
import type { 
  Platform, 
  Conversation, 
  Message, 
  PlatformCredentials,
  SendMessageResponse 
} from '../../shared/types.js';

/**
 * Twitter/X Platform Adapter
 * Uses cookie-based authentication with Twitter's internal API
 * Implements real-time polling for DM updates
 */

// Twitter API Bearer Token (public, used by web client)
const TWITTER_BEARER_TOKEN = 'AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';

// Rate limiting constants
const MIN_FETCH_INTERVAL = 15000; // 15 seconds minimum between fetches
const POLLING_INTERVAL = 10000; // 10 seconds for real-time polling
const MAX_RETRIES = 3;

interface TwitterCookies {
  auth_token: string;
  ct0: string;
}

interface TwitterUser {
  id_str: string;
  name: string;
  screen_name: string;
  profile_image_url_https?: string;
}

interface TwitterMessage {
  id: string;
  time: string;
  message_data: {
    text: string;
    sender_id: string;
  };
  conversation_id: string;
}

interface TwitterConversation {
  conversation_id: string;
  participants: Array<{ user_id: string }>;
  sort_timestamp?: string;
}

interface TwitterInboxResponse {
  inbox_initial_state?: {
    users: Record<string, TwitterUser>;
    conversations: Record<string, TwitterConversation>;
    entries: Array<{ message?: TwitterMessage }>;
    cursor?: string;
  };
}

export class TwitterAdapter extends EventEmitter {
  readonly platform: Platform = 'twitter';
  
  private cookies: TwitterCookies | null = null;
  private axiosInstance: AxiosInstance;
  private lastFetchTime: number = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private lastCursor: string | null = null;
  private currentUserId: string | null = null;
  private loginWindow: BrowserWindow | null = null;
  
  // Cache for conversations and messages
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  private usersCache: Map<string, TwitterUser> = new Map();

  constructor() {
    super();
    this.axiosInstance = axios.create({
      timeout: 60000,
      validateStatus: (status) => status < 500,
    });
  }

  /**
   * Connect to Twitter with cookie-based authentication
   */
  async connect(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    if (!credentials.cookies?.auth_token || !credentials.cookies?.ct0) {
      return { success: false, error: 'Twitter requires auth_token and ct0 cookies' };
    }

    this.cookies = {
      auth_token: credentials.cookies.auth_token,
      ct0: credentials.cookies.ct0,
    };

    // Verify connection by fetching initial state
    try {
      const response = await this.fetchInboxState();
      if (!response.inbox_initial_state) {
        return { success: false, error: 'Invalid response from Twitter API' };
      }
      
      this.isConnected = true;
      this.lastCursor = response.inbox_initial_state.cursor || null;
      
      // Cache users and find current user
      const users = response.inbox_initial_state.users || {};
      let currentUser: TwitterUser | null = null;
      
      for (const [userId, user] of Object.entries(users)) {
        this.usersCache.set(userId, user);
        // First user is usually the current user
        if (!currentUser) {
          currentUser = user;
          this.currentUserId = userId;
        }
      }
      
      console.log('[TwitterAdapter] Connected successfully');
      this.emit('connected');
      
      return {
        success: true,
        userId: this.currentUserId || undefined,
        username: currentUser?.screen_name,
      };
    } catch (error: any) {
      this.isConnected = false;
      console.error('[TwitterAdapter] Connection failed:', error.message);
      return { success: false, error: `Twitter connection failed: ${error.message}` };
    }
  }

  /**
   * Disconnect from Twitter
   */
  async disconnect(): Promise<void> {
    this.stopRealTime();
    this.cookies = null;
    this.isConnected = false;
    this.conversationsCache.clear();
    this.messagesCache.clear();
    this.usersCache.clear();
    this.lastCursor = null;
    this.currentUserId = null;
    
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
    
    console.log('[TwitterAdapter] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Open browser login window for Twitter
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<TwitterCookies | null> {
    return new Promise((resolve) => {
      const twitterSession = session.fromPartition('twitter-login');
      
      console.log('[TwitterAdapter] Opening login window...');
      
      this.loginWindow = new BrowserWindow({
        width: 500,
        height: 700,
        resizable: true,
        title: 'Twitter/X Login',
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: twitterSession,
        },
      });

      this.loginWindow.show();
      this.loginWindow.focus();
      
      console.log('[TwitterAdapter] Loading Twitter...');
      this.loginWindow.loadURL('https://twitter.com/login');
      
      let isResolved = false;
      
      const checkForLogin = async () => {
        if (isResolved) return;
        
        try {
          if (!this.loginWindow || this.loginWindow.isDestroyed()) {
            return;
          }

          const currentURL = this.loginWindow.webContents.getURL();
          
          // Check if user is logged in (redirected to home or messages)
          if ((currentURL.includes('twitter.com/home') || 
               currentURL.includes('x.com/home') ||
               currentURL.includes('twitter.com/messages') ||
               currentURL.includes('x.com/messages') ||
               (currentURL.includes('twitter.com') && !currentURL.includes('/login')) ||
               (currentURL.includes('x.com') && !currentURL.includes('/login')))) {
            
            const cookies = await twitterSession.cookies.get({ domain: '.twitter.com' });
            const xCookies = await twitterSession.cookies.get({ domain: '.x.com' });
            const allCookies = [...cookies, ...xCookies];
            
            let auth_token = '';
            let ct0 = '';

            for (const cookie of allCookies) {
              if (cookie.name === 'auth_token') auth_token = cookie.value;
              if (cookie.name === 'ct0') ct0 = cookie.value;
            }

            if (auth_token && ct0) {
              isResolved = true;
              
              console.log('[TwitterAdapter] Login successful!');
              
              const twitterCookies: TwitterCookies = { auth_token, ct0 };

              if (!this.loginWindow.isDestroyed()) {
                this.loginWindow.close();
              }

              resolve(twitterCookies);
              return;
            }
          }
          
          // Keep checking every 2 seconds
          setTimeout(checkForLogin, 2000);
          
        } catch (err: any) {
          console.error('[TwitterAdapter] Login check error:', err.message);
        }
      };

      this.loginWindow.webContents.on('did-finish-load', () => {
        setTimeout(checkForLogin, 1000);
      });
      
      // Also check on navigation
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
      
      // Timeout after 3 minutes
      setTimeout(() => {
        if (!isResolved && this.loginWindow && !this.loginWindow.isDestroyed()) {
          console.log('[TwitterAdapter] Login timeout - closing window');
          this.loginWindow.close();
        }
      }, 3 * 60 * 1000);
    });
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.isConnected && this.cookies !== null;
  }

  /**
   * Get request headers for Twitter API
   */
  private getHeaders(): Record<string, string> {
    if (!this.cookies) {
      throw new Error('Not connected to Twitter');
    }

    return {
      'authorization': `Bearer ${TWITTER_BEARER_TOKEN}`,
      'cookie': `auth_token=${this.cookies.auth_token}; ct0=${this.cookies.ct0}`,
      'x-csrf-token': this.cookies.ct0,
      'x-twitter-auth-type': 'OAuth2Session',
      'x-twitter-active-user': 'yes',
      'x-twitter-client-language': 'en',
      'content-type': 'application/json',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    };
  }

  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastFetchTime;
    
    if (timeSinceLastFetch < MIN_FETCH_INTERVAL) {
      const waitTime = MIN_FETCH_INTERVAL - timeSinceLastFetch;
      console.log(`[TwitterAdapter] Rate limit: waiting ${Math.ceil(waitTime / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Fetch inbox initial state from Twitter API
   */
  private async fetchInboxState(retryCount = 0): Promise<TwitterInboxResponse> {
    await this.enforceRateLimit();

    const url = 'https://api.twitter.com/1.1/dm/inbox_initial_state.json?' + new URLSearchParams({
      include_profile_interstitial_type: '1',
      include_blocking: '1',
      include_blocked_by: '1',
      include_followed_by: '1',
      include_want_retweets: '1',
      include_mute_edge: '1',
      include_can_dm: '1',
      include_can_media_tag: '1',
      skip_status: '1',
      dm_secret_conversations_enabled: 'false',
      cards_platform: 'Web-12',
      include_cards: '1',
      include_ext_alt_text: 'true',
      include_quote_count: 'true',
      include_reply_count: '1',
      tweet_mode: 'extended',
      count: '50',
    }).toString();

    try {
      const response = await this.axiosInstance.get<TwitterInboxResponse>(url, {
        headers: this.getHeaders(),
      });

      this.lastFetchTime = Date.now();

      if (response.status === 401 || response.status === 403) {
        throw new Error('Twitter authentication failed - cookies may be expired');
      }

      if (response.status !== 200) {
        throw new Error(`Twitter API error: ${response.status}`);
      }

      return response.data;
    } catch (error: any) {
      // Retry on connection errors
      const isRetryable = error.message?.includes('ECONNRESET') ||
                         error.message?.includes('ETIMEDOUT') ||
                         error.message?.includes('socket hang up') ||
                         error.code === 'ECONNRESET';

      if (isRetryable && retryCount < MAX_RETRIES) {
        const waitTime = Math.pow(2, retryCount) * 3000; // Exponential backoff: 3s, 6s, 12s
        console.log(`[TwitterAdapter] Retrying in ${waitTime / 1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.fetchInboxState(retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Parse Twitter API response into app format
   */
  private parseConversations(data: TwitterInboxResponse): Conversation[] {
    const conversations: Conversation[] = [];
    const inboxState = data.inbox_initial_state;
    
    if (!inboxState) return conversations;

    const users = inboxState.users || {};
    const convs = inboxState.conversations || {};
    const entries = inboxState.entries || [];

    // Update users cache
    for (const [userId, user] of Object.entries(users)) {
      this.usersCache.set(userId, user);
    }

    // Track seen conversation IDs to avoid duplicates
    const seenConvIds = new Set<string>();

    for (const [convId, conv] of Object.entries(convs)) {
      // Skip if already processed
      if (seenConvIds.has(convId)) continue;
      seenConvIds.add(convId);
      
      // Get messages for this conversation
      const messages: Message[] = [];
      const seenMsgIds = new Set<string>();
      
      for (const entry of entries) {
        if (entry.message && entry.message.conversation_id === convId) {
          const msg = entry.message;
          
          // Skip duplicate messages
          if (seenMsgIds.has(msg.id)) continue;
          seenMsgIds.add(msg.id);
          
          const msgData = msg.message_data;
          const senderUser = users[msgData.sender_id] || this.usersCache.get(msgData.sender_id);
          
          messages.push({
            id: msg.id,
            conversationId: convId,
            platformMessageId: msg.id,
            senderId: msgData.sender_id,
            senderName: senderUser?.name || senderUser?.screen_name || 'Unknown',
            content: msgData.text,
            messageType: 'text',
            isOutgoing: msgData.sender_id === this.currentUserId,
            isRead: true, // Twitter doesn't provide read status in this API
            sentAt: new Date(parseInt(msg.time)).toISOString(),
          });
        }
      }

      // Sort messages by time (oldest first)
      messages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

      // Get participant info (exclude current user for display)
      const participantIds = conv.participants?.map(p => p.user_id) || [];
      const otherParticipants = participantIds.filter(id => id !== this.currentUserId);
      const mainParticipantId = otherParticipants[0] || participantIds[0];
      const mainParticipant = users[mainParticipantId] || this.usersCache.get(mainParticipantId);

      const lastMessage = messages[messages.length - 1];

      const conversation: Conversation = {
        id: `twitter_${convId}`,
        platform: 'twitter',
        platformConversationId: convId,
        participantName: mainParticipant?.name || mainParticipant?.screen_name || 'Twitter User',
        participantId: mainParticipantId,
        participantAvatarUrl: mainParticipant?.profile_image_url_https,
        lastMessage: lastMessage?.content,
        lastMessageAt: lastMessage?.sentAt || conv.sort_timestamp || new Date().toISOString(),
        unreadCount: 0, // Twitter doesn't provide unread count in this API
      };

      conversations.push(conversation);
      
      // Cache conversation and messages
      this.conversationsCache.set(convId, conversation);
      this.messagesCache.set(convId, messages);
    }

    // Sort by last message time (newest first)
    conversations.sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );

    return conversations;
  }

  /**
   * Fetch all conversations
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Twitter');
    }

    try {
      const response = await this.fetchInboxState();
      return this.parseConversations(response);
    } catch (error: any) {
      console.error('[TwitterAdapter] fetchConversations error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch messages for a specific conversation
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Twitter');
    }

    // Return cached messages if available
    const cached = this.messagesCache.get(conversationId);
    if (cached && cached.length > 0) {
      return cached;
    }

    // Fetch fresh data
    await this.fetchConversations();
    return this.messagesCache.get(conversationId) || [];
  }

  /**
   * Send a message via browser automation
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected()) {
      return { success: false, error: 'Not connected to Twitter' };
    }

    console.log('[TwitterAdapter] sendMessage called:', conversationId, content.substring(0, 30));

    try {
      const result = await this.sendMessageViaBrowser(conversationId, content);
      return result;
    } catch (error: any) {
      console.error('[TwitterAdapter] sendMessage error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Send message using browser automation
   */
  private sendMessageViaBrowser(conversationId: string, content: string): Promise<SendMessageResponse> {
    return new Promise(async (resolve) => {
      const twitterSession = session.fromPartition('twitter-login');
      
      console.log('[TwitterAdapter] Browser automation - sending message...');
      
      // Set cookies in session
      if (this.cookies) {
        const cookiesToSet = [
          { url: 'https://twitter.com', name: 'auth_token', value: this.cookies.auth_token, domain: '.twitter.com' },
          { url: 'https://twitter.com', name: 'ct0', value: this.cookies.ct0, domain: '.twitter.com' },
          { url: 'https://x.com', name: 'auth_token', value: this.cookies.auth_token, domain: '.x.com' },
          { url: 'https://x.com', name: 'ct0', value: this.cookies.ct0, domain: '.x.com' },
        ];
        
        for (const cookie of cookiesToSet) {
          try {
            await twitterSession.cookies.set(cookie);
          } catch (e: any) {
            console.log('[TwitterAdapter] Cookie set warning:', e.message);
          }
        }
      }
      
      // Create hidden browser window
      const sendWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: twitterSession,
        },
      });

      // Twitter DM URL format: https://twitter.com/messages/conversationId
      const dmUrl = `https://twitter.com/messages/${conversationId}`;
      console.log('[TwitterAdapter] Loading DM thread:', dmUrl);
      
      sendWindow.loadURL(dmUrl);
      
      let isResolved = false;
      let retryCount = 0;
      const maxRetries = 3;

      const tryToSend = async () => {
        if (isResolved) return;
        
        try {
          const currentURL = sendWindow.webContents.getURL();
          console.log('[TwitterAdapter] Current URL:', currentURL);
          
          // Check if redirected to login
          if (currentURL.includes('/login') || currentURL.includes('/i/flow/login')) {
            isResolved = true;
            if (!sendWindow.isDestroyed()) sendWindow.close();
            resolve({ success: false, error: 'Twitter session expired. Please re-login.' });
            return;
          }
          
          // Step 1: Type the message
          const typeResult = await sendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                // Find message input - Twitter uses contenteditable div
                const messageInput = document.querySelector('[data-testid="dmComposerTextInput"]') ||
                                    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                                    document.querySelector('div[data-contents="true"]')?.closest('[contenteditable="true"]');
                
                if (!messageInput) {
                  return { success: false, error: 'Message input not found' };
                }
                
                messageInput.focus();
                messageInput.textContent = ${JSON.stringify(content)};
                messageInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(content)} }));
                
                return { success: true, step: 'typed' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[TwitterAdapter] Type result:', typeResult);
          
          if (!typeResult.success) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log('[TwitterAdapter] Retrying... (' + retryCount + '/' + maxRetries + ')');
              setTimeout(tryToSend, 2000);
              return;
            }
            isResolved = true;
            if (!sendWindow.isDestroyed()) sendWindow.close();
            resolve({ success: false, error: typeResult.error || 'Could not type message' });
            return;
          }
          
          // Step 2: Click send button or press Enter
          await new Promise(r => setTimeout(r, 500));
          
          const sendResult = await sendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                // Try to find and click send button
                const sendButton = document.querySelector('[data-testid="dmComposerSendButton"]') ||
                                  document.querySelector('button[aria-label*="Send"]') ||
                                  document.querySelector('div[role="button"][data-testid*="send"]');
                
                if (sendButton) {
                  sendButton.click();
                  return { success: true, method: 'click' };
                }
                
                // Fallback: press Enter
                const messageInput = document.querySelector('[data-testid="dmComposerTextInput"]') ||
                                    document.querySelector('div[contenteditable="true"][role="textbox"]');
                
                if (messageInput) {
                  const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                  });
                  messageInput.dispatchEvent(enterEvent);
                  return { success: true, method: 'enter' };
                }
                
                return { success: false, error: 'Could not send message' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[TwitterAdapter] Send result:', sendResult);
          
          await new Promise(r => setTimeout(r, 2000));
          
          isResolved = true;
          if (!sendWindow.isDestroyed()) sendWindow.close();
          
          if (sendResult.success) {
            resolve({ success: true, messageId: 'browser_' + Date.now(), sentAt: new Date().toISOString() });
          } else {
            resolve({ success: false, error: sendResult.error || 'Failed to send' });
          }
          
        } catch (err: any) {
          console.error('[TwitterAdapter] Browser automation error:', err.message);
          if (retryCount < maxRetries) {
            retryCount++;
            setTimeout(tryToSend, 2000);
          } else {
            isResolved = true;
            if (!sendWindow.isDestroyed()) sendWindow.close();
            resolve({ success: false, error: err.message });
          }
        }
      };
      
      sendWindow.webContents.on('did-finish-load', () => {
        console.log('[TwitterAdapter] Page loaded, waiting for DOM...');
        setTimeout(tryToSend, 3000);
      });
      
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (!sendWindow.isDestroyed()) sendWindow.close();
          resolve({ success: false, error: 'Timeout: Page took too long' });
        }
      }, 30000);
    });
  }

  /**
   * Start real-time polling for new messages
   */
  startRealTime(): void {
    if (this.pollingTimer) {
      return; // Already running
    }

    console.log('[TwitterAdapter] Starting real-time polling');
    
    this.pollingTimer = setInterval(async () => {
      if (!this.connected()) {
        this.stopRealTime();
        return;
      }

      try {
        const oldConversations = new Map(this.conversationsCache);
        const oldMessages = new Map(this.messagesCache);
        
        await this.fetchConversations();
        
        // Check for new messages
        for (const [convId, messages] of this.messagesCache) {
          const oldMsgs = oldMessages.get(convId) || [];
          const newMsgs = messages.filter(m => 
            !oldMsgs.some(om => om.id === m.id)
          );
          
          for (const msg of newMsgs) {
            const conversation = this.conversationsCache.get(convId);
            if (conversation) {
              this.emit('newMessage', {
                platform: 'twitter',
                conversationId: conversation.id,
                message: msg,
              });
            }
          }
        }
      } catch (error: any) {
        console.error('[TwitterAdapter] Polling error:', error.message);
        this.emit('error', { platform: 'twitter', error: error.message });
      }
    }, POLLING_INTERVAL);
  }

  /**
   * Stop real-time polling
   */
  stopRealTime(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      console.log('[TwitterAdapter] Stopped real-time polling');
    }
  }

  /**
   * Set current user ID (for determining outgoing messages)
   */
  setCurrentUserId(userId: string): void {
    this.currentUserId = userId;
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
let twitterAdapter: TwitterAdapter | null = null;

export function getTwitterAdapter(): TwitterAdapter {
  if (!twitterAdapter) {
    twitterAdapter = new TwitterAdapter();
  }
  return twitterAdapter;
}
