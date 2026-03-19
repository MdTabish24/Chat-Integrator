# Design Document: Unified Desktop Application

## Overview

This document describes the architecture and design for a Unified Desktop Application that combines the existing React frontend with Electron to create a standalone desktop app. The app will handle all social media DM fetching locally from the user's PC (using residential IP), eliminating the need for server-side API calls that get blocked by platforms.

The key innovation is that all platform API calls happen from the user's local machine, making them appear as normal browser requests rather than server-side automation.

## Architecture

```mermaid
graph TB
    subgraph "Desktop App (Electron)"
        subgraph "Main Process"
            MP[Main Process]
            SM[Session Manager]
            SE[Sync Engine]
            PA[Platform Adapters]
            LS[Local Storage]
        end
        
        subgraph "Renderer Process"
            RP[React Frontend]
            IPC[IPC Bridge]
        end
        
        subgraph "Hidden Browser Windows"
            FB[Facebook Window]
            LI[LinkedIn Window]
            IG[Instagram Window]
        end
    end
    
    subgraph "External Platforms"
        TW[Twitter/X API]
        WA[WhatsApp Web]
        TG[Telegram API]
        DC[Discord API]
        FBM[Facebook Messenger]
        LIM[LinkedIn Messaging]
        IGM[Instagram DMs]
    end
    
    RP <--> IPC
    IPC <--> MP
    MP --> SM
    MP --> SE
    MP --> PA
    MP --> LS
    
    PA --> TW
    PA --> WA
    PA --> TG
    PA --> DC
    PA --> FB --> FBM
    PA --> LI --> LIM
    PA --> IG --> IGM
```

## Components and Interfaces

### 1. Main Process (main.js)

The Electron main process orchestrates all operations.

```typescript
interface MainProcess {
  // Window management
  createMainWindow(): BrowserWindow;
  createTray(): Tray;
  createPlatformWindow(platform: Platform): BrowserWindow;
  
  // IPC handlers
  registerIPCHandlers(): void;
  
  // Lifecycle
  onReady(): void;
  onActivate(): void;
  onWindowAllClosed(): void;
}
```

### 2. Session Manager

Handles authentication state for all platforms.

```typescript
interface SessionManager {
  // Session storage
  saveSession(platform: Platform, session: PlatformSession): void;
  getSession(platform: Platform): PlatformSession | null;
  clearSession(platform: Platform): void;
  clearAllSessions(): void;
  
  // Session validation
  isSessionValid(platform: Platform): boolean;
  refreshSession(platform: Platform): Promise<boolean>;
  
  // Encryption
  encryptData(data: string): string;
  decryptData(encrypted: string): string;
}

interface PlatformSession {
  platform: Platform;
  cookies: Record<string, string>;
  tokens?: Record<string, string>;
  userId?: string;
  username?: string;
  expiresAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}
```

### 3. Platform Adapters

Each platform has a dedicated adapter for authentication and message fetching.

```typescript
interface PlatformAdapter {
  platform: Platform;
  
  // Authentication
  authenticate(): Promise<AuthResult>;
  isAuthenticated(): boolean;
  logout(): Promise<void>;
  
  // Message operations
  fetchConversations(): Promise<Conversation[]>;
  fetchMessages(conversationId: string): Promise<Message[]>;
  sendMessage(conversationId: string, content: string): Promise<Message>;
  
  // Real-time (where supported)
  onNewMessage?(callback: (message: Message) => void): void;
  disconnect?(): void;
}

interface AuthResult {
  success: boolean;
  session?: PlatformSession;
  error?: string;
  requiresAction?: 'qr_scan' | '2fa' | 'captcha';
}
```

### 4. Real-Time Message Engine

The core innovation of this desktop app is **real-time messaging** instead of periodic sync. Each platform adapter maintains persistent connections where possible.

