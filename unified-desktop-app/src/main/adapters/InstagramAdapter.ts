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
import { getInstagramSidecarManager } from '../services/InstagramSidecarManager.js';

/**
 * Instagram Platform Adapter
 * 
 * TOGGLE: Set USE_PRIVATE_API to switch between methods
 * - true: Uses Python Sidecar with instagrapi (Mobile API - FAST)
 * - false: Uses Browser Automation (Web API - SLOW but works without Python)
 */

// ============================================
// TOGGLE: Switch between Private API and Browser Automation
// ============================================
const USE_PRIVATE_API = true;  // Set to false to use browser automation
const PRIVATE_API_URL = 'http://127.0.0.1:5050';

// Rate limiting constants
const MIN_FETCH_INTERVAL = 20000; // 20 seconds minimum between fetches
const POLLING_INTERVAL = 5000; // 5 seconds for real-time polling
const MAX_RETRIES = 3;
const AUTO_RELOGIN_COOLDOWN = 60000; // 1 minute between auto-relogin attempts

interface InstagramCookies {
  sessionid: string;
  csrftoken: string;
  ds_user_id?: string;
  mid?: string;
  ig_did?: string;
  rur?: string;
}

interface InstagramUser {
  pk: number | string;
  username: string;
  full_name?: string;
  profile_pic_url?: string;
}

interface InstagramMessage {
  item_id: string;
  user_id: number | string;
  timestamp: number;
  text?: string;
  link?: { text: string };
  reel_share?: { text?: string };
  story_share?: { message?: string };
  media_share?: { caption?: { text: string } };
  clip?: { clip?: { caption?: { text: string } } };
  voice_media?: any;
  visual_media?: any;
  animated_media?: any;
  like?: any;
  reactions?: any;
  placeholder?: { message?: string };
  action_log?: { description?: string };
}

interface InstagramThread {
  thread_id: string;
  users: InstagramUser[];
  items: InstagramMessage[];
  last_activity_at?: number;
}

interface InstagramInboxResponse {
  inbox?: {
    threads: InstagramThread[];
    oldest_cursor?: string;
    has_older?: boolean;
  };
  pending_requests_total?: number;
}

// Private API credentials (for instagrapi)
interface PrivateAPICredentials {
  username: string;
  password: string;
}

export class InstagramAdapter extends EventEmitter {
  readonly platform: Platform = 'instagram';
  
  // Cookie-based auth (browser automation)
  private cookies: InstagramCookies | null = null;
  private axiosInstance: AxiosInstance;
  private lastFetchTime: number = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private lastAutoReloginAttempt: number = 0;
  private loginWindow: BrowserWindow | null = null;
  
  // Private API auth
  private privateAPIConnected: boolean = false;
  private privateAPIUserId: string | null = null;
  private privateAPIUsername: string | null = null;
  
  // Cache for conversations and messages
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();

  constructor() {
    super();
    this.axiosInstance = axios.create({
      timeout: 60000,
      maxRedirects: 0,
      validateStatus: (status) => status < 400 || status === 302 || status === 301,
    });
  }

  // ============================================
  // Private API Methods (instagrapi sidecar)
  // ============================================

