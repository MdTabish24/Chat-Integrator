import axios from 'axios';
import { EventEmitter } from 'events';
import { BrowserWindow, session } from 'electron';
import type {
  Platform,
  Conversation,
  Message,
  PlatformCredentials,
  SendMessageResponse
} from '../../shared/types.js';
import { getFacebookSidecarManager } from '../services/FacebookSidecarManager.js';

/**
 * Facebook Messenger Platform Adapter
 * 
 * Two modes available:
 * 1. Private API (fbchat-v2 MQTT) - FAST, ~20MB RAM, <1 sec response
 * 2. Browser Automation (DOM Scraping) - SLOW, ~500MB RAM, 5-10 sec response
 * 
 * User can choose mode from UI. Default is Private API.
 */

// ============================================
// Mode Configuration
// ============================================
const FB_PRIVATE_API_URL = 'http://127.0.0.1:5001';

// Rate limiting constants (for browser automation fallback)
const MIN_FETCH_INTERVAL = 60000; // 60 seconds minimum between fetches
const POLLING_INTERVAL = 30000; // 30 seconds for real-time polling
const MAX_EXTRACT_ATTEMPTS = 6;
const PAGE_LOAD_TIMEOUT = 45000;

interface FacebookCookies {
  c_user: string;
  xs: string;
  datr?: string;
  fr?: string;
}

export class FacebookAdapter extends EventEmitter {
  readonly platform: Platform = 'facebook';

  // Common state
  private cookies: FacebookCookies | null = null;
  private lastFetchTime: number = 0;
  private pollingTimer: NodeJS.Timeout | null = null;
  private isConnected: boolean = false;
  private loginWindow: BrowserWindow | null = null;
  private fetchWindow: BrowserWindow | null = null;

  // Mode flag - Browser automation is now primary (Private API blocked by E2EE)
  // Facebook's End-to-End Encryption (2024+) prevents API access to individual DMs
  // Private API login works but returns 0 threads - E2EE restriction
  // Browser automation successfully scrapes conversations from UI
  private usePrivateAPI: boolean = false; // Disabled - E2EE blocks API access  // Private API state
  private privateAPIConnected: boolean = false;
  private privateAPIUserId: string | null = null;
  private privateAPIUsername: string | null = null;

  // Cache for conversations and messages
  private conversationsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();

  // Optimized Browser Bridge - Hidden, Resource-Blocked, Mobile View
  // Uses mobile site which is lighter and easier to parse
  // Blocks images/CSS/fonts to stay under 100MB RAM
  private optimizedBrowser: BrowserWindow | null = null;
  private static readonly MOBILE_USER_AGENT = 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.0 Mobile/15E148 Safari/604.1';
  private static readonly MOBILE_MESSENGER_URL = 'https://www.messenger.com/';  // Use messenger.com instead of m.facebook.com

  constructor() {
    super();
  }

  // ============================================
  // Private API Methods (Python Sidecar)
  // ============================================

  /**
   * Check if Private API sidecar is running
   */
  private async isPrivateAPIAvailable(): Promise<boolean> {
    try {
      const response = await axios.get(`${FB_PRIVATE_API_URL}/status`, { timeout: 1000 });
      return response.status === 200;
    } catch {
      return false;
    }
  }

