import { EventEmitter } from 'events';
import { BrowserWindow, session, ipcMain } from 'electron';
import { v4 as uuidv4 } from 'uuid';
import type { 
  Platform, 
  Conversation, 
  Message, 
  PlatformCredentials,
  SendMessageResponse 
} from '../../shared/types.js';

/**
 * LinkedIn Platform Adapter - Texts.com Style Implementation
 * 
 * Strategy: Runtime Script Injection & Network Interception
 * 
 * We DON'T make direct API calls (Axios/fetch) - LinkedIn blocks those.
 * Instead we:
 * 1. Load REAL LinkedIn messaging page in a stealth BrowserWindow
 * 2. Let user login once - creates genuine TLS-fingerprinted session
 * 3. Intercept LinkedIn's own API responses via session.webRequest
 * 4. Inject MutationObserver to detect DOM changes in real-time
 * 5. Extract data and pass back via IPC
 * 
 * LinkedIn sees this as a REAL user browsing their messages.
 */

// ============================================
// Constants
// ============================================
const LINKEDIN_MESSAGING_URL = 'https://www.linkedin.com/messaging/';
const LINKEDIN_BASE_URL = 'https://www.linkedin.com';
const POLLING_INTERVAL = 60000; // 60 seconds for polling fallback
const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';

interface LinkedInCookies {
  li_at: string;
  JSESSIONID: string;
  bcookie?: string;
  bscookie?: string;
}

interface InterceptedConversation {
  entityUrn: string;
  lastActivityAt: number;
  participants: any[];
  events?: any[];
}

interface InterceptedMessage {
  entityUrn: string;
  createdAt: number;
  eventContent?: any;
  from?: any;
}

export class LinkedInAdapter extends EventEmitter {
  readonly platform: Platform = 'linkedin';
  
  // Authentication
  private cookies: LinkedInCookies | null = null;
  
  // State
  private isConnected: boolean = false;
  private pollingTimer: NodeJS.Timeout | null = null;
  
  // Persistent Browser Window (Texts.com style - keep alive)
  private browserWindow: BrowserWindow | null = null;
  private loginWindow: BrowserWindow | null = null;
  private linkedinSession: Electron.Session | null = null;
  
  // Cache - populated from intercepted network responses
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();
  
  // Network interception data store
  private interceptedData: {
    conversations: Map<string, any>;
    messages: Map<string, any[]>;
    profiles: Map<string, any>;
  } = {
    conversations: new Map(),
    messages: new Map(),
    profiles: new Map(),
  };

  constructor() {
    super();
    this.setupIPCHandlers();
  }

  // ============================================
  // IPC Handlers for Preload Script Communication
  // ============================================
  
  private setupIPCHandlers(): void {
    // Remove existing handlers to avoid duplicates
    ipcMain.removeHandler('linkedin:dom-data');
    ipcMain.removeHandler('linkedin:conversation-update');
    ipcMain.removeHandler('linkedin:message-update');
    
    // Handle DOM extracted data from preload script
    ipcMain.handle('linkedin:dom-data', (_event, data: any) => {
      console.log('[LinkedInAdapter] Received DOM data:', data?.type);
      this.handleDOMData(data);
      return { success: true };
    });
    
    // Handle real-time conversation updates from MutationObserver
    ipcMain.handle('linkedin:conversation-update', (_event, conversations: any[]) => {
      console.log('[LinkedInAdapter] Conversation update:', conversations?.length);
      this.handleConversationUpdate(conversations);
      return { success: true };
    });
    
    // Handle real-time message updates
    ipcMain.handle('linkedin:message-update', (_event, data: any) => {
      console.log('[LinkedInAdapter] Message update for:', data?.conversationId);
      this.handleMessageUpdate(data);
      return { success: true };
    });
  }

  private handleDOMData(data: any): void {
    if (!data) return;
    
    switch (data.type) {
      case 'CONVERSATIONS':
        this.processDOMConversations(data.conversations || []);
        break;
      case 'MESSAGES':
        this.processDOMMessages(data.conversationId, data.messages || []);
        break;
      case 'LOGIN_REQUIRED':
        this.isConnected = false;
        this.emit('reloginRequired');
        break;
    }
  }

  private handleConversationUpdate(conversations: any[]): void {
    for (const conv of conversations) {
      const existing = this.conversationsCache.get(conv.id);
      if (!existing || existing.lastMessage !== conv.lastMessage) {
        const conversation = this.convertToConversation(conv);
        this.conversationsCache.set(conv.id, conversation);
        this.emit('conversationUpdated', {
          platform: 'linkedin',
          conversationId: conversation.id,
          conversation,
        });
      }
    }
  }

  private handleMessageUpdate(data: any): void {
    if (!data?.conversationId || !data?.messages) return;
    
    const messages = data.messages.map((msg: any) => this.convertToMessage(data.conversationId, msg));
    this.messagesCache.set(data.conversationId, messages);
    
    // Emit new message event for the latest message
    if (messages.length > 0) {
      const latestMessage = messages[messages.length - 1];
      this.emit('newMessage', {
        platform: 'linkedin',
        conversationId: data.conversationId,
        message: latestMessage,
      });
    }
  }

  // ============================================
  // Network Response Interception (Core Strategy)
  // ============================================
  