  /**
   * Check if Private API sidecar is running
   */
  private async isPrivateAPIAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${PRIVATE_API_URL}/status`, { timeout: 1000 }); // Reduced from 2s to 1s
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Connect via Private API (instagrapi)
   */
  private async connectViaPrivateAPI(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    if (!credentials.username || !credentials.password) {
      return { success: false, error: 'Username and password required for Private API' };
    }

    try {
      const response = await axios.post(`${PRIVATE_API_URL}/login`, {
        username: credentials.username,
        password: credentials.password,
      }, { timeout: 60000 }); // Instagram login can take time due to challenges

      const data = response.data;

      if (data.success) {
        this.privateAPIConnected = true;
        this.privateAPIUserId = data.user_id;
        this.privateAPIUsername = data.username;
        this.isConnected = true;
        
        console.log('[InstagramAdapter] Connected via Private API as:', data.username);
        this.emit('connected');
        
        // Start real-time polling for new messages
        this.startRealTime();
        
        return {
          success: true,
          userId: data.user_id,
          username: data.username,
        };
      }

      // Handle 2FA
      if (data.requires_2fa) {
        return {
          success: false,
          error: '2FA_REQUIRED',
        };
      }

      // Handle Challenge
      if (data.requires_challenge) {
        return {
          success: false,
          error: `CHALLENGE_REQUIRED:${data.challenge_type}`,
        };
      }

      return { success: false, error: data.error || 'Login failed' };

    } catch (error: any) {
      console.error('[InstagramAdapter] Private API connection failed:', error.message);
      return { success: false, error: `Private API error: ${error.message}` };
    }
  }

  /**
   * Fetch conversations via Private API
   */
  private async fetchConversationsViaPrivateAPI(): Promise<Conversation[]> {
    try {
      const response = await axios.get(`${PRIVATE_API_URL}/inbox?limit=30`, { timeout: 30000 });
      const data = response.data;

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch inbox');
      }

      const conversations: Conversation[] = [];

      for (const thread of data.threads || []) {
        const mainUser = thread.users[0] || {};
        
        const conversation: Conversation = {
          id: `instagram_${thread.thread_id}`,
          platform: 'instagram',
          platformConversationId: thread.thread_id,
          participantName: thread.thread_title || mainUser.full_name || mainUser.username || 'Instagram User',
          participantId: mainUser.user_id || thread.thread_id,
          participantAvatarUrl: mainUser.profile_pic_url,
          lastMessage: thread.last_message,
          lastMessageAt: thread.last_message_at || new Date().toISOString(),
          unreadCount: thread.unread_count || 0,
        };

        conversations.push(conversation);
        this.conversationsCache.set(thread.thread_id, conversation);
      }

      console.log('[InstagramAdapter] Private API fetched', conversations.length, 'conversations');
      return conversations;

    } catch (error: any) {
      console.error('[InstagramAdapter] Private API fetch error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch messages via Private API
   */
  private async fetchMessagesViaPrivateAPI(threadId: string): Promise<Message[]> {
    try {
      const response = await axios.get(`${PRIVATE_API_URL}/thread/${threadId}/messages?limit=50`, { timeout: 30000 });
      const data = response.data;

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch messages');
      }

      const messages: Message[] = [];

      for (const msg of data.messages || []) {
        messages.push({
          id: msg.id,
          conversationId: `instagram_${threadId}`,
          platformMessageId: msg.id,
          senderId: msg.user_id,
          senderName: msg.username || 'Unknown',
          content: msg.text || '[Media]',
          messageType: 'text',
          isOutgoing: msg.is_outgoing,
          isRead: true,
          sentAt: msg.timestamp || new Date().toISOString(),
        });
      }

      this.messagesCache.set(threadId, messages);
      return messages;

    } catch (error: any) {
      console.error('[InstagramAdapter] Private API messages error:', error.message);
      throw error;
    }
  }

  /**
   * Send message via Private API
   */
  private async sendMessageViaPrivateAPI(threadId: string, content: string): Promise<SendMessageResponse> {
    try {
      const response = await axios.post(`${PRIVATE_API_URL}/send`, {
        thread_id: threadId,
        message: content,
      }, { timeout: 30000 });

      const data = response.data;

      if (data.success) {
        return {
          success: true,
          messageId: data.message_id,
          sentAt: data.timestamp,
        };
      }

      return { success: false, error: data.error || 'Failed to send' };

    } catch (error: any) {
      console.error('[InstagramAdapter] Private API send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // Main Public Methods (with toggle logic)
  // ============================================

  /**
   * Connect to Instagram
   * Uses Private API if available, falls back to cookie-based auth
   */
  async connect(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    // Try Private API first if enabled and credentials provided
    if (USE_PRIVATE_API && credentials.username && credentials.password) {
      const privateAPIAvailable = await this.isPrivateAPIAvailable();
      console.log('[InstagramAdapter] Private API available:', privateAPIAvailable);
      
      if (privateAPIAvailable) {
        console.log('[InstagramAdapter] Using Private API (instagrapi)');
        return this.connectViaPrivateAPI(credentials);
      } else {
        // If user provided username/password but sidecar not running, return error with debug info
        const sidecar = getInstagramSidecarManager();
        const status = await sidecar.getStatus();
        console.log('[InstagramAdapter] Private API not available - sidecar status:', status);
        return { 
          success: false, 
          error: `Instagram Private API server not running (sidecar running: ${status.running}). Please restart the app or use Browser Login.` 
        };
      }
    }

    // Fallback to cookie-based authentication
    if (!credentials.cookies?.sessionid || !credentials.cookies?.csrftoken) {
      return { success: false, error: 'Instagram requires sessionid and csrftoken cookies' };
    }

    this.cookies = {
      sessionid: credentials.cookies.sessionid,
      csrftoken: credentials.cookies.csrftoken,
      ds_user_id: credentials.cookies.ds_user_id,
      mid: credentials.cookies.mid,
      ig_did: credentials.cookies.ig_did,
      rur: credentials.cookies.rur,
    };

    // Verify connection by fetching inbox
    try {
      const response = await this.fetchInbox();
      if (!response.inbox) {
        return { success: false, error: 'Invalid response from Instagram API' };
      }
      
      this.isConnected = true;
      
      console.log('[InstagramAdapter] Connected successfully via cookies');
      this.emit('connected');
      
      // Start real-time polling for new messages
      this.startRealTime();
      
      return {
        success: true,
        userId: this.cookies.ds_user_id,
        username: undefined,
      };
    } catch (error: any) {
      this.isConnected = false;
      console.error('[InstagramAdapter] Connection failed:', error.message);
      return { success: false, error: `Instagram connection failed: ${error.message}` };
    }
  }

  /**
   * Disconnect from Instagram
   */
  async disconnect(): Promise<void> {
    this.stopRealTime();
    this.cookies = null;
    this.isConnected = false;
    this.privateAPIConnected = false;
    this.privateAPIUserId = null;
    this.privateAPIUsername = null;
    this.conversationsCache.clear();
    this.messagesCache.clear();
    
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
    
    console.log('[InstagramAdapter] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Check if connected - also sync state with sidecar
   */
  connected(): boolean {
    // Connected via Private API OR cookie-based auth
    return this.isConnected && (this.privateAPIConnected || this.cookies !== null);
  }

  /**
   * Sync connection state with sidecar (call periodically or on demand)
   */
  async syncWithSidecar(): Promise<void> {
    try {
      const response = await axios.get(`${PRIVATE_API_URL}/status`, { timeout: 2000 });
      if (response.data.connected) {
        this.privateAPIConnected = true;
        this.privateAPIUserId = response.data.user_id;
        this.privateAPIUsername = response.data.username;
        this.isConnected = true;
        console.log('[InstagramAdapter] Synced with sidecar - connected as:', response.data.username);
      }
    } catch {
      // Sidecar not running or not connected - don't change state
    }
  }

  /**
   * Get request headers for Instagram API
   */
  private getHeaders(): Record<string, string> {
    if (!this.cookies) {
      throw new Error('Not connected to Instagram');
    }

    const cookieString = [
      `sessionid=${this.cookies.sessionid}`,
      `csrftoken=${this.cookies.csrftoken}`,
      this.cookies.ds_user_id ? `ds_user_id=${this.cookies.ds_user_id}` : '',
      'ig_nrcb=1',
    ].filter(Boolean).join('; ');

    return {
      'authority': 'www.instagram.com',
      'accept': '*/*',
      'accept-language': 'en-US,en;q=0.9',
      'cookie': cookieString,
      'origin': 'https://www.instagram.com',
      'referer': 'https://www.instagram.com/direct/inbox/',
      'sec-ch-prefers-color-scheme': 'dark',
      'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
      'sec-ch-ua-mobile': '?0',
      'sec-ch-ua-platform': '"Windows"',
      'sec-fetch-dest': 'empty',
      'sec-fetch-mode': 'cors',
      'sec-fetch-site': 'same-origin',
      'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'x-asbd-id': '129477',
      'x-csrftoken': this.cookies.csrftoken,
      'x-ig-app-id': '936619743392459',
      'x-ig-www-claim': 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5wvYbOJOD9qaPjM',
      'x-requested-with': 'XMLHttpRequest',
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
      console.log(`[InstagramAdapter] Rate limit: waiting ${Math.ceil(waitTime / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * Try to get fresh cookies from browser session
   */
  private async refreshCookiesFromSession(): Promise<void> {
    try {
      const instagramSession = session.fromPartition('instagram-login');
      const browserCookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
      
      if (browserCookies && browserCookies.length > 0 && this.cookies) {
        let freshSessionId = '';
        let freshCsrfToken = '';
        let freshDsUserId = '';
        
        for (const cookie of browserCookies) {
          if (cookie.name === 'sessionid') freshSessionId = cookie.value;
          if (cookie.name === 'csrftoken') freshCsrfToken = cookie.value;
          if (cookie.name === 'ds_user_id') freshDsUserId = cookie.value;
        }
        
        // If browser session has valid cookies, use them
        if (freshSessionId && freshCsrfToken) {
          if (freshSessionId !== this.cookies.sessionid) {
            console.log('[InstagramAdapter] Using fresh cookies from browser session');
            this.cookies.sessionid = freshSessionId;
            this.cookies.csrftoken = freshCsrfToken;
            if (freshDsUserId) this.cookies.ds_user_id = freshDsUserId;
          }
        }
      }
    } catch (e) {
      // Browser session not available, use stored cookies
    }
  }

  /**
   * Fetch inbox from Instagram API
   */
  private async fetchInbox(retryCount = 0): Promise<InstagramInboxResponse> {
    await this.enforceRateLimit();
    await this.refreshCookiesFromSession();

    try {
      const response = await this.axiosInstance.get<InstagramInboxResponse>(
        'https://www.instagram.com/api/v1/direct_v2/inbox/',
        { headers: this.getHeaders() }
      );

      this.lastFetchTime = Date.now();

      // Check for redirect (means session expired)
      if (response.status === 301 || response.status === 302) {
        const location = response.headers.location || '';
        console.log('[InstagramAdapter] Redirected to:', location);
        if (location.includes('login') || location.includes('accounts')) {
          this.triggerAutoRelogin();
          throw new Error('Instagram session expired. Auto-relogin triggered.');
        }
      }

      if (response.status === 401 || response.status === 403) {
        throw new Error('Instagram session expired. Please login again.');
      }

      if (!response.data || !response.data.inbox) {
        const dataStr = JSON.stringify(response.data || {}).substring(0, 500);
        if (dataStr.includes('login') || dataStr.includes('Login') || dataStr.includes('<!DOCTYPE')) {
          throw new Error('Instagram session expired. Please re-login.');
        }
        throw new Error('Invalid response from Instagram.');
      }

      return response.data;
    } catch (error: any) {
      console.error('[InstagramAdapter] Fetch error:', error.message);

      // Check if it's a redirect error (session expired)
      if (error.message.includes('redirect') || error.message.includes('Maximum')) {
        throw new Error('Instagram session expired. Please re-login.');
      }

      // Retry on connection errors
      const isRetryable = error.message?.includes('SSL') ||
                         error.message?.includes('ECONNRESET') ||
                         error.message?.includes('ETIMEDOUT') ||
                         error.message?.includes('CLOSE_NOTIFY') ||
                         error.message?.includes('socket hang up');

      if (isRetryable && retryCount < MAX_RETRIES) {
        const waitTime = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
        console.log(`[InstagramAdapter] Retrying in ${waitTime / 1000}s... (attempt ${retryCount + 1}/${MAX_RETRIES})`);
        await new Promise(resolve => setTimeout(resolve, waitTime));
        return this.fetchInbox(retryCount + 1);
      }

      throw error;
    }
  }

  /**
   * Parse Instagram message to extract text content
   */
  private parseMessageText(item: InstagramMessage): string {
    // Regular text message
    if (item.text) return item.text;
    // Link share
    if (item.link?.text) return item.link.text;
    // Reel share
    if (item.reel_share) return item.reel_share.text || '[Shared a Reel]';
    // Story share
    if (item.story_share) return item.story_share.message || '[Shared a Story]';
    // Media share (posts)
    if (item.media_share) {
      const caption = item.media_share.caption?.text || '';
      return caption ? `[Post] ${caption.substring(0, 100)}` : '[Shared a Post]';
    }
    // Clip (Reels in DM)
    if (item.clip) {
      const caption = item.clip.clip?.caption?.text || '';
      return caption ? `[Clip] ${caption.substring(0, 100)}` : '[Shared a Clip]';
    }
    // Voice message
    if (item.voice_media) return '[Voice Message]';
    // Visual media (photo/video)
    if (item.visual_media) return '[Photo/Video]';
    // Animated media (GIF)
    if (item.animated_media) return '[GIF]';
    // Like/reaction
    if (item.like) return '❤️';
    // Reactions
    if (item.reactions) return '[Reaction]';
    // Placeholder message
    if (item.placeholder) return item.placeholder.message || '[Message unavailable]';
    // Action log
    if (item.action_log) return item.action_log.description || '[Action]';
    // Default fallback
    return '[Media]';
  }

  /**
   * Parse Instagram API response into app format
   */
  private parseConversations(data: InstagramInboxResponse): Conversation[] {
    const conversations: Conversation[] = [];
    const threads = data.inbox?.threads || [];

    // Limit to 8 conversations for faster sync
    for (const thread of threads.slice(0, 8)) {
      const messages: Message[] = [];
      
      // Limit to last 10 messages per conversation
      for (const item of (thread.items || []).slice(0, 10)) {
        messages.push({
          id: item.item_id || '',
          conversationId: thread.thread_id,
          platformMessageId: item.item_id,
          senderId: item.user_id?.toString() || '',
          senderName: thread.users.find(u => u.pk?.toString() === item.user_id?.toString())?.full_name || 
                     thread.users.find(u => u.pk?.toString() === item.user_id?.toString())?.username || 'Unknown',
          content: this.parseMessageText(item),
          messageType: 'text',
          isOutgoing: item.user_id?.toString() === this.cookies?.ds_user_id,
          isRead: true,
          sentAt: new Date(item.timestamp / 1000).toISOString(),
        });
      }

      // Sort messages by time (oldest first)
      messages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

      // Get main participant (first user that's not current user)
      const otherUsers = thread.users.filter(u => u.pk?.toString() !== this.cookies?.ds_user_id);
      const mainUser = otherUsers[0] || thread.users[0];

      const lastMessage = messages[messages.length - 1];

      const conversation: Conversation = {
        id: `instagram_${thread.thread_id}`,
        platform: 'instagram',
        platformConversationId: thread.thread_id,
        participantName: mainUser?.full_name || mainUser?.username || 'Instagram User',
        participantId: mainUser?.pk?.toString() || '',
        participantAvatarUrl: mainUser?.profile_pic_url,
        lastMessage: lastMessage?.content,
        lastMessageAt: lastMessage?.sentAt || new Date(thread.last_activity_at || Date.now()).toISOString(),
        unreadCount: 0,
      };

      conversations.push(conversation);
      
      // Cache conversation and messages
      this.conversationsCache.set(thread.thread_id, conversation);
      this.messagesCache.set(thread.thread_id, messages);
    }

    // Sort by last message time (newest first)
    conversations.sort((a, b) => 
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );

    return conversations;
  }

  /**
   * Trigger auto-relogin when session expires
   */
  private triggerAutoRelogin(): void {
    const now = Date.now();
    
    // Prevent spam - only allow one auto-relogin per minute
    if (now - this.lastAutoReloginAttempt < AUTO_RELOGIN_COOLDOWN) {
      console.log('[InstagramAdapter] Auto-relogin skipped - cooldown active');
      return;
    }
    
    this.lastAutoReloginAttempt = now;
    
    // Check if login window is already open
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      console.log('[InstagramAdapter] Login window already open');
      this.loginWindow.focus();
      return;
    }
    
    console.log('[InstagramAdapter] Opening auto-relogin window...');
    this.emit('reloginRequired', { platform: 'instagram' });
  }

  /**
   * Open browser login window for Instagram
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<InstagramCookies | null> {
    return new Promise((resolve) => {
      const instagramSession = session.fromPartition('instagram-login');
      
      console.log('[InstagramAdapter] Opening login window...');
      
      this.loginWindow = new BrowserWindow({
        width: 450,
        height: 700,
        resizable: true,
        title: 'Instagram Login',
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: instagramSession,
        },
      });

      // Ensure window is shown
      this.loginWindow.show();
      this.loginWindow.focus();
      
      console.log('[InstagramAdapter] Loading Instagram...');
      this.loginWindow.loadURL('https://www.instagram.com/');
      
      let isResolved = false;
      
      const checkForLogin = async () => {
        if (isResolved) return;
        
        try {
          if (!this.loginWindow || this.loginWindow.isDestroyed()) {
            return;
          }

          const currentURL = this.loginWindow.webContents.getURL();
          
          // Check if user is logged in
          if (currentURL.includes('instagram.com') && 
              !currentURL.includes('/accounts/login') && 
              !currentURL.includes('/challenge') &&
              !currentURL.includes('/two_factor')) {
            
            const cookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
            
            let sessionid = '';
            let csrftoken = '';
            let ds_user_id = '';
            let mid = '';
            let ig_did = '';
            let rur = '';

            for (const cookie of cookies) {
              if (cookie.name === 'sessionid') sessionid = cookie.value;
              if (cookie.name === 'csrftoken') csrftoken = cookie.value;
              if (cookie.name === 'ds_user_id') ds_user_id = cookie.value;
              if (cookie.name === 'mid') mid = cookie.value;
              if (cookie.name === 'ig_did') ig_did = cookie.value;
              if (cookie.name === 'rur') rur = cookie.value;
            }

            if (sessionid && csrftoken) {
              isResolved = true;
              
              console.log('[InstagramAdapter] Login successful!');
              
              const instagramCookies: InstagramCookies = { 
                sessionid, csrftoken, ds_user_id, mid, ig_did, rur 
              };

              if (!this.loginWindow.isDestroyed()) {
                this.loginWindow.close();
              }

              resolve(instagramCookies);
              return;
            }
          }
          
          // Keep checking every 2 seconds
          setTimeout(checkForLogin, 2000);
          
        } catch (err: any) {
          console.error('[InstagramAdapter] Login check error:', err.message);
        }
      };

      this.loginWindow.webContents.on('did-finish-load', () => {
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
          console.log('[InstagramAdapter] Login timeout - closing window');
          this.loginWindow.close();
        }
      }, 3 * 60 * 1000);
    });
  }

  /**
   * Fetch all conversations
   * Uses Private API if connected, otherwise browser-based
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Instagram');
    }

    // Use Private API if connected via it
    if (USE_PRIVATE_API && this.privateAPIConnected) {
      try {
        return await this.fetchConversationsViaPrivateAPI();
      } catch (error: any) {
        console.error('[InstagramAdapter] Private API failed:', error.message);
        // Don't fall through to browser method - just return cached or throw
        // This prevents "Not connected" errors when it's actually a timeout
        if (error.message.includes('timeout')) {
          // Return cached conversations on timeout
          const cached = Array.from(this.conversationsCache.values());
          if (cached.length > 0) {
            console.log('[InstagramAdapter] Returning cached conversations due to timeout');
            return cached;
          }
          throw new Error('Request timeout - please try again');
        }
        throw error;
      }
    }

    // Browser-based method
    try {
      const response = await this.fetchInbox();
      return this.parseConversations(response);
    } catch (error: any) {
      console.error('[InstagramAdapter] fetchConversations error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch messages for a specific conversation
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Instagram');
    }

    const threadId = conversationId.replace('instagram_', '');

    // Use Private API if connected via it
    if (USE_PRIVATE_API && this.privateAPIConnected) {
      try {
        return await this.fetchMessagesViaPrivateAPI(threadId);
      } catch (error: any) {
        console.error('[InstagramAdapter] Private API messages failed:', error.message);
        // Fall through to cached
      }
    }

    // Return cached messages if available
    const cached = this.messagesCache.get(threadId);
    if (cached && cached.length > 0) {
      return cached;
    }

    // Fetch fresh data
    await this.fetchConversations();
    return this.messagesCache.get(threadId) || [];
  }

  /**
   * Send a message via Instagram
   * Uses Private API if available (FAST), falls back to browser automation (SLOW)
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    console.log('[InstagramAdapter] sendMessage called:', conversationId, content.substring(0, 30));
    
    if (!this.connected()) {
      console.log('[InstagramAdapter] Not connected!');
      return { success: false, error: 'Not connected to Instagram' };
    }

    const threadId = conversationId.replace('instagram_', '');

    // Try Private API first (FAST - instant send)
    if (USE_PRIVATE_API && this.privateAPIConnected) {
      console.log('[InstagramAdapter] Using Private API to send message');
      const result = await this.sendMessageViaPrivateAPI(threadId, content);
      if (result.success) {
        return result;
      }
      console.log('[InstagramAdapter] Private API send failed, trying browser automation');
    }

    // Fallback to browser automation (SLOW but works)
    try {
      console.log('[InstagramAdapter] Thread ID:', threadId);
      
      const result = await this.sendMessageViaBrowser(threadId, content);
      
      if (result.success) {
        const sentAt = new Date().toISOString();
        const clientContext = `${Date.now()}${Math.random().toString(36).substring(2, 15)}`;
        
        // Create a local message object
        const newMessage: Message = {
          id: clientContext,
          conversationId: conversationId,
          platformMessageId: clientContext,
          senderId: this.cookies?.ds_user_id || '',
          senderName: 'You',
          content: content,
          messageType: 'text',
          isOutgoing: true,
          isRead: true,
          sentAt: sentAt,
        };
        
        // Update cache
        const cachedMessages = this.messagesCache.get(threadId) || [];
        cachedMessages.push(newMessage);
        this.messagesCache.set(threadId, cachedMessages);
        
        // Update conversation's last message
        const conversation = this.conversationsCache.get(threadId);
        if (conversation) {
          conversation.lastMessage = content;
          conversation.lastMessageAt = newMessage.sentAt;
          this.conversationsCache.set(threadId, conversation);
        }
        
        return {
          success: true,
          messageId: clientContext,
          sentAt: sentAt,
        };
      }
      
      return result;
    } catch (error: any) {
      console.error('[InstagramAdapter] sendMessage error:', error.message);
      return {
        success: false,
        error: `Failed to send message: ${error.message}`,
      };
    }
  }

  /**
   * Send message using browser automation (same approach as desktop-app/main.js)
   */
  private sendMessageViaBrowser(threadId: string, content: string): Promise<SendMessageResponse> {
    return new Promise(async (resolve) => {
      const instagramSession = session.fromPartition('instagram-login');
      
      console.log('[InstagramAdapter] Browser automation - sending message...');
      
      // Set cookies in session
      if (this.cookies) {
        const cookiesToSet = [
          { url: 'https://www.instagram.com', name: 'sessionid', value: this.cookies.sessionid, domain: '.instagram.com' },
          { url: 'https://www.instagram.com', name: 'csrftoken', value: this.cookies.csrftoken, domain: '.instagram.com' },
        ];
        if (this.cookies.ds_user_id) {
          cookiesToSet.push({ url: 'https://www.instagram.com', name: 'ds_user_id', value: this.cookies.ds_user_id, domain: '.instagram.com' });
        }
        
        for (const cookie of cookiesToSet) {
          try {
            await instagramSession.cookies.set(cookie);
          } catch (e: any) {
            console.log('[InstagramAdapter] Cookie set warning:', e.message);
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
          session: instagramSession,
        },
      });

      const threadUrl = `https://www.instagram.com/direct/t/${threadId}/`;
      console.log('[InstagramAdapter] Loading thread:', threadUrl);
      
      sendWindow.loadURL(threadUrl);
      
      let isResolved = false;
      let retryCount = 0;
      const maxRetries = 3;

      const tryToSend = async () => {
        if (isResolved) return;
        
        try {
          const currentURL = sendWindow.webContents.getURL();
          console.log('[InstagramAdapter] Current URL:', currentURL);
          
          if (currentURL.includes('/accounts/login') || currentURL.includes('/challenge')) {
            isResolved = true;
            if (!sendWindow.isDestroyed()) sendWindow.close();
            this.triggerAutoRelogin();
            resolve({ success: false, error: 'Instagram session expired. Please re-login.' });
            return;
          }
          
          // Step 1: Type the message
          const typeResult = await sendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                const messageInput = document.querySelector('textarea[placeholder*="Message"]') ||
                                    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                                    document.querySelector('div[aria-label*="Message"]') ||
                                    document.querySelector('[data-lexical-editor="true"]');
                
                if (!messageInput) {
                  return { success: false, error: 'Message input not found' };
                }
                
                messageInput.focus();
                
                if (messageInput.tagName === 'TEXTAREA') {
                  messageInput.value = ${JSON.stringify(content)};
                  messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                  messageInput.textContent = ${JSON.stringify(content)};
                  messageInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(content)} }));
                }
                
                return { success: true, step: 'typed' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[InstagramAdapter] Type result:', typeResult);
          
          if (!typeResult.success) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log('[InstagramAdapter] Retrying... (' + retryCount + '/' + maxRetries + ')');
              setTimeout(tryToSend, 2000);
              return;
            }
            isResolved = true;
            if (!sendWindow.isDestroyed()) sendWindow.close();
            resolve({ success: false, error: typeResult.error || 'Could not type message' });
            return;
          }
          
          // Step 2: Press Enter to send
          await new Promise(r => setTimeout(r, 500));
          
          const sendResult = await sendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                const messageInput = document.querySelector('textarea[placeholder*="Message"]') ||
                                    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                                    document.querySelector('[data-lexical-editor="true"]');
                
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
                
                const sendButton = document.querySelector('button[type="submit"]');
                if (sendButton) {
                  sendButton.click();
                  return { success: true, method: 'click' };
                }
                
                return { success: false, error: 'Could not send message' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[InstagramAdapter] Send result:', sendResult);
          
          await new Promise(r => setTimeout(r, 2000));
          
          isResolved = true;
          
          // Update cookies if changed
          try {
            const updatedCookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
            for (const cookie of updatedCookies) {
              if (cookie.name === 'sessionid' && this.cookies) this.cookies.sessionid = cookie.value;
              if (cookie.name === 'csrftoken' && this.cookies) this.cookies.csrftoken = cookie.value;
            }
          } catch (e) {}
          
          if (!sendWindow.isDestroyed()) sendWindow.close();
          
          if (sendResult.success) {
            resolve({ success: true, messageId: 'browser_' + Date.now() });
          } else {
            resolve({ success: false, error: sendResult.error || 'Failed to send' });
          }
          
        } catch (err: any) {
          console.error('[InstagramAdapter] Browser automation error:', err.message);
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
        console.log('[InstagramAdapter] Page loaded, waiting for DOM...');
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

    console.log('[InstagramAdapter] Starting real-time polling');
    
    this.pollingTimer = setInterval(async () => {
      if (!this.connected()) {
        this.stopRealTime();
        return;
      }

      try {
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
                platform: 'instagram',
                conversationId: conversation.id,
                message: msg,
              });
            }
          }
        }
      } catch (error: any) {
        // Don't emit error for timeouts - just log and continue polling
        if (!error.message.includes('timeout')) {
          console.error('[InstagramAdapter] Polling error:', error.message);
          this.emit('error', { platform: 'instagram', error: error.message });
        } else {
          console.log('[InstagramAdapter] Polling timeout - will retry');
        }
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
      console.log('[InstagramAdapter] Stopped real-time polling');
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
let instagramAdapter: InstagramAdapter | null = null;

export function getInstagramAdapter(): InstagramAdapter {
  if (!instagramAdapter) {
    instagramAdapter = new InstagramAdapter();
  }
  return instagramAdapter;
}
