/**
 * Microsoft Teams Web Bridge Adapter
 * Uses stealth BrowserWindow to interact with Teams web client
 * Works with both Personal and Work/School accounts
 * 
 * Optimizations:
 * - Resource blocking (images, telemetry) for 60-70% RAM reduction
 * - Network interception for stable data extraction
 * - CPU throttling in background mode
 * - Persistent sessions
 */

import { EventEmitter } from 'events';
import { BrowserWindow, session, app, ipcMain } from 'electron';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import type { 
  Platform, 
  Conversation, 
  Message, 
  PlatformCredentials,
  SendMessageResponse 
} from '../../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Teams URLs
const TEAMS_URL = 'https://teams.microsoft.com/v2/';
const TEAMS_LITE_URL = 'https://teams.live.com/';

// Blocked resources for RAM optimization
const BLOCKED_EXTENSIONS = ['.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico', '.woff', '.woff2', '.ttf'];
const BLOCKED_DOMAINS = [
  'vortex.data.microsoft.com',
  'browser.events.data.microsoft.com',
  'self.events.data.microsoft.com',
  'mobile.events.data.microsoft.com',
  'umwatson.events.data.microsoft.com',
  'ceuswatcab01.blob.core.windows.net',
  'ceuswatcab02.blob.core.windows.net',
  'eaus2watcab01.blob.core.windows.net',
  'eaus2watcab02.blob.core.windows.net',
  'weus2watcab01.blob.core.windows.net',
  'weus2watcab02.blob.core.windows.net',
];

// Modern User Agent
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36 Edg/120.0.0.0';

interface TeamsBridgeState {
  isLoggedIn: boolean;
  userId?: string;
  userName?: string;
  tenants?: Array<{ id: string; name: string }>;
  activeTenant?: string;
  lastSync?: string;
}

interface TeamsConversation {
  id: string;
  type: 'oneOnOne' | 'group' | 'meeting' | 'channel';
  title: string;
  participants: Array<{ id: string; name: string; avatar?: string }>;
  lastMessage?: string;
  lastMessageTime?: string;
  unreadCount: number;
}

interface TeamsMessage {
  id: string;
  conversationId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: string;
  isOutgoing: boolean;
  attachments?: Array<{ type: string; url: string; name: string }>;
}

export class TeamsAdapter extends EventEmitter {
  readonly platform: Platform = 'teams' as Platform;
  
  private bridgeWindow: BrowserWindow | null = null;
  private isConnected: boolean = false;
  private isInitialized: boolean = false;
  private bridgeState: TeamsBridgeState = { isLoggedIn: false };
  private stateFilePath: string;
  private teamsSession: Electron.Session | null = null;
  
  // Caches
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  
  // Network intercepted data
  private interceptedChats: Map<string, any> = new Map();
  private interceptedMessages: Map<string, any[]> = new Map();
  
  // Background mode
  private isInBackground: boolean = false;
  private messageQueue: TeamsMessage[] = [];

  constructor() {
    super();
    this.stateFilePath = path.join(app.getPath('userData'), 'teams-bridge-state.json');
    this.loadState();
    this.setupIpcHandlers();
    console.log('[TeamsAdapter] Initialized with Web Bridge mode');
  }

  // ============================================
  // State Management
  // ============================================

  private loadState(): void {
    try {
      if (fs.existsSync(this.stateFilePath)) {
        const data = fs.readFileSync(this.stateFilePath, 'utf-8');
        this.bridgeState = JSON.parse(data);
        console.log('[TeamsAdapter] Loaded saved state');
      }
    } catch (error) {
      console.error('[TeamsAdapter] Failed to load state:', error);
      this.bridgeState = { isLoggedIn: false };
    }
  }

  private saveState(): void {
    try {
      fs.writeFileSync(this.stateFilePath, JSON.stringify(this.bridgeState, null, 2));
    } catch (error) {
      console.error('[TeamsAdapter] Failed to save state:', error);
    }
  }

  // ============================================
  // IPC Handlers (Communication with preload)
  // ============================================