  private setupNetworkInterception(): void {
    if (!this.linkedinSession) return;
    
    console.log('[LinkedInAdapter] Setting up network interception...');
    
    // Intercept completed requests to capture LinkedIn's API responses
    this.linkedinSession.webRequest.onCompleted(
      { urls: ['*://*.linkedin.com/voyager/api/*'] },
      (details) => {
        // We can't read response body directly from onCompleted
        // But we can track which endpoints were called
        this.trackAPICall(details.url, details.statusCode);
      }
    );
    
    // Block unnecessary resources for performance
    this.linkedinSession.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const url = details.url.toLowerCase();
        
        // Block heavy resources we don't need
        if (
          url.includes('analytics') ||
          url.includes('tracking') ||
          url.includes('beacon') ||
          url.includes('ads') ||
          url.includes('media-exp') ||
          url.includes('.mp4') ||
          url.includes('.webm') ||
          (url.includes('.jpg') && !url.includes('profile')) ||
          (url.includes('.png') && !url.includes('profile')) ||
          url.includes('.gif') ||
          url.includes('.woff2') ||
          url.includes('.woff') ||
          url.includes('li.protechts.net')
        ) {
          callback({ cancel: true });
          return;
        }
        
        callback({});
      }
    );
  }

  private trackAPICall(url: string, statusCode: number): void {
    // Log API calls for debugging
    if (url.includes('/messaging/')) {
      console.log(`[LinkedInAdapter] API: ${url.split('?')[0]} - ${statusCode}`);
    }
  }

  // ============================================
  // Persistent Hidden Browser Window
  // ============================================
  
  private async createPersistentBrowser(): Promise<BrowserWindow> {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      return this.browserWindow;
    }
    
    console.log('[LinkedInAdapter] Creating persistent browser window...');
    
    // Create dedicated session for LinkedIn
    this.linkedinSession = session.fromPartition('persist:linkedin', { cache: true });
    
    // Set up network interception
    this.setupNetworkInterception();
    
    // Block permission requests
    this.linkedinSession.setPermissionRequestHandler((_webContents, permission, callback) => {
      // Block notifications, geolocation, etc.
      callback(false);
    });
    
    this.browserWindow = new BrowserWindow({
      width: 1280,
      height: 800,
      show: false, // Hidden - Texts.com style
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: this.linkedinSession,
        // Preload script for injection
        preload: undefined, // We'll inject via executeJavaScript instead
        webSecurity: true,
        allowRunningInsecureContent: false,
      },
    });
    
    // DevTools disabled for production
    // this.browserWindow.webContents.openDevTools();
    
    // Set realistic User-Agent
    this.browserWindow.webContents.setUserAgent(USER_AGENT);
    
    // Handle navigation events
    this.browserWindow.webContents.on('did-navigate', (_event, url) => {
      console.log('[LinkedInAdapter] Navigated to:', url);
      this.handleNavigation(url);
    });
    
    this.browserWindow.webContents.on('did-finish-load', () => {
      console.log('[LinkedInAdapter] Page loaded');
      this.injectObserverScript();
    });
    
    // Handle window close
    this.browserWindow.on('closed', () => {
      console.log('[LinkedInAdapter] Browser window closed');
      this.browserWindow = null;
    });
    
    return this.browserWindow;
  }

  private handleNavigation(url: string): void {
    // Check if redirected to login
    if (url.includes('/login') || url.includes('/checkpoint') || url.includes('/authwall')) {
      console.log('[LinkedInAdapter] Login required - session expired');
      this.isConnected = false;
      this.emit('reloginRequired');
    }
  }

  // ============================================
  // Script Injection (MutationObserver + Data Extraction)
  // ============================================
  
  private async injectObserverScript(): Promise<void> {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) return;
    
    const currentURL = this.browserWindow.webContents.getURL();
    if (!currentURL.includes('linkedin.com/messaging')) return;
    
    console.log('[LinkedInAdapter] Injecting observer script...');
    
    try {
      await this.browserWindow.webContents.executeJavaScript(this.getInjectionScript());
      console.log('[LinkedInAdapter] Observer script injected successfully');
    } catch (error: any) {
      console.error('[LinkedInAdapter] Script injection failed:', error.message);
    }
  }

  /**
   * Main injection script - runs in LinkedIn's page context
   * 
   * STRATEGY (from user's prompt):
   * 1. Network Response Interception - Intercept fetch/XHR to capture LinkedIn's API responses
   * 2. MutationObserver - Watch DOM for real-time changes
   * 3. Global State Hijacking - Access LinkedIn's internal data stores
   */
  private getInjectionScript(): string {
    return `
      (function() {
        // Prevent double injection
        if (window.__linkedinObserverInjected) return;
        window.__linkedinObserverInjected = true;
        
        console.log('[LinkedIn Injected] Starting Network Interception + MutationObserver...');
        
        // ============================================
        // DATA STORE - Captured from network responses
        // ============================================
        window.__linkedinData = {
          conversations: new Map(),
          messages: new Map(),
          profiles: new Map(),
          lastUpdate: null
        };
        
        // ============================================
        // NETWORK RESPONSE INTERCEPTION (CORE STRATEGY)
        // Intercept LinkedIn's own API responses
        // ============================================
        
        // Store original fetch
        const originalFetch = window.fetch;
        
        // Override fetch to intercept responses
        window.fetch = async function(...args) {
          const response = await originalFetch.apply(this, args);
          
          try {
            const url = typeof args[0] === 'string' ? args[0] : args[0]?.url || '';
            
            // Intercept messaging API responses
            if (url.includes('/voyager/api/messaging/')) {
              console.log('[LinkedIn Intercept] Captured:', url.split('?')[0]);
              
              // Clone response to read body without consuming it
              const clonedResponse = response.clone();
              
              try {
                const data = await clonedResponse.json();
                processInterceptedData(url, data);
              } catch (e) {
                // Not JSON, ignore
              }
            }
          } catch (e) {
            console.error('[LinkedIn Intercept] Error:', e);
          }
          
          return response;
        };
        
        // Also intercept XMLHttpRequest for older code paths
        const originalXHROpen = XMLHttpRequest.prototype.open;
        const originalXHRSend = XMLHttpRequest.prototype.send;
        
        XMLHttpRequest.prototype.open = function(method, url, ...rest) {
          this._interceptUrl = url;
          return originalXHROpen.apply(this, [method, url, ...rest]);
        };
        
        XMLHttpRequest.prototype.send = function(...args) {
          this.addEventListener('load', function() {
            try {
              const url = this._interceptUrl || '';
              if (url.includes('/voyager/api/messaging/')) {
                console.log('[LinkedIn XHR Intercept] Captured:', url.split('?')[0]);
                
                try {
                  const data = JSON.parse(this.responseText);
                  processInterceptedData(url, data);
                } catch (e) {
                  // Not JSON
                }
              }
            } catch (e) {
              console.error('[LinkedIn XHR Intercept] Error:', e);
            }
          });
          return originalXHRSend.apply(this, args);
        };
        
        // ============================================
        // PROCESS INTERCEPTED DATA
        // ============================================
        
        function processInterceptedData(url, data) {
          if (!data) return;
          
          const included = data.included || [];
          const elements = data.elements || data.data?.elements || [];
          
          console.log('[LinkedIn Process] URL:', url.split('?')[0]);
          console.log('[LinkedIn Process] Elements:', elements.length, 'Included:', included.length);
          
          // Extract profiles from included
          included.forEach(item => {
            if (item.$type?.includes('MiniProfile') || (item.firstName && item.lastName)) {
              const urn = item.entityUrn || item['*miniProfile'] || '';
              if (urn) {
                window.__linkedinData.profiles.set(urn, {
                  firstName: item.firstName,
                  lastName: item.lastName,
                  publicIdentifier: item.publicIdentifier,
                  picture: item.picture || item.profilePicture
                });
              }
            }
          });
          
          // Check if this is conversations response
          if (url.includes('/conversations')) {
            processConversations(elements, included);
          }
          
          // Check if this is messages/events response
          if (url.includes('/events') || url.includes('/messages')) {
            const threadMatch = url.match(/conversations\\/([^/]+)/);
            if (threadMatch) {
              processMessages(threadMatch[1], elements, included);
            }
          }
          
          window.__linkedinData.lastUpdate = Date.now();
          
          // Notify that data was updated
          window.postMessage({ type: 'LINKEDIN_DATA_UPDATE', source: 'network' }, '*');
        }
        
        function processConversations(elements, included) {
          console.log('[LinkedIn Process] Processing conversations...');
          
          // Find conversations in elements or included
          let convItems = elements.filter(e => 
            e.entityUrn?.includes('conversation') || 
            e['*participants'] ||
            e.$type?.includes('Conversation')
          );
          
          if (convItems.length === 0) {
            convItems = included.filter(e => 
              e.entityUrn?.includes('conversation') || 
              e['*participants'] ||
              e.$type?.includes('Conversation')
            );
          }
          
          console.log('[LinkedIn Process] Found', convItems.length, 'conversation items');
          
          convItems.forEach(conv => {
            const urn = conv.entityUrn || conv['$id'] || '';
            const threadId = urn.split(':').pop() || '';
            
            if (!threadId) return;
            
            // Get participant info
            let participantName = 'LinkedIn User';
            let participantAvatar = '';
            
            const participantUrns = conv['*participants'] || conv.participants || [];
            for (const pUrn of participantUrns) {
              const urnStr = typeof pUrn === 'string' ? pUrn : pUrn?.entityUrn;
              if (!urnStr) continue;
              
              // Look up profile
              const profile = window.__linkedinData.profiles.get(urnStr);
              if (profile && profile.firstName) {
                participantName = (profile.firstName + ' ' + (profile.lastName || '')).trim();
                
                // Get avatar
                const pic = profile.picture;
                if (pic) {
                  const vecImg = pic['com.linkedin.common.VectorImage'] || pic;
                  if (vecImg?.rootUrl && vecImg?.artifacts?.length) {
                    participantAvatar = vecImg.rootUrl + vecImg.artifacts[vecImg.artifacts.length - 1].fileIdentifyingUrlPathSegment;
                  }
                }
                break;
              }
            }
            
            // Get last message
            let lastMessage = '';
            const lastEventUrn = conv['*events']?.[0] || conv['*lastEvent'];
            if (lastEventUrn) {
              const event = included.find(i => i.entityUrn === lastEventUrn || i['$id'] === lastEventUrn);
              if (event) {
                const msgEvent = event.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent'];
                lastMessage = msgEvent?.body || msgEvent?.attributedBody?.text || '';
              }
            }
            
            window.__linkedinData.conversations.set(threadId, {
              id: threadId,
              participantName,
              participantAvatar,
              lastMessage: lastMessage || 'Click to view',
              lastActivityAt: conv.lastActivityAt || Date.now(),
              unreadCount: 0
            });
            
            console.log('[LinkedIn Process] Conversation:', threadId, '-', participantName);
          });
        }
        
        function processMessages(threadId, elements, included) {
          console.log('[LinkedIn Process] Processing messages for:', threadId);
          
          const messages = [];
          
          elements.forEach((event, index) => {
            const msgContent = event.eventContent?.['com.linkedin.voyager.messaging.event.MessageEvent'];
            if (!msgContent) return;
            
            const msgId = event.entityUrn?.split(':').pop() || ('msg_' + index);
            
            // Get sender
            let senderName = 'LinkedIn User';
            const fromMember = event.from?.['com.linkedin.voyager.messaging.MessagingMember'];
            if (fromMember) {
              const miniProfileUrn = fromMember['*miniProfile'] || fromMember.miniProfile;
              if (miniProfileUrn) {
                const profile = window.__linkedinData.profiles.get(miniProfileUrn) ||
                               included.find(i => i.entityUrn === miniProfileUrn);
                if (profile) {
                  senderName = ((profile.firstName || '') + ' ' + (profile.lastName || '')).trim() || 'LinkedIn User';
                }
              }
            }
            
            messages.push({
              id: msgId,
              sender: senderName,
              content: msgContent.body || msgContent.attributedBody?.text || '',
              timestamp: event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString(),
              isOutgoing: false // Would need to compare with current user
            });
          });
          
          if (messages.length > 0) {
            window.__linkedinData.messages.set(threadId, messages);
            console.log('[LinkedIn Process] Stored', messages.length, 'messages for', threadId);
          }
        }
        
        // ============================================
        // GLOBAL STATE HIJACKING (ADVANCED)
        // Try to access LinkedIn's internal data stores
        // ============================================
        
        function tryAccessGlobalState() {
          try {
            // Check for various global state locations
            const possibleStores = [
              'window.__INITIAL_STATE__',
              'window.APP_DATA',
              'window.__PRELOADED_STATE__',
              'window.Ember?.Application?.NAMESPACES_BY_ID'
            ];
            
            for (const storePath of possibleStores) {
              try {
                const store = eval(storePath);
                if (store) {
                  console.log('[LinkedIn Global] Found store at:', storePath);
                  // Could extract data from here
                }
              } catch (e) {}
            }
            
            // Check for React fiber (LinkedIn uses React)
            const reactRoot = document.getElementById('root') || document.getElementById('app');
            if (reactRoot?._reactRootContainer) {
              console.log('[LinkedIn Global] React root found');
            }
            
          } catch (e) {
            // Silently fail
          }
        }
        
        // ============================================
        // MUTATION OBSERVER (REAL-TIME DOM CHANGES)
        // ============================================
        
        function setupMutationObserver() {
          const targetNode = document.querySelector('.msg-conversations-container') ||
                            document.querySelector('[class*="messaging"]') ||
                            document.body;
          
          console.log('[LinkedIn Observer] Setting up on:', targetNode.className || 'body');
          
          let debounceTimer = null;
          
          const observer = new MutationObserver((mutations) => {
            if (debounceTimer) clearTimeout(debounceTimer);
            
            debounceTimer = setTimeout(() => {
              // Check if we have intercepted data
              if (window.__linkedinData.conversations.size > 0) {
                const conversations = Array.from(window.__linkedinData.conversations.values());
                window.postMessage({
                  type: 'LINKEDIN_CONVERSATIONS_UPDATE',
                  conversations: conversations,
                  source: 'intercepted'
                }, '*');
              } else {
                // Fallback to DOM extraction
                const conversations = extractConversationsFromDOM();
                if (conversations.length > 0) {
                  window.postMessage({
                    type: 'LINKEDIN_CONVERSATIONS_UPDATE',
                    conversations: conversations,
                    source: 'dom'
                  }, '*');
                }
              }
            }, 500);
          });
          
          observer.observe(targetNode, { childList: true, subtree: true });
          console.log('[LinkedIn Observer] Active');
        }
        
        // ============================================
        // DOM EXTRACTION (FALLBACK)
        // ============================================
        
        function extractConversationsFromDOM() {
          const conversations = [];
          const seenIds = new Set();
          
          const items = document.querySelectorAll('li[class*="msg-conversation"]');
          
          items.forEach((item, index) => {
            try {
              // Get thread ID from link
              let threadId = '';
              const link = item.querySelector('a[href*="/messaging/thread/"]');
              if (link) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/\\/messaging\\/thread\\/([^/\\?#]+)/);
                if (match && match[1]) {
                  threadId = decodeURIComponent(match[1]);
                }
              }
              
              if (!threadId || threadId.startsWith('ember') || seenIds.has(threadId)) return;
              seenIds.add(threadId);
              
              // Get name
              let name = '';
              const nameEl = item.querySelector('[class*="participant-names"]') || item.querySelector('h3 span');
              if (nameEl) name = nameEl.innerText?.split('\\n')[0]?.trim() || '';
              if (!name || name.length < 2) return;
              
              // Get avatar
              let avatar = '';
              const img = item.querySelector('img[src*="profile"], img[src*="licdn"]');
              if (img) avatar = img.src || '';
              
              // Get last message
              let lastMessage = '';
              const msgEl = item.querySelector('[class*="message-snippet"]') || item.querySelector('p');
              if (msgEl) lastMessage = msgEl.innerText?.trim() || '';
              
              conversations.push({
                id: threadId,
                participantName: name,
                participantAvatar: avatar,
                lastMessage: lastMessage || 'Click to view',
                lastActivityAt: Date.now(),
                unreadCount: 0
              });
            } catch (e) {}
          });
          
          return conversations;
        }
        
        // ============================================
        // PUBLIC API
        // ============================================
        
        window.__linkedinExtract = {
          // Get conversations - prefer intercepted data, fallback to DOM
          conversations: function() {
            if (window.__linkedinData.conversations.size > 0) {
              console.log('[LinkedIn Extract] Using intercepted data:', window.__linkedinData.conversations.size);
              return Array.from(window.__linkedinData.conversations.values());
            }
            console.log('[LinkedIn Extract] Falling back to DOM extraction');
            return extractConversationsFromDOM();
          },
          
          // Get messages for a thread
          messages: function(threadId) {
            return window.__linkedinData.messages.get(threadId) || [];
          },
          
          // Get raw intercepted data
          rawData: function() {
            return {
              conversations: Array.from(window.__linkedinData.conversations.entries()),
              messages: Array.from(window.__linkedinData.messages.entries()),
              profiles: Array.from(window.__linkedinData.profiles.entries())
            };
          },
          
          // Force refresh by triggering LinkedIn's own fetch
          refresh: function() {
            // Scroll to trigger lazy load
            const list = document.querySelector('[class*="conversations-list"]');
            if (list) {
              list.scrollTop = 0;
              setTimeout(() => list.scrollTop = 500, 200);
              setTimeout(() => list.scrollTop = 0, 400);
            }
          }
        };
        
        // ============================================
        // INITIALIZE
        // ============================================
        
        function init() {
          console.log('[LinkedIn Injected] Initializing...');
          
          // Wait for page ready
          setTimeout(() => {
            tryAccessGlobalState();
            setupMutationObserver();
            
            // Trigger initial data load by scrolling
            window.__linkedinExtract.refresh();
            
            console.log('[LinkedIn Injected] Ready. Network interception active.');
            console.log('[LinkedIn Injected] Use window.__linkedinExtract.rawData() to see captured data');
          }, 2000);
        }
        
        init();
      })();
    `;
  }

  // ============================================
  // Data Processing
  // ============================================
  
  private processDOMConversations(rawConversations: any[]): void {
    for (const raw of rawConversations) {
      const conversation = this.convertToConversation(raw);
      this.conversationsCache.set(raw.id, conversation);
    }
  }

  private processDOMMessages(conversationId: string, rawMessages: any[]): void {
    const messages = rawMessages.map(raw => this.convertToMessage(conversationId, raw));
    this.messagesCache.set(conversationId, messages);
  }

  private convertToConversation(raw: any): Conversation {
    return {
      id: `linkedin_${raw.id}`,
      platform: 'linkedin',
      platformConversationId: raw.id,
      participantName: raw.participantName || 'LinkedIn User',
      participantId: raw.id,
      participantAvatarUrl: raw.avatarUrl || raw.participantAvatar || '',
      lastMessage: raw.lastMessage || 'Click to view',
      lastMessageAt: raw.lastActivityAt ? new Date(raw.lastActivityAt).toISOString() : new Date().toISOString(),
      unreadCount: raw.unreadCount || 0,
    };
  }

  private convertToMessage(conversationId: string, raw: any): Message {
    // Parse timestamp - LinkedIn returns various formats
    let sentAt = new Date().toISOString();
    if (raw.timestamp) {
      // If we have dateContext, try to use it for better date parsing
      if (raw.dateContext && typeof raw.timestamp === 'string') {
        const timeOnly = raw.timestamp.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
        if (timeOnly) {
          // timestamp is just time, combine with dateContext
          sentAt = this.parseLinkedInTimestamp(raw.dateContext + ' ' + raw.timestamp);
        } else {
          sentAt = this.parseLinkedInTimestamp(raw.timestamp);
        }
      } else {
        sentAt = this.parseLinkedInTimestamp(raw.timestamp);
      }
    }
    
    return {
      id: raw.id || 'msg_' + Date.now(),
      conversationId: 'linkedin_' + conversationId.replace('linkedin_', ''),
      platformMessageId: raw.id,
      senderId: raw.sender || 'unknown',
      senderName: raw.sender || 'LinkedIn User',
      content: raw.content || '',
      messageType: 'text',
      isOutgoing: raw.isOutgoing || false,
      isRead: true,
      sentAt: sentAt,
    };
  }

  /**
   * Parse LinkedIn timestamp - handles various formats:
   * - ISO format: "2025-12-24T12:30:00.000Z"
   * - Unix timestamp: 1735044600000
   * - Time only: "12:32 PM", "6:17 PM"
   * - Relative: "Today", "Yesterday", "Dec 24"
   * - Combined: "Dec 20 7:24 PM", "Yesterday 3:30 PM"
   */
  private parseLinkedInTimestamp(timestamp: string | number): string {
    // If it's a number (Unix timestamp in milliseconds)
    if (typeof timestamp === 'number') {
      return new Date(timestamp).toISOString();
    }
    
    const ts = String(timestamp).trim();
    
    // Already ISO format
    if (ts.includes('T') && (ts.includes('Z') || ts.includes('+'))) {
      return ts;
    }
    
    // Date format like "2025-12-24"
    if (/^\d{4}-\d{2}-\d{2}/.test(ts)) {
      const parsed = new Date(ts);
      if (!isNaN(parsed.getTime())) {
        return parsed.toISOString();
      }
    }
    
    const now = new Date();
    
    // Combined format: "Dec 20 7:24 PM" or "December 20 7:24 PM"
    const combinedMatch = ts.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?\s+(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (combinedMatch) {
      const monthNames: { [key: string]: number } = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      const month = monthNames[combinedMatch[1].toLowerCase().substring(0, 3)];
      const day = parseInt(combinedMatch[2], 10);
      const year = combinedMatch[3] ? parseInt(combinedMatch[3], 10) : now.getFullYear();
      let hours = parseInt(combinedMatch[4], 10);
      const minutes = parseInt(combinedMatch[5], 10);
      const period = combinedMatch[6]?.toUpperCase();
      
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      
      const date = new Date(year, month, day, hours, minutes, 0);
      
      // If date is in future, it's probably last year
      if (date > now) {
        date.setFullYear(date.getFullYear() - 1);
      }
      
      return date.toISOString();
    }
    
    // Time only format: "12:32 PM", "6:17 PM", "14:30"
    const timeMatch = ts.match(/^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i);
    if (timeMatch) {
      let hours = parseInt(timeMatch[1], 10);
      const minutes = parseInt(timeMatch[2], 10);
      const period = timeMatch[3]?.toUpperCase();
      
      if (period === 'PM' && hours !== 12) hours += 12;
      if (period === 'AM' && hours === 12) hours = 0;
      
      const date = new Date(now);
      date.setHours(hours, minutes, 0, 0);
      
      // If the time is in the future, it's probably from yesterday
      if (date > now) {
        date.setDate(date.getDate() - 1);
      }
      
      return date.toISOString();
    }
    
    // "Today" or "Today at 12:32 PM"
    if (ts.toLowerCase().includes('today')) {
      const todayTimeMatch = ts.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (todayTimeMatch) {
        let hours = parseInt(todayTimeMatch[1], 10);
        const minutes = parseInt(todayTimeMatch[2], 10);
        const period = todayTimeMatch[3]?.toUpperCase();
        
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        const date = new Date(now);
        date.setHours(hours, minutes, 0, 0);
        return date.toISOString();
      }
      // Just "Today" without time
      return now.toISOString();
    }
    
    // "Yesterday" or "Yesterday at 12:32 PM"
    if (ts.toLowerCase().includes('yesterday')) {
      const yesterday = new Date(now);
      yesterday.setDate(yesterday.getDate() - 1);
      
      const yestTimeMatch = ts.match(/(\d{1,2}):(\d{2})\s*(AM|PM)?/i);
      if (yestTimeMatch) {
        let hours = parseInt(yestTimeMatch[1], 10);
        const minutes = parseInt(yestTimeMatch[2], 10);
        const period = yestTimeMatch[3]?.toUpperCase();
        
        if (period === 'PM' && hours !== 12) hours += 12;
        if (period === 'AM' && hours === 12) hours = 0;
        
        yesterday.setHours(hours, minutes, 0, 0);
      }
      return yesterday.toISOString();
    }
    
    // Month Day format: "Dec 24", "December 24", "Dec 24, 2025"
    const monthDayMatch = ts.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+(\d{1,2})(?:,?\s*(\d{4}))?/i);
    if (monthDayMatch) {
      const monthNames: { [key: string]: number } = {
        jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5,
        jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11
      };
      const month = monthNames[monthDayMatch[1].toLowerCase().substring(0, 3)];
      const day = parseInt(monthDayMatch[2], 10);
      const year = monthDayMatch[3] ? parseInt(monthDayMatch[3], 10) : now.getFullYear();
      
      const date = new Date(year, month, day, 12, 0, 0);
      return date.toISOString();
    }
    
    // Fallback - try native Date parsing
    const parsed = new Date(ts);
    if (!isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
    
    // Ultimate fallback - return current time
    console.log('[LinkedInAdapter] Could not parse timestamp:', ts);
    return now.toISOString();
  }


  // ============================================
  // Public API Methods
  // ============================================

  /**
   * Set mode - kept for compatibility but browser automation is now default
   */
  setMode(_useVoyagerAPI: boolean): void {
    // Always use browser automation now
    console.log('[LinkedInAdapter] Mode: Browser Automation (Texts.com style)');
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.isConnected && this.cookies !== null;
  }

  /**
   * Connect to LinkedIn with cookie-based authentication
   */
  async connect(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    console.log('[LinkedInAdapter] Connecting with browser automation...');
    
    if (!credentials.cookies?.li_at || !credentials.cookies?.JSESSIONID) {
      return { success: false, error: 'LinkedIn requires li_at and JSESSIONID cookies' };
    }

    this.cookies = {
      li_at: credentials.cookies.li_at,
      JSESSIONID: credentials.cookies.JSESSIONID.replace(/"/g, ''),
      bcookie: credentials.cookies.bcookie,
      bscookie: credentials.cookies.bscookie,
    };

    try {
      // Create persistent browser window
      await this.createPersistentBrowser();
      
      if (!this.browserWindow || !this.linkedinSession) {
        throw new Error('Failed to create browser window');
      }
      
      // Set cookies in the session
      const cookiesToSet = [
        { url: LINKEDIN_BASE_URL, name: 'li_at', value: this.cookies.li_at, domain: '.linkedin.com', path: '/', secure: true, httpOnly: true },
        { url: LINKEDIN_BASE_URL, name: 'JSESSIONID', value: `"${this.cookies.JSESSIONID}"`, domain: '.linkedin.com', path: '/', secure: true },
      ];
      
      if (this.cookies.bcookie) {
        cookiesToSet.push({ url: LINKEDIN_BASE_URL, name: 'bcookie', value: this.cookies.bcookie, domain: '.linkedin.com', path: '/', secure: true, httpOnly: false });
      }
      if (this.cookies.bscookie) {
        cookiesToSet.push({ url: LINKEDIN_BASE_URL, name: 'bscookie', value: this.cookies.bscookie, domain: '.linkedin.com', path: '/', secure: true, httpOnly: true });
      }
      
      for (const cookie of cookiesToSet) {
        await this.linkedinSession.cookies.set(cookie);
      }
      
      console.log('[LinkedInAdapter] Cookies set, loading messaging page...');
      
      // Load LinkedIn messaging page
      await this.browserWindow.loadURL(LINKEDIN_MESSAGING_URL);
      
      // Wait for page to load and check if logged in
      await new Promise(resolve => setTimeout(resolve, 3000));
      
      const currentURL = this.browserWindow.webContents.getURL();
      if (currentURL.includes('/login') || currentURL.includes('/checkpoint') || currentURL.includes('/authwall')) {
        this.isConnected = false;
        return { success: false, error: 'LinkedIn session expired. Please re-login.' };
      }
      
      this.isConnected = true;
      
      // Fetch initial conversations
      const conversations = await this.fetchConversations();
      console.log(`[LinkedInAdapter] Connected - found ${conversations.length} conversations`);
      
      this.emit('connected');
      
      // Start polling for updates
      this.startRealTime();
      
      return {
        success: true,
        userId: undefined,
        username: undefined,
      };
      
    } catch (error: any) {
      console.error('[LinkedInAdapter] Connection failed:', error.message);
      this.isConnected = false;
      return { success: false, error: `LinkedIn connection failed: ${error.message}` };
    }
  }

  /**
   * Disconnect from LinkedIn
   */
  async disconnect(): Promise<void> {
    this.stopRealTime();
    this.cookies = null;
    this.isConnected = false;
    this.conversationsCache.clear();
    this.messagesCache.clear();
    this.interceptedData.conversations.clear();
    this.interceptedData.messages.clear();
    this.interceptedData.profiles.clear();
    
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
    
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.close();
      this.browserWindow = null;
    }
    
    console.log('[LinkedInAdapter] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Open browser login window for LinkedIn
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<LinkedInCookies | null> {
    return new Promise((resolve) => {
      const loginSession = session.fromPartition('persist:linkedin-login', { cache: true });
      
      console.log('[LinkedInAdapter] Opening login window...');
      
      // Block WebAuthn/passkey prompts
      loginSession.setPermissionRequestHandler((_webContents, permission, callback) => {
        const permStr = String(permission);
        if (permStr === 'webauthn' || permStr.includes('publickey') || permStr.includes('credentials')) {
          callback(false);
          return;
        }
        callback(true);
      });
      
      this.loginWindow = new BrowserWindow({
        width: 500,
        height: 700,
        resizable: true,
        title: 'LinkedIn Login',
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: loginSession,
        },
      });

      this.loginWindow.webContents.setUserAgent(USER_AGENT);
      this.loginWindow.show();
      this.loginWindow.focus();
      
      this.loginWindow.loadURL('https://www.linkedin.com/login');
      
      let isResolved = false;
      
      const checkForLogin = async () => {
        if (isResolved) return;
        
        try {
          if (!this.loginWindow || this.loginWindow.isDestroyed()) {
            return;
          }

          const currentURL = this.loginWindow.webContents.getURL();
          
          // Check if logged in (redirected to feed/messaging/etc)
          if (currentURL.includes('linkedin.com/feed') || 
              currentURL.includes('linkedin.com/messaging') ||
              currentURL.includes('linkedin.com/mynetwork') ||
              currentURL.includes('linkedin.com/in/') ||
              (currentURL.includes('linkedin.com') && 
               !currentURL.includes('/login') && 
               !currentURL.includes('/checkpoint') &&
               !currentURL.includes('/authwall') &&
               !currentURL.includes('/uas/'))) {
            
            const cookies = await loginSession.cookies.get({ domain: '.linkedin.com' });
            
            let li_at = '';
            let JSESSIONID = '';
            let bcookie = '';
            let bscookie = '';

            for (const cookie of cookies) {
              if (cookie.name === 'li_at') li_at = cookie.value;
              if (cookie.name === 'JSESSIONID') JSESSIONID = cookie.value.replace(/"/g, '');
              if (cookie.name === 'bcookie') bcookie = cookie.value;
              if (cookie.name === 'bscookie') bscookie = cookie.value;
            }

            if (li_at && JSESSIONID) {
              isResolved = true;
              
              console.log('[LinkedInAdapter] Login successful!');
              console.log('[LinkedInAdapter] li_at:', li_at.substring(0, 20) + '...');
              console.log('[LinkedInAdapter] JSESSIONID:', JSESSIONID);
              
              const linkedinCookies: LinkedInCookies = { li_at, JSESSIONID, bcookie, bscookie };

              if (!this.loginWindow.isDestroyed()) {
                this.loginWindow.close();
              }

              resolve(linkedinCookies);
              return;
            }
          }
          
          // Keep checking
          setTimeout(checkForLogin, 2000);
          
        } catch (err: any) {
          console.error('[LinkedInAdapter] Login check error:', err.message);
          setTimeout(checkForLogin, 2000);
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
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!isResolved && this.loginWindow && !this.loginWindow.isDestroyed()) {
          this.loginWindow.close();
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Fetch all conversations
   * Uses browser automation to extract from DOM
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected to LinkedIn');
    }

    // Return cached if available and recent
    if (this.conversationsCache.size > 0) {
      const cached = Array.from(this.conversationsCache.values());
      console.log('[LinkedInAdapter] Returning', cached.length, 'cached conversations');
      return cached;
    }

    // Extract from browser
    return await this.extractConversationsFromBrowser();
  }

  /**
   * Extract conversations by executing script in browser
   */
  private async extractConversationsFromBrowser(): Promise<Conversation[]> {
    if (!this.browserWindow || this.browserWindow.isDestroyed()) {
      console.log('[LinkedInAdapter] Browser window not available, recreating...');
      await this.createPersistentBrowser();
      
      if (!this.browserWindow) {
        throw new Error('Failed to create browser window');
      }
      
      // Reload messaging page
      await this.browserWindow.loadURL(LINKEDIN_MESSAGING_URL);
      await new Promise(resolve => setTimeout(resolve, 3000));
    }

    console.log('[LinkedInAdapter] Extracting conversations from browser...');

    try {
      // Check current URL
      let currentURL = this.browserWindow.webContents.getURL();
      console.log('[LinkedInAdapter] Current URL:', currentURL);
      
      // IMPORTANT: LinkedIn auto-opens last conversation (thread view)
      // We need to be on /messaging/ to see the conversation LIST in the sidebar
      // The sidebar is ALWAYS visible, even on thread view!
      // So we DON'T need to navigate away - just extract from sidebar
      
      // But first, make sure we're on messaging at all
      if (!currentURL.includes('/messaging')) {
        console.log('[LinkedInAdapter] Not on messaging page, navigating...');
        await this.browserWindow.loadURL('https://www.linkedin.com/messaging/');
        await new Promise(resolve => setTimeout(resolve, 4000));
        currentURL = this.browserWindow.webContents.getURL();
      }
      
      // Wait for page to stabilize
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Scroll to load lazy content in the sidebar
      await this.browserWindow.webContents.executeJavaScript(`
        (function() {
          console.log('[LinkedIn DOM] Starting scroll in sidebar...');
          
          // The conversation list is in the LEFT sidebar (aside element)
          // It's visible even when viewing a specific thread
          const sidebarSelectors = [
            'aside.msg-conversations-container',
            'aside[class*="msg-conversations"]',
            '.msg-conversations-container',
            '[class*="scaffold-layout__list"]',
            '.scaffold-layout__list'
          ];
          
          let sidebar = null;
          for (const sel of sidebarSelectors) {
            sidebar = document.querySelector(sel);
            if (sidebar) {
              console.log('[LinkedIn DOM] Found sidebar with:', sel);
              break;
            }
          }
          
          // Find the scrollable list inside sidebar
          const listSelectors = [
            '.msg-conversations-container__conversations-list',
            'ul[class*="msg-conversations"]',
            '[class*="conversations-list"]'
          ];
          
          let list = null;
          const searchIn = sidebar || document;
          for (const sel of listSelectors) {
            list = searchIn.querySelector(sel);
            if (list) {
              console.log('[LinkedIn DOM] Found list with:', sel);
              break;
            }
          }
          
          if (list) {
            list.scrollTop = 0;
            setTimeout(() => { list.scrollTop = 500; }, 200);
            setTimeout(() => { list.scrollTop = 0; }, 400);
          }
          
          // Debug: Log what we can see
          const allLis = document.querySelectorAll('li');
          console.log('[LinkedIn DOM] Total li elements:', allLis.length);
          
          // Look for conversation items specifically
          const convItems = document.querySelectorAll('li.msg-conversation-listitem, li[class*="msg-conversation"]');
          console.log('[LinkedIn DOM] Conversation li elements:', convItems.length);
          
          // Check for thread links
          const threadLinks = document.querySelectorAll('a[href*="/messaging/thread/"]');
          console.log('[LinkedIn DOM] Thread links:', threadLinks.length);
          
          // DEBUG: Log the first conversation item's HTML structure
          if (convItems.length > 0) {
            const firstItem = convItems[0];
            console.log('[LinkedIn DOM] First item classes:', firstItem.className);
            console.log('[LinkedIn DOM] First item innerHTML preview:', firstItem.innerHTML.substring(0, 500));
            
            // Log all anchor tags in first item
            const anchors = firstItem.querySelectorAll('a');
            console.log('[LinkedIn DOM] Anchors in first item:', anchors.length);
            anchors.forEach((a, i) => {
              console.log('[LinkedIn DOM] Anchor', i, 'href:', a.getAttribute('href'));
            });
            
            // Log all data attributes
            const allElements = firstItem.querySelectorAll('*');
            allElements.forEach(el => {
              const attrs = el.attributes;
              for (let i = 0; i < attrs.length; i++) {
                if (attrs[i].name.startsWith('data-')) {
                  console.log('[LinkedIn DOM] Data attr:', attrs[i].name, '=', attrs[i].value.substring(0, 50));
                }
              }
            });
          }
          
          // Log first few thread links for debugging
          threadLinks.forEach((link, i) => {
            if (i < 3) {
              console.log('[LinkedIn DOM] Thread link', i, ':', link.getAttribute('href'));
            }
          });
        })();
      `);

      await new Promise(resolve => setTimeout(resolve, 2000));

      // Extract conversations
      const result = await this.browserWindow.webContents.executeJavaScript(`
        (function() {
          console.log('[LinkedIn Extract] Starting extraction...');
          console.log('[LinkedIn Extract] Current URL:', window.location.href);
          
          // First check if we have intercepted data
          if (window.__linkedinData && window.__linkedinData.conversations.size > 0) {
            console.log('[LinkedIn Extract] Using intercepted data:', window.__linkedinData.conversations.size);
            const convs = Array.from(window.__linkedinData.conversations.values());
            return { success: true, conversations: convs, source: 'intercepted' };
          }
          
          // Check if __linkedinExtract is available
          if (window.__linkedinExtract && typeof window.__linkedinExtract.conversations === 'function') {
            console.log('[LinkedIn Extract] Using injected extractor');
            try {
              const convs = window.__linkedinExtract.conversations();
              if (convs && convs.length > 0) {
                return { success: true, conversations: convs, source: 'injected' };
              }
            } catch (e) {
              console.error('[LinkedIn Extract] Injected extractor failed:', e);
            }
          }
          
          console.log('[LinkedIn Extract] Using direct DOM extraction');
          
          // Direct DOM extraction
          // KEY INSIGHT: The conversation list is in the LEFT SIDEBAR (aside)
          // It's ALWAYS visible, even when viewing a specific thread
          const conversations = [];
          const seenIds = new Set();
          
          // Step 1: Find the sidebar/aside that contains conversations
          const sidebarSelectors = [
            'aside.msg-conversations-container',
            'aside[class*="msg-conversations"]',
            '.msg-conversations-container',
            '.scaffold-layout__list'
          ];
          
          let sidebar = null;
          for (const sel of sidebarSelectors) {
            sidebar = document.querySelector(sel);
            if (sidebar) {
              console.log('[LinkedIn Extract] Found sidebar:', sel);
              break;
            }
          }
          
          // Step 2: Find conversation list items
          // These are the clickable items in the sidebar
          let items = [];
          
          // Strategy A: Try direct selectors first (more reliable)
          const itemSelectors = [
            'li.msg-conversation-listitem',
            'li.msg-conversation-card',
            'li[class*="msg-conversation"]',
            '.msg-conversations-container__conversations-list > li'
          ];
          
          for (const sel of itemSelectors) {
            items = document.querySelectorAll(sel);
            console.log('[LinkedIn Extract] Selector:', sel, '- Found:', items.length);
            if (items.length > 0) break;
          }
          
          // Strategy B: Find all links to messaging threads and get their parent li
          if (items.length === 0) {
            const threadLinks = document.querySelectorAll('a[href*="/messaging/thread/"]');
            console.log('[LinkedIn Extract] Found', threadLinks.length, 'thread links');
            
            if (threadLinks.length > 0) {
              const liSet = new Set();
              threadLinks.forEach(link => {
                let li = link.closest('li');
                if (li) {
                  liSet.add(li);
                } else {
                  liSet.add(link);
                }
              });
              items = Array.from(liSet);
              console.log('[LinkedIn Extract] Unique items from links:', items.length);
            }
          }
          
          console.log('[LinkedIn Extract] Processing', items.length, 'items');
          
          // Step 3: Extract data from each item
          items.forEach((item, index) => {
            try {
              // Get the element to work with
              const el = item.tagName === 'A' ? item : item;
              
              // Get the li element for extracting other data
              const li = el.tagName === 'LI' ? el : el.closest('li') || el;
              
              // Extract thread ID - try multiple methods
              let threadId = '';
              
              // Method 1: From href attribute on any link
              const link = li.querySelector('a[href*="/messaging/thread/"]') ||
                          li.querySelector('a[href*="/messaging/"]') ||
                          (el.tagName === 'A' ? el : null);
              
              if (link) {
                const href = link.getAttribute('href') || '';
                const match = href.match(/\\/messaging\\/thread\\/([^/\\?#]+)/);
                if (match && match[1]) {
                  threadId = decodeURIComponent(match[1]);
                }
              }
              
              // Method 2: From data attributes
              if (!threadId) {
                const dataId = li.getAttribute('data-thread-id') || 
                              li.getAttribute('data-conversation-id') ||
                              li.getAttribute('data-entity-urn') ||
                              li.querySelector('[data-thread-id]')?.getAttribute('data-thread-id') ||
                              li.querySelector('[data-conversation-id]')?.getAttribute('data-conversation-id');
                if (dataId) {
                  threadId = dataId;
                }
              }
              
              // Method 3: From id attribute
              if (!threadId) {
                const idAttr = li.id || li.querySelector('[id*="conversation"]')?.id;
                if (idAttr && !idAttr.startsWith('ember')) {
                  threadId = idAttr;
                }
              }
              
              // Method 4: Generate from participant name + index (fallback)
              // We'll set this after getting the name
              
              // Extract participant name FIRST (we need it for fallback ID)
              let name = '';
              
              // Try multiple strategies to find the name
              const nameStrategies = [
                // Strategy 1: Specific LinkedIn classes
                () => {
                  const nameEl = li.querySelector('.msg-conversation-listitem__participant-names, .msg-conversation-card__participant-names');
                  return nameEl?.innerText?.split('\\n')[0]?.trim();
                },
                // Strategy 2: Partial class match
                () => {
                  const nameEl = li.querySelector('[class*="participant-names"]');
                  return nameEl?.innerText?.split('\\n')[0]?.trim();
                },
                // Strategy 3: h3 with span
                () => {
                  const h3 = li.querySelector('h3');
                  if (h3) {
                    const span = h3.querySelector('span');
                    return span?.innerText?.trim() || h3.innerText?.split('\\n')[0]?.trim();
                  }
                  return null;
                },
                // Strategy 4: Any span with truncate class
                () => {
                  const span = li.querySelector('span.truncate, span[class*="truncate"]');
                  return span?.innerText?.trim();
                },
                // Strategy 5: Title row
                () => {
                  const titleRow = li.querySelector('[class*="title-row"]');
                  if (titleRow) {
                    const span = titleRow.querySelector('span');
                    return span?.innerText?.trim();
                  }
                  return null;
                },
                // Strategy 6: First meaningful text in the item
                () => {
                  const allSpans = li.querySelectorAll('span');
                  for (const span of allSpans) {
                    const text = span.innerText?.trim();
                    if (text && text.length > 2 && text.length < 50 && /^[A-Za-z]/.test(text) && !text.includes('ago') && !text.includes('AM') && !text.includes('PM')) {
                      return text;
                    }
                  }
                  return null;
                }
              ];
              
              for (const strategy of nameStrategies) {
                const result = strategy();
                if (result && result.length > 1 && result.length < 100 && /[a-zA-Z]/.test(result)) {
                  name = result;
                  break;
                }
              }
              
              // Method 4 fallback: Generate thread ID from name if we still don't have one
              if (!threadId && name) {
                // Create a pseudo-ID from the name
                threadId = 'conv_' + name.toLowerCase().replace(/[^a-z0-9]/g, '_') + '_' + index;
                console.log('[LinkedIn Extract] Generated fallback ID:', threadId);
              }
              
              // Skip if still no valid thread ID
              if (!threadId || threadId.length < 3) {
                console.log('[LinkedIn Extract] Item', index, '- No valid thread ID, name:', name);
                return;
              }
              
              if (seenIds.has(threadId)) return;
              seenIds.add(threadId);
              
              if (!name) {
                console.log('[LinkedIn Extract] Item', index, '- No name found for thread:', threadId);
                name = 'LinkedIn User';
              }
              
              // Get avatar
              let avatar = '';
              const img = li.querySelector('img.presence-entity__image, img[src*="profile"], img[src*="licdn"], img[class*="presence"]');
              if (img) avatar = img.src || '';
              
              // Get last message snippet
              let lastMessage = '';
              const msgStrategies = [
                () => li.querySelector('.msg-conversation-listitem__message-snippet')?.innerText?.trim(),
                () => li.querySelector('.msg-conversation-card__message-snippet')?.innerText?.trim(),
                () => li.querySelector('[class*="message-snippet"]')?.innerText?.trim(),
                () => {
                  // Find the second paragraph or span that looks like a message
                  const allP = li.querySelectorAll('p');
                  if (allP.length > 0) {
                    return allP[allP.length - 1]?.innerText?.trim();
                  }
                  return null;
                }
              ];
              
              for (const strategy of msgStrategies) {
                const result = strategy();
                if (result) {
                  lastMessage = result;
                  break;
                }
              }
              
              // Check if unread
              const isUnread = li.classList.toString().includes('unread') || 
                              li.querySelector('[class*="unread"]') !== null;
              
              console.log('[LinkedIn Extract] Adding:', threadId.substring(0, 30) + '...', '-', name);
              
              conversations.push({
                id: threadId,
                participantName: name,
                avatarUrl: avatar,
                lastMessage: lastMessage || 'Click to view',
                unreadCount: isUnread ? 1 : 0
              });
            } catch (e) {
              console.error('[LinkedIn Extract] Error on item', index, ':', e);
            }
          });
          
          console.log('[LinkedIn Extract] Total extracted:', conversations.length);
          return { success: true, conversations, source: 'dom' };
        })();
      `);

      console.log('[LinkedInAdapter] Extraction result:', {
        success: result.success,
        count: result.conversations?.length || 0,
        source: result.source
      });

      if (result.success && result.conversations.length > 0) {
        // Process and cache
        for (const raw of result.conversations) {
          const conversation = this.convertToConversation(raw);
          this.conversationsCache.set(raw.id, conversation);
        }
        
        console.log('[LinkedInAdapter] Extracted ' + result.conversations.length + ' conversations from ' + result.source);
        return Array.from(this.conversationsCache.values());
      }

      console.log('[LinkedInAdapter] No conversations found');
      return [];

    } catch (error: any) {
      console.error('[LinkedInAdapter] Extraction error:', error.message);
      return [];
    }
  }

  /**
   * Fetch messages for a specific conversation
   * Clicks on conversation in sidebar and extracts messages from DOM
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected()) {
      throw new Error('Not connected to LinkedIn');
    }

    // Return cached if available
    const cached = this.messagesCache.get(conversationId);
    if (cached && cached.length > 0) {
      console.log('[LinkedInAdapter] Returning', cached.length, 'cached messages');
      return cached;
    }

    if (!this.browserWindow || this.browserWindow.isDestroyed()) {
      console.log('[LinkedInAdapter] Browser window not available');
      return [];
    }

    const threadId = conversationId.replace('linkedin_', '');
    console.log('[LinkedInAdapter] Fetching messages for thread:', threadId);

    try {
      // Check if this is a generated ID (conv_name_index) or real thread ID
      const isGeneratedId = threadId.startsWith('conv_');
      
      if (isGeneratedId) {
        // For generated IDs, we need to click on the conversation by index or name
        // Extract the index from the ID (e.g., conv_fatima_momin_1 -> 1)
        const parts = threadId.split('_');
        const index = parseInt(parts[parts.length - 1], 10);
        
        console.log('[LinkedInAdapter] Generated ID detected, clicking conversation at index:', index);
        
        // Click on the conversation in the sidebar
        const clickResult = await this.browserWindow.webContents.executeJavaScript(`
          (function() {
            const items = document.querySelectorAll('li.msg-conversation-listitem');
            console.log('[LinkedIn Click] Found', items.length, 'conversation items');
            
            if (items.length > ${index}) {
              const item = items[${index}];
              const clickable = item.querySelector('.msg-conversation-listitem__link') || 
                               item.querySelector('[tabindex="0"]') ||
                               item;
              
              if (clickable) {
                console.log('[LinkedIn Click] Clicking on conversation at index ${index}');
                clickable.click();
                return { success: true, clicked: true };
              }
            }
            return { success: false, error: 'Conversation not found at index ${index}' };
          })();
        `);
        
        if (!clickResult.success) {
          console.log('[LinkedInAdapter] Failed to click conversation:', clickResult.error);
          return [];
        }
        
        // Wait for messages to load
        await new Promise(resolve => setTimeout(resolve, 2000));
        
      } else {
        // For real thread IDs, navigate directly
        const currentURL = this.browserWindow.webContents.getURL();
        const needsNavigation = !currentURL.includes('/messaging/thread/' + encodeURIComponent(threadId)) &&
                                !currentURL.includes('/messaging/thread/' + threadId);
        
        if (needsNavigation) {
          console.log('[LinkedInAdapter] Navigating to thread for messages...');
          await this.browserWindow.loadURL(LINKEDIN_BASE_URL + '/messaging/thread/' + encodeURIComponent(threadId));
          await new Promise(resolve => setTimeout(resolve, 3000));
        }
      }

      // Extract messages from DOM - track date from time-heading, time from timestamp
      const result = await this.browserWindow.webContents.executeJavaScript(`
        (function() {
          const messages = [];
          
          const container = document.querySelector('.msg-s-message-list-content') || 
                            document.querySelector('.msg-s-message-list');
          
          if (!container) {
            return { success: false, messages: [], error: 'No container' };
          }
          
          let currentDate = ''; // Track date from msg-s-message-list__time-heading
          
          Array.from(container.children).forEach((child, idx) => {
            // Skip non-message elements
            if (!child.classList.contains('msg-s-message-list__event')) return;
            
            // Check for DATE in time-heading (NOV 30, DEC 7, TODAY, YESTERDAY)
            const dateEl = child.querySelector('time.msg-s-message-list__time-heading');
            if (dateEl) {
              currentDate = dateEl.innerText?.trim() || '';
              console.log('[LinkedIn] Date separator:', currentDate);
            }
            
            // Check for TIME in timestamp (7:45 PM, 10:59 PM)
            const timeEl = child.querySelector('time.msg-s-message-group__timestamp');
            const timeText = timeEl?.innerText?.trim() || '';
            
            // Get sender
            const senderEl = child.querySelector('.msg-s-message-group__name');
            const senderName = senderEl?.innerText?.trim() || '';
            
            // Get message content
            const bodyEl = child.querySelector('.msg-s-event-listitem__body');
            const content = bodyEl?.innerText?.trim() || '';
            
            if (!content) return;
            
            // Check if outgoing
            const isOutgoing = child.querySelector('.msg-s-event-listitem--outbound') !== null ||
                              senderName.toLowerCase().includes('safix');
            
            // Combine date + time: "NOV 30" + "7:24 PM" = "NOV 30 7:24 PM"
            let fullTimestamp = '';
            if (currentDate && timeText) {
              fullTimestamp = currentDate + ' ' + timeText;
            } else if (currentDate) {
              fullTimestamp = currentDate;
            } else if (timeText) {
              fullTimestamp = timeText;
            }
            
            console.log('[LinkedIn] MSG:', senderName, '|', fullTimestamp, '|', content.substring(0,30));
            
            messages.push({
              id: 'msg_' + idx + '_' + Date.now(),
              sender: senderName || (isOutgoing ? 'You' : 'LinkedIn User'),
              content: content,
              timestamp: fullTimestamp || new Date().toISOString(),
              isOutgoing: isOutgoing
            });
          });
          
          return { success: true, messages };
        })();
      `);

      if (result.success && result.messages.length > 0) {
        const messages = result.messages.map((raw: any) => this.convertToMessage(conversationId, raw));
        this.messagesCache.set(conversationId, messages);
        console.log('[LinkedInAdapter] Fetched ' + messages.length + ' messages');
        return messages;
      }

      console.log('[LinkedInAdapter] No messages found');
      return [];

    } catch (error: any) {
      console.error('[LinkedInAdapter] Message fetch error:', error.message);
      return [];
    }
  }

  /**
   * Send a message
   * Uses DOM manipulation to fill input and click send
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected()) {
      return { success: false, error: 'Not connected to LinkedIn' };
    }

    if (!this.browserWindow || this.browserWindow.isDestroyed()) {
      return { success: false, error: 'Browser window not available' };
    }

    console.log('[LinkedInAdapter] Sending message via DOM manipulation...');
    console.log('[LinkedInAdapter] Conversation ID:', conversationId);
    console.log('[LinkedInAdapter] Content:', content.substring(0, 50) + '...');

    try {
      // For generated IDs, we should already be on the right conversation
      // For real thread IDs, navigate if needed
      const threadId = conversationId.replace('linkedin_', '');
      const isGeneratedId = threadId.startsWith('conv_');
      
      if (!isGeneratedId) {
        const currentURL = this.browserWindow.webContents.getURL();
        const needsNavigation = !currentURL.includes('/messaging/thread/' + encodeURIComponent(threadId)) &&
                                !currentURL.includes('/messaging/thread/' + threadId);
        
        if (needsNavigation) {
          console.log('[LinkedInAdapter] Navigating to thread...');
          await this.browserWindow.loadURL(LINKEDIN_BASE_URL + '/messaging/thread/' + encodeURIComponent(threadId));
          await new Promise(resolve => setTimeout(resolve, 4000));
        }
      }

      // Wait for message input to appear
      console.log('[LinkedInAdapter] Waiting for message input...');
      
      const result = await this.browserWindow.webContents.executeJavaScript(`
        (async function() {
          // Helper to wait for element
          function waitForElement(selectors, timeout = 10000) {
            return new Promise((resolve) => {
              const startTime = Date.now();
              
              function check() {
                for (const sel of selectors) {
                  const el = document.querySelector(sel);
                  if (el) {
                    resolve(el);
                    return;
                  }
                }
                
                if (Date.now() - startTime < timeout) {
                  setTimeout(check, 500);
                } else {
                  resolve(null);
                }
              }
              
              check();
            });
          }
          
          // Wait for page to be ready
          await new Promise(r => setTimeout(r, 1000));
          
          // Find message input with multiple strategies
          const inputSelectors = [
            '.msg-form__contenteditable',
            '[class*="msg-form__contenteditable"]',
            'div[contenteditable="true"][class*="msg"]',
            '[role="textbox"][class*="msg"]',
            '.msg-form__message-texteditor div[contenteditable="true"]',
            '[aria-label*="Write a message"]',
            '[aria-label*="message"][contenteditable="true"]',
            '[data-artdeco-is-focused] div[contenteditable="true"]',
            'form[class*="msg-form"] div[contenteditable="true"]'
          ];
          
          console.log('[LinkedIn Send] Looking for input...');
          let input = await waitForElement(inputSelectors, 8000);
          
          if (!input) {
            // Try clicking on the form area first to activate it
            const formArea = document.querySelector('.msg-form__msg-content-container, [class*="msg-form"]');
            if (formArea) {
              formArea.click();
              await new Promise(r => setTimeout(r, 500));
              input = await waitForElement(inputSelectors, 3000);
            }
          }
          
          if (!input) {
            console.error('[LinkedIn Send] Input not found. Available elements:', 
              document.querySelectorAll('[contenteditable="true"]').length);
            return { success: false, error: 'Message input not found. Page may not have loaded correctly.' };
          }
          
          console.log('[LinkedIn Send] Input found:', input.className);
          
          // Focus and fill the input
          input.focus();
          await new Promise(r => setTimeout(r, 200));
          
          // Clear existing content
          input.innerHTML = '';
          
          // Set new content
          const messageText = ` + JSON.stringify(content) + `;
          input.innerHTML = '<p>' + messageText + '</p>';
          
          // Trigger events to notify LinkedIn's React
          input.dispatchEvent(new Event('focus', { bubbles: true }));
          input.dispatchEvent(new InputEvent('input', { bubbles: true, data: messageText }));
          input.dispatchEvent(new Event('change', { bubbles: true }));
          
          // Also try setting via execCommand for older handlers
          document.execCommand('selectAll', false, null);
          document.execCommand('insertText', false, messageText);
          
          await new Promise(r => setTimeout(r, 500));
          
          // Find send button
          const sendSelectors = [
            '.msg-form__send-button',
            '[class*="msg-form__send-button"]',
            'button[type="submit"][class*="msg-form"]',
            '[aria-label="Send"]',
            '[aria-label*="Send"][type="submit"]',
            'button.msg-form__send-btn',
            'form[class*="msg-form"] button[type="submit"]',
            '[data-control-name="send"]'
          ];
          
          console.log('[LinkedIn Send] Looking for send button...');
          let sendBtn = await waitForElement(sendSelectors, 5000);
          
          if (!sendBtn) {
            // Try finding any submit button in the form
            const form = input.closest('form');
            if (form) {
              sendBtn = form.querySelector('button[type="submit"]') || form.querySelector('button');
            }
          }
          
          if (!sendBtn) {
            console.error('[LinkedIn Send] Send button not found');
            return { success: false, error: 'Send button not found' };
          }
          
          console.log('[LinkedIn Send] Send button found:', sendBtn.className);
          
          // Check if button is disabled
          if (sendBtn.disabled) {
            console.log('[LinkedIn Send] Button is disabled, waiting...');
            await new Promise(r => setTimeout(r, 1000));
            
            // Re-trigger input events
            input.dispatchEvent(new InputEvent('input', { bubbles: true, data: messageText }));
            await new Promise(r => setTimeout(r, 500));
          }
          
          // Click send
          sendBtn.click();
          console.log('[LinkedIn Send] Send button clicked');
          
          // Wait a bit to see if message was sent
          await new Promise(r => setTimeout(r, 1000));
          
          return { success: true };
        })();
      `);

      if (result.success) {
        console.log('[LinkedInAdapter] Message sent successfully');
        return {
          success: true,
          messageId: 'msg_' + Date.now(),
          sentAt: new Date().toISOString(),
        };
      } else {
        console.error('[LinkedInAdapter] Send failed:', result.error);
        return { success: false, error: result.error || 'Failed to send message' };
      }

    } catch (error: any) {
      console.error('[LinkedInAdapter] Send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Start real-time polling for updates
   */
  startRealTime(): void {
    if (this.pollingTimer) {
      return;
    }

    console.log('[LinkedInAdapter] Starting real-time polling');
    
    this.pollingTimer = setInterval(async () => {
      if (!this.connected()) {
        this.stopRealTime();
        return;
      }

      try {
        // Clear cache to force refresh
        const oldConversations = new Map(this.conversationsCache);
        this.conversationsCache.clear();
        
        await this.fetchConversations();
        
        // Check for updates
        for (const [convId, conversation] of this.conversationsCache) {
          const oldConv = oldConversations.get(convId);
          
          if (!oldConv || oldConv.lastMessage !== conversation.lastMessage) {
            this.emit('conversationUpdated', {
              platform: 'linkedin',
              conversationId: conversation.id,
              conversation,
            });
          }
        }
      } catch (error: any) {
        console.error('[LinkedInAdapter] Polling error:', error.message);
        this.emit('error', { platform: 'linkedin', error: error.message });
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
      console.log('[LinkedInAdapter] Stopped real-time polling');
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

  /**
   * Show the hidden browser window (for debugging)
   */
  showBrowserWindow(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.show();
      this.browserWindow.webContents.openDevTools();
    }
  }

  /**
   * Hide the browser window
   */
  hideBrowserWindow(): void {
    if (this.browserWindow && !this.browserWindow.isDestroyed()) {
      this.browserWindow.hide();
    }
  }
}

// Export singleton instance
let linkedinAdapter: LinkedInAdapter | null = null;

export function getLinkedInAdapter(): LinkedInAdapter {
  if (!linkedinAdapter) {
    linkedinAdapter = new LinkedInAdapter();
  }
  return linkedinAdapter;
}