  /**
   * Connect via Private API using cookies
   */
  private async connectViaPrivateAPI(cookies: FacebookCookies): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    try {
      console.log('[FacebookAdapter] Connecting via Private API...');

      const response = await axios.post(`${FB_PRIVATE_API_URL}/login-cookies`, {
        c_user: cookies.c_user,
        xs: cookies.xs,
        fr: cookies.fr,
        datr: cookies.datr,
      }, { timeout: 30000 });

      const data = response.data;

      if (data.success) {
        this.privateAPIConnected = true;
        this.privateAPIUserId = data.user_id;
        this.privateAPIUsername = data.username;
        this.isConnected = true;

        console.log('[FacebookAdapter] Connected via Private API as:', data.user_id);
        this.emit('connected');

        // Start real-time polling
        this.startRealTime();

        return {
          success: true,
          userId: data.user_id,
          username: data.username,
        };
      }

      // Handle checkpoint/2FA
      if (data.status === 'needs_otp') {
        return {
          success: false,
          error: `CHECKPOINT_REQUIRED:${data.type}`,
        };
      }

      return { success: false, error: data.error || 'Login failed' };

    } catch (error: any) {
      console.error('[FacebookAdapter] Private API connection failed:', error.message);
      return { success: false, error: `Private API error: ${error.message}` };
    }
  }

  /**
   * Fetch conversations via Private API
   */
  private async fetchConversationsViaPrivateAPI(): Promise<Conversation[]> {
    try {
      const response = await axios.get(`${FB_PRIVATE_API_URL}/fb/threads?limit=20`, { timeout: 30000 });
      const data = response.data;

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch threads');
      }

      const conversations: Conversation[] = [];

      for (const thread of data.threads || []) {
        const mainParticipant = thread.participants?.[0] || {};

        const conversation: Conversation = {
          id: `facebook_${thread.thread_id}`,
          platform: 'facebook',
          platformConversationId: thread.thread_id,
          participantName: thread.thread_title || mainParticipant.name || 'Facebook User',
          participantId: mainParticipant.user_id || thread.thread_id,
          participantAvatarUrl: undefined,
          lastMessage: thread.last_message,
          lastMessageAt: thread.last_message_at || new Date().toISOString(),
          unreadCount: thread.unread_count || 0,
        };

        conversations.push(conversation);
        this.conversationsCache.set(thread.thread_id, conversation);
      }

      console.log('[FacebookAdapter] Private API fetched', conversations.length, 'conversations');
      return conversations;

    } catch (error: any) {
      console.error('[FacebookAdapter] Private API fetch error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch messages via Private API
   */
  private async fetchMessagesViaPrivateAPI(threadId: string): Promise<Message[]> {
    try {
      const response = await axios.get(`${FB_PRIVATE_API_URL}/fb/messages/${threadId}?limit=50`, { timeout: 30000 });
      const data = response.data;

      if (!data.success) {
        throw new Error(data.error || 'Failed to fetch messages');
      }

      const messages: Message[] = [];

      for (const msg of data.messages || []) {
        messages.push({
          id: msg.id,
          conversationId: `facebook_${threadId}`,
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
      console.error('[FacebookAdapter] Private API messages error:', error.message);
      throw error;
    }
  }

  /**
   * Send message via Private API (with human-like behavior)
   */
  private async sendMessageViaPrivateAPI(threadId: string, content: string): Promise<SendMessageResponse> {
    try {
      const response = await axios.post(`${FB_PRIVATE_API_URL}/fb/send`, {
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
      console.error('[FacebookAdapter] Private API send error:', error.message);
      return { success: false, error: error.message };
    }
  }

  // ============================================
  // RASTA B: Optimized Browser Bridge
  // Hidden, Resource-Blocked, Mobile View
  // Bypasses E2EE by extracting decrypted DOM data
  // Target: <100MB RAM, 2-3 second response
  // ============================================

  /**
   * Create an optimized hidden browser instance
   * - Uses mobile view (m.facebook.com) - lighter, easier to parse
   * - Blocks images, CSS, fonts, media to save RAM
   * - Runs completely hidden in background
   */
  private async createOptimizedBrowserBridge(): Promise<BrowserWindow> {
    const facebookSession = session.fromPartition('facebook-login');

    // Close existing if any
    if (this.optimizedBrowser && !this.optimizedBrowser.isDestroyed()) {
      this.optimizedBrowser.close();
    }

    // Create visible browser for debugging
    this.optimizedBrowser = new BrowserWindow({
      width: 800,  // Larger for debugging
      height: 900,
      show: true,  // VISIBLE - for debugging
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: facebookSession,
        // Disable features to save RAM
        images: false,  // Block images
        webgl: false,
        spellcheck: false,
      },
    });

    // Open DevTools for debugging
    this.optimizedBrowser.webContents.openDevTools();

    // Set mobile user agent
    this.optimizedBrowser.webContents.setUserAgent(FacebookAdapter.MOBILE_USER_AGENT);

    // ============================================
    // RESOURCE BLOCKER - Key to Low RAM Usage
    // Block: images, fonts, media, ads (but ALLOW CSS and JS)
    // ============================================
    this.optimizedBrowser.webContents.session.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const url = details.url.toLowerCase();
        const resourceType = details.resourceType;

        // Block only heavy media content (NOT CSS/JS)
        const blockedTypes = ['image', 'font', 'media'];
        const blockedPatterns = [
          /\.jpg$/i, /\.jpeg$/i, /\.png$/i, /\.gif$/i, /\.webp$/i, /\.svg$/i, /\.ico$/i,
          /\.woff/i, /\.woff2/i, /\.ttf$/i, /\.eot$/i,
          /\.mp4$/i, /\.mp3$/i, /\.webm$/i, /\.ogg$/i,
          /facebook\.com\/ads/i, /fbcdn\.net.*video/i,
          /static.*\.facebook\.com.*font/i,
        ];

        // Block if type matches
        if (blockedTypes.includes(resourceType)) {
          callback({ cancel: true });
          return;
        }

        // Block if URL matches patterns
        for (const pattern of blockedPatterns) {
          if (pattern.test(url)) {
            callback({ cancel: true });
            return;
          }
        }

        // Allow all other requests (including CSS and JS)
        callback({ cancel: false });
      }
    );

    // ============================================
    // PROTOCOL REDIRECT BLOCKER
    // Block fb-messenger:// and other app protocol redirects
    // This keeps the browser on the web page
    // ============================================
    this.optimizedBrowser.webContents.on('will-navigate', (event, url) => {
      console.log('[FacebookAdapter] Navigation attempt:', url);

      // Block non-http protocols (fb-messenger://, messenger://, etc.)
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        console.log('[FacebookAdapter] Blocking protocol redirect:', url);
        event.preventDefault();
        return;
      }
    });

    // Also handle new window attempts (links that try to open in new tab)
    this.optimizedBrowser.webContents.setWindowOpenHandler(({ url }) => {
      console.log('[FacebookAdapter] New window attempt:', url);

      // Block non-http protocols
      if (!url.startsWith('http://') && !url.startsWith('https://')) {
        console.log('[FacebookAdapter] Blocking protocol in new window:', url);
        return { action: 'deny' };
      }

      // Allow but don't open new windows - load in same window
      this.optimizedBrowser?.loadURL(url);
      return { action: 'deny' };
    });

    console.log('[FacebookAdapter] Created optimized browser bridge (hidden, mobile, resource-blocked)');
    return this.optimizedBrowser;
  }

  /**
   * Extract conversations using mobile browser with existing session
   * Uses same session as login window so cookies are shared
   */
  private async extractWithMobileBrowser(existingSession: Electron.Session): Promise<Conversation[]> {
    console.log('[FacebookAdapter] Creating mobile browser with existing session...');

    return new Promise(async (resolve) => {
      // Create mobile browser with SAME session (cookies shared)
      const mobileBrowser = new BrowserWindow({
        width: 375,
        height: 667,
        show: true,  // Show for debugging - change to false later
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: existingSession,  // SAME SESSION = SAME COOKIES
        },
      });

      // Set mobile user agent
      mobileBrowser.webContents.setUserAgent(FacebookAdapter.MOBILE_USER_AGENT);

      // Open DevTools for debugging
      mobileBrowser.webContents.openDevTools();

      console.log('[FacebookAdapter] Loading m.facebook.com/messages...');
      mobileBrowser.loadURL('https://m.facebook.com/messages/');

      let extractAttempts = 0;
      const maxAttempts = 5;

      const extractData = async () => {
        extractAttempts++;
        
        if (mobileBrowser.isDestroyed()) {
          resolve([]);
          return;
        }

        const currentURL = mobileBrowser.webContents.getURL();
        console.log('[FacebookAdapter] Mobile URL:', currentURL);

        // Check for login redirect
        if (currentURL.includes('/login')) {
          console.log('[FacebookAdapter] Session not shared properly - redirected to login');
          mobileBrowser.close();
          resolve([]);
          return;
        }

        try {
          const result = await mobileBrowser.webContents.executeJavaScript(this.getMobileExtractionScript());
          console.log('[FacebookAdapter] Mobile extraction:', result.success, 'conversations:', result.conversations?.length || 0);

          if (result.conversations?.length > 0) {
            mobileBrowser.close();
            
            const conversations: Conversation[] = result.conversations.map((conv: any) => ({
              id: `facebook_${conv.id}`,
              platform: 'facebook' as Platform,
              platformConversationId: conv.id,
              participantName: conv.participantName || 'Facebook User',
              participantId: conv.id,
              participantAvatarUrl: conv.avatarUrl,
              lastMessage: conv.lastMessage,
              lastMessageAt: new Date().toISOString(),
              unreadCount: 0,
            }));
            
            resolve(conversations);
            return;
          }

          if (extractAttempts < maxAttempts) {
            console.log('[FacebookAdapter] Retrying extraction... attempt', extractAttempts);
            setTimeout(extractData, 3000);
          } else {
            console.log('[FacebookAdapter] Max attempts reached, closing');
            mobileBrowser.close();
            resolve([]);
          }
        } catch (err: any) {
          console.error('[FacebookAdapter] Extraction error:', err.message);
          if (extractAttempts < maxAttempts) {
            setTimeout(extractData, 3000);
          } else {
            mobileBrowser.close();
            resolve([]);
          }
        }
      };

      mobileBrowser.webContents.on('did-finish-load', () => {
        console.log('[FacebookAdapter] Mobile page loaded');
        setTimeout(extractData, 3000);
      });

      // Timeout after 30 seconds
      setTimeout(() => {
        if (!mobileBrowser.isDestroyed()) {
          console.log('[FacebookAdapter] Mobile extraction timeout');
          mobileBrowser.close();
          resolve([]);
        }
      }, 30000);
    });
  }

  /**
   * Desktop DOM Extraction Script for messenger.com
   * Extracts conversations from the logged-in messenger page
   */
  private getDesktopExtractionScript(): string {
    return `
      (function() {
        try {
          console.log('[FB Desktop Extractor] Starting extraction...');
          console.log('[FB Desktop Extractor] URL:', window.location.href);
          
          const conversations = [];
          const seenIds = new Set();
          
          // Find all conversation links
          const threadLinks = document.querySelectorAll('a[href*="/t/"]');
          console.log('[FB Desktop Extractor] Found', threadLinks.length, 'thread links');
          
          for (const link of threadLinks) {
            try {
              const href = link.getAttribute('href') || '';
              
              // Extract thread ID
              const match = href.match(/\\/t\\/([0-9]+)/);
              if (!match) continue;
              
              let threadId = match[1];
              if (href.includes('/e2ee/')) threadId = 'e2ee_' + threadId;
              
              // Skip duplicates
              if (seenIds.has(threadId)) continue;
              seenIds.add(threadId);
              
              // Find parent container
              const container = link.closest('[role="row"]') || 
                               link.closest('[role="listitem"]') ||
                               link.parentElement?.parentElement?.parentElement;
              
              // Extract name
              let name = 'Facebook User';
              const spans = container?.querySelectorAll('span[dir="auto"]') || [];
              for (const span of spans) {
                const text = span.textContent?.trim();
                if (text && text.length > 1 && text.length < 50 && 
                    !text.match(/^\\d+[mhd]$/) && !text.includes('Active')) {
                  name = text;
                  break;
                }
              }
              
              // Extract last message
              let lastMessage = '';
              const allSpans = container?.querySelectorAll('span') || [];
              for (const span of allSpans) {
                const text = span.textContent?.trim() || '';
                if (text && text !== name && text.length > 2 && text.length < 200 &&
                    !text.match(/^\\d+[mhd]$/) && !text.includes('Active') &&
                    !text.includes('end-to-end')) {
                  lastMessage = text;
                  break;
                }
              }
              
              // Extract avatar
              let avatarUrl = '';
              const img = container?.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
              if (img) avatarUrl = img.getAttribute('src') || '';
              
              conversations.push({
                id: threadId,
                participantName: name,
                lastMessage: lastMessage || 'Click to view',
                avatarUrl: avatarUrl,
                platform: 'facebook'
              });
              
              console.log('[FB Desktop Extractor] Added:', threadId, name);
              
            } catch (e) {
              console.warn('[FB Desktop Extractor] Error parsing link:', e);
            }
          }
          
          console.log('[FB Desktop Extractor] Total extracted:', conversations.length);
          
          return {
            success: conversations.length > 0,
            conversations: conversations,
            pageUrl: window.location.href
          };
          
        } catch (error) {
          console.error('[FB Desktop Extractor] Error:', error);
          return { success: false, error: error.message, conversations: [] };
        }
      })();
    `;
  }

  /**
   * Mobile DOM Extraction Script - "Sucker" Script
   * Extracts decrypted messages from m.facebook.com DOM
   * Much simpler structure than desktop version
   */
  private getMobileExtractionScript(): string {
    return `
      (function() {
        try {
          console.log('[FB Mobile Sucker] Starting extraction...');
          
          const conversations = [];
          
          // messenger.com structure - works for both desktop and mobile views
          // Look for conversation list items
          const threadSelectors = [
            '[data-testid*="thread"]',       // Thread containers
            '[data-testid*="conversation"]', // Conversation items
            'a[href*="/t/"]',                // Thread links
            '[role="row"]',                  // Row items in list
            '[role="listitem"]',             // List items
            'div[data-id]',                  // Elements with data-id
          ];
          
          let threadElements = [];
          for (const selector of threadSelectors) {
            const elements = document.querySelectorAll(selector);
            if (elements.length > 0) {
              threadElements = Array.from(elements);
              console.log('[FB Mobile Sucker] Found', elements.length, 'threads with selector:', selector);
              break;
            }
          }
          
          // Fallback: Look for any links to threads
          if (threadElements.length === 0) {
            const allLinks = document.querySelectorAll('a[href*="/t/"]');
            threadElements = Array.from(allLinks);
            console.log('[FB Mobile Sucker] Fallback found', threadElements.length, 'thread links');
          }
          
          const seenIds = new Set();
          
          for (const element of threadElements.slice(0, 30)) {  // Max 30 for performance
            try {
              // Extract thread ID from href
              let threadId = '';
              let href = '';
              
              // Try to get href from element or find link inside
              if (element.tagName === 'A') {
                href = element.getAttribute('href') || '';
              } else {
                const link = element.querySelector('a[href*="/t/"]');
                if (link) href = link.getAttribute('href') || '';
              }
              
              // Pattern: /t/123456 or /e2ee/t/123456
              const tMatch = href.match(/\\/t\\/([0-9]+)/);
              if (tMatch) {
                threadId = tMatch[1];
                if (href.includes('/e2ee/')) threadId = 'e2ee_' + threadId;
              } else {
                // Try data attributes
                const dataId = element.getAttribute('data-id') || element.getAttribute('data-thread-id');
                if (dataId) threadId = dataId;
                else continue;  // Skip if no ID found
              }
              
              // Skip duplicates
              if (seenIds.has(threadId)) continue;
              seenIds.add(threadId);
              
              // Extract name - look for text content
              let name = 'Unknown';
              const nameSelectors = [
                'span[dir="auto"]',
                'strong',
                'h4',
                'h3',
                '[role="heading"]',
                '.x1lliihq',  // Facebook's class for names
              ];
              
              for (const ns of nameSelectors) {
                const nameEl = element.querySelector(ns);
                if (nameEl && nameEl.textContent) {
                  const text = nameEl.textContent.trim();
                  // Filter out timestamps and system messages
                  if (text && text.length > 0 && text.length < 100 && 
                      !text.match(/^\\d+[mhd]$/) && !text.includes('Active')) {
                    name = text;
                    break;
                  }
                }
              }
              
              // Extract last message
              let lastMessage = '';
              const allSpans = element.querySelectorAll('span');
              for (const span of allSpans) {
                const text = span.textContent?.trim() || '';
                // Skip name, timestamps, and system messages
                if (text && text !== name && text.length > 2 && text.length < 200 &&
                    !text.match(/^\\d+[mhd]$/) && !text.includes('Active') &&
                    !text.includes('end-to-end')) {
                  lastMessage = text;
                  break;
                }
              }
              
              // Extract avatar
              let avatarUrl = '';
              const img = element.querySelector('img[src*="scontent"], img[src*="fbcdn"]');
              if (img) {
                avatarUrl = img.getAttribute('src') || '';
              }
              
              // Add conversation if we have thread ID (name can be Unknown)
              if (threadId) {
                conversations.push({
                  id: threadId,
                  participantName: name || 'Facebook User',
                  lastMessage: lastMessage || 'Click to view messages',
                  avatarUrl: avatarUrl,
                  platform: 'facebook'
                });
                console.log('[FB Mobile Sucker] Added:', threadId, name);
              }
            } catch (e) {
              console.warn('[FB Mobile Sucker] Error parsing element:', e);
            }
          }
          
          console.log('[FB Mobile Sucker] Extracted', conversations.length, 'conversations');
          
          return {
            success: conversations.length > 0,
            conversations: conversations,
            pageUrl: window.location.href,
            timestamp: new Date().toISOString()
          };
          
        } catch (error) {
          console.error('[FB Mobile Sucker] Extraction error:', error);
          return {
            success: false,
            error: error.message,
            conversations: [],
            pageUrl: window.location.href
          };
        }
      })();
    `;
  }

  /**
   * Fetch conversations using Optimized Browser Bridge
   * Fast, low RAM, works with E2EE (extracts decrypted DOM)
   */
  private async fetchConversationsViaOptimizedBridge(): Promise<Conversation[]> {
    if (!this.cookies) {
      throw new Error('No cookies available for browser bridge');
    }

    console.log('[FacebookAdapter] Using Optimized Browser Bridge (mobile, hidden, resource-blocked)');

    return new Promise(async (resolve, reject) => {
      try {
        const browser = await this.createOptimizedBrowserBridge();

        // Set cookies explicitly before loading page
        const facebookSession = browser.webContents.session;
        await facebookSession.cookies.set({
          url: 'https://www.messenger.com',
          name: 'c_user',
          value: this.cookies.c_user,
          domain: '.messenger.com',
        });
        await facebookSession.cookies.set({
          url: 'https://www.messenger.com',
          name: 'xs',
          value: this.cookies.xs,
          domain: '.messenger.com',
        });
        if (this.cookies.datr) {
          await facebookSession.cookies.set({
            url: 'https://www.messenger.com',
            name: 'datr',
            value: this.cookies.datr,
            domain: '.messenger.com',
          });
        }
        if (this.cookies.fr) {
          await facebookSession.cookies.set({
            url: 'https://www.messenger.com',
            name: 'fr',
            value: this.cookies.fr,
            domain: '.messenger.com',
          });
        }

        console.log('[FacebookAdapter] Cookies set, loading Mobile Messenger...');
        await browser.loadURL(FacebookAdapter.MOBILE_MESSENGER_URL);

        let extractAttempts = 0;
        const maxAttempts = 5;
        let isResolved = false;

        const extractData = async () => {
          if (isResolved) return;
          extractAttempts++;

          try {
            if (!browser || browser.isDestroyed()) {
              if (!isResolved) {
                isResolved = true;
                resolve([]);
              }
              return;
            }

            const currentURL = browser.webContents.getURL();
            console.log('[FacebookAdapter] Current URL:', currentURL);

            // Check for login redirect
            if (currentURL.includes('/login')) {
              isResolved = true;
              browser.close();
              reject(new Error('Session expired - please re-login'));
              return;
            }

            // Try to dismiss PIN popup if present
            try {
              await browser.webContents.executeJavaScript(`
                (function() {
                  // Look for "Forgotten PIN?" button or close button
                  const forgottenBtn = document.querySelector('a[href*="recover"], button:contains("Forgotten")');
                  if (forgottenBtn) {
                    forgottenBtn.click();
                    console.log('[FB] Clicked Forgotten PIN');
                    return true;
                  }
                  
                  // Look for close/dismiss button
                  const closeBtn = document.querySelector('[aria-label*="Close"], [aria-label*="Dismiss"], button[aria-label*="close"]');
                  if (closeBtn) {
                    closeBtn.click();
                    console.log('[FB] Clicked close button');
                    return true;
                  }
                  
                  return false;
                })();
              `);
            } catch (e) {
              // Ignore PIN dismiss errors
            }

            // Wait for page to have content
            const hasContent = await browser.webContents.executeJavaScript(`
              document.body && document.body.innerHTML.length > 1000
            `);

            if (!hasContent && extractAttempts < maxAttempts) {
              console.log('[FacebookAdapter] Page not ready, waiting...');
              setTimeout(extractData, 2000);
              return;
            }

            // Run extraction script
            const result = await browser.webContents.executeJavaScript(this.getMobileExtractionScript());
            console.log('[FacebookAdapter] Extraction result:', result.success, 'conversations:', result.conversations.length);

            if (result.conversations.length === 0 && extractAttempts < maxAttempts) {
              console.log('[FacebookAdapter] No conversations found, retrying... (attempt', extractAttempts, ')');
              setTimeout(extractData, 2500);
              return;
            }

            isResolved = true;

            // Close browser to free RAM
            if (!browser.isDestroyed()) {
              browser.close();
            }

            if (result.success && result.conversations.length > 0) {
              const conversations: Conversation[] = result.conversations.map((conv: any) => ({
                id: `facebook_${conv.id}`,
                platform: 'facebook' as Platform,
                platformConversationId: conv.id,
                participantName: conv.participantName || 'Facebook User',
                participantId: conv.id,
                participantAvatarUrl: conv.avatarUrl,
                lastMessage: conv.lastMessage,
                lastMessageAt: new Date().toISOString(),
                unreadCount: 0,
              }));

              // Cache conversations
              conversations.forEach(c => this.conversationsCache.set(c.platformConversationId, c));

              console.log('[FacebookAdapter] Optimized Bridge extracted', conversations.length, 'conversations');
              resolve(conversations);
            } else {
              console.log('[FacebookAdapter] Falling back to standard browser...');
              // Fallback to standard extraction if mobile fails
              resolve(await this.fetchConversationsViaBrowser());
            }

          } catch (err: any) {
            console.error('[FacebookAdapter] Extraction error:', err);
            if (extractAttempts < maxAttempts) {
              setTimeout(extractData, 2000);
            } else {
              isResolved = true;
              if (!browser.isDestroyed()) browser.close();
              resolve([]);
            }
          }
        };

        // Start extraction after page load
        browser.webContents.on('did-finish-load', () => {
          console.log('[FacebookAdapter] Mobile page loaded, starting extraction...');
          setTimeout(extractData, 1500);
        });

        // Timeout fallback
        setTimeout(() => {
          if (!isResolved) {
            console.log('[FacebookAdapter] Timeout, forcing extraction...');
            extractData();
          }
        }, 10000);

      } catch (error: any) {
        console.error('[FacebookAdapter] Optimized Bridge error:', error);
        reject(error);
      }
    });
  }

  // ============================================
  // Main Public Methods (with toggle logic)
  // ============================================

  /**
   * Set the mode for Facebook connection
   * Private API uses MinhHuyDev's maintained fbchat-v2 fork
   */
  setMode(usePrivateAPI: boolean): void {
    this.usePrivateAPI = usePrivateAPI;
    console.log(`[FacebookAdapter] Mode: ${usePrivateAPI ? 'Private API (fbchat-v2 MQTT)' : 'Browser Automation'}`);
  }

  /**
   * Connect to Facebook
   * Tries Private API first (fast), falls back to Browser Automation
   */
  async connect(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    if (!credentials.cookies?.c_user || !credentials.cookies?.xs) {
      return { success: false, error: 'Facebook requires c_user and xs cookies' };
    }

    this.cookies = {
      c_user: credentials.cookies.c_user,
      xs: credentials.cookies.xs,
      datr: credentials.cookies.datr,
      fr: credentials.cookies.fr,
    };

    // Try Private API first if enabled
    if (this.usePrivateAPI) {
      const sidecarAvailable = await this.isPrivateAPIAvailable();
      console.log('[FacebookAdapter] Private API (fbchat-v2) available:', sidecarAvailable);

      if (sidecarAvailable) {
        console.log('[FacebookAdapter] Using Private API (fbchat-v2 MQTT) - Fast mode ⚡');
        const result = await this.connectViaPrivateAPI(this.cookies);

        if (result.success) {
          return result;
        }

        console.log('[FacebookAdapter] Private API failed, falling back to browser automation');
        console.log('[FacebookAdapter] Error:', result.error);
      }
    }

    // Use Optimized Browser Bridge (Rasta B)
    // Hidden, mobile view, resource-blocked for low RAM
    console.log('[FacebookAdapter] Using Optimized Browser Bridge 🚀');
    try {
      console.log('[FacebookAdapter] Fetching via hidden mobile browser...');

      // Try optimized bridge first (faster, low RAM)
      let conversations: Conversation[] = [];
      try {
        conversations = await this.fetchConversationsViaOptimizedBridge();
        console.log(`[FacebookAdapter] Optimized Bridge found ${conversations.length} conversations`);
      } catch (bridgeError: any) {
        console.log('[FacebookAdapter] Optimized Bridge failed, trying standard browser:', bridgeError.message);
        // Fallback to standard browser if optimized fails
        conversations = await this.fetchConversationsViaBrowser();
      }

      console.log(`[FacebookAdapter] Total: ${conversations.length} conversations`);

      this.isConnected = true;
      console.log('[FacebookAdapter] Connected via Browser Bridge');
      this.emit('connected');

      // Start real-time polling
      this.startRealTime();

      return {
        success: true,
        userId: this.cookies.c_user,
        username: undefined,
      };
    } catch (error: any) {
      this.isConnected = false;
      console.error('[FacebookAdapter] Connection failed:', error.message);
      return { success: false, error: `Facebook connection failed: ${error.message}` };
    }
  }

  /**
   * Disconnect from Facebook
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

    if (this.fetchWindow && !this.fetchWindow.isDestroyed()) {
      this.fetchWindow.close();
      this.fetchWindow = null;
    }

    console.log('[FacebookAdapter] Disconnected');
    this.emit('disconnected');
  }

  /**
   * Check if connected
   */
  connected(): boolean {
    return this.isConnected && (this.privateAPIConnected || this.cookies !== null);
  }

  /**
   * Fetch all conversations
   * If cache is empty, triggers extraction from hidden browser
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Facebook');
    }

    // FIRST: Return cached conversations if available
    if (this.conversationsCache.size > 0) {
      const cached = Array.from(this.conversationsCache.values());
      console.log('[FacebookAdapter] Returning', cached.length, 'cached conversations');
      return cached;
    }

    // No cache - trigger extraction
    console.log('[FacebookAdapter] No cached conversations, triggering extraction...');
    return await this.triggerExtraction();
  }

  /**
   * Fetch messages for a specific conversation
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Facebook');
    }

    const threadId = conversationId.replace('facebook_', '');

    // Use Private API if connected and mode is set
    if (this.usePrivateAPI && this.privateAPIConnected) {
      try {
        return await this.fetchMessagesViaPrivateAPI(threadId);
      } catch (error: any) {
        console.error('[FacebookAdapter] Private API failed, falling back to browser:', error.message);
      }
    }

    // Return cached messages or fetch via browser
    const cached = this.messagesCache.get(threadId);
    if (cached && cached.length > 0) {
      return cached;
    }

    return await this.fetchMessagesViaBrowser(conversationId);
  }

  /**
   * Send a message
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected()) {
      return { success: false, error: 'Not connected to Facebook' };
    }

    const threadId = conversationId.replace('facebook_', '');

    // Use Private API if connected and mode is set
    if (this.usePrivateAPI && this.privateAPIConnected) {
      try {
        return await this.sendMessageViaPrivateAPI(threadId, content);
      } catch (error: any) {
        console.error('[FacebookAdapter] Private API send failed, falling back to browser:', error.message);
      }
    }

    // Fallback to browser automation
    return await this.sendMessageViaBrowser(conversationId, content);
  }

  // Store pending extraction resolver for manual trigger
  private pendingExtractionResolve: ((conversations: Conversation[]) => void) | null = null;
  private messengerCloseTimer: NodeJS.Timeout | null = null;

  /**
   * Open browser login window for Facebook
   * After login, navigates to messenger.com, waits for page load, then 15 sec for PIN entry
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<FacebookCookies | null> {
    return new Promise((resolve) => {
      const facebookSession = session.fromPartition('facebook-login');

      console.log('[FacebookAdapter] Opening login window...');

      this.loginWindow = new BrowserWindow({
        width: 900,
        height: 700,
        resizable: true,
        title: 'Facebook Login',
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: facebookSession,
        },
      });

      this.loginWindow.show();
      this.loginWindow.focus();

      console.log('[FacebookAdapter] Loading Facebook...');
      this.loginWindow.loadURL('https://www.facebook.com/');

      let isResolved = false;
      let timerStarted = false;

      const checkForLogin = async () => {
        if (isResolved) return;

        try {
          if (!this.loginWindow || this.loginWindow.isDestroyed()) {
            return;
          }

          const currentURL = this.loginWindow.webContents.getURL();

          if (currentURL.includes('facebook.com') &&
            !currentURL.includes('/login') &&
            !currentURL.includes('/checkpoint') &&
            !currentURL.includes('/recover')) {

            const cookies = await facebookSession.cookies.get({ domain: '.facebook.com' });

            let c_user = '';
            let xs = '';
            let datr = '';
            let fr = '';

            for (const cookie of cookies) {
              if (cookie.name === 'c_user') c_user = cookie.value;
              if (cookie.name === 'xs') xs = cookie.value;
              if (cookie.name === 'datr') datr = cookie.value;
              if (cookie.name === 'fr') fr = cookie.value;
            }

            if (c_user && xs) {
              isResolved = true;

              console.log('[FacebookAdapter] Login successful!');

              const facebookCookies: FacebookCookies = { c_user, xs, datr, fr };

              // Store cookies
              this.cookies = facebookCookies;
              this.isConnected = true;
              console.log('[FacebookAdapter] Cookies stored for Browser Bridge');

              // Navigate to messenger.com
              if (!this.loginWindow.isDestroyed()) {
                console.log('[FacebookAdapter] Navigating to Messenger...');
                this.loginWindow.loadURL('https://www.messenger.com/');
              }

              resolve(facebookCookies);
              return;
            }
          }

          setTimeout(checkForLogin, 2000);

        } catch (err: any) {
          console.error('[FacebookAdapter] Login check error:', err.message);
        }
      };

      // Handle page loads
      this.loginWindow.webContents.on('did-finish-load', () => {
        if (!this.loginWindow || this.loginWindow.isDestroyed()) return;
        
        const url = this.loginWindow.webContents.getURL();
        console.log('[FacebookAdapter] Page loaded:', url);
        
        // Start login check for facebook.com
        if (url.includes('facebook.com') && !url.includes('messenger.com')) {
          setTimeout(checkForLogin, 1000);
        }
        
        // Start 20 sec timer ONLY when messenger.com loads and timer not already started
        if (url.includes('messenger.com') && !timerStarted) {
          timerStarted = true;
          console.log('[FacebookAdapter] *** MESSENGER LOADED - Starting 20 sec countdown ***');
          this.loginWindow.setTitle('Messenger - Enter PIN now! (20 seconds remaining)');
          
          // Clear any existing timer
          if (this.messengerCloseTimer) {
            clearTimeout(this.messengerCloseTimer);
          }
          
          // Start 20 second countdown
          this.messengerCloseTimer = setTimeout(() => {
            console.log('[FacebookAdapter] *** 20 sec timer fired - closing window ***');
            if (this.loginWindow && !this.loginWindow.isDestroyed()) {
              this.loginWindow.close();
              this.loginWindow = null;
            }
          }, 20000);
        }
      });

      this.loginWindow.on('closed', () => {
        console.log('[FacebookAdapter] Login window closed');
        // Clear timer if window closed manually
        if (this.messengerCloseTimer) {
          clearTimeout(this.messengerCloseTimer);
          this.messengerCloseTimer = null;
        }
        this.loginWindow = null;
        if (!isResolved) {
          isResolved = true;
          resolve(null);
        }
      });

      // Timeout after 10 minutes for initial login
      setTimeout(() => {
        if (!isResolved && this.loginWindow && !this.loginWindow.isDestroyed()) {
          console.log('[FacebookAdapter] Login timeout - closing window');
          this.loginWindow.close();
        }
      }, 10 * 60 * 1000);
    });
  }

  /**
   * Trigger extraction - creates an OPTIMIZED hidden browser to extract conversations
   * - Desktop browser (mobile DOM is different and extraction fails)
   * - Images/fonts/media blocked (saves RAM)
   * - Target: ~150-200MB RAM instead of 500MB
   */
  async triggerExtraction(): Promise<Conversation[]> {
    console.log('[FacebookAdapter] Optimized extraction triggered');
    
    // Return cached if available
    if (this.conversationsCache.size > 0) {
      const cached = Array.from(this.conversationsCache.values());
      console.log('[FacebookAdapter] Returning', cached.length, 'cached conversations');
      return cached;
    }

    if (!this.cookies) {
      console.log('[FacebookAdapter] No cookies available');
      return [];
    }

    // Create OPTIMIZED hidden browser for extraction
    // Using DESKTOP view because mobile messenger.com has different DOM structure
    const facebookSession = session.fromPartition('facebook-login');
    
    const extractBrowser = new BrowserWindow({
      width: 1200,  // Desktop width
      height: 800,  // Desktop height
      show: false,  // Hidden
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        session: facebookSession,
        images: false,  // Block images - saves RAM
      },
    });

    // Block heavy resources to save RAM (but keep desktop user agent)
    extractBrowser.webContents.session.webRequest.onBeforeRequest(
      { urls: ['*://*/*'] },
      (details, callback) => {
        const url = details.url.toLowerCase();
        const resourceType = details.resourceType;

        // Block images, fonts, media
        const blockedTypes = ['image', 'font', 'media'];
        if (blockedTypes.includes(resourceType)) {
          callback({ cancel: true });
          return;
        }

        // Block by URL pattern
        const blockedPatterns = [
          /\.jpg$/i, /\.jpeg$/i, /\.png$/i, /\.gif$/i, /\.webp$/i, /\.svg$/i,
          /\.woff/i, /\.woff2/i, /\.ttf$/i,
          /\.mp4$/i, /\.mp3$/i, /\.webm$/i,
          /fbcdn\.net.*video/i,
        ];

        for (const pattern of blockedPatterns) {
          if (pattern.test(url)) {
            callback({ cancel: true });
            return;
          }
        }

        callback({ cancel: false });
      }
    );

    console.log('[FacebookAdapter] Loading messenger.com (desktop, resource-blocked)...');
    await extractBrowser.loadURL('https://www.messenger.com/');

    // Wait for page to load
    await new Promise(resolve => setTimeout(resolve, 6000));

    // Try extraction multiple times
    for (let attempt = 1; attempt <= 5; attempt++) {
      console.log('[FacebookAdapter] Extraction attempt', attempt);
      
      try {
        const result = await extractBrowser.webContents.executeJavaScript(this.getDesktopExtractionScript());
        console.log('[FacebookAdapter] Result:', result.success, 'conversations:', result.conversations?.length || 0);

        if (result.success && result.conversations?.length > 0) {
          const conversations: Conversation[] = [];
          
          for (const conv of result.conversations) {
            const conversation: Conversation = {
              id: `facebook_${conv.id}`,
              platform: 'facebook' as Platform,
              platformConversationId: conv.id,
              participantName: conv.participantName || 'Facebook User',
              participantId: conv.id,
              participantAvatarUrl: conv.avatarUrl,
              lastMessage: conv.lastMessage,
              lastMessageAt: new Date().toISOString(),
              unreadCount: 0,
            };
            conversations.push(conversation);
            this.conversationsCache.set(conv.id, conversation);
          }

          console.log('[FacebookAdapter] Extracted', conversations.length, 'conversations (optimized)');
          
          // Close hidden browser
          if (!extractBrowser.isDestroyed()) {
            extractBrowser.close();
          }
          
          return conversations;
        }
      } catch (err: any) {
        console.error('[FacebookAdapter] Extraction error:', err.message);
      }

      // Wait before retry
      await new Promise(resolve => setTimeout(resolve, 2000));
    }

    // Close browser
    if (!extractBrowser.isDestroyed()) {
      extractBrowser.close();
    }

    console.log('[FacebookAdapter] Extraction failed after 5 attempts');
    return [];
  }

  /**
   * Check if login window is open and on messenger
   */
  isLoginWindowReady(): boolean {
    if (!this.loginWindow || this.loginWindow.isDestroyed()) {
      return false;
    }
    const url = this.loginWindow.webContents.getURL();
    return url.includes('messenger.com') || url.includes('facebook.com');
  }

  // ============================================
  // Browser Automation Methods (Fallback)
  // ============================================

  /**
   * Enforce rate limiting
   */
  private async enforceRateLimit(): Promise<void> {
    const now = Date.now();
    const timeSinceLastFetch = now - this.lastFetchTime;

    if (timeSinceLastFetch < MIN_FETCH_INTERVAL) {
      const waitTime = MIN_FETCH_INTERVAL - timeSinceLastFetch;
      console.log(`[FacebookAdapter] Rate limit: waiting ${Math.ceil(waitTime / 1000)}s`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
    }
  }

  /**
   * DOM scraping script to extract conversations from Messenger
   * Updated for Facebook's December 2025 UI
   */
  private getExtractionScript(): string {
    return `
                (function () {
                  try {
                    const conversations = [];
                    const seenIds = new Set();

                    console.log('[FB Debug] Starting extraction...');
                    console.log('[FB Debug] Current URL:', window.location.href);

                    // ============================================
                    // First: Dismiss any blocking modals/dialogs
                    // ============================================

                    // Close PIN restore dialog (E2E encryption)
                    const dismissPinDialog = () => {
                      // Look for close button on PIN dialog
                      const closeButtons = document.querySelectorAll('[aria-label="Close"], [aria-label="close"], [aria-label="Dismiss"], button svg[class*="x1lliihq"]');
                      console.log('[FB Debug] Found', closeButtons.length, 'potential close buttons');

                      for (const btn of closeButtons) {
                        const button = btn.closest('div[role="button"]') || btn.closest('button') || btn;
                        if (button) {
                          // Check if it's part of a dialog/modal
                          const dialog = button.closest('[role="dialog"]') || button.closest('[aria-modal="true"]');
                          if (dialog) {
                            console.log('[FB Debug] Dismissing modal dialog...');
                            button.click();
                            return true;
                          }
                        }
                      }

                      // Alternative: Look for X button by its visual characteristics
                      const allDivButtons = document.querySelectorAll('div[role="button"]');
                      for (const btn of allDivButtons) {
                        const svg = btn.querySelector('svg');
                        const dialog = btn.closest('[role="dialog"]');
                        if (svg && dialog) {
                          // This is likely a close button in a dialog
                          const rect = btn.getBoundingClientRect();
                          // Close buttons are usually small and in top-right
                          if (rect.width < 50 && rect.height < 50) {
                            console.log('[FB Debug] Found dialog close button, clicking...');
                            btn.click();
                            return true;
                          }
                        }
                      }

                      // Look for "Not now" or "Skip" buttons
                      const skipButtons = document.querySelectorAll('div[role="button"], button');
                      for (const btn of skipButtons) {
                        const text = btn.textContent?.toLowerCase() || '';
                        if (text.includes('not now') || text.includes('skip') || text.includes('maybe later') || text.includes('cancel')) {
                          const dialog = btn.closest('[role="dialog"]');
                          if (dialog) {
                            console.log('[FB Debug] Clicking skip/cancel button...');
                            btn.click();
                            return true;
                          }
                        }
                      }

                      return false;
                    };

                    // Try to dismiss any blocking dialogs
                    let dismissed = dismissPinDialog();
                    if (dismissed) {
                      console.log('[FB Debug] Dismissed a dialog, waiting for UI update...');
                      // Return early - caller will retry after delay
                      return { success: false, dialogDismissed: true, conversations: [], error: 'Dialog dismissed, retry needed' };
                    }

                    // Method 1: Find all message links
                    const allLinks = document.querySelectorAll('a[href*="/messages/"]');
                    console.log('[FB Debug] Found', allLinks.length, 'message links');

                    // Method 2: Find conversation rows (new Facebook UI)
                    const rows = document.querySelectorAll('[role="row"], [role="listitem"], [data-testid*="mwthreadlist"]');
                    console.log('[FB Debug] Found', rows.length, 'conversation rows');

                    // Method 3: Find by aria-label containing "Conversation"
                    const ariaConvs = document.querySelectorAll('[aria-label*="Conversation"], [aria-label*="conversation"], [aria-label*="Chat"]');
                    console.log('[FB Debug] Found', ariaConvs.length, 'aria-labeled conversations');

                    // Try extracting from links first
                    allLinks.forEach((link, index) => {
                      if (conversations.length >= 20) return;

                      try {
                        const href = link.getAttribute('href') || '';

                        let threadId = '';
                        // Match various URL patterns - FIXED regex patterns
                        const patterns = [
                          /\/messages\/t\/(\d+)/,
                          /\/messages\/e2ee\/t\/(\d+)/,
                          /thread_id=(\d+)/,
                          /\/messages\/(\d+)/
                        ];

                        for (const pattern of patterns) {
                          const match = href.match(pattern);
                          if (match) {
                            threadId = match[1];
                            if (href.includes('/e2ee/')) threadId = 'e2ee_' + threadId;
                            break;
                          }
                        }

                        if (!threadId || seenIds.has(threadId)) return;
                        seenIds.add(threadId);

                        // Find container - try multiple approaches
                        const container = link.closest('[role="row"]') ||
                          link.closest('[role="listitem"]') ||
                          link.closest('[data-testid]') ||
                          link.closest('div[class*="x1n2onr6"]') ||
                          link.parentElement?.parentElement?.parentElement?.parentElement;

                        let participantName = 'Facebook User';

                        // Try multiple selectors for name
                        const nameSelectors = [
                          'span[dir="auto"]',
                          'span[class*="x1lliihq"]',
                          '[data-testid*="name"]',
                          'span > span > span',
                          'strong',
                          'h4',
                          'h3'
                        ];

                        for (const selector of nameSelectors) {
                          const el = container?.querySelector(selector) || link.querySelector(selector);
                          if (el && el.textContent) {
                            const text = el.textContent.trim();
                            // Filter out non-name text
                            if (text.length > 0 && text.length < 50 &&
                              !text.includes('Message') && !text.includes('Active') &&
                              !text.includes('ago') && !text.includes('min') &&
                              !text.includes('hour') && !text.includes('day')) {
                              participantName = text;
                              break;
                            }
                          }
                        }

                        // Get last message preview
                        let lastMessage = '';
                        const allSpans = container?.querySelectorAll('span') || [];
                        for (const span of allSpans) {
                          const text = span.textContent?.trim() || '';
                          // Skip system messages and timestamps
                          if (text.includes('end-to-end') || text.includes('secured') ||
                            text.includes('No one outside') || text.includes('Messages and calls') ||
                            text.includes('Active') || text.match(/^\d+[mhd]$/) ||
                            text === participantName || text.length < 2) {
                            continue;
                          }
                          if (text.length > 2 && text.length < 200) {
                            lastMessage = text;
                            break;
                          }
                        }

                        if (!lastMessage && href.includes('/e2ee/')) {
                          lastMessage = '[End-to-end encrypted chat]';
                        }

                        // Get avatar
                        const avatarImg = container?.querySelector('img[src*="scontent"]') ||
                          container?.querySelector('img[src*="fbcdn"]') ||
                          container?.querySelector('img[alt]');
                        const avatarUrl = avatarImg?.src || '';

                        console.log('[FB Debug] Found conversation:', threadId, participantName);

                        conversations.push({
                          id: threadId,
                          participantName: participantName,
                          avatarUrl: avatarUrl,
                          lastMessage: lastMessage || 'No preview available'
                        });

                      } catch (itemErr) {
                        console.error('[FB Debug] Item error:', itemErr.message);
                      }
                    });

                    // If no conversations found via links, try rows directly
                    if (conversations.length === 0 && rows.length > 0) {
                      console.log('[FB Debug] Trying row-based extraction...');
                      rows.forEach((row, index) => {
                        if (conversations.length >= 20) return;
                        try {
                          const link = row.querySelector('a[href*="/messages/"]');
                          if (!link) return;

                          const href = link.getAttribute('href') || '';
                          const match = href.match(/\/messages\/(?:t|e2ee\/t)\/(\d+)/);
                          if (!match) return;

                          const threadId = match[1];
                          if (seenIds.has(threadId)) return;
                          seenIds.add(threadId);

                          const spans = row.querySelectorAll('span');
                          let name = 'Facebook User';
                          for (const span of spans) {
                            const text = span.textContent?.trim();
                            if (text && text.length > 1 && text.length < 40 && !text.match(/^\d/)) {
                              name = text;
                              break;
                            }
                          }

                          conversations.push({
                            id: threadId,
                            participantName: name,
                            avatarUrl: '',
                            lastMessage: 'Click to view'
                          });
                        } catch (e) { }
                  });
            }

            console.log('[FB Debug] Total conversations found:', conversations.length);
            return { success: true, conversations: conversations };
          } catch (e) {
            console.error('[FB Debug] Extraction error:', e.message);
            return { success: false, error: e.message, conversations: [] };
          }
        })();
    `;
  }

  /**
   * Fetch conversations using browser automation
   */
  private async fetchConversationsViaBrowser(): Promise<Conversation[]> {
    await this.enforceRateLimit();

    console.log('[FacebookAdapter] Fetching messages with browser automation...');

    if (!this.cookies?.c_user || !this.cookies?.xs) {
      throw new Error('Facebook session not found. Please login first.');
    }

    return new Promise(async (resolve, reject) => {
      try {
        const facebookSession = session.fromPartition('facebook-login');

        if (this.fetchWindow && !this.fetchWindow.isDestroyed()) {
          this.fetchWindow.close();
          this.fetchWindow = null;
        }

        this.fetchWindow = new BrowserWindow({
          width: 1200,
          height: 800,
          show: true,  // DEBUG: Show window to see what's happening
          webPreferences: {
            nodeIntegration: false,
            contextIsolation: true,
            session: facebookSession,
          },
        });

        // Open DevTools for debugging
        this.fetchWindow.webContents.openDevTools();

        console.log('[FacebookAdapter] Loading Messenger...');
        this.fetchWindow.loadURL('https://www.facebook.com/messages/');

        let isResolved = false;
        let extractAttempts = 0;
        let dialogDismissAttempts = 0;  // Track dialog dismiss attempts

        const extractConversations = async () => {
          if (isResolved) return;
          extractAttempts++;

          try {
            if (!this.fetchWindow || this.fetchWindow.isDestroyed()) {
              if (!isResolved) {
                isResolved = true;
                resolve([]);
              }
              return;
            }

            const currentURL = this.fetchWindow.webContents.getURL();

            if (currentURL.includes('/login') || currentURL.includes('/checkpoint')) {
              isResolved = true;
              if (this.fetchWindow && !this.fetchWindow.isDestroyed()) {
                this.fetchWindow.close();
              }
              reject(new Error('Facebook session expired. Please re-login.'));
              return;
            }

            const result = await this.fetchWindow.webContents.executeJavaScript(this.getExtractionScript());

            // Limit dialog dismiss retries to 3, then force extraction
            if (result.dialogDismissed && dialogDismissAttempts < 3) {
              dialogDismissAttempts++;
              console.log(`[FacebookAdapter] Dialog dismissed (attempt ${dialogDismissAttempts}/3), retrying...`);
              setTimeout(extractConversations, 1500);
              return;
            }

            // After 3 dialog dismiss attempts, proceed with extraction anyway
            if (result.dialogDismissed && dialogDismissAttempts >= 3) {
              console.log('[FacebookAdapter] Max dialog dismiss attempts reached, proceeding with extraction...');
            }

            if (result.conversations.length === 0 && extractAttempts < MAX_EXTRACT_ATTEMPTS) {
              console.log(`[FacebookAdapter] No conversations yet (attempt ${extractAttempts}/${MAX_EXTRACT_ATTEMPTS}), retrying...`);
              setTimeout(extractConversations, 3000);
              return;
            }

            this.lastFetchTime = Date.now();
            isResolved = true;

            if (this.fetchWindow && !this.fetchWindow.isDestroyed()) {
              this.fetchWindow.close();
            }

            if (result.success && result.conversations.length > 0) {
              const conversations: Conversation[] = result.conversations.map((conv: any) => {
                const conversation: Conversation = {
                  id: `facebook_${conv.id} `,
                  platform: 'facebook',
                  platformConversationId: conv.id,
                  participantName: conv.participantName || 'Facebook User',
                  participantId: conv.id,
                  participantAvatarUrl: conv.avatarUrl,
                  lastMessage: conv.lastMessage,
                  lastMessageAt: new Date().toISOString(),
                  unreadCount: 0,
                };

                this.conversationsCache.set(conv.id, conversation);
                return conversation;
              });

              resolve(conversations);
            } else {
              resolve([]);
            }

          } catch (err: any) {
            if (extractAttempts < MAX_EXTRACT_ATTEMPTS) {
              setTimeout(extractConversations, 3000);
            } else if (!isResolved) {
              isResolved = true;
              if (this.fetchWindow && !this.fetchWindow.isDestroyed()) {
                this.fetchWindow.close();
              }
              resolve([]);
            }
          }
        };

        this.fetchWindow.webContents.on('did-finish-load', () => {
          setTimeout(extractConversations, 6000);
        });

        setTimeout(() => {
          if (!isResolved) {
            isResolved = true;
            if (this.fetchWindow && !this.fetchWindow.isDestroyed()) {
              this.fetchWindow.close();
            }
            resolve([]);
          }
        }, PAGE_LOAD_TIMEOUT);

      } catch (error: any) {
        console.error('[FacebookAdapter] Fetch error:', error.message);
        reject(error);
      }
    });
  }

  /**
   * Fetch messages using browser automation
   */
  private async fetchMessagesViaBrowser(conversationId: string): Promise<Message[]> {
    return new Promise(async (resolve) => {
      const facebookSession = session.fromPartition('facebook-login');

      const threadId = conversationId.replace('facebook_', '');
      const isE2EE = threadId.startsWith('e2ee_');
      const actualThreadId = isE2EE ? threadId.replace('e2ee_', '') : threadId;

      const msgWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: facebookSession,
        },
      });

      const threadUrl = isE2EE
        ? `https://www.facebook.com/messages/e2ee/t/${actualThreadId}/`
        : `https://www.facebook.com/messages/t/${actualThreadId}/`;

      msgWindow.loadURL(threadUrl);

      let isResolved = false;

      const extractMessages = async () => {
        if (isResolved) return;

        try {
          const result = await msgWindow.webContents.executeJavaScript(`
            (function() {
              try {
                const messages = [];
                const allDivs = document.querySelectorAll('div[dir="auto"]');
                
                allDivs.forEach((div, index) => {
                  if (messages.length >= 50) return;
                  
                  const text = div.textContent?.trim();
                  if (!text || text.length < 1 || text.length > 1000) return;
                  
                  if (text.includes('Type a message') || 
                      text.includes('end-to-end encryption') ||
                      text.includes('Messages and calls')) return;
                  
                  const parent = div.closest('[role="row"]') || div.parentElement?.parentElement;
                  if (!parent) return;
                  
                  const style = window.getComputedStyle(parent);
                  const isOutgoing = style.justifyContent === 'flex-end' || 
                                    parent.querySelector('[style*="background-color: rgb(0, 132, 255)"]') !== null;
                  
                  messages.push({
                    id: 'msg_' + index + '_' + Date.now(),
                    content: text,
                    isOutgoing: isOutgoing,
                    sentAt: new Date().toISOString()
                  });
                });
                
                return { success: true, messages: messages.slice(-30) };
              } catch (e) {
                return { success: false, error: e.message, messages: [] };
              }
            })();
          `);

          isResolved = true;
          if (!msgWindow.isDestroyed()) msgWindow.close();

          if (result.success && result.messages.length > 0) {
            const messages: Message[] = result.messages.map((msg: any) => ({
              id: msg.id,
              conversationId: conversationId,
              platformMessageId: msg.id,
              senderId: msg.isOutgoing ? 'me' : 'other',
              senderName: msg.isOutgoing ? 'You' : 'Contact',
              content: msg.content,
              messageType: 'text',
              isOutgoing: msg.isOutgoing,
              isRead: true,
              sentAt: msg.sentAt,
            }));
            resolve(messages);
          } else {
            resolve([]);
          }
        } catch (err: any) {
          isResolved = true;
          if (!msgWindow.isDestroyed()) msgWindow.close();
          resolve([]);
        }
      };

      msgWindow.webContents.on('did-finish-load', () => {
        setTimeout(extractMessages, 4000);
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (!msgWindow.isDestroyed()) msgWindow.close();
          resolve([]);
        }
      }, 20000);
    });
  }

  /**
   * Send message using browser automation
   */
  private sendMessageViaBrowser(conversationId: string, content: string): Promise<SendMessageResponse> {
    return new Promise(async (resolve) => {
      const facebookSession = session.fromPartition('facebook-login');

      const threadId = conversationId.replace('facebook_', '');
      const isE2EE = threadId.startsWith('e2ee_');
      const actualThreadId = isE2EE ? threadId.replace('e2ee_', '') : threadId;

      const sendWindow = new BrowserWindow({
        width: 1200,
        height: 800,
        show: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: facebookSession,
        },
      });

      const threadUrl = isE2EE
        ? `https://www.facebook.com/messages/e2ee/t/${actualThreadId}/`
        : `https://www.facebook.com/messages/t/${actualThreadId}/`;

      sendWindow.loadURL(threadUrl);

      let isResolved = false;

      const tryToSend = async () => {
        if (isResolved) return;

        try {
          // Type the message
          const typeResult = await sendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                const input = document.querySelector('[contenteditable="true"][role="textbox"]') ||
                             document.querySelector('div[aria-label*="Message"]') ||
                             document.querySelector('[data-lexical-editor="true"]');
                
                if (!input) {
                  return { success: false, error: 'Message input not found' };
                }
                
                input.focus();
                input.textContent = ${JSON.stringify(content)};
                input.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(content)} }));
                
                return { success: true };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);

          if (!typeResult.success) {
            isResolved = true;
            if (!sendWindow.isDestroyed()) sendWindow.close();
            resolve({ success: false, error: typeResult.error });
            return;
          }

          await new Promise(r => setTimeout(r, 500));

          // Press Enter to send
          await sendWindow.webContents.executeJavaScript(`
            (function() {
              const input = document.querySelector('[contenteditable="true"][role="textbox"]') ||
                           document.querySelector('[data-lexical-editor="true"]');
              
              if (input) {
                input.dispatchEvent(new KeyboardEvent('keydown', {
                  key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true
                }));
              }
            })();
          `);

          await new Promise(r => setTimeout(r, 2000));

          isResolved = true;
          if (!sendWindow.isDestroyed()) sendWindow.close();
          resolve({ success: true, messageId: 'fb_' + Date.now(), sentAt: new Date().toISOString() });

        } catch (err: any) {
          isResolved = true;
          if (!sendWindow.isDestroyed()) sendWindow.close();
          resolve({ success: false, error: err.message });
        }
      };

      sendWindow.webContents.on('did-finish-load', () => {
        setTimeout(tryToSend, 4000);
      });

      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (!sendWindow.isDestroyed()) sendWindow.close();
          resolve({ success: false, error: 'Timeout' });
        }
      }, 30000);
    });
  }

  // ============================================
  // Real-time and Cache Methods
  // ============================================

  /**
   * Start real-time polling for new messages
   */
  startRealTime(): void {
    if (this.pollingTimer) {
      return;
    }

    console.log('[FacebookAdapter] Starting real-time polling');

    this.pollingTimer = setInterval(async () => {
      if (!this.connected()) {
        this.stopRealTime();
        return;
      }

      try {
        const oldConversations = new Map(this.conversationsCache);

        // Use appropriate fetch method based on connection type
        if (this.usePrivateAPI && this.privateAPIConnected) {
          await this.fetchConversationsViaPrivateAPI();
        } else {
          await this.fetchConversationsViaBrowser();
        }

        // Check for new/updated conversations
        for (const [convId, conversation] of this.conversationsCache) {
          const oldConv = oldConversations.get(convId);

          if (!oldConv || oldConv.lastMessage !== conversation.lastMessage) {
            this.emit('conversationUpdated', {
              platform: 'facebook',
              conversationId: conversation.id,
              conversation,
            });
          }
        }
      } catch (error: any) {
        console.error('[FacebookAdapter] Polling error:', error.message);
        this.emit('error', { platform: 'facebook', error: error.message });
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
      console.log('[FacebookAdapter] Stopped real-time polling');
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
   * Sync connection state with sidecar
   */
  async syncWithSidecar(): Promise<void> {
    try {
      const response = await axios.get(`${FB_PRIVATE_API_URL}/status`, { timeout: 2000 });
      if (response.data.connected) {
        this.privateAPIConnected = true;
        this.privateAPIUserId = response.data.user_id;
        this.privateAPIUsername = response.data.username;
        this.isConnected = true;
        console.log('[FacebookAdapter] Synced with sidecar - connected as:', response.data.user_id);
      }
    } catch {
      // Sidecar not running - don't change state
    }
  }

  /**
   * Submit PIN to unlock chat history
   * Called from frontend when user enters PIN
   */
  async submitPIN(pin: string): Promise<{ success: boolean; error?: string }> {
    console.log('[FacebookAdapter] Submitting PIN...');
    
    if (!this.optimizedBrowser || this.optimizedBrowser.isDestroyed()) {
      return { success: false, error: 'No active browser window' };
    }

    try {
      // Enter PIN in the input fields
      const result = await this.optimizedBrowser.webContents.executeJavaScript(`
        (function() {
          try {
            // Find PIN input fields (usually 6 digits)
            const inputs = document.querySelectorAll('input[type="text"], input[type="tel"], input[type="number"]');
            const pinDigits = '${pin}'.split('');
            
            console.log('[FB PIN] Found', inputs.length, 'input fields');
            console.log('[FB PIN] PIN digits:', pinDigits.length);
            
            // Fill each digit in separate input
            let filled = 0;
            for (let i = 0; i < Math.min(inputs.length, pinDigits.length); i++) {
              if (inputs[i]) {
                inputs[i].value = pinDigits[i];
                inputs[i].dispatchEvent(new Event('input', { bubbles: true }));
                inputs[i].dispatchEvent(new Event('change', { bubbles: true }));
                filled++;
              }
            }
            
            console.log('[FB PIN] Filled', filled, 'inputs');
            
            // Wait a bit then submit
            setTimeout(() => {
              // Look for submit button
              const submitBtn = document.querySelector('button[type="submit"], button:not([type="button"])');
              if (submitBtn) {
                submitBtn.click();
                console.log('[FB PIN] Clicked submit button');
              } else {
                // Try pressing Enter on last input
                const lastInput = inputs[inputs.length - 1];
                if (lastInput) {
                  lastInput.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                  }));
                  console.log('[FB PIN] Pressed Enter on last input');
                }
              }
            }, 500);
            
            return { success: true, filled: filled };
          } catch (e) {
            console.error('[FB PIN] Error:', e);
            return { success: false, error: e.message };
          }
        })();
      `);

      console.log('[FacebookAdapter] PIN submit result:', result);
      
      // Wait for page to process PIN
      await new Promise(r => setTimeout(r, 2000));
      
      return { success: true };
      
    } catch (error: any) {
      console.error('[FacebookAdapter] PIN submit error:', error);
      return { success: false, error: error.message };
    }
  }
}

// Export singleton instance
let facebookAdapter: FacebookAdapter | null = null;

export function getFacebookAdapter(): FacebookAdapter {
  if (!facebookAdapter) {
    facebookAdapter = new FacebookAdapter();
  }
  return facebookAdapter;
}