  private setupIpcHandlers(): void {
    // Login status from bridge
    ipcMain.on('teams-bridge:logged-in', (_event, data: { userId: string; userName: string; tenants?: any[] }) => {
      console.log('[TeamsAdapter] Login detected:', data.userName);
      this.bridgeState.isLoggedIn = true;
      this.bridgeState.userId = data.userId;
      this.bridgeState.userName = data.userName;
      this.bridgeState.tenants = data.tenants;
      this.isConnected = true;
      this.saveState();
      this.emit('connected');
      
      // Hide window after login
      if (this.bridgeWindow && !this.bridgeWindow.isDestroyed()) {
        this.bridgeWindow.hide();
        this.setBackgroundMode(true);
      }
    });

    // Logout detected
    ipcMain.on('teams-bridge:logged-out', () => {
      console.log('[TeamsAdapter] Logout detected');
      this.bridgeState.isLoggedIn = false;
      this.isConnected = false;
      this.saveState();
      this.emit('disconnected');
    });

    // New conversations from bridge
    ipcMain.on('teams-bridge:conversations', (_event, conversations: TeamsConversation[]) => {
      console.log('[TeamsAdapter] Received', conversations.length, 'conversations from bridge');
      this.processConversations(conversations);
    });

    // New messages from bridge
    ipcMain.on('teams-bridge:new-message', (_event, message: TeamsMessage) => {
      console.log('[TeamsAdapter] New message from:', message.senderName);
      this.processNewMessage(message);
    });

    // Messages for a conversation
    ipcMain.on('teams-bridge:messages', (_event, data: { conversationId: string; messages: TeamsMessage[] }) => {
      console.log('[TeamsAdapter] Received', data.messages.length, 'messages for', data.conversationId);
      this.processMessages(data.conversationId, data.messages);
    });

    // Error from bridge
    ipcMain.on('teams-bridge:error', (_event, error: string) => {
      console.error('[TeamsAdapter] Bridge error:', error);
      this.emit('error', { platform: 'teams', error });
    });

    // Tenant switch
    ipcMain.on('teams-bridge:tenant-changed', (_event, tenantId: string) => {
      console.log('[TeamsAdapter] Tenant changed to:', tenantId);
      this.bridgeState.activeTenant = tenantId;
      this.saveState();
      // Clear caches on tenant switch
      this.conversationsCache.clear();
      this.messagesCache.clear();
    });
  }

  // ============================================
  // Bridge Window Management
  // ============================================

  /**
   * Initialize the Teams bridge window
   */
  async initializeBridge(): Promise<boolean> {
    if (this.isInitialized && this.bridgeWindow && !this.bridgeWindow.isDestroyed()) {
      return true;
    }

    console.log('[TeamsAdapter] Initializing bridge...');

    try {
      // Create persistent session - THIS IS KEY FOR SESSION PERSISTENCE
      // 'persist:' prefix ensures cookies/localStorage survive app restarts
      this.teamsSession = session.fromPartition('persist:teams-bridge', { cache: true });
      
      // Setup resource blocking for RAM optimization
      this.setupResourceBlocking();
      
      // Setup network interception for data extraction
      this.setupNetworkInterception();

      // Create hidden bridge window
      this.bridgeWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false, // Hidden by default
        webPreferences: {
          preload: path.join(__dirname, '../../preload/preload/TeamsPreload.cjs'),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: false,
          session: this.teamsSession,
          backgroundThrottling: false, // We'll handle throttling ourselves
        },
      });

      // Set modern user agent
      this.bridgeWindow.webContents.setUserAgent(USER_AGENT);

      // Handle window events
      this.bridgeWindow.on('closed', () => {
        this.bridgeWindow = null;
        this.isInitialized = false;
      });

      this.bridgeWindow.webContents.on('crashed', () => {
        console.error('[TeamsAdapter] Bridge window crashed, reinitializing...');
        this.bridgeWindow = null;
        this.isInitialized = false;
        // Auto-recover
        setTimeout(() => this.initializeBridge(), 2000);
      });
      
      // Handle navigation - detect login page vs logged in
      this.bridgeWindow.webContents.on('did-navigate', (_event, url) => {
        console.log('[TeamsAdapter] Navigated to:', url);
        this.handleNavigation(url);
      });
      
