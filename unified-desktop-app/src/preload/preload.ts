import { contextBridge, ipcRenderer } from 'electron';
import type {
  Platform,
  PlatformCredentials,
  NewMessageEvent,
  ConnectionStatusEvent,
  TypingIndicatorEvent,
  ElectronAPI
} from '../shared/types.js';

/**
 * IPC Bridge - Exposes protected methods to renderer process
 * Uses contextBridge for security (no direct ipcRenderer access in renderer)
 */
const electronAPI: ElectronAPI = {
  // ============================================
  // App Info
  // ============================================
  getAppVersion: (): Promise<string> => ipcRenderer.invoke('get-app-version'),
  getPlatform: (): Promise<string> => ipcRenderer.invoke('get-platform'),

  // ============================================
  // Window Controls
  // ============================================
  minimizeToTray: (): Promise<void> => ipcRenderer.invoke('minimize-to-tray'),
  quitApp: (): Promise<void> => ipcRenderer.invoke('quit-app'),

  // ============================================
  // Event Listeners (Main -> Renderer)
  // ============================================
  onSyncAllPlatforms: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('sync-all-platforms', handler);
    return () => ipcRenderer.removeListener('sync-all-platforms', handler);
  },

  onOpenSettings: (callback: () => void) => {
    const handler = () => callback();
    ipcRenderer.on('open-settings', handler);
    return () => ipcRenderer.removeListener('open-settings', handler);
  },

  onNewMessage: (callback: (data: NewMessageEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: NewMessageEvent) => callback(data);
    ipcRenderer.on('new-message', handler);
    return () => ipcRenderer.removeListener('new-message', handler);
  },

  onConnectionStatus: (callback: (data: ConnectionStatusEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: ConnectionStatusEvent) => callback(data);
    ipcRenderer.on('connection-status', handler);
    return () => ipcRenderer.removeListener('connection-status', handler);
  },

  onTypingIndicator: (callback: (data: TypingIndicatorEvent) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: TypingIndicatorEvent) => callback(data);
    ipcRenderer.on('typing-indicator', handler);
    return () => ipcRenderer.removeListener('typing-indicator', handler);
  },

  onOpenConversation: (callback: (data: { conversationId: string; platform: Platform }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { conversationId: string; platform: Platform }) => callback(data);
    ipcRenderer.on('open-conversation', handler);
    return () => ipcRenderer.removeListener('open-conversation', handler);
  },

  // ============================================
  // Platform Operations
  // ============================================
  platform: {
    connect: (platform: Platform, credentials: PlatformCredentials) =>
      ipcRenderer.invoke('platform:connect', platform, credentials),

    disconnect: (platform: Platform) =>
      ipcRenderer.invoke('platform:disconnect', platform),

    getStatus: (platform: Platform) =>
      ipcRenderer.invoke('platform:status', platform),

    getAllStatuses: () =>
      ipcRenderer.invoke('platform:all-statuses'),
  },

  // ============================================
  // Data Operations
  // ============================================
  data: {
    getConversations: (platform?: Platform) =>
      ipcRenderer.invoke('data:conversations', platform),

    getMessages: (conversationId: string, platform: Platform) =>
      ipcRenderer.invoke('data:messages', conversationId, platform),

    sendMessage: (conversationId: string, platform: Platform, content: string) =>
      ipcRenderer.invoke('data:send-message', conversationId, platform, content),

    markAsRead: (conversationId: string, platform: Platform) =>
      ipcRenderer.invoke('data:mark-read', conversationId, platform),
  },

  // ============================================
  // Settings Operations
  // ============================================
  settings: {
    get: <T = any>(key: string): Promise<T | null> =>
      ipcRenderer.invoke('settings:get', key),

    set: (key: string, value: any) =>
      ipcRenderer.invoke('settings:set', key, value),

    getAll: () =>
      ipcRenderer.invoke('settings:all'),
  },

  // ============================================
  // Session Operations
  // ============================================
  session: {
    save: (platform: Platform, data: any) =>
      ipcRenderer.invoke('session:save', platform, data),

    get: (platform: Platform) =>
      ipcRenderer.invoke('session:get', platform),

    clear: (platform: Platform) =>
      ipcRenderer.invoke('session:clear', platform),

    clearAll: () =>
      ipcRenderer.invoke('session:clear-all'),

    getAll: () =>
      ipcRenderer.invoke('session:get-all'),

    hasValid: (platform: Platform) =>
      ipcRenderer.invoke('session:has-valid', platform),

    export: () =>
      ipcRenderer.invoke('session:export'),

    import: (data: string) =>
      ipcRenderer.invoke('session:import', data),
  },

  // ============================================
  // Security Operations
  // ============================================
  security: {
    isPasswordSet: () =>
      ipcRenderer.invoke('security:is-password-set'),

    setPassword: (password: string) =>
      ipcRenderer.invoke('security:set-password', password),

    verifyPassword: (password: string) =>
      ipcRenderer.invoke('security:verify-password', password),

    removePassword: (currentPassword: string) =>
      ipcRenderer.invoke('security:remove-password', currentPassword),

    isLocked: () =>
      ipcRenderer.invoke('security:is-locked'),

    lock: () =>
      ipcRenderer.invoke('security:lock'),

    unlock: (password: string) =>
      ipcRenderer.invoke('security:unlock', password),
  },

  // ============================================
  // WhatsApp Specific Operations
  // ============================================
  whatsapp: {
    onQrCode: (callback: (data: { qrCode: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { qrCode: string }) => {
        console.log('[Preload] WhatsApp QR received from main process');
        callback(data);
      };
      ipcRenderer.on('whatsapp-qr', handler);
      return () => ipcRenderer.removeListener('whatsapp-qr', handler);
    },

    onStatusChange: (callback: (data: { status: string; message?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { status: string; message?: string }) => {
        console.log('[Preload] WhatsApp status change:', data.status);
        callback(data);
      };
      ipcRenderer.on('whatsapp-status', handler);
      return () => ipcRenderer.removeListener('whatsapp-status', handler);
    },

    onChatsUpdated: (callback: (data: { conversations: any[] }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { conversations: any[] }) => {
        console.log('[Preload] WhatsApp chats updated:', data.conversations?.length);
        callback(data);
      };
      ipcRenderer.on('whatsapp-chats-updated', handler);
      return () => ipcRenderer.removeListener('whatsapp-chats-updated', handler);
    },

    getStatus: () =>
      ipcRenderer.invoke('whatsapp:status'),
  },

  // ============================================
  // Twitter Specific Operations
  // ============================================
  twitter: {
    openLogin: () =>
      ipcRenderer.invoke('twitter:open-login'),
  },

  // ============================================
  // Discord Specific Operations
  // ============================================
  discord: {
    openLogin: () =>
      ipcRenderer.invoke('discord:open-login'),
  },

  // ============================================
  // Telegram Specific Operations
  // ============================================
  telegram: {
    openLogin: () =>
      ipcRenderer.invoke('telegram:open-login'),

    // Legacy methods - kept for compatibility
    setCredentials: (apiId: string, apiHash: string) =>
      ipcRenderer.invoke('telegram:set-credentials', apiId, apiHash),

    startVerification: (phoneNumber: string) =>
      ipcRenderer.invoke('telegram:start-verification', phoneNumber),

    verifyCode: (code: string) =>
      ipcRenderer.invoke('telegram:verify-code', code),

    verifyPassword: (password: string) =>
      ipcRenderer.invoke('telegram:verify-password', password),
  },

  // ============================================
  // Instagram Specific Operations
  // ============================================
  instagram: {
    openLogin: () =>
      ipcRenderer.invoke('instagram:open-login'),

    // Private API login (username/password)
    loginWithCredentials: (username: string, password: string) =>
      ipcRenderer.invoke('instagram:login-credentials', username, password),

    // Check sidecar status
    getSidecarStatus: () =>
      ipcRenderer.invoke('instagram:sidecar-status'),
  },

  // ============================================
  // Facebook Specific Operations
  // ============================================
  facebook: {
    openLogin: () =>
      ipcRenderer.invoke('facebook:open-login'),

    // Set mode: true = Private API, false = Browser Automation
    setMode: (usePrivateAPI: boolean) =>
      ipcRenderer.invoke('facebook:set-mode', usePrivateAPI),

    // Submit PIN for chat history unlock
    submitPIN: (pin: string) =>
      ipcRenderer.invoke('facebook:submit-pin', pin),

    // Trigger extraction after user enters PIN manually
    triggerExtraction: () =>
      ipcRenderer.invoke('facebook:trigger-extraction'),

    // Check if login window is ready for extraction
    isWindowReady: () =>
      ipcRenderer.invoke('facebook:is-window-ready'),

    // Private API login (username/password)
    loginWithCredentials: (email: string, password: string) =>
      ipcRenderer.invoke('facebook:login-credentials', email, password),

    // Private API login (cookie-based)
    loginWithCookies: (cookies: { c_user: string; xs: string; fr?: string; datr?: string }) =>
      ipcRenderer.invoke('facebook:login-cookies', cookies),

    // Check sidecar status
    getSidecarStatus: () =>
      ipcRenderer.invoke('facebook:sidecar-status'),

    // Verify OTP code
    verifyOtp: (code: string) =>
      ipcRenderer.invoke('facebook:verify-otp', code),
  },

  // ============================================
  // LinkedIn Specific Operations
  // ============================================
  linkedin: {
    openLogin: () =>
      ipcRenderer.invoke('linkedin:open-login'),

    // Set mode: true = Voyager API, false = Browser Automation
    setMode: (useVoyagerAPI: boolean) =>
      ipcRenderer.invoke('linkedin:set-mode', useVoyagerAPI),

    // Debug: Show hidden browser window
    showBrowser: () =>
      ipcRenderer.invoke('linkedin:show-browser'),

    // Debug: Hide browser window
    hideBrowser: () =>
      ipcRenderer.invoke('linkedin:hide-browser'),
  },

  // ============================================
  // Teams Specific Operations
  // ============================================
  teams: {
    openLogin: () =>
      ipcRenderer.invoke('teams:open-login'),
  },

  // ============================================
  // Gmail Specific Operations
  // ============================================
  gmail: {
    openLogin: () =>
      ipcRenderer.invoke('gmail:open-login'),
  },
};

// Expose the API to the renderer process
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Re-export type for use in renderer
export type { ElectronAPI };