```typescript
interface RealTimeEngine {
  // Connection management
  startAllConnections(): Promise<void>;
  stopAllConnections(): void;
  reconnectPlatform(platform: Platform): Promise<void>;
  
  // Status
  getConnectionStatus(platform: Platform): ConnectionStatus;
  getAllConnectionStatuses(): Record<Platform, ConnectionStatus>;
  
  // Events - Real-time callbacks
  onNewMessage(callback: (message: Message, platform: Platform) => void): void;
  onMessageRead(callback: (messageId: string, platform: Platform) => void): void;
  onTypingIndicator(callback: (conversationId: string, platform: Platform, isTyping: boolean) => void): void;
  onConnectionChange(callback: (platform: Platform, status: ConnectionStatus) => void): void;
  
  // Fallback sync for non-realtime platforms
  syncNonRealtimePlatforms(): Promise<SyncResult>;
}

type ConnectionStatus = 'connected' | 'connecting' | 'disconnected' | 'error';

interface SyncResult {
  success: boolean;
  platforms: Record<Platform, PlatformSyncResult>;
  totalNewMessages: number;
  timestamp: Date;
}

interface PlatformSyncResult {
  success: boolean;
  conversationsCount: number;
  newMessagesCount: number;
  error?: string;
}
```

### Real-Time Strategy Per Platform

| Platform | Real-Time Method | Fallback |
|----------|------------------|----------|
| WhatsApp | whatsapp-web.js events (WebSocket) | None needed |
| Telegram | MTProto persistent connection | None needed |
| Discord | Discord Gateway WebSocket | REST API polling |
| Instagram | Long-polling on inbox endpoint | 30s polling |
| Twitter | Long-polling on DM endpoint | 15s polling |
| Facebook | MutationObserver on DOM | 30s page refresh |
| LinkedIn | MutationObserver on DOM | 60s page refresh |

### 4.1 Platform Real-Time Implementations

#### WhatsApp Real-Time (Native)
```typescript
// whatsapp-web.js provides native real-time via WebSocket
this.client.on('message', (msg) => {
  this.emit('newMessage', this.mapMessage(msg));
});

this.client.on('message_ack', (msg, ack) => {
  if (ack === 3) { // Read
    this.emit('messageRead', msg.id._serialized);
  }
});
```

#### Telegram Real-Time (Native)
```typescript
// Telegram MTProto provides native real-time
this.client.addEventHandler((event) => {
  if (event instanceof NewMessage) {
    this.emit('newMessage', this.mapMessage(event.message));
  }
});
```

#### Instagram Real-Time (Long-Polling)
```typescript
class InstagramRealTime {
  private pollInterval: NodeJS.Timer;
  private lastSeenTimestamp: number;
  
  startRealTime() {
    // Poll every 5 seconds for new messages
    this.pollInterval = setInterval(async () => {
      const inbox = await this.fetchInbox();
      const newMessages = inbox.filter(m => m.timestamp > this.lastSeenTimestamp);
      
      for (const msg of newMessages) {
        this.emit('newMessage', msg);
      }
      
      this.lastSeenTimestamp = Date.now();
    }, 5000); // 5 second polling for near real-time
  }
}
```

#### Twitter Real-Time (Long-Polling)
```typescript
class TwitterRealTime {
  private pollInterval: NodeJS.Timer;
  private lastCursor: string;
  
  startRealTime() {
    // Poll every 10 seconds (respecting rate limits)
    this.pollInterval = setInterval(async () => {
      const response = await this.fetchDMUpdates(this.lastCursor);
      
      for (const msg of response.newMessages) {
        this.emit('newMessage', msg);
      }
      
      this.lastCursor = response.cursor;
    }, 10000); // 10 second polling
  }
}
```

#### Facebook/LinkedIn Real-Time (DOM Observer)
```typescript
class FacebookRealTime {
  private observer: MutationObserver;
  
  startRealTime() {
    // Watch for DOM changes in Messenger
    await this.browserWindow.webContents.executeJavaScript(`
      const observer = new MutationObserver((mutations) => {
        for (const mutation of mutations) {
          if (mutation.type === 'childList') {
            // Check for new message elements
            const newMessages = mutation.addedNodes;
            // Send to main process via IPC
            window.electronAPI.onDOMMessage(newMessages);
          }
        }
      });
      
      observer.observe(document.querySelector('.message-list'), {
        childList: true,
        subtree: true
      });
    `);
  }
}
```