      this.bridgeWindow.webContents.on('did-finish-load', () => {
        const url = this.bridgeWindow?.webContents.getURL() || '';
        console.log('[TeamsAdapter] Page loaded:', url);
        
        // Check if we're on Teams main page (logged in)
        if (url.includes('teams.microsoft.com') && !url.includes('login') && !url.includes('oauth')) {
          // Give page time to render, then check login
          setTimeout(() => {
            this.checkLoginStatus();
          }, 3000);
        }
      });

      // Load Teams
      console.log('[TeamsAdapter] Loading Teams...');
      await this.bridgeWindow.loadURL(TEAMS_URL);
      
      this.isInitialized = true;
      console.log('[TeamsAdapter] Bridge initialized');

      return true;
    } catch (error: any) {
      console.error('[TeamsAdapter] Failed to initialize bridge:', error.message);
      this.emit('error', { platform: 'teams', error: error.message });
      return false;
    }
  }
  
  /**
   * Handle navigation events
   */
  private handleNavigation(url: string): void {
    // Check if on login page
    if (url.includes('login.microsoftonline.com') || 
        url.includes('login.live.com') ||
        url.includes('/oauth')) {
      console.log('[TeamsAdapter] On login page');
      // Show window for login
      if (this.bridgeWindow && !this.bridgeWindow.isDestroyed()) {
        this.bridgeWindow.show();
        this.setBackgroundMode(false);
      }
    }
    
    // Check if redirected back to Teams after login
    if (url.includes('teams.microsoft.com') && !url.includes('login')) {
      console.log('[TeamsAdapter] Back on Teams - checking login status...');
      setTimeout(() => {
        this.checkLoginStatus();
      }, 3000);
    }
  }

  /**
   * Setup resource blocking for RAM optimization
   * Blocks images, fonts, telemetry - reduces RAM by 60-70%
   */
  private setupResourceBlocking(): void {
    if (!this.teamsSession) return;

    this.teamsSession.webRequest.onBeforeRequest({ urls: ['*://*/*'] }, (details, callback) => {
      const url = details.url.toLowerCase();
      
      // Block telemetry/analytics
      for (const domain of BLOCKED_DOMAINS) {
        if (url.includes(domain)) {
          callback({ cancel: true });
          return;
        }
      }
      
      // Block heavy assets (images, fonts) - keep CSS for layout
      for (const ext of BLOCKED_EXTENSIONS) {
        if (url.endsWith(ext)) {
          // Allow essential Microsoft assets
          if (!url.includes('teams.microsoft.com/assets/') && !url.includes('statics.teams.cdn')) {
            callback({ cancel: true });
            return;
          }
        }
      }
      
      callback({ cancel: false });
    });

    console.log('[TeamsAdapter] Resource blocking enabled');
  }

  /**
   * Setup network interception for data extraction
   * More stable than DOM scraping - intercepts Teams' own API calls
   */
  private setupNetworkInterception(): void {
    if (!this.teamsSession) return;

    this.teamsSession.webRequest.onCompleted({ urls: ['*://*/*'] }, (details) => {
      const url = details.url;
      
      // Intercept chat list API calls
      if (url.includes('/api/csa/') && url.includes('conversations')) {
        // Teams fetched conversations - trigger extraction
        this.requestDataFromBridge('conversations');
      }
      
      // Intercept message API calls
      if (url.includes('/api/csa/') && url.includes('messages')) {
        // Teams fetched messages - trigger extraction
        const match = url.match(/conversations\/([^\/]+)\/messages/);
        if (match) {
          this.requestDataFromBridge('messages', match[1]);
        }
      }
      
      // Intercept GraphQL calls (Teams uses these too)
      if (url.includes('graph.microsoft.com') || url.includes('substrate.office.com')) {
        // Could contain chat data
        this.requestDataFromBridge('conversations');
      }
    });

    console.log('[TeamsAdapter] Network interception enabled');
  }

  /**
   * Request data extraction from bridge preload script
   */
  private requestDataFromBridge(type: 'conversations' | 'messages', conversationId?: string): void {
    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) return;
    
    this.bridgeWindow.webContents.send('teams-bridge:extract', { type, conversationId });
  }

  /**
   * Check login status via bridge - also check URL and cookies
   */
  private async checkLoginStatus(): Promise<void> {
    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) return;
    
    const url = this.bridgeWindow.webContents.getURL();
    console.log('[TeamsAdapter] Checking login status, URL:', url);
    
    // If on login page, not logged in
    if (url.includes('login.microsoftonline.com') || url.includes('login.live.com')) {
      console.log('[TeamsAdapter] On login page - not logged in');
      return;
    }
    
    // If on Teams main page, try to detect login from page content
    if (url.includes('teams.microsoft.com') || url.includes('teams.live.com')) {
      try {
        // Try to detect login from main process by checking page content
        const loginCheck = await this.bridgeWindow.webContents.executeJavaScript(`
          (function() {
            // Check for Teams v2 logged-in indicators
            const chatList = document.querySelector('[role="tree"], [class*="chat-list"], [data-tid="chat-list"]');
            const leftRail = document.querySelector('[data-tid="left-rail"], [class*="leftRail"], [class*="left-rail"]');
            const avatar = document.querySelector('[data-tid="avatar"], .fui-Avatar, [class*="avatar"]');
            const chatNav = document.querySelector('[aria-label="Chat"], [data-tid="chat-tab"]');
            const appBar = document.querySelector('[class*="app-bar"], [data-tid="app-bar"]');
            const chatButton = document.querySelector('[data-tid="chat-button"], [aria-label*="Chat"]');
            
            const isTeamsPage = window.location.href.includes('teams.microsoft.com') || window.location.href.includes('teams.live.com');
            const notLoginPage = !window.location.href.includes('login.microsoftonline') && !window.location.href.includes('login.live.com');
            
            const hasTeamsUI = !!(chatList || leftRail || avatar || chatNav || appBar || chatButton);
            
            console.log('[Teams Check] chatList:', !!chatList, 'leftRail:', !!leftRail, 'avatar:', !!avatar, 'chatNav:', !!chatNav, 'appBar:', !!appBar);
            
            // Try to get user name
            let userName = 'Teams User';
            const profileBtn = document.querySelector('[data-tid="me-control"], [aria-label*="profile"], [aria-label*="Profile"]');
            if (profileBtn) {
              const label = profileBtn.getAttribute('aria-label') || '';
              userName = label.replace('Profile, ', '').replace('profile, ', '') || userName;
            }
            if (userName === 'Teams User') {
              const nameEl = document.querySelector('[class*="userName"], [class*="displayName"]');
              if (nameEl) userName = nameEl.textContent?.trim() || userName;
            }
            
            return {
              isLoggedIn: isTeamsPage && notLoginPage && hasTeamsUI,
              userName,
              hasTeamsUI
            };
          })()
        `);
        
        console.log('[TeamsAdapter] Login check result:', loginCheck);
        
        if (loginCheck?.isLoggedIn && !this.isConnected) {
          // Mark as connected
          this.bridgeState.isLoggedIn = true;
          this.bridgeState.userId = 'teams_' + Date.now();
          this.bridgeState.userName = loginCheck.userName || 'Teams User';
          this.isConnected = true;
          this.saveState();
          
          console.log('[TeamsAdapter] ✓ Login confirmed:', this.bridgeState.userName);
          this.emit('connected');
          
          // Hide window after login
          if (this.bridgeWindow && !this.bridgeWindow.isDestroyed()) {
            this.bridgeWindow.hide();
            this.setBackgroundMode(true);
          }
          
          // Extract initial conversations
          setTimeout(() => {
            this.extractConversationsFromBridge();
          }, 2000);
        } else if (!loginCheck?.hasTeamsUI) {
          // Page still loading, check again
          console.log('[TeamsAdapter] Teams UI not found yet, will retry...');
          setTimeout(() => this.checkLoginStatus(), 3000);
        }
      } catch (error: any) {
        console.error('[TeamsAdapter] Login check error:', error.message);
      }
    }
  }
  
  /**
   * Extract conversations directly from bridge window
   */
  private async extractConversationsFromBridge(): Promise<void> {
    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) return;
    
    try {
      const conversations = await this.bridgeWindow.webContents.executeJavaScript(`
        (function() {
          const conversations = [];
          const seen = new Set();
          
          // Try multiple selectors for Teams v2
          let items = document.querySelectorAll('[role="treeitem"], [data-tid="chat-list-item"], [class*="chatListItem"]');
          
          console.log('[Teams Extract] Found', items.length, 'items');
          
          items.forEach((item, index) => {
            try {
              // Get title first for deduplication
              let title = '';
              const titleEl = item.querySelector('[class*="title"], [class*="displayName"], span[dir="auto"]');
              if (titleEl) title = titleEl.textContent?.trim() || '';
              if (!title) title = item.getAttribute('aria-label')?.split(',')[0] || '';
              
              if (!title || title === 'Unknown') return;
              
              // Create unique ID based on title to deduplicate
              const uniqueKey = title.toLowerCase().replace(/\s+/g, '_');
              if (seen.has(uniqueKey)) return;
              seen.add(uniqueKey);
              
              const id = item.getAttribute('data-tid') || 
                         item.getAttribute('id') ||
                         uniqueKey;
              
              // Get preview
              let preview = '';
              const previewEl = item.querySelector('[class*="preview"], [class*="lastMessage"], [class*="secondary"]');
              if (previewEl) preview = previewEl.textContent?.trim() || '';
              
              // Get time
              let time = '';
              const timeEl = item.querySelector('time, [class*="timestamp"]');
              if (timeEl) time = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
              
              // Unread
              const unreadEl = item.querySelector('[class*="unread"], [class*="badge"]');
              const unreadCount = unreadEl ? parseInt(unreadEl.textContent || '1') || 1 : 0;
              
              conversations.push({
                id,
                type: 'oneOnOne',
                title,
                participants: [{ id: uniqueKey, name: title }],
                lastMessage: preview,
                lastMessageTime: time || new Date().toISOString(),
                unreadCount
              });
            } catch (e) {}
          });
          
          return conversations;
        })()
      `);
      
      console.log('[TeamsAdapter] Extracted', conversations?.length || 0, 'conversations');
      
      if (conversations && conversations.length > 0) {
        this.processConversations(conversations);
      }
    } catch (error: any) {
      console.error('[TeamsAdapter] Extract conversations error:', error.message);
    }
  }

  /**
   * Set background mode for CPU optimization
   */
  private setBackgroundMode(enabled: boolean): void {
    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) return;
    
    this.isInBackground = enabled;
    
    if (enabled) {
      // Mute audio
      this.bridgeWindow.webContents.setAudioMuted(true);
      // Throttle frame rate to 1 FPS
      this.bridgeWindow.webContents.setFrameRate(1);
      console.log('[TeamsAdapter] Background mode enabled (1 FPS, muted)');
    } else {
      this.bridgeWindow.webContents.setAudioMuted(false);
      this.bridgeWindow.webContents.setFrameRate(60);
      console.log('[TeamsAdapter] Background mode disabled');
    }
  }

  // ============================================
  // Public API
  // ============================================

  /**
   * Connect to Teams - auto-restores session if available
   */
  async connect(credentials?: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    console.log('[TeamsAdapter] Connect called');
    
    // Initialize bridge if not already
    const initialized = await this.initializeBridge();
    if (!initialized) {
      return { success: false, error: 'Failed to initialize Teams bridge' };
    }

    // Wait for page to load
    await this.delay(2000);
    
    // Check login status
    await this.checkLoginStatus();
    
    // Wait a bit more for login detection
    await this.delay(2000);
    
    if (this.isConnected) {
      console.log('[TeamsAdapter] Already connected:', this.bridgeState.userName);
      return {
        success: true,
        userId: this.bridgeState.userId,
        username: this.bridgeState.userName,
      };
    }

    // Not logged in - need to show login window
    console.log('[TeamsAdapter] Not logged in, showing login window...');
    return { 
      success: false, 
      error: 'Please login via Teams login window',
    };
  }

  /**
   * Open login window for user to authenticate
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<{ success: boolean; error?: string }> {
    console.log('[TeamsAdapter] Opening login window...');
    
    // Initialize bridge if not already
    const initialized = await this.initializeBridge();
    if (!initialized) {
      return { success: false, error: 'Failed to initialize Teams bridge' };
    }

    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) {
      return { success: false, error: 'Bridge window not available' };
    }

    // Show the bridge window for login
    this.bridgeWindow.show();
    this.bridgeWindow.focus();
    this.setBackgroundMode(false);

    // Return immediately - login will be detected via IPC
    return { success: true };
  }

  /**
   * Disconnect from Teams
   */
  async disconnect(): Promise<void> {
    console.log('[TeamsAdapter] Disconnecting...');
    
    this.isConnected = false;
    this.bridgeState.isLoggedIn = false;
    this.saveState();
    
    // Clear session cookies
    if (this.teamsSession) {
      await this.teamsSession.clearStorageData();
    }
    
    // Close bridge window
    if (this.bridgeWindow && !this.bridgeWindow.isDestroyed()) {
      this.bridgeWindow.close();
      this.bridgeWindow = null;
    }
    
    this.isInitialized = false;
    this.conversationsCache.clear();
    this.messagesCache.clear();
    
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.isConnected && this.bridgeState.isLoggedIn;
  }

  /**
   * Get user ID
   */
  getUserId(): string | null {
    return this.bridgeState.userId || null;
  }

  /**
   * Get username
   */
  getUsername(): string | null {
    return this.bridgeState.userName || null;
  }

  /**
   * Get connection status
   */
  getStatus(): string {
    if (this.isConnected) return 'connected';
    if (this.isInitialized) return 'connecting';
    return 'disconnected';
  }

  /**
   * Get available tenants (for work accounts with multiple orgs)
   */
  getTenants(): Array<{ id: string; name: string }> {
    return this.bridgeState.tenants || [];
  }

  /**
   * Switch tenant
   */
  async switchTenant(tenantId: string): Promise<boolean> {
    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) return false;
    
    this.bridgeWindow.webContents.send('teams-bridge:switch-tenant', tenantId);
    return true;
  }

  // ============================================
  // Data Operations
  // ============================================

  /**
   * Fetch conversations
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Teams');
    }

    // Request fresh data from bridge
    this.requestDataFromBridge('conversations');
    
    // Wait a bit for data
    await this.delay(1000);
    
    // Return cached data
    return Array.from(this.conversationsCache.values());
  }

  /**
   * Fetch messages for a conversation
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Teams');
    }

    const teamsConvId = conversationId.replace('teams_', '');
    
    console.log('[TeamsAdapter] fetchMessages called for:', teamsConvId);
    
    // Check cache first
    const cached = this.messagesCache.get(teamsConvId);
    if (cached && cached.length > 0) {
      console.log('[TeamsAdapter] Returning', cached.length, 'cached messages');
      return cached;
    }

    // Request from bridge
    if (this.bridgeWindow && !this.bridgeWindow.isDestroyed()) {
      console.log('[TeamsAdapter] Requesting messages from bridge...');
      this.bridgeWindow.webContents.send('teams-bridge:load-conversation', teamsConvId);
    }
    
    // Wait for data
    await this.delay(1500);
    
    const messages = this.messagesCache.get(teamsConvId) || [];
    console.log('[TeamsAdapter] Returning', messages.length, 'messages after bridge request');
    return messages;
  }

  /**
   * Send a message
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected()) {
      return { success: false, error: 'Not connected to Teams' };
    }

    const teamsConvId = conversationId.replace('teams_', '');

    if (!this.bridgeWindow || this.bridgeWindow.isDestroyed()) {
      return { success: false, error: 'Bridge not available' };
    }

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        resolve({ success: false, error: 'Send message timeout' });
      }, 10000);

      // Listen for send result
      const handler = (_event: any, result: { success: boolean; messageId?: string; error?: string }) => {
        clearTimeout(timeout);
        ipcMain.removeListener('teams-bridge:message-sent', handler);
        
        if (result.success) {
          resolve({
            success: true,
            messageId: result.messageId,
            sentAt: new Date().toISOString(),
          });
        } else {
          resolve({ success: false, error: result.error });
        }
      };

      ipcMain.on('teams-bridge:message-sent', handler);

      // Send command to bridge
      this.bridgeWindow!.webContents.send('teams-bridge:send-message', {
        conversationId: teamsConvId,
        content,
      });
    });
  }

  // ============================================
  // Data Processing
  // ============================================

  private processConversations(teamsConversations: TeamsConversation[]): void {
    // Clear cache to avoid duplicates
    this.conversationsCache.clear();
    
    // Use Set to track unique titles (case-insensitive)
    const seenTitles = new Set<string>();
    
    for (const conv of teamsConversations) {
      const normalizedTitle = (conv.title || '').toLowerCase().trim();
      
      // Skip if already seen by title
      if (seenTitles.has(normalizedTitle)) {
        console.log('[TeamsAdapter] Skipping duplicate:', conv.title);
        continue;
      }
      seenTitles.add(normalizedTitle);
      
      const conversation: Conversation = {
        id: `teams_${conv.id}`,
        platform: 'teams' as Platform,
        platformConversationId: conv.id,
        participantName: conv.title || conv.participants.map(p => p.name).join(', ') || 'Teams Chat',
        participantId: conv.participants[0]?.id || conv.id,
        participantAvatarUrl: conv.participants[0]?.avatar,
        lastMessage: conv.lastMessage,
        lastMessageAt: conv.lastMessageTime || new Date().toISOString(),
        unreadCount: conv.unreadCount || 0,
      };
      
      this.conversationsCache.set(conv.id, conversation);
    }
    
    console.log('[TeamsAdapter] Processed', this.conversationsCache.size, 'unique conversations');
    this.emit('conversationsUpdated', { conversations: Array.from(this.conversationsCache.values()) });
  }

  private processMessages(conversationId: string, teamsMessages: TeamsMessage[]): void {
    const messages: Message[] = teamsMessages.map(msg => ({
      id: msg.id,
      conversationId: `teams_${conversationId}`,
      platformMessageId: msg.id,
      senderId: msg.senderId,
      senderName: msg.senderName,
      content: msg.content,
      messageType: 'text',
      isOutgoing: msg.isOutgoing,
      isRead: true,
      sentAt: msg.timestamp,
    }));
    
    // Sort oldest first
    messages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
    
    this.messagesCache.set(conversationId, messages);
  }

  private processNewMessage(teamsMessage: TeamsMessage): void {
    const message: Message = {
      id: teamsMessage.id,
      conversationId: `teams_${teamsMessage.conversationId}`,
      platformMessageId: teamsMessage.id,
      senderId: teamsMessage.senderId,
      senderName: teamsMessage.senderName,
      content: teamsMessage.content,
      messageType: 'text',
      isOutgoing: teamsMessage.isOutgoing,
      isRead: false,
      sentAt: teamsMessage.timestamp,
    };

    // Add to cache
    const cached = this.messagesCache.get(teamsMessage.conversationId) || [];
    cached.push(message);
    this.messagesCache.set(teamsMessage.conversationId, cached);

    // Emit new message event
    this.emit('newMessage', {
      platform: 'teams',
      conversationId: `teams_${teamsMessage.conversationId}`,
      message,
    });
  }

  // ============================================
  // Utilities
  // ============================================

  private delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Start real-time updates (no-op for bridge, it's always listening)
   */
  startRealTime(): void {
    console.log('[TeamsAdapter] Real-time is always active via bridge');
  }

  /**
   * Stop real-time updates
   */
  stopRealTime(): void {
    // Bridge handles this automatically
  }
}

// Singleton
let teamsAdapter: TeamsAdapter | null = null;

export function getTeamsAdapter(): TeamsAdapter {
  if (!teamsAdapter) {
    teamsAdapter = new TeamsAdapter();
  }
  return teamsAdapter;
}
