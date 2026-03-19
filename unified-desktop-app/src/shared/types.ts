/**
 * Shared types for IPC communication between main and renderer processes
 */

// Platform types
export type Platform = 'telegram' | 'twitter' | 'linkedin' | 'instagram' | 'whatsapp' | 'facebook' | 'discord' | 'teams' | 'gmail';

// ============================================
// Data Models
// ============================================

export interface Conversation {
  id: string;
  platform: Platform;
  platformConversationId: string;
  participantName: string;
  participantId: string;
  participantAvatarUrl?: string;
  lastMessage?: string;
  lastMessageAt: string;
  unreadCount: number;
}

export interface Message {
  id: string;
  conversationId: string;
  platformMessageId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: 'text' | 'image' | 'video' | 'file';
  mediaUrl?: string;
  isOutgoing: boolean;
  isRead: boolean;
  sentAt: string;
}

export interface PlatformCredentials {
  // Cookie-based platforms (Twitter, Instagram, Facebook, LinkedIn)
  cookies?: Record<string, string>;

  // Token-based platforms (Discord)
  token?: string;

  // OAuth-based platforms (Teams, Gmail)
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;

  // Phone-based platforms (Telegram, WhatsApp)
  phoneNumber?: string;
  apiId?: string;
  apiHash?: string;
  sessionString?: string;

  // WhatsApp specific
  qrCode?: string;
  isAuthenticated?: boolean;

  // Username/Password based (Instagram Private API)
  username?: string;
  password?: string;

  // Mode selection (Facebook: 'private' for fbchat-v2 MQTT, 'browser' for DOM scraping)
  mode?: 'private' | 'browser';
}

export interface PlatformStatus {
  platform: Platform;
  connected: boolean;
  lastSync?: string;
  error?: string;
  username?: string;
  userId?: string;
}

// ============================================
// IPC Request/Response Types
// ============================================

// Generic response wrapper
export interface IPCResponse<T = void> {
  success: boolean;
  data?: T;
  error?: string;
}

// Session operations
export interface SessionSaveRequest {
  platform: Platform;
  credentials: PlatformCredentials;
  userId?: string;
  username?: string;
}

export interface SessionData {
  platform: Platform;
  credentials: PlatformCredentials;
  userId?: string;
  username?: string;
  lastSync?: string;
  createdAt: string;
  updatedAt: string;
}

// Platform operations
export interface PlatformConnectRequest {
  platform: Platform;
  credentials: PlatformCredentials;
}

export interface PlatformConnectResponse {
  success: boolean;
  platform: Platform;
  userId?: string;
  username?: string;
  error?: string;
}

// Data operations
export interface SendMessageRequest {
  conversationId: string;
  platform: Platform;
  content: string;
  messageType?: 'text' | 'image' | 'video' | 'file';
  mediaUrl?: string;
}

export interface SendMessageResponse {
  success: boolean;
  messageId?: string;
  sentAt?: string;
  error?: string;
}

// Settings
export interface AppSettings {
  theme: 'light' | 'dark' | 'system';
  autoStart: boolean;
  minimizeToTray: boolean;
  notifications: {
    enabled: boolean;
    sound: boolean;
    showPreview: boolean;
  };
  syncInterval: number; // in seconds
  // Security settings
  security: {
    passwordEnabled: boolean;
    lockOnMinimize: boolean;
    lockTimeout: number; // in minutes, 0 = never
  };
}

// Real-time events
export interface NewMessageEvent {
  platform: Platform;
  conversationId: string;
  message: Message;
}

export interface ConnectionStatusEvent {
  platform: Platform;
  status: 'connected' | 'disconnected' | 'connecting' | 'error';
  error?: string;
}

export interface TypingIndicatorEvent {
  platform: Platform;
  conversationId: string;
  userId: string;
  isTyping: boolean;
}

// ============================================
// ElectronAPI Interface (for renderer)
// ============================================

export interface ElectronAPI {
  // App info
  getAppVersion: () => Promise<string>;
  getPlatform: () => Promise<string>;

  // Window controls
  minimizeToTray: () => Promise<void>;
  quitApp: () => Promise<void>;

  // Event listeners
  onSyncAllPlatforms: (callback: () => void) => () => void;
  onOpenSettings: (callback: () => void) => () => void;
  onNewMessage: (callback: (data: NewMessageEvent) => void) => () => void;
  onConnectionStatus: (callback: (data: ConnectionStatusEvent) => void) => () => void;
  onTypingIndicator: (callback: (data: TypingIndicatorEvent) => void) => () => void;
  onOpenConversation: (callback: (data: { conversationId: string; platform: Platform }) => void) => () => void;

  // Platform operations
  platform: {
    connect: (platform: Platform, credentials: PlatformCredentials) => Promise<PlatformConnectResponse>;
    disconnect: (platform: Platform) => Promise<IPCResponse>;
    getStatus: (platform: Platform) => Promise<PlatformStatus>;
    getAllStatuses: () => Promise<Record<Platform, PlatformStatus>>;
  };