### 5. Local Storage

Persistent storage using electron-store with encryption.

```typescript
interface LocalStorage {
  // Sessions
  saveSessions(sessions: Record<Platform, PlatformSession>): void;
  getSessions(): Record<Platform, PlatformSession>;
  
  // Conversations cache
  saveConversations(platform: Platform, conversations: Conversation[]): void;
  getConversations(platform: Platform): Conversation[];
  
  // Messages cache
  saveMessages(conversationId: string, messages: Message[]): void;
  getMessages(conversationId: string): Message[];
  
  // Settings
  saveSettings(settings: AppSettings): void;
  getSettings(): AppSettings;
  
  // Export/Import
  exportData(): string;
  importData(data: string): void;
  clearAllData(): void;
}

interface AppSettings {
  syncInterval: number;
  autoStart: boolean;
  minimizeToTray: boolean;
  showNotifications: boolean;
  theme: 'light' | 'dark' | 'system';
  dataRetentionDays: number;
}
```

### 6. IPC Bridge (Preload Script)

Secure communication between main and renderer processes.

```typescript
interface ElectronAPI {
  // Platform operations
  getPlatforms(): Promise<PlatformConfig[]>;
  connectPlatform(platform: Platform): Promise<AuthResult>;
  disconnectPlatform(platform: Platform): Promise<void>;
  
  // Sync operations
  syncAll(): Promise<SyncResult>;
  syncPlatform(platform: Platform): Promise<PlatformSyncResult>;
  
  // Data operations
  getConversations(platform?: Platform): Promise<Conversation[]>;
  getMessages(conversationId: string): Promise<Message[]>;
  sendMessage(conversationId: string, content: string): Promise<Message>;
  
  // Settings
  getSettings(): Promise<AppSettings>;
  saveSettings(settings: AppSettings): Promise<void>;
  
  // Events
  onSyncStatus(callback: (status: SyncStatus) => void): void;
  onNewMessage(callback: (message: Message) => void): void;
  onAuthStatus(callback: (platform: Platform, status: AuthStatus) => void): void;
}
```

## Data Models

### Conversation

```typescript
interface Conversation {
  id: string;
  platform: Platform;
  platformConversationId: string;
  participantId: string;
  participantName: string;
  participantAvatarUrl?: string;
  lastMessage?: string;
  lastMessageAt: Date;
  unreadCount: number;
  isGroup: boolean;
  createdAt: Date;
  updatedAt: Date;
}
```

### Message

```typescript
interface Message {
  id: string;
  conversationId: string;
  platform: Platform;
  platformMessageId: string;
  senderId: string;
  senderName: string;
  senderAvatarUrl?: string;
  content: string;
  messageType: 'text' | 'image' | 'video' | 'file' | 'audio';
  mediaUrl?: string;
  isOutgoing: boolean;
  isRead: boolean;
  sentAt: Date;
  deliveredAt?: Date;
  readAt?: Date;
}
```

### Platform Types

```typescript
type Platform = 
  | 'twitter'
  | 'instagram'
  | 'facebook'
  | 'linkedin'
  | 'whatsapp'
  | 'telegram'
  | 'discord';

interface PlatformConfig {
  id: Platform;
  name: string;
  icon: string;
  color: string;
  authMethod: 'browser' | 'qr' | 'token' | 'api';
  supportsRealtime: boolean;
  rateLimit: {
    minInterval: number; // milliseconds
    maxRequestsPerHour: number;
  };
}
```

## Platform-Specific Implementations

### Twitter/X Adapter

