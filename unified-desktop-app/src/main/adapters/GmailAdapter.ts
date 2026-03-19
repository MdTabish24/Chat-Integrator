/**
 * Gmail Platform Adapter
 * Uses OAuth2 Authorization Code flow with Gmail API
 * Only supports reading Primary inbox and replying to threads (no new compose)
 */

import { EventEmitter } from 'events';
import { BrowserWindow, session, shell, app } from 'electron';
import { createServer, IncomingMessage, ServerResponse } from 'http';
import type { 
  Platform, 
  Conversation, 
  Message, 
  PlatformCredentials,
  SendMessageResponse 
} from '../../shared/types.js';
import { GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from '../config.js';

const GMAIL_BASE_URL = 'https://gmail.googleapis.com/gmail/v1';
const POLLING_INTERVAL = 60000; // 60 seconds

// OAuth Configuration - Try multiple ports if one is busy
const REDIRECT_PORTS = [8923, 8924, 8925, 8926, 8927];
let activeRedirectPort = 8923;

// Gmail API Scopes
const GMAIL_SCOPES = [
  'openid',
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/gmail.modify',
];

interface GmailTokens {
  accessToken: string;
  refreshToken?: string;
  expiresAt?: number;
}

interface GmailUser {
  emailAddress: string;
  name?: string;
  picture?: string;
}

interface EmailThread {
  id: string;
  subject: string;
  from: string;
  fromEmail: string;
  snippet: string;
  date: string;
  unreadCount: number;
  messageCount: number;
}

export class GmailAdapter extends EventEmitter {
  readonly platform: Platform = 'gmail' as Platform;
  
  private tokens: GmailTokens | null = null;
  private currentUser: GmailUser | null = null;
  private isConnected: boolean = false;
  private loginWindow: BrowserWindow | null = null;
  private pollingTimer: NodeJS.Timeout | null = null;
  private callbackServer: ReturnType<typeof createServer> | null = null;
  
  // Cache
  private threadsCache: Map<string, Conversation> = new Map();
  private messagesCache: Map<string, Message[]> = new Map();

  constructor() {
    super();
    console.log('[GmailAdapter] Initialized');
  }

  // ============================================
  // Connection Management
  // ============================================

  /**
   * Connect to Gmail with OAuth tokens
   */
  async connect(credentials: PlatformCredentials): Promise<{ success: boolean; userId?: string; username?: string; error?: string }> {
    if (!credentials.accessToken) {
      return { success: false, error: 'Gmail requires access token from OAuth login' };
    }

    this.tokens = {
      accessToken: credentials.accessToken,
      refreshToken: credentials.refreshToken,
      expiresAt: credentials.expiresAt,
    };

    try {
      // Verify token by fetching user profile
      const user = await this.fetchCurrentUser();
      if (!user) {
        return { success: false, error: 'Failed to verify Gmail token' };
      }
      
      this.currentUser = user;
      this.isConnected = true;
      
      console.log('[GmailAdapter] Connected as:', user.emailAddress);
      this.emit('connected');
      
      // Start polling for new emails
      this.startRealTime();
      
      return {
        success: true,
        userId: user.emailAddress,
        username: user.name || user.emailAddress,
      };
    } catch (error: any) {
      this.isConnected = false;
      console.error('[GmailAdapter] Connection failed:', error.message);
      return { success: false, error: `Gmail connection failed: ${error.message}` };
    }
  }

  /**
   * Disconnect from Gmail
   */
  async disconnect(): Promise<void> {
    this.stopRealTime();
    this.tokens = null;
    this.currentUser = null;
    this.isConnected = false;
    this.threadsCache.clear();
    this.messagesCache.clear();
    
    this.closeLoginWindow();
    this.stopCallbackServer();
    
    console.log('[GmailAdapter] Disconnected');
    this.emit('disconnected');
  }

  connected(): boolean {
    return this.isConnected && this.tokens !== null;
  }

  getUserId(): string | null {
    return this.currentUser?.emailAddress || null;
  }

  getUsername(): string | null {
    return this.currentUser?.name || this.currentUser?.emailAddress || null;
  }

  getStatus(): string {
    if (this.isConnected) return 'connected';
    if (this.tokens) return 'connecting';
    return 'disconnected';
  }

  // ============================================
  // OAuth Flow
  // ============================================

  /**
   * Open browser login window for Gmail OAuth
   * Uses Authorization Code flow (more secure than implicit)
   */
  async openLoginWindow(parentWindow?: BrowserWindow): Promise<GmailTokens | null> {
    // Check if credentials are configured
    if (!GOOGLE_CLIENT_ID) {
      console.error('[GmailAdapter] GOOGLE_CLIENT_ID not configured');
      this.emit('error', { platform: 'gmail', error: 'Google OAuth not configured. Set GOOGLE_CLIENT_ID environment variable.' });
      return null;
    }

    return new Promise(async (resolve) => {
      let isResolved = false;
      
      // Start local callback server (tries multiple ports)
      let port: number;
      try {
        port = await this.startCallbackServer((code) => {
          if (isResolved) return;
          isResolved = true;
          
          console.log('[GmailAdapter] Got authorization code');
          this.closeLoginWindow();
          this.stopCallbackServer();
          
          // Exchange code for tokens
          this.exchangeCodeForTokens(code, port)
            .then(tokens => resolve(tokens))
            .catch(err => {
              console.error('[GmailAdapter] Token exchange failed:', err.message);
              resolve(null);
            });
        });
      } catch (err: any) {
        console.error('[GmailAdapter] Failed to start callback server:', err.message);
        this.emit('error', { platform: 'gmail', error: err.message });
        resolve(null);
        return;
      }

      const redirectUri = `http://localhost:${port}/callback`;
      
      // Generate state for CSRF protection
      const state = Math.random().toString(36).substring(2, 15);
      
      // Build authorization URL
      const authUrl = new URL('https://accounts.google.com/o/oauth2/v2/auth');
      authUrl.searchParams.set('client_id', GOOGLE_CLIENT_ID);
      authUrl.searchParams.set('redirect_uri', redirectUri);
      authUrl.searchParams.set('response_type', 'code');
      authUrl.searchParams.set('scope', GMAIL_SCOPES.join(' '));
      authUrl.searchParams.set('access_type', 'offline'); // Get refresh token
      authUrl.searchParams.set('prompt', 'consent'); // Force consent to get refresh token
      authUrl.searchParams.set('state', state);
      
      console.log('[GmailAdapter] Opening OAuth window with redirect:', redirectUri);
      
      // Create login window
      const gmailSession = session.fromPartition('gmail-oauth');
      
      this.loginWindow = new BrowserWindow({
        width: 500,
        height: 700,
        resizable: true,
        title: 'Sign in with Google',
        parent: parentWindow || undefined,
        modal: false,
        show: true,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: gmailSession,
        },
      });

      this.loginWindow.loadURL(authUrl.toString());
      this.loginWindow.show();
      this.loginWindow.focus();

      this.loginWindow.on('closed', () => {
        this.loginWindow = null;
        if (!isResolved) {
          isResolved = true;
          this.stopCallbackServer();
          resolve(null);
        }
      });
      
      // Timeout after 5 minutes
      setTimeout(() => {
        if (!isResolved) {
          console.log('[GmailAdapter] Login timeout');
          isResolved = true;
          this.closeLoginWindow();
          this.stopCallbackServer();
          resolve(null);
        }
      }, 5 * 60 * 1000);
    });
  }

  /**
   * Start local HTTP server to receive OAuth callback
   * Tries multiple ports if one is busy
   */
  private startCallbackServer(onCode: (code: string) => void): Promise<number> {
    this.stopCallbackServer();
    
    return new Promise((resolve, reject) => {
      const tryPort = (portIndex: number) => {
        if (portIndex >= REDIRECT_PORTS.length) {
          reject(new Error('All callback ports are busy. Please close other applications and try again.'));
          return;
        }
        
        const port = REDIRECT_PORTS[portIndex];
        
        this.callbackServer = createServer((req: IncomingMessage, res: ServerResponse) => {
          const url = new URL(req.url || '', `http://localhost:${port}`);
          
          if (url.pathname === '/callback') {
            const code = url.searchParams.get('code');
            const error = url.searchParams.get('error');
            
            if (error) {
              console.error('[GmailAdapter] OAuth error:', error);
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body><h2>Login Failed</h2><p>You can close this window.</p><script>window.close()</script></body></html>');
              return;
            }
            
            if (code) {
              res.writeHead(200, { 'Content-Type': 'text/html' });
              res.end('<html><body><h2>Login Successful!</h2><p>You can close this window and return to Chat Orbitor.</p><script>window.close()</script></body></html>');
              onCode(code);
            } else {
              res.writeHead(400, { 'Content-Type': 'text/html' });
              res.end('<html><body><h2>Error</h2><p>No authorization code received.</p></body></html>');
            }
          } else {
            res.writeHead(404);
            res.end('Not found');
          }
        });
        
        this.callbackServer.on('error', (err: any) => {
          if (err.code === 'EADDRINUSE') {
            console.log(`[GmailAdapter] Port ${port} is busy, trying next...`);
            this.callbackServer = null;
            tryPort(portIndex + 1);
          } else {
            reject(err);
          }
        });
        
        this.callbackServer.listen(port, () => {
          activeRedirectPort = port;
          console.log(`[GmailAdapter] Callback server listening on port ${port}`);
          resolve(port);
        });
      };
      
      tryPort(0);
    });
  }

  /**
   * Stop callback server
   */
  private stopCallbackServer(): void {
    if (this.callbackServer) {
      this.callbackServer.close();
      this.callbackServer = null;
    }
  }

  /**
   * Close login window
   */
  private closeLoginWindow(): void {
    if (this.loginWindow && !this.loginWindow.isDestroyed()) {
      this.loginWindow.close();
      this.loginWindow = null;
    }
  }

  /**
   * Exchange authorization code for tokens
   */
  private async exchangeCodeForTokens(code: string, port: number): Promise<GmailTokens | null> {
    const redirectUri = `http://localhost:${port}/callback`;
    
    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          code,
          redirect_uri: redirectUri,
          grant_type: 'authorization_code',
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as any;
        throw new Error(error.error_description || `Token exchange failed: ${response.status}`);
      }

      const data = await response.json() as any;
      
      console.log('[GmailAdapter] Token exchange successful');
      
      return {
        accessToken: data.access_token,
        refreshToken: data.refresh_token,
        expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined,
      };
    } catch (error: any) {
      console.error('[GmailAdapter] Token exchange error:', error.message);
      return null;
    }
  }

  /**
   * Refresh access token
   */
  private async refreshAccessToken(): Promise<boolean> {
    if (!this.tokens?.refreshToken) {
      console.error('[GmailAdapter] No refresh token available');
      return false;
    }

    try {
      const response = await fetch('https://oauth2.googleapis.com/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          client_id: GOOGLE_CLIENT_ID,
          client_secret: GOOGLE_CLIENT_SECRET,
          refresh_token: this.tokens.refreshToken,
          grant_type: 'refresh_token',
        }),
      });

      if (!response.ok) {
        const error = await response.json().catch(() => ({})) as any;
        if (error.error === 'invalid_grant') {
          // Refresh token expired, need re-auth
          this.isConnected = false;
          this.emit('error', { platform: 'gmail', error: 'Session expired. Please re-login.' });
          return false;
        }
        throw new Error(error.error_description || 'Token refresh failed');
      }

      const data = await response.json() as any;
      
      this.tokens.accessToken = data.access_token;
      this.tokens.expiresAt = data.expires_in ? Date.now() + data.expires_in * 1000 : undefined;
      
      console.log('[GmailAdapter] Token refreshed');
      return true;
    } catch (error: any) {
      console.error('[GmailAdapter] Token refresh error:', error.message);
      return false;
    }
  }

  // ============================================
  // API Requests
  // ============================================

  /**
   * Make authenticated request to Gmail API
   */
  private async gmailRequest<T>(endpoint: string, options: RequestInit = {}, retry = true): Promise<T> {
    if (!this.tokens?.accessToken) {
      throw new Error('Not authenticated');
    }

    // Check if token needs refresh
    if (this.tokens.expiresAt && Date.now() > this.tokens.expiresAt - 60000) {
      console.log('[GmailAdapter] Token expiring soon, refreshing...');
      await this.refreshAccessToken();
    }

    const response = await fetch(`${GMAIL_BASE_URL}${endpoint}`, {
      ...options,
      headers: {
        'Authorization': `Bearer ${this.tokens.accessToken}`,
        'Content-Type': 'application/json',
        ...options.headers,
      },
    });

    if (response.status === 401 && retry) {
      // Try refresh
      const refreshed = await this.refreshAccessToken();
      if (refreshed) {
        return this.gmailRequest(endpoint, options, false);
      }
      this.isConnected = false;
      this.emit('error', { platform: 'gmail', error: 'Token expired. Please re-login.' });
      throw new Error('Token expired');
    }

    if (response.status === 403) {
      throw new Error('Access denied. Please ensure Gmail API access is granted.');
    }

    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as any;
      throw new Error(error?.error?.message || `Gmail API error: ${response.status}`);
    }

    return response.json() as Promise<T>;
  }

  /**
   * Fetch current user profile
   */
  private async fetchCurrentUser(): Promise<GmailUser | null> {
    try {
      // Get user info from Google
      const userInfoResponse = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
        headers: {
          'Authorization': `Bearer ${this.tokens?.accessToken}`,
        },
      });
      
      if (!userInfoResponse.ok) {
        throw new Error('Failed to fetch user info');
      }
      
      const userInfo = await userInfoResponse.json() as any;
      
      // Also get Gmail profile
      const profile = await this.gmailRequest<any>('/users/me/profile');
      
      return {
        emailAddress: profile.emailAddress || userInfo.email,
        name: userInfo.name,
        picture: userInfo.picture,
      };
    } catch (error: any) {
      console.error('[GmailAdapter] Failed to fetch user:', error.message);
      return null;
    }
  }

  // ============================================
  // Data Fetching
  // ============================================

  /**
   * Fetch all conversations (email threads from Primary inbox)
   */
  async fetchConversations(): Promise<Conversation[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Gmail');
    }

    try {
      // Query for ALL inbox emails (read + unread)
      const query = 'in:inbox -in:spam -in:trash';
      
      const response = await this.gmailRequest<any>(`/users/me/threads?q=${encodeURIComponent(query)}&maxResults=50`);
      const threads = response.threads || [];
      
      const conversations: Conversation[] = [];
      
      // Fetch details for each thread
      for (const threadRef of threads.slice(0, 30)) {
        try {
          const thread = await this.fetchThreadDetails(threadRef.id);
          if (thread) {
            const conversation: Conversation = {
              id: `gmail_${thread.id}`,
              platform: 'gmail' as Platform,
              platformConversationId: thread.id,
              participantName: thread.from,
              participantId: thread.fromEmail,
              participantAvatarUrl: undefined,
              lastMessage: `📧 ${thread.subject}`,
              lastMessageAt: thread.date,
              unreadCount: thread.unreadCount,
            };
            
            conversations.push(conversation);
            this.threadsCache.set(thread.id, conversation);
          }
        } catch (err: any) {
          console.error('[GmailAdapter] Failed to fetch thread:', err.message);
        }
      }
      
      console.log('[GmailAdapter] Fetched', conversations.length, 'email threads');
      return conversations;
    } catch (error: any) {
      console.error('[GmailAdapter] fetchConversations error:', error.message);
      throw error;
    }
  }

  /**
   * Fetch thread details
   */
  private async fetchThreadDetails(threadId: string): Promise<EmailThread | null> {
    try {
      const thread = await this.gmailRequest<any>(
        `/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Date`
      );
      const messages = thread.messages || [];
      
      if (messages.length === 0) return null;
      
      const firstMessage = messages[0];
      const lastMessage = messages[messages.length - 1];
      
      const firstHeaders: Record<string, string> = {};
      const lastHeaders: Record<string, string> = {};
      
      for (const header of firstMessage.payload?.headers || []) {
        firstHeaders[header.name.toLowerCase()] = header.value;
      }
      for (const header of lastMessage.payload?.headers || []) {
        lastHeaders[header.name.toLowerCase()] = header.value;
      }
      
      const fromHeader = firstHeaders['from'] || 'Unknown';
      const subject = firstHeaders['subject'] || '(No Subject)';
      const date = lastHeaders['date'] || '';
      
      const unreadCount = messages.filter((m: any) => m.labelIds?.includes('UNREAD')).length;
      
      return {
        id: threadId,
        subject,
        from: this.extractSenderName(fromHeader),
        fromEmail: this.extractEmailAddress(fromHeader),
        snippet: thread.snippet || '',
        date,
        unreadCount,
        messageCount: messages.length,
      };
    } catch (error: any) {
      console.error('[GmailAdapter] fetchThreadDetails error:', error.message);
      return null;
    }
  }

  /**
   * Fetch messages for a thread
   */
  async fetchMessages(conversationId: string): Promise<Message[]> {
    if (!this.connected()) {
      throw new Error('Not connected to Gmail');
    }

    const threadId = conversationId.replace('gmail_', '');
    
    // Return cached if available
    const cached = this.messagesCache.get(threadId);
    if (cached && cached.length > 0) {
      return cached;
    }

    try {
      const thread = await this.gmailRequest<any>(`/users/me/threads/${threadId}?format=full`);
      const gmailMessages = thread.messages || [];
      
      const messages: Message[] = [];
      
      for (const msg of gmailMessages) {
        const headers: Record<string, string> = {};
        for (const header of msg.payload?.headers || []) {
          headers[header.name.toLowerCase()] = header.value;
        }
        
        const fromHeader = headers['from'] || 'Unknown';
        const subject = headers['subject'] || '';
        const date = headers['date'] || '';
        
        const body = this.extractBody(msg.payload);
        const isOutgoing = this.currentUser?.emailAddress 
          ? fromHeader.toLowerCase().includes(this.currentUser.emailAddress.toLowerCase())
          : false;
        
        messages.push({
          id: msg.id,
          conversationId: `gmail_${threadId}`,
          platformMessageId: msg.id,
          senderId: this.extractEmailAddress(fromHeader),
          senderName: this.extractSenderName(fromHeader),
          content: body || msg.snippet || '',
          messageType: 'text',
          isOutgoing,
          isRead: !msg.labelIds?.includes('UNREAD'),
          sentAt: date,
        });
      }
      
      // Sort oldest first
      messages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
      
      this.messagesCache.set(threadId, messages);
      console.log('[GmailAdapter] Fetched', messages.length, 'emails for thread', threadId);
      
      return messages;
    } catch (error: any) {
      console.error('[GmailAdapter] fetchMessages error:', error.message);
      return [];
    }
  }

  /**
   * Send a reply to an existing thread
   * Note: Gmail adapter only supports replies, not new emails
   */
  async sendMessage(conversationId: string, content: string): Promise<SendMessageResponse> {
    if (!this.connected()) {
      return { success: false, error: 'Not connected to Gmail' };
    }

    const threadId = conversationId.replace('gmail_', '');

    try {
      // Get thread to find reply-to info
      const thread = await this.gmailRequest<any>(
        `/users/me/threads/${threadId}?format=metadata&metadataHeaders=From&metadataHeaders=Subject&metadataHeaders=Message-ID&metadataHeaders=References`
      );
      const messages = thread.messages || [];
      
      if (messages.length === 0) {
        return { success: false, error: 'Cannot compose new emails. Only replies are supported.' };
      }
      
      const lastMessage = messages[messages.length - 1];
      const headers: Record<string, string> = {};
      for (const header of lastMessage.payload?.headers || []) {
        headers[header.name.toLowerCase()] = header.value;
      }
      
      const originalFrom = headers['from'] || '';
      const originalSubject = headers['subject'] || '';
      const messageId = headers['message-id'] || '';
      const references = headers['references'] || '';
      
      const replyTo = this.extractEmailAddress(originalFrom);
      const replySubject = originalSubject.toLowerCase().startsWith('re:') 
        ? originalSubject 
        : `Re: ${originalSubject}`;
      const newReferences = references ? `${references} ${messageId}` : messageId;
      
      // Build raw email
      const rawEmail = [
        `To: ${replyTo}`,
        `Subject: ${replySubject}`,
        `In-Reply-To: ${messageId}`,
        `References: ${newReferences}`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        content,
      ].join('\r\n');
      
      // Base64url encode
      const encodedEmail = Buffer.from(rawEmail).toString('base64')
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/, '');
      
      // Send
      const response = await this.gmailRequest<any>('/users/me/messages/send', {
        method: 'POST',
        body: JSON.stringify({
          raw: encodedEmail,
          threadId,
        }),
      });

      console.log('[GmailAdapter] Reply sent:', response.id);

      // Clear cache for this thread
      this.messagesCache.delete(threadId);

      return {
        success: true,
        messageId: response.id,
        sentAt: new Date().toISOString(),
      };
    } catch (error: any) {
      console.error('[GmailAdapter] sendMessage error:', error.message);
      return { success: false, error: error.message };
    }
  }

  /**
   * Mark email as read
   */
  async markAsRead(messageId: string): Promise<void> {
    if (!this.connected()) return;
    
    try {
      await this.gmailRequest(`/users/me/messages/${messageId}/modify`, {
        method: 'POST',
        body: JSON.stringify({
          removeLabelIds: ['UNREAD'],
        }),
      });
      console.log('[GmailAdapter] Marked as read:', messageId);
    } catch (error: any) {
      console.error('[GmailAdapter] markAsRead error:', error.message);
    }
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Extract email body from payload
   */
  private extractBody(payload: any): string {
    if (!payload) return '';
    
    // Simple body
    if (payload.body?.data) {
      try {
        return Buffer.from(payload.body.data, 'base64').toString('utf-8');
      } catch {
        return '';
      }
    }
    
    // Multipart - prefer plain text
    if (payload.parts) {
      for (const part of payload.parts) {
        if (part.mimeType === 'text/plain' && part.body?.data) {
          try {
            return Buffer.from(part.body.data, 'base64').toString('utf-8');
          } catch {
            continue;
          }
        }
        if (part.parts) {
          const nested = this.extractBody(part);
          if (nested) return nested;
        }
      }
      
      // Fallback to HTML
      for (const part of payload.parts) {
        if (part.mimeType === 'text/html' && part.body?.data) {
          try {
            const html = Buffer.from(part.body.data, 'base64').toString('utf-8');
            return this.stripHtml(html);
          } catch {
            continue;
          }
        }
      }
    }
    
    return '';
  }

  /**
   * Strip HTML tags
   */
  private stripHtml(html: string): string {
    let text = html.replace(/<style[^>]*>.*?<\/style>/gis, '');
    text = text.replace(/<script[^>]*>.*?<\/script>/gis, '');
    text = text.replace(/<br\s*\/?>/gi, '\n');
    text = text.replace(/<\/(?:p|div|tr|li|h[1-6])>/gi, '\n');
    text = text.replace(/<[^>]+>/g, '');
    text = text.replace(/&nbsp;/g, ' ');
    text = text.replace(/&amp;/g, '&');
    text = text.replace(/&lt;/g, '<');
    text = text.replace(/&gt;/g, '>');
    text = text.replace(/&quot;/g, '"');
    text = text.replace(/&#39;/g, "'");
    text = text.replace(/\n{3,}/g, '\n\n');
    return text.trim();
  }

  private extractEmailAddress(from: string): string {
    const match = from.match(/<([^>]+)>/);
    return match ? match[1] : from.trim();
  }

  private extractSenderName(from: string): string {
    const match = from.match(/^([^<]+)</);
    return match ? match[1].trim().replace(/"/g, '') : this.extractEmailAddress(from);
  }

  // ============================================
  // Real-time Polling
  // ============================================

  startRealTime(): void {
    if (this.pollingTimer) return;
    
    console.log('[GmailAdapter] Starting polling');
    
    this.pollingTimer = setInterval(async () => {
      if (!this.connected()) {
        this.stopRealTime();
        return;
      }
      
      try {
        // Check for new emails
        const conversations = await this.fetchConversations();
        
        // Emit update event
        this.emit('conversationsUpdated', { conversations });
      } catch (error: any) {
        console.error('[GmailAdapter] Polling error:', error.message);
      }
    }, POLLING_INTERVAL);
  }

  stopRealTime(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer);
      this.pollingTimer = null;
      console.log('[GmailAdapter] Stopped polling');
    }
  }
}

// Singleton
let gmailAdapter: GmailAdapter | null = null;

export function getGmailAdapter(): GmailAdapter {
  if (!gmailAdapter) {
    gmailAdapter = new GmailAdapter();
  }
  return gmailAdapter;
}