  // Data operations
  data: {
    getConversations: (platform?: Platform) => Promise<Conversation[]>;
    getMessages: (conversationId: string, platform: Platform) => Promise<Message[]>;
    sendMessage: (conversationId: string, platform: Platform, content: string) => Promise<SendMessageResponse>;
    markAsRead: (conversationId: string, platform: Platform) => Promise<IPCResponse>;
  };

  // Settings operations
  settings: {
    get: <T = any>(key: string) => Promise<T | null>;
    set: (key: string, value: any) => Promise<IPCResponse>;
    getAll: () => Promise<Partial<AppSettings>>;
  };

  // Session operations
  session: {
    save: (platform: Platform, data: SessionSaveRequest) => Promise<IPCResponse>;
    get: (platform: Platform) => Promise<SessionData | null>;
    clear: (platform: Platform) => Promise<IPCResponse>;
    clearAll: () => Promise<IPCResponse>;
    getAll: () => Promise<Record<Platform, SessionData>>;
    hasValid: (platform: Platform) => Promise<boolean>;
    export: () => Promise<string>;
    import: (data: string) => Promise<IPCResponse>;
  };

  // Security operations
  security: {
    isPasswordSet: () => Promise<boolean>;
    setPassword: (password: string) => Promise<IPCResponse>;
    verifyPassword: (password: string) => Promise<IPCResponse>;
    removePassword: (currentPassword: string) => Promise<IPCResponse>;
    isLocked: () => Promise<boolean>;
    lock: () => Promise<void>;
    unlock: (password: string) => Promise<IPCResponse>;
  };

  // WhatsApp specific operations
  whatsapp: {
    onQrCode: (callback: (data: { qrCode: string }) => void) => () => void;
    onStatusChange: (callback: (data: { status: string; message?: string }) => void) => () => void;
    onChatsUpdated: (callback: (data: { conversations: any[] }) => void) => () => void;
    getStatus: () => Promise<{ status: string; qrCode?: string; phoneNumber?: string; connected: boolean }>;
  };

  // Twitter specific operations
  twitter: {
    openLogin: () => Promise<IPCResponse>;
  };

  // Discord specific operations
  discord: {
    openLogin: () => Promise<IPCResponse>;
  };

  // Telegram specific operations
  telegram: {
    openLogin: () => Promise<{ success: boolean; userId?: string; username?: string; error?: string }>;
    // Legacy methods - kept for compatibility
    setCredentials: (apiId: string, apiHash: string) => Promise<IPCResponse>;
    startVerification: (phoneNumber: string) => Promise<{ success: boolean; error?: string }>;
    verifyCode: (code: string) => Promise<{ success: boolean; needPassword?: boolean; error?: string }>;
    verifyPassword: (password: string) => Promise<{ success: boolean; error?: string }>;
  };

  // Instagram specific operations
  instagram: {
    openLogin: () => Promise<IPCResponse>;
    loginWithCredentials: (username: string, password: string) => Promise<{ success: boolean; userId?: string; username?: string; error?: string }>;
    getSidecarStatus: () => Promise<{ running: boolean; connected: boolean; userId?: string; username?: string }>;
  };

  // Facebook specific operations
  facebook: {
    openLogin: () => Promise<IPCResponse>;
    setMode: (usePrivateAPI: boolean) => Promise<{ success: boolean; mode?: string; error?: string }>;
    submitPIN: (pin: string) => Promise<{ success: boolean; error?: string }>;
    triggerExtraction: () => Promise<{ success: boolean; conversations?: any[]; count?: number; error?: string }>;
    isWindowReady: () => Promise<{ ready: boolean }>;
    loginWithCredentials: (email: string, password: string) => Promise<{ success: boolean; userId?: string; username?: string; error?: string }>;
    loginWithCookies: (cookies: { c_user: string; xs: string; fr?: string; datr?: string })
      => Promise<{ success: boolean; userId?: string; username?: string; error?: string }>;
    getSidecarStatus: () => Promise<{ running: boolean; connected: boolean; userId?: string; username?: string }>;
    verifyOtp: (code: string) => Promise<{ success: boolean; error?: string }>;
  };

  // LinkedIn specific operations
  linkedin: {
    openLogin: () => Promise<IPCResponse>;
    setMode: (useVoyagerAPI: boolean) => Promise<{ success: boolean; mode?: string; error?: string }>;
    showBrowser: () => Promise<{ success: boolean; error?: string }>;
    hideBrowser: () => Promise<{ success: boolean; error?: string }>;
  };

  // Teams specific operations
  teams: {
    openLogin: () => Promise<IPCResponse>;
  };

  // Gmail specific operations
  gmail: {
    openLogin: () => Promise<IPCResponse>;
  };
}

// Declare global window type
declare global {
  interface Window {
    electronAPI: ElectronAPI;
  }
}