```typescript
class TwitterAdapter implements PlatformAdapter {
  private cookies: { auth_token: string; ct0: string };
  private lastFetch: number = 0;
  private MIN_INTERVAL = 15000; // 15 seconds
  
  async fetchConversations(): Promise<Conversation[]> {
    // Rate limit check
    await this.waitForRateLimit();
    
    const response = await fetch(
      'https://api.twitter.com/1.1/dm/inbox_initial_state.json?...',
      {
        headers: {
          'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs...',
          'cookie': `auth_token=${this.cookies.auth_token}; ct0=${this.cookies.ct0}`,
          'x-csrf-token': this.cookies.ct0,
          'x-twitter-auth-type': 'OAuth2Session',
          'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)...'
        }
      }
    );
    
    return this.parseTwitterResponse(response);
  }
}
```

### Instagram Adapter

```typescript
class InstagramAdapter implements PlatformAdapter {
  private cookies: { sessionid: string; csrftoken: string; ds_user_id: string };
  
  async fetchConversations(): Promise<Conversation[]> {
    const response = await fetch(
      'https://www.instagram.com/api/v1/direct_v2/inbox/',
      {
        headers: {
          'cookie': this.buildCookieString(),
          'x-csrftoken': this.cookies.csrftoken,
          'x-ig-app-id': '936619743392459',
          'user-agent': 'Mozilla/5.0...'
        }
      }
    );
    
    return this.parseInstagramResponse(response);
  }
}
```

### Facebook Adapter (DOM Scraping)

```typescript
class FacebookAdapter implements PlatformAdapter {
  private browserWindow: BrowserWindow;
  
  async fetchConversations(): Promise<Conversation[]> {
    // Load Messenger in hidden window
    await this.browserWindow.loadURL('https://www.messenger.com/');
    
    // Wait for page load
    await this.waitForSelector('.conversation-list');
    
    // Extract conversations via DOM
    const conversations = await this.browserWindow.webContents.executeJavaScript(`
      (function() {
        const items = document.querySelectorAll('[data-testid="mwthreadlist-item"]');
        return Array.from(items).map(item => ({
          id: item.getAttribute('data-id'),
          name: item.querySelector('[data-testid="mwthreadlist-item-name"]')?.textContent,
          lastMessage: item.querySelector('[data-testid="mwthreadlist-item-snippet"]')?.textContent,
          // ... more extraction
        }));
      })()
    `);
    
    return conversations;
  }
}
```

### LinkedIn Adapter (DOM Scraping)

```typescript
class LinkedInAdapter implements PlatformAdapter {
  private browserWindow: BrowserWindow;
  private MIN_INTERVAL = 60000; // 60 seconds
  
  async authenticate(): Promise<AuthResult> {
    // Block WebAuthn/Passkey prompts
    this.browserWindow.webContents.session.setPermissionRequestHandler(
      (webContents, permission, callback) => {
        if (permission === 'webauthn') {
          callback(false);
          return;
        }
        callback(true);
      }
    );
    
    await this.browserWindow.loadURL('https://www.linkedin.com/login');
    // Wait for user to complete login
    // Extract cookies after successful login
  }
  
  async fetchConversations(): Promise<Conversation[]> {
    await this.browserWindow.loadURL('https://www.linkedin.com/messaging/');
    
    // Extract via DOM scraping
    const conversations = await this.browserWindow.webContents.executeJavaScript(`
      (function() {
        const items = document.querySelectorAll('li.msg-conversation-listitem');
        // ... extraction logic
      })()
    `);
    
    return conversations;
  }
}
```

### WhatsApp Adapter (whatsapp-web.js)

```typescript
class WhatsAppAdapter implements PlatformAdapter {
  private client: Client; // whatsapp-web.js Client
  private qrCallback?: (qr: string) => void;
  
  async authenticate(): Promise<AuthResult> {
    this.client = new Client({
      authStrategy: new LocalAuth(),
      puppeteer: { headless: true }
    });
    
    return new Promise((resolve) => {
      this.client.on('qr', (qr) => {
        this.qrCallback?.(qr);
        resolve({ success: false, requiresAction: 'qr_scan' });
      });
      
      this.client.on('ready', () => {
        resolve({ success: true });
      });
      
      this.client.initialize();
    });
  }
  
  async fetchConversations(): Promise<Conversation[]> {
    const chats = await this.client.getChats();
    return chats.map(chat => ({
      id: chat.id._serialized,
      participantName: chat.name,
      // ... mapping
    }));
  }
  
  onNewMessage(callback: (message: Message) => void): void {
    this.client.on('message', (msg) => {
      callback(this.mapMessage(msg));
    });
  }
}
```

### Telegram Adapter (Telethon-style)

```typescript
class TelegramAdapter implements PlatformAdapter {
  private apiId: string;
  private apiHash: string;
  private session: string;
  
  // Uses MTProto protocol via telegram library
  async fetchConversations(): Promise<Conversation[]> {
    // Telegram has official API - no scraping needed
    const dialogs = await this.client.getDialogs();
    return dialogs.map(dialog => ({
      id: dialog.id.toString(),
      participantName: dialog.title || dialog.name,
      // ... mapping
    }));
  }
}
```

### Discord Adapter

```typescript
class DiscordAdapter implements PlatformAdapter {
  private token: string; // Bot or user token
  
  async fetchConversations(): Promise<Conversation[]> {
    const response = await fetch(
      'https://discord.com/api/v10/users/@me/channels',
      {
        headers: {
          'Authorization': `Bot ${this.token}`, // or just token for user
          'Content-Type': 'application/json'
        }
      }
    );
    
    const channels = await response.json();
    return channels.map(ch => ({
      id: ch.id,
      participantName: ch.recipients?.[0]?.username || ch.name,
      // ... mapping
    }));
  }
}
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system—essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*



### Property 1: Session Persistence Round-Trip

*For any* valid platform session, saving it to Local_Storage and then retrieving it SHALL produce an equivalent session object with all fields preserved.

**Validates: Requirements 2.3, 12.2**

### Property 2: Session Expiry Triggers Re-Authentication

*For any* platform and any expired session, when a fetch operation is attempted, the Platform_Adapter SHALL trigger the re-authentication flow.

**Validates: Requirements 2.4, 3.4, 4.4**

### Property 3: Authentication Cookies Included in Requests

*For any* platform API request, the Platform_Adapter SHALL include all required authentication cookies/tokens in the request headers.

**Validates: Requirements 3.2, 4.2, 5.2, 6.2**

### Property 4: Response Parsing Produces Valid Conversations

*For any* valid platform API response, parsing SHALL produce conversation objects containing at minimum: id, participantName, and messages array.

**Validates: Requirements 3.3, 4.3, 5.3, 5.4, 6.3**

### Property 5: Rate Limit Compliance

*For any* platform with configured rate limits, consecutive fetch requests SHALL be spaced by at least the minimum interval (Twitter: 15s, LinkedIn: 60s).

**Validates: Requirements 3.5, 6.5, 9.4**

### Property 6: Real-Time Message Reception

*For any* platform supporting real-time updates (WhatsApp, Telegram), when a new message is sent to the user, the Desktop_App SHALL receive it within 5 seconds.

**Validates: Requirements 7.3, 8.5, 10.5**

### Property 7: Message Sending Confirmation

*For any* platform and any valid message content, sending a message SHALL result in either a success confirmation or a descriptive error within 30 seconds.

**Validates: Requirements 7.4, 9.3**

### Property 8: Aggregator Combines All Platform Conversations

*For any* set of connected platforms with conversations, the Message_Aggregator SHALL return a combined list containing all conversations from all platforms.

**Validates: Requirements 10.1**

### Property 9: Unread Count Calculation

*For any* set of platform conversations, the total unread count SHALL equal the sum of unread counts across all individual platforms.

**Validates: Requirements 10.4**

### Property 10: Sync Interval Configuration

*For any* configured sync interval, the Sync_Engine SHALL execute syncs at intervals within 10% of the configured value.

**Validates: Requirements 11.1, 11.2**

### Property 11: Background Sync Continues When Minimized

*For any* state where the Desktop_App is minimized to tray, the Sync_Engine SHALL continue executing periodic syncs.

**Validates: Requirements 11.3**

### Property 12: Sync Failure Handling

*For any* sync operation that fails (network error, auth error, etc.), the Sync_Engine SHALL log the error and continue operation without crashing.

**Validates: Requirements 11.5**

### Property 13: Storage Encryption

*For any* stored session data, the raw stored value SHALL be encrypted and not contain plaintext credentials.

**Validates: Requirements 12.1, 14.1**

### Property 14: Data Export/Import Round-Trip

*For any* complete app state (sessions, conversations, messages), exporting and then importing SHALL restore an equivalent state.

**Validates: Requirements 12.3**

### Property 15: Platform Logout Clears Data

*For any* platform, after logout, querying that platform's sessions, conversations, and messages SHALL return empty results.

**Validates: Requirements 12.4**

### Property 16: No External Token Transmission

*For any* network request made by the Desktop_App, authentication tokens SHALL only be sent to their respective platform domains, never to any other external server.

**Validates: Requirements 14.2**

### Property 17: Real-Time Message Delivery Latency

*For any* platform with real-time support (WhatsApp, Telegram, Discord), when a new message is sent to the user, the Desktop_App SHALL receive and display it within 5 seconds of the message being sent.

**Validates: Requirements 11.2**

### Property 18: Real-Time Connection Auto-Reconnect

*For any* platform connection that disconnects unexpectedly, the Real_Time_Engine SHALL attempt to reconnect within 10 seconds and restore the connection within 30 seconds (assuming network is available).

**Validates: Requirements 11.7**

### Property 19: Polling Interval Compliance for Non-Real-Time Platforms

*For any* platform using polling (Twitter, Instagram, Facebook, LinkedIn), the polling interval SHALL be between 5-60 seconds depending on platform rate limits, ensuring near real-time experience.

**Validates: Requirements 11.3, 11.4**

## Error Handling

### Authentication Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Session Expired | Trigger re-authentication flow, show notification |
| Invalid Credentials | Clear stored session, prompt for new login |
| 2FA Required | Show 2FA input dialog (Telegram, Instagram) |
| Rate Limited | Wait and retry with exponential backoff |
| Network Error | Retry 3 times, then show offline indicator |

### Sync Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Platform Unavailable | Skip platform, continue with others |
| Partial Failure | Log error, return partial results |
| All Platforms Failed | Show error notification, schedule retry |

### Storage Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Encryption Failed | Fall back to secure storage, log warning |
| Storage Full | Clear old cached data, notify user |
| Corruption Detected | Reset storage, prompt re-authentication |

## Testing Strategy

### Unit Tests

Unit tests will verify specific examples and edge cases:

1. **Session Manager Tests**
   - Save and retrieve session
   - Handle missing session gracefully
   - Encrypt/decrypt data correctly

2. **Platform Adapter Tests**
   - Parse Twitter response correctly
   - Parse Instagram response correctly
   - Handle malformed responses
   - Build correct request headers

3. **Sync Engine Tests**
   - Execute sync at correct intervals
   - Handle platform failures
   - Aggregate results correctly

### Property-Based Tests

Property-based tests will use **fast-check** library for JavaScript/TypeScript to verify universal properties across many generated inputs.

Configuration:
- Minimum 100 iterations per property test
- Each test tagged with: **Feature: unified-desktop-app, Property {number}: {property_text}**

Property tests to implement:
1. Session persistence round-trip (Property 1)
2. Response parsing produces valid conversations (Property 4)
3. Unread count calculation (Property 9)
4. Data export/import round-trip (Property 14)
5. Platform logout clears data (Property 15)

### Integration Tests

1. **End-to-end authentication flow** for each platform
2. **Sync cycle** with multiple platforms
3. **Real-time message reception** (WhatsApp, Telegram)
4. **Message sending** through unified interface

### Manual Testing

1. **Cross-platform builds** (Windows, macOS, Linux)
2. **System tray behavior**
3. **Auto-start functionality**
4. **Theme switching**
