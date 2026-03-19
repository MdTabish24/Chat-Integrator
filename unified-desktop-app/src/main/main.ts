// Note: crypto polyfill is loaded in bootstrap.ts before this file is imported

import { app, BrowserWindow, Tray, Menu, nativeImage, ipcMain, Notification } from 'electron';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSessionManager } from './services/SessionManager.js';
import { getLocalStorage } from './services/LocalStorage.js';
import { getInstagramSidecarManager } from './services/InstagramSidecarManager.js';
import { getFacebookSidecarManager } from './services/FacebookSidecarManager.js';
import { getTwitterAdapter, getInstagramAdapter, getFacebookAdapter, getLinkedInAdapter, getWhatsAppAdapter, getTelegramAdapter, getDiscordAdapter, getTeamsAdapter, getGmailAdapter } from './adapters/index.js';
import type { Platform } from './types/index.js';
import type {
  NewMessageEvent,
  ConnectionStatusEvent,
  TypingIndicatorEvent,
  PlatformCredentials,
  AppSettings
} from '../shared/types.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let isQuitting = false;

const isDev = process.env.NODE_ENV === 'development';

// Initialize session manager and local storage
const sessionManager = getSessionManager();
const localStorage = getLocalStorage();
const instagramSidecar = getInstagramSidecarManager();
const facebookSidecar = getFacebookSidecarManager();

// Initialize platform adapters
const twitterAdapter = getTwitterAdapter();
const instagramAdapter = getInstagramAdapter();
const facebookAdapter = getFacebookAdapter();
const linkedinAdapter = getLinkedInAdapter();
const whatsappAdapter = getWhatsAppAdapter();
const telegramAdapter = getTelegramAdapter();
const discordAdapter = getDiscordAdapter();
const teamsAdapter = getTeamsAdapter();
const gmailAdapter = getGmailAdapter();

// Set up Twitter adapter event listeners
twitterAdapter.on('newMessage', (event: NewMessageEvent) => {
  console.log('[TwitterAdapter] New message received');
  emitNewMessage(event);
});

twitterAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'twitter', status: 'connected' });
});

twitterAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'twitter', status: 'disconnected' });
});

twitterAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

// Set up Instagram adapter event listeners
instagramAdapter.on('newMessage', (event: NewMessageEvent) => {
  console.log('[InstagramAdapter] New message received');
  emitNewMessage(event);
});

instagramAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'instagram', status: 'connected' });
});

instagramAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'instagram', status: 'disconnected' });
});

instagramAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

instagramAdapter.on('reloginRequired', () => {
  sendToRenderer('instagram-relogin-required');
});

// Set up Facebook adapter event listeners
facebookAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'facebook', status: 'connected' });
});

facebookAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'facebook', status: 'disconnected' });
});

facebookAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

facebookAdapter.on('conversationUpdated', (data: any) => {
  sendToRenderer('conversation-updated', data);
});

// Set up LinkedIn adapter event listeners
linkedinAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'linkedin', status: 'connected' });
});

linkedinAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'linkedin', status: 'disconnected' });
});

linkedinAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

linkedinAdapter.on('conversationUpdated', (data: any) => {
  sendToRenderer('conversation-updated', data);
});

// Set up WhatsApp adapter event listeners
whatsappAdapter.on('connected', () => {
  console.log('[Main] WhatsApp connected event received');
  emitConnectionStatus({ platform: 'whatsapp', status: 'connected' });
});

whatsappAdapter.on('disconnected', () => {
  console.log('[Main] WhatsApp disconnected event received');
  emitConnectionStatus({ platform: 'whatsapp', status: 'disconnected' });
});

whatsappAdapter.on('error', (data: { platform: Platform; error: string }) => {
  console.log('[Main] WhatsApp error event received:', data.error);
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

whatsappAdapter.on('newMessage', (event: NewMessageEvent) => {
  console.log('[WhatsAppAdapter] New message received');
  emitNewMessage(event);
});

whatsappAdapter.on('statusChange', (data: any) => {
  console.log('[Main] WhatsApp statusChange event:', data.status);
  sendToRenderer('whatsapp-status', data);
});

whatsappAdapter.on('qrCode', (data: { qrCode: string }) => {
  console.log('[Main] WhatsApp QR code received, sending to renderer...');
  console.log('[Main] QR data length:', data.qrCode?.length || 0);
  sendToRenderer('whatsapp-qr', data);
  console.log('[Main] QR sent to renderer via whatsapp-qr channel');
});

whatsappAdapter.on('messageAck', (data: any) => {
  sendToRenderer('whatsapp-message-ack', data);
});

whatsappAdapter.on('chatsReady', (data: { conversations: any[] }) => {
  console.log(`[WhatsAppAdapter] Chats ready: ${data.conversations.length} conversations`);
  sendToRenderer('whatsapp-chats-updated', data);
});

// Set up Telegram adapter event listeners
telegramAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'telegram', status: 'connected' });
});

telegramAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'telegram', status: 'disconnected' });
});

telegramAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

telegramAdapter.on('newMessage', (event: NewMessageEvent) => {
  console.log('[TelegramAdapter] New message received');
  emitNewMessage(event);
});

telegramAdapter.on('statusChange', (data: any) => {
  sendToRenderer('telegram-status', data);
});

// Set up Discord adapter event listeners
discordAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'discord', status: 'connected' });
});

discordAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'discord', status: 'disconnected' });
});

discordAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

discordAdapter.on('newMessage', (event: NewMessageEvent) => {
  console.log('[DiscordAdapter] New message received');
  emitNewMessage(event);
});

discordAdapter.on('statusChange', (data: any) => {
  sendToRenderer('discord-status', data);
});

discordAdapter.on('typingIndicator', (data: any) => {
  emitTypingIndicator(data);
});

// Set up Teams adapter event listeners
teamsAdapter.on('connected', () => {
  console.log('[Main] Teams connected event received');
  emitConnectionStatus({ platform: 'teams' as Platform, status: 'connected' });
  // Save session when connected via bridge
  const userId = teamsAdapter.getUserId();
  const username = teamsAdapter.getUsername();
  if (userId) {
    sessionManager.saveSession('teams' as Platform, {} as any, { userId, username: username || undefined });
  }
});

teamsAdapter.on('disconnected', () => {
  console.log('[Main] Teams disconnected event received');
  emitConnectionStatus({ platform: 'teams' as Platform, status: 'disconnected' });
});

teamsAdapter.on('error', (data: { platform: Platform; error: string }) => {
  console.log('[Main] Teams error event received:', data.error);
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

teamsAdapter.on('newMessage', (event: NewMessageEvent) => {
  console.log('[TeamsAdapter] New message received');
  emitNewMessage(event);
});

teamsAdapter.on('conversationsUpdated', (data: { conversations: any[] }) => {
  console.log(`[TeamsAdapter] Conversations updated: ${data.conversations.length}`);
  sendToRenderer('teams-conversations-updated', data);
});

// Set up Gmail adapter event listeners
gmailAdapter.on('connected', () => {
  emitConnectionStatus({ platform: 'gmail' as Platform, status: 'connected' });
});

gmailAdapter.on('disconnected', () => {
  emitConnectionStatus({ platform: 'gmail' as Platform, status: 'disconnected' });
});

gmailAdapter.on('error', (data: { platform: Platform; error: string }) => {
  emitConnectionStatus({ platform: data.platform, status: 'error', error: data.error });
});

// Default settings
const defaultSettings: AppSettings = {
  theme: 'dark',
  autoStart: false,
  minimizeToTray: true,
  notifications: {
    enabled: true,
    sound: true,
    showPreview: true,
  },
  syncInterval: 30,
  security: {
    passwordEnabled: false,
    lockOnMinimize: false,
    lockTimeout: 5,
  },
};

// In-memory settings (will be persisted in Task 17)
let appSettings: AppSettings = { ...defaultSettings };

// ============================================
// Helper Functions
// ============================================

/**
 * Send event to renderer process
 */
function sendToRenderer(channel: string, data?: any): void {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.send(channel, data);
  }
}

/**
 * Emit new message event to renderer and show notification
 */
export function emitNewMessage(event: NewMessageEvent): void {
  sendToRenderer('new-message', event);

  // Show system notification if enabled
  if (appSettings.notifications.enabled) {
    showNotification(event);
  }
}

/**
 * Show system notification for new message
 */
function showNotification(event: NewMessageEvent): void {
  if (!Notification.isSupported()) {
    console.log('[Notification] Not supported on this platform');
    return;
  }

  const { message, platform, conversationId } = event;

  // Get platform display name
  const platformNames: Record<Platform, string> = {
    telegram: 'Telegram',
    twitter: 'Twitter/X',
    linkedin: 'LinkedIn',
    instagram: 'Instagram',
    whatsapp: 'WhatsApp',
    facebook: 'Facebook',
    discord: 'Discord',
    teams: 'Microsoft Teams',
    gmail: 'Gmail',
  };

  const platformName = platformNames[platform] || platform;
  const title = `${message.senderName} • ${platformName}`;
  const body = appSettings.notifications.showPreview
    ? message.content.substring(0, 100) + (message.content.length > 100 ? '...' : '')
    : 'New message received';

  const notification = new Notification({
    title,
    body,
    silent: !appSettings.notifications.sound,
    icon: path.join(__dirname, '../../../assets/icon.png'),
  });

  // Click notification to open conversation
  notification.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
      mainWindow.focus();
      // Send event to renderer to open the conversation
      sendToRenderer('open-conversation', { conversationId, platform });
    }
  });

  notification.show();
}

/**
 * Emit connection status change to renderer
 */
export function emitConnectionStatus(event: ConnectionStatusEvent): void {
  sendToRenderer('connection-status', event);
}

/**
 * Emit typing indicator to renderer
 */
export function emitTypingIndicator(event: TypingIndicatorEvent): void {
  sendToRenderer('typing-indicator', event);
}

/**
 * Create IPC response with consistent format
 */
function createResponse<T>(success: boolean, data?: T, error?: string) {
  return { success, data, error };
}

// ============================================
// Window Management
// ============================================

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1000,
    minHeight: 700,
    frame: true,
    show: false,
    backgroundColor: '#0f172a',
    webPreferences: {
      preload: path.join(__dirname, '../../preload/preload/preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
    },
    icon: path.join(__dirname, '../../../assets/icon.png'),
  });

  // Load the app
  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
  } else {
    mainWindow.loadFile(path.join(__dirname, '../../../dist/renderer/index.html'));
  }

  // Always open DevTools for debugging (can be removed later)
  mainWindow.webContents.openDevTools();

  // Show window when ready
  mainWindow.once('ready-to-show', () => {
    mainWindow?.show();
  });

  // Handle window close - minimize to tray instead
  mainWindow.on('close', (event) => {
    if (!isQuitting && appSettings.minimizeToTray) {
      event.preventDefault();
      mainWindow?.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function createTray(): void {
  const iconPath = path.join(__dirname, '../../../assets/tray-icon.png');
  let trayIcon: Electron.NativeImage;

  try {
    trayIcon = nativeImage.createFromPath(iconPath);
    if (trayIcon.isEmpty()) {
      trayIcon = nativeImage.createEmpty();
    }
  } catch {
    trayIcon = nativeImage.createEmpty();
  }

  tray = new Tray(trayIcon);
  tray.setToolTip('Chat Orbitor - Multi-Platform DM Hub');

  const contextMenu = Menu.buildFromTemplate([
    {
      label: 'Open Chat Orbitor',
      click: () => {
        mainWindow?.show();
        mainWindow?.focus();
      },
    },
    {
      label: 'Sync All Platforms',
      click: () => {
        sendToRenderer('sync-all-platforms');
      },
    },
    { type: 'separator' },
    {
      label: 'Settings',
      click: () => {
        mainWindow?.show();
        sendToRenderer('open-settings');
      },
    },
    { type: 'separator' },
    {
      label: 'Quit',
      click: () => {
        isQuitting = true;
        app.quit();
      },
    },
  ]);

  tray.setContextMenu(contextMenu);

  tray.on('click', () => {
    if (mainWindow?.isVisible()) {
      mainWindow.hide();
    } else {
      mainWindow?.show();
      mainWindow?.focus();
    }
  });
}

// ============================================
// App Lifecycle
// ============================================

app.whenReady().then(async () => {
  // Create window first - don't wait for sidecar
  createWindow();
  createTray();

  // Start sidecars in background after window is shown (delayed)
  setTimeout(() => {
    console.log('[App] Starting Instagram sidecar in background...');
    instagramSidecar.start().then(async (started) => {
      if (started) {
        console.log('[App] Instagram sidecar started successfully');
        // Sync Instagram adapter state with sidecar
        await instagramAdapter.syncWithSidecar();
      } else {
        console.log('[App] Instagram sidecar failed to start (will use browser fallback)');
      }
    }).catch((err) => {
      console.error('[App] Instagram sidecar error:', err.message);
    });

    console.log('[App] Starting Facebook sidecar in background...');
    facebookSidecar.start().then(async (started) => {
      if (started) {
        console.log('[App] Facebook sidecar started successfully');
        // Sync Facebook adapter state with sidecar
        await facebookAdapter.syncWithSidecar();
      } else {
        console.log('[App] Facebook sidecar failed to start (will use browser fallback)');
      }
    }).catch((err) => {
      console.error('[App] Facebook sidecar error:', err.message);
    });
  }, 3000); // Start 3 seconds after app launch

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    } else {
      mainWindow?.show();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    // Don't quit on Windows/Linux, just hide to tray
  }
});

app.on('before-quit', () => {
  isQuitting = true;
  // Stop sidecars
  instagramSidecar.stop();
  facebookSidecar.stop();
});

// ============================================
// IPC Handlers - App Info
// ============================================

ipcMain.handle('get-app-version', () => app.getVersion());

ipcMain.handle('get-platform', () => process.platform);

ipcMain.handle('minimize-to-tray', () => {
  mainWindow?.hide();
});

ipcMain.handle('quit-app', () => {
  isQuitting = true;
  app.quit();
});

// ============================================
// IPC Handlers - Session Management
// ============================================

ipcMain.handle('session:save', async (_event, platform: Platform, data: any) => {
  try {
    await sessionManager.saveSession(platform, data.credentials, {
      userId: data.userId,
      username: data.username,
    });
    return createResponse(true);
  } catch (error: any) {
    console.error(`[IPC] session:save error for ${platform}:`, error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('session:get', async (_event, platform: Platform) => {
  try {
    return sessionManager.getSession(platform);
  } catch (error: any) {
    console.error(`[IPC] session:get error for ${platform}:`, error);
    return null;
  }
});

ipcMain.handle('session:clear', async (_event, platform: Platform) => {
  try {
    sessionManager.clearSession(platform);
    return createResponse(true);
  } catch (error: any) {
    console.error(`[IPC] session:clear error for ${platform}:`, error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('session:clear-all', async () => {
  try {
    sessionManager.clearAllSessions();
    return createResponse(true);
  } catch (error: any) {
    console.error('[IPC] session:clear-all error:', error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('session:get-all', async () => {
  try {
    return sessionManager.getAllSessions();
  } catch (error: any) {
    console.error('[IPC] session:get-all error:', error);
    return {};
  }
});

ipcMain.handle('session:has-valid', async (_event, platform: Platform) => {
  return sessionManager.hasValidSession(platform);
});

ipcMain.handle('session:export', async () => {
  try {
    return sessionManager.exportSessions();
  } catch (error: any) {
    console.error('[IPC] session:export error:', error);
    throw error;
  }
});

ipcMain.handle('session:import', async (_event, data: string) => {
  try {
    sessionManager.importSessions(data);
    return createResponse(true);
  } catch (error: any) {
    console.error('[IPC] session:import error:', error);
    return createResponse(false, undefined, error.message);
  }
});

// ============================================
// IPC Handlers - Platform Operations
// ============================================

ipcMain.handle('platform:connect', async (_event, platform: Platform, credentials: PlatformCredentials) => {
  console.log(`[IPC] platform:connect - ${platform}`);
  try {
    emitConnectionStatus({ platform, status: 'connecting' });

    // Handle Twitter specifically
    if (platform === 'twitter') {
      const result = await twitterAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // Handle Instagram specifically
    if (platform === 'instagram') {
      const result = await instagramAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // Handle Facebook specifically
    if (platform === 'facebook') {
      const result = await facebookAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // Handle LinkedIn specifically
    if (platform === 'linkedin') {
      const result = await linkedinAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // Handle WhatsApp specifically (QR code based)
    if (platform === 'whatsapp') {
      const result = await whatsappAdapter.connect();
      return {
        success: result.success,
        platform,
        status: result.status,
        error: result.error,
      };
    }

    // Handle Telegram specifically (phone + code based)
    if (platform === 'telegram') {
      // If we have a session string, try to reconnect
      if (credentials.sessionString && credentials.apiId && credentials.apiHash) {
        const result = await telegramAdapter.connectWithSession({
          apiId: credentials.apiId,
          apiHash: credentials.apiHash,
          sessionString: credentials.sessionString,
        });
        if (result.success) {
          await sessionManager.saveSession(platform, {
            ...credentials,
            sessionString: telegramAdapter.getSessionString() || credentials.sessionString,
          } as any, {
            userId: result.userId,
            username: result.username,
          });
        }
        return result;
      }
      // Otherwise, need to go through phone verification flow
      return {
        success: false,
        platform,
        error: 'Telegram requires phone verification. Use telegram:start-verification first.',
      };
    }

    // Handle Discord specifically (token based)
    if (platform === 'discord') {
      const result = await discordAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // Handle Teams specifically (OAuth based)
    if (platform === 'teams') {
      const result = await teamsAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // Handle Gmail specifically (OAuth based)
    if (platform === 'gmail') {
      const result = await gmailAdapter.connect(credentials);
      if (result.success) {
        await sessionManager.saveSession(platform, credentials as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return result;
    }

    // For other platforms - save session
    await sessionManager.saveSession(platform, credentials as any, {});

    emitConnectionStatus({
      platform,
      status: 'connected',
    });

    return {
      success: true,
      platform,
    };
  } catch (error: any) {
    console.error(`[IPC] platform:connect error for ${platform}:`, error);
    emitConnectionStatus({
      platform,
      status: 'error',
      error: error.message,
    });
    return {
      success: false,
      platform,
      error: error.message
    };
  }
});

ipcMain.handle('platform:disconnect', async (_event, platform: Platform) => {
  console.log(`[IPC] platform:disconnect - ${platform}`);
  try {
    sessionManager.clearSession(platform);

    emitConnectionStatus({
      platform,
      status: 'disconnected',
    });

    return createResponse(true);
  } catch (error: any) {
    console.error(`[IPC] platform:disconnect error for ${platform}:`, error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('platform:status', async (_event, platform: Platform) => {
  const session = sessionManager.getSession(platform);
  return {
    platform,
    connected: sessionManager.hasValidSession(platform),
    lastSync: session?.lastSync,
    username: session?.username,
    userId: session?.userId,
  };
});

ipcMain.handle('platform:all-statuses', async () => {
  const platforms: Platform[] = ['telegram', 'twitter', 'linkedin', 'instagram', 'whatsapp', 'facebook', 'discord', 'teams', 'gmail'];
  const statuses: Record<string, any> = {};

  for (const platform of platforms) {
    const session = sessionManager.getSession(platform);

    // For Telegram, also check adapter's connected status
    let isConnected = sessionManager.hasValidSession(platform);
    if (platform === 'telegram') {
      isConnected = isConnected || telegramAdapter.connected();
    }
    if (platform === 'instagram') {
      isConnected = isConnected || instagramAdapter.connected();
    }
    if (platform === 'whatsapp') {
      isConnected = isConnected || whatsappAdapter.connected();
    }
    if (platform === 'linkedin') {
      isConnected = isConnected || linkedinAdapter.connected();
    }
    if (platform === 'facebook') {
      isConnected = isConnected || facebookAdapter.connected();
    }
    if (platform === 'teams') {
      isConnected = isConnected || teamsAdapter.connected();
    }

    // Get username/userId from adapters if not in session
    let username = session?.username;
    let userId = session?.userId;
    
    if (platform === 'telegram' && !username) {
      username = telegramAdapter.getUsername() || undefined;
      userId = telegramAdapter.getUserId() || undefined;
    }
    if (platform === 'teams' && !username) {
      username = teamsAdapter.getUsername() || undefined;
      userId = teamsAdapter.getUserId() || undefined;
    }

    statuses[platform] = {
      platform,
      connected: isConnected,
      lastSync: session?.lastSync,
      username,
      userId,
    };
  }

  return statuses;
});

// ============================================
// IPC Handlers - Browser Login
// ============================================

ipcMain.handle('twitter:open-login', async () => {
  console.log('[IPC] twitter:open-login - HANDLER CALLED');
  console.log('[IPC] mainWindow exists:', !!mainWindow);
  try {
    console.log('[IPC] Calling twitterAdapter.openLoginWindow...');
    const cookies = await twitterAdapter.openLoginWindow(mainWindow || undefined);
    console.log('[IPC] openLoginWindow returned:', cookies ? 'cookies' : 'null');
    if (cookies) {
      // Save cookies and connect
      const result = await twitterAdapter.connect({ cookies } as any);
      if (result.success) {
        await sessionManager.saveSession('twitter', cookies as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return { success: true, cookies };
    }
    return { success: false, error: 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] twitter:open-login error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('instagram:open-login', async () => {
  console.log('[IPC] instagram:open-login - HANDLER CALLED');
  console.log('[IPC] mainWindow exists:', !!mainWindow);
  try {
    console.log('[IPC] Calling instagramAdapter.openLoginWindow...');
    const cookies = await instagramAdapter.openLoginWindow(mainWindow || undefined);
    console.log('[IPC] openLoginWindow returned:', cookies ? 'cookies' : 'null');
    if (cookies) {
      // Save cookies and connect
      const result = await instagramAdapter.connect({ cookies } as any);
      if (result.success) {
        await sessionManager.saveSession('instagram', cookies as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return { success: true, cookies };
    }
    return { success: false, error: 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] instagram:open-login error:', error);
    return { success: false, error: error.message };
  }
});

// Instagram Private API login (username/password)
ipcMain.handle('instagram:login-credentials', async (_event, username: string, password: string) => {
  console.log('[IPC] instagram:login-credentials - HANDLER CALLED');
  try {
    // Connect using Private API with username/password
    const result = await instagramAdapter.connect({ username, password });

    if (result.success) {
      await sessionManager.saveSession('instagram', { username, password } as any, {
        userId: result.userId,
        username: result.username,
      });
      console.log('[IPC] Instagram Private API login successful:', result.username);
    }

    return result;
  } catch (error: any) {
    console.error('[IPC] instagram:login-credentials error:', error);
    return { success: false, error: error.message };
  }
});

// Facebook set mode handler
ipcMain.handle('facebook:set-mode', async (_event, usePrivateAPI: boolean) => {
  console.log('[IPC] facebook:set-mode - usePrivateAPI:', usePrivateAPI);
  try {
    facebookAdapter.setMode(usePrivateAPI);
    return { success: true, mode: usePrivateAPI ? 'private' : 'browser' };
  } catch (error: any) {
    console.error('[IPC] facebook:set-mode error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('facebook:open-login', async () => {
  console.log('[IPC] facebook:open-login - HANDLER CALLED');
  console.log('[IPC] mainWindow exists:', !!mainWindow);
  try {
    console.log('[IPC] Calling facebookAdapter.openLoginWindow...');
    const cookies = await facebookAdapter.openLoginWindow(mainWindow || undefined);
    console.log('[IPC] openLoginWindow returned:', cookies ? 'cookies' : 'null');
    if (cookies?.c_user && cookies?.xs) {
      // Convert to Record<string, string> format for PlatformCredentials
      const cookieRecord: Record<string, string> = {
        c_user: cookies.c_user,
        xs: cookies.xs,
      };
      if (cookies.datr) cookieRecord.datr = cookies.datr;
      if (cookies.fr) cookieRecord.fr = cookies.fr;

      // Try to connect via sidecar first if available
      const sidecarStatus = await facebookSidecar.getStatus();
      console.log('[IPC] Sidecar status:', sidecarStatus);
      if (sidecarStatus.running) {
        const loginResult = await facebookSidecar.loginWithCookies(cookies);
        if (loginResult.success) {
          await sessionManager.saveSession('facebook', { cookies: cookieRecord } as any, {
            userId: loginResult.user_id,
            username: loginResult.username,
          });
          return { success: true, userId: loginResult.user_id, cookies: cookieRecord };
        }
      }

      // Fallback to direct adapter connection
      const result = await facebookAdapter.connect({ cookies: cookieRecord });
      if (result.success) {
        await sessionManager.saveSession('facebook', { cookies: cookieRecord } as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return { success: result.success, userId: result.userId, cookies: cookieRecord, error: result.error };
    }
    return { success: false, error: 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] facebook:open-login error:', error);
    return { success: false, error: error.message };
  }
});

// Facebook submit PIN handler
ipcMain.handle('facebook:submit-pin', async (_event, pin: string) => {
  console.log('[IPC] facebook:submit-pin - PIN received');
  try {
    const result = await facebookAdapter.submitPIN(pin);
    return result;
  } catch (error: any) {
    console.error('[IPC] facebook:submit-pin error:', error);
    return { success: false, error: error.message };
  }
});

// Facebook trigger extraction handler - called after user enters PIN manually
ipcMain.handle('facebook:trigger-extraction', async () => {
  console.log('[IPC] facebook:trigger-extraction - HANDLER CALLED');
  try {
    const conversations = await facebookAdapter.triggerExtraction();
    console.log('[IPC] Extraction returned', conversations.length, 'conversations');
    return { success: conversations.length > 0, conversations, count: conversations.length };
  } catch (error: any) {
    console.error('[IPC] facebook:trigger-extraction error:', error);
    return { success: false, error: error.message, conversations: [] };
  }
});

// Facebook check if login window is ready
ipcMain.handle('facebook:is-window-ready', async () => {
  return { ready: facebookAdapter.isLoginWindowReady() };
});

// LinkedIn set mode handler
ipcMain.handle('linkedin:set-mode', async (_event, useVoyagerAPI: boolean) => {
  console.log('[IPC] linkedin:set-mode - useVoyagerAPI:', useVoyagerAPI);
  try {
    linkedinAdapter.setMode(useVoyagerAPI);
    return { success: true, mode: useVoyagerAPI ? 'voyager' : 'browser' };
  } catch (error: any) {
    console.error('[IPC] linkedin:set-mode error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('linkedin:open-login', async () => {
  console.log('[IPC] linkedin:open-login - HANDLER CALLED');
  console.log('[IPC] mainWindow exists:', !!mainWindow);
  
  try {
    console.log('[IPC] Calling linkedinAdapter.openLoginWindow...');
    const cookies = await linkedinAdapter.openLoginWindow(mainWindow || undefined);
    console.log('[IPC] openLoginWindow returned:', cookies ? 'cookies' : 'null');
    if (cookies) {
      // Save cookies and connect
      const result = await linkedinAdapter.connect({ cookies } as any);
      if (result.success) {
        await sessionManager.saveSession('linkedin', cookies as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return { success: true, cookies };
    }
    return { success: false, error: 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] linkedin:open-login error:', error);
    return { success: false, error: error.message };
  }
});

// LinkedIn debug - show hidden browser window
ipcMain.handle('linkedin:show-browser', async () => {
  console.log('[IPC] linkedin:show-browser - showing hidden browser window');
  try {
    linkedinAdapter.showBrowserWindow();
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] linkedin:show-browser error:', error);
    return { success: false, error: error.message };
  }
});

// LinkedIn debug - hide browser window
ipcMain.handle('linkedin:hide-browser', async () => {
  console.log('[IPC] linkedin:hide-browser - hiding browser window');
  try {
    linkedinAdapter.hideBrowserWindow();
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] linkedin:hide-browser error:', error);
    return { success: false, error: error.message };
  }
});

// WhatsApp specific handlers
ipcMain.handle('whatsapp:init', async () => {
  console.log('[IPC] whatsapp:init');
  try {
    const result = await whatsappAdapter.connect();
    return result;
  } catch (error: any) {
    console.error('[IPC] whatsapp:init error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('whatsapp:status', async () => {
  return {
    status: whatsappAdapter.getStatus(),
    qrCode: whatsappAdapter.getQRCode(),
    phoneNumber: whatsappAdapter.getPhoneNumber(),
    connected: whatsappAdapter.connected(),
  };
});

ipcMain.handle('whatsapp:disconnect', async () => {
  console.log('[IPC] whatsapp:disconnect');
  try {
    await whatsappAdapter.disconnect();
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] whatsapp:disconnect error:', error);
    return { success: false, error: error.message };
  }
});

// Telegram specific handlers - GramJS MTProto
ipcMain.handle('telegram:open-login', async () => {
  console.log('[IPC] telegram:open-login - Starting credential flow');
  // This now triggers the credential input flow in the UI
  return {
    success: false,
    needCredentials: true,
    message: 'Please enter your Telegram API credentials from my.telegram.org'
  };
});

ipcMain.handle('telegram:set-credentials', async (_event, apiId: string, apiHash: string) => {
  console.log('[IPC] telegram:set-credentials');
  try {
    telegramAdapter.setApiCredentials(apiId, apiHash);
    return { success: true, status: 'awaiting_phone' };
  } catch (error: any) {
    console.error('[IPC] telegram:set-credentials error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram:start-verification', async (_event, phoneNumber: string) => {
  console.log('[IPC] telegram:start-verification');
  try {
    const result = await telegramAdapter.startPhoneVerification(phoneNumber);
    if (result.success) {
      // Save session after successful connection
      const session = telegramAdapter.getSession();
      if (session) {
        await sessionManager.saveSession('telegram', {
          apiId: session.apiId.toString(),
          apiHash: session.apiHash,
          sessionString: session.sessionString,
        } as any, {
          userId: telegramAdapter.getUserId() || undefined,
          username: telegramAdapter.getUsername() || undefined,
        });
      }
    }
    return result;
  } catch (error: any) {
    console.error('[IPC] telegram:start-verification error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram:verify-code', async (_event, code: string) => {
  console.log('[IPC] telegram:verify-code');
  try {
    const result = await telegramAdapter.verifyCode(code);

    // Save session if connected
    if (telegramAdapter.connected()) {
      const session = telegramAdapter.getSession();
      if (session) {
        await sessionManager.saveSession('telegram', {
          apiId: session.apiId.toString(),
          apiHash: session.apiHash,
          sessionString: session.sessionString,
        } as any, {
          userId: telegramAdapter.getUserId() || undefined,
          username: telegramAdapter.getUsername() || undefined,
        });
        console.log('[IPC] Telegram session saved successfully');
      }
    }

    return result;
  } catch (error: any) {
    console.error('[IPC] telegram:verify-code error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram:verify-password', async (_event, password: string) => {
  console.log('[IPC] telegram:verify-password');
  try {
    const result = await telegramAdapter.verifyPassword(password);
    // After password verification, check if connected
    if (telegramAdapter.connected()) {
      const session = telegramAdapter.getSession();
      if (session) {
        await sessionManager.saveSession('telegram', {
          apiId: session.apiId.toString(),
          apiHash: session.apiHash,
          sessionString: session.sessionString,
        } as any, {
          userId: telegramAdapter.getUserId() || undefined,
          username: telegramAdapter.getUsername() || undefined,
        });
      }
    }
    return result;
  } catch (error: any) {
    console.error('[IPC] telegram:verify-password error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('telegram:status', async () => {
  return {
    status: telegramAdapter.getStatus(),
    username: telegramAdapter.getUsername(),
    userId: telegramAdapter.getUserId(),
    connected: telegramAdapter.connected(),
    sessionString: telegramAdapter.getSessionString(),
  };
});

ipcMain.handle('telegram:disconnect', async () => {
  console.log('[IPC] telegram:disconnect');
  try {
    await telegramAdapter.disconnect();
    sessionManager.clearSession('telegram');
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] telegram:disconnect error:', error);
    return { success: false, error: error.message };
  }
});

// Discord specific handlers
ipcMain.handle('discord:open-login', async () => {
  console.log('[IPC] discord:open-login - HANDLER CALLED');
  console.log('[IPC] mainWindow exists:', !!mainWindow);
  try {
    console.log('[IPC] Calling discordAdapter.openLoginWindow...');
    const result = await discordAdapter.openLoginWindow(mainWindow || undefined);
    console.log('[IPC] openLoginWindow returned:', result ? 'token' : 'null');
    if (result?.token) {
      // Connect with the extracted token
      const connectResult = await discordAdapter.connect({ token: result.token });
      if (connectResult.success) {
        await sessionManager.saveSession('discord', { token: result.token } as any, {
          userId: connectResult.userId,
          username: connectResult.username,
        });
      }
      return { success: connectResult.success, error: connectResult.error };
    }
    return { success: false, error: 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] discord:open-login error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('discord:connect', async (_event, token: string, userId?: string, username?: string) => {
  console.log('[IPC] discord:connect');
  try {
    const result = await discordAdapter.connect({ token });
    if (result.success) {
      await sessionManager.saveSession('discord', { token } as any, {
        userId: result.userId || userId,
        username: result.username || username,
      });
    }
    return result;
  } catch (error: any) {
    console.error('[IPC] discord:connect error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('discord:status', async () => {
  return {
    status: discordAdapter.getStatus(),
    userId: discordAdapter.getUserId(),
    username: discordAdapter.getUsername(),
    connected: discordAdapter.connected(),
  };
});

ipcMain.handle('discord:disconnect', async () => {
  console.log('[IPC] discord:disconnect');
  try {
    await discordAdapter.disconnect();
    sessionManager.clearSession('discord');
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] discord:disconnect error:', error);
    return { success: false, error: error.message };
  }
});

// Teams specific handlers
ipcMain.handle('teams:open-login', async () => {
  console.log('[IPC] teams:open-login - HANDLER CALLED');
  try {
    // New bridge-based login - just opens the Teams web page
    const result = await teamsAdapter.openLoginWindow(mainWindow || undefined);
    if (result.success) {
      // Login will be detected via IPC from preload script
      // Session will be saved when 'teams-bridge:logged-in' event is received
      return { success: true };
    }
    return { success: false, error: result.error || 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] teams:open-login error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('teams:status', async () => {
  return {
    status: teamsAdapter.getStatus(),
    userId: teamsAdapter.getUserId(),
    username: teamsAdapter.getUsername(),
    connected: teamsAdapter.connected(),
  };
});

ipcMain.handle('teams:disconnect', async () => {
  console.log('[IPC] teams:disconnect');
  try {
    await teamsAdapter.disconnect();
    sessionManager.clearSession('teams' as Platform);
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] teams:disconnect error:', error);
    return { success: false, error: error.message };
  }
});

// Gmail specific handlers
ipcMain.handle('gmail:open-login', async () => {
  console.log('[IPC] gmail:open-login - HANDLER CALLED');
  try {
    const tokens = await gmailAdapter.openLoginWindow(mainWindow || undefined);
    if (tokens?.accessToken) {
      const result = await gmailAdapter.connect({ accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt });
      if (result.success) {
        await sessionManager.saveSession('gmail' as Platform, { accessToken: tokens.accessToken, refreshToken: tokens.refreshToken, expiresAt: tokens.expiresAt } as any, {
          userId: result.userId,
          username: result.username,
        });
      }
      return { success: result.success, error: result.error };
    }
    return { success: false, error: 'Login cancelled or failed' };
  } catch (error: any) {
    console.error('[IPC] gmail:open-login error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('gmail:status', async () => {
  return {
    status: gmailAdapter.getStatus(),
    userId: gmailAdapter.getUserId(),
    username: gmailAdapter.getUsername(),
    connected: gmailAdapter.connected(),
  };
});

ipcMain.handle('gmail:disconnect', async () => {
  console.log('[IPC] gmail:disconnect');
  try {
    await gmailAdapter.disconnect();
    sessionManager.clearSession('gmail' as Platform);
    return { success: true };
  } catch (error: any) {
    console.error('[IPC] gmail:disconnect error:', error);
    return { success: false, error: error.message };
  }
});

// ============================================
// IPC Handlers - Data Operations
// ============================================

ipcMain.handle('data:conversations', async (_event, platform?: Platform) => {
  console.log(`[IPC] data:conversations - ${platform || 'all'}`);
  const startTime = Date.now();
  
  try {
    // If specific platform requested, fetch only that
    if (platform) {
      let convs: any[] = [];
      
      switch (platform) {
        case 'twitter':
          if (twitterAdapter.connected()) convs = await twitterAdapter.fetchConversations();
          break;
        case 'instagram':
          if (instagramAdapter.connected()) convs = await instagramAdapter.fetchConversations();
          break;
        case 'facebook':
          if (facebookAdapter.connected()) convs = await facebookAdapter.fetchConversations();
          break;
        case 'linkedin':
          if (linkedinAdapter.connected()) convs = await linkedinAdapter.fetchConversations();
          break;
        case 'whatsapp':
          if (whatsappAdapter.connected()) convs = await whatsappAdapter.fetchConversations();
          break;
        case 'telegram':
          if (telegramAdapter.connected()) convs = await telegramAdapter.fetchConversations();
          break;
        case 'discord':
          if (discordAdapter.connected()) convs = await discordAdapter.fetchConversations();
          break;
        case 'teams':
          if (teamsAdapter.connected()) convs = await teamsAdapter.fetchConversations();
          break;
        case 'gmail':
          if (gmailAdapter.connected()) convs = await gmailAdapter.fetchConversations();
          break;
      }
      
      console.log(`[IPC] ${platform} conversations: ${convs.length} (${Date.now() - startTime}ms)`);
      return convs;
    }

    // Fetch ALL platforms in PARALLEL for speed
    const fetchPromises: Promise<any[]>[] = [];
    const platformNames: string[] = [];

    if (twitterAdapter.connected()) {
      platformNames.push('twitter');
      fetchPromises.push(twitterAdapter.fetchConversations().catch(() => []));
    }
    if (instagramAdapter.connected()) {
      platformNames.push('instagram');
      fetchPromises.push(instagramAdapter.fetchConversations().catch(() => []));
    }
    if (facebookAdapter.connected()) {
      platformNames.push('facebook');
      fetchPromises.push(facebookAdapter.fetchConversations().catch(() => []));
    }
    if (linkedinAdapter.connected()) {
      platformNames.push('linkedin');
      fetchPromises.push(linkedinAdapter.fetchConversations().catch(() => []));
    }
    if (whatsappAdapter.connected()) {
      platformNames.push('whatsapp');
      fetchPromises.push(whatsappAdapter.fetchConversations().catch(() => []));
    }
    if (telegramAdapter.connected()) {
      platformNames.push('telegram');
      fetchPromises.push(telegramAdapter.fetchConversations().catch(() => []));
    }
    if (discordAdapter.connected()) {
      platformNames.push('discord');
      fetchPromises.push(discordAdapter.fetchConversations().catch(() => []));
    }
    if (teamsAdapter.connected()) {
      platformNames.push('teams');
      fetchPromises.push(teamsAdapter.fetchConversations().catch(() => []));
    }
    if (gmailAdapter.connected()) {
      platformNames.push('gmail');
      fetchPromises.push(gmailAdapter.fetchConversations().catch(() => []));
    }

    console.log(`[IPC] Fetching ${platformNames.length} platforms in parallel: ${platformNames.join(', ')}`);

    // Wait for all in parallel
    const results = await Promise.all(fetchPromises);
    
    // Combine all conversations
    const conversations: any[] = [];
    results.forEach((convs, i) => {
      console.log(`[IPC] ${platformNames[i]}: ${convs.length} conversations`);
      conversations.push(...convs);
    });

    // Sort by last message time
    conversations.sort((a, b) =>
      new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime()
    );

    console.log(`[IPC] Total: ${conversations.length} conversations (${Date.now() - startTime}ms)`);
    return conversations;
  } catch (error: any) {
    console.error('[IPC] data:conversations error:', error);
    return [];
  }
});

ipcMain.handle('data:messages', async (_event, conversationId: string, platform: Platform) => {
  console.log(`[IPC] data:messages - ${platform}/${conversationId}`);
  try {
    // Extract platform conversation ID (remove platform prefix)
    const platformConvId = conversationId.replace(`${platform}_`, '');

    if (platform === 'twitter' && twitterAdapter.connected()) {
      return await twitterAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'instagram' && instagramAdapter.connected()) {
      return await instagramAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'facebook' && facebookAdapter.connected()) {
      return await facebookAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'linkedin' && linkedinAdapter.connected()) {
      return await linkedinAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'whatsapp' && whatsappAdapter.connected()) {
      return await whatsappAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'telegram' && telegramAdapter.connected()) {
      return await telegramAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'discord' && discordAdapter.connected()) {
      return await discordAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'teams' && teamsAdapter.connected()) {
      return await teamsAdapter.fetchMessages(platformConvId);
    }

    if (platform === 'gmail' && gmailAdapter.connected()) {
      return await gmailAdapter.fetchMessages(platformConvId);
    }

    return [];
  } catch (error: any) {
    console.error('[IPC] data:messages error:', error);
    return [];
  }
});

ipcMain.handle('data:send-message', async (_event, conversationId: string, platform: Platform, content: string) => {
  console.log(`[IPC] data:send-message - ${platform}/${conversationId} - content: "${content.substring(0, 50)}..."`);
  try {
    const platformConvId = conversationId.replace(`${platform}_`, '');
    console.log(`[IPC] Platform conv ID: ${platformConvId}`);

    // Instagram send
    if (platform === 'instagram') {
      console.log('[IPC] Instagram connected:', instagramAdapter.connected());
      if (instagramAdapter.connected()) {
        console.log('[IPC] Calling Instagram sendMessage...');
        const result = await instagramAdapter.sendMessage(conversationId, content);
        console.log('[IPC] Instagram sendMessage result:', result);
        return result;
      }
      return { success: false, error: 'Instagram not connected' };
    }

    // Facebook send (browser automation)
    if (platform === 'facebook') {
      console.log('[IPC] Facebook connected:', facebookAdapter.connected());
      if (facebookAdapter.connected()) {
        console.log('[IPC] Calling Facebook sendMessage...');
        const result = await facebookAdapter.sendMessage(conversationId, content);
        console.log('[IPC] Facebook sendMessage result:', result);
        return result;
      }
      return { success: false, error: 'Facebook not connected' };
    }

    // WhatsApp has full send support
    if (platform === 'whatsapp' && whatsappAdapter.connected()) {
      console.log('[IPC] Calling WhatsApp sendMessage...');
      return await whatsappAdapter.sendMessage(platformConvId, content);
    }

    // Telegram has full send support
    if (platform === 'telegram') {
      console.log('[IPC] Telegram connected:', telegramAdapter.connected());
      if (telegramAdapter.connected()) {
        console.log('[IPC] Calling Telegram sendMessage...');
        const result = await telegramAdapter.sendMessage(conversationId, content);
        console.log('[IPC] Telegram sendMessage result:', result);
        return result;
      }
      return { success: false, error: 'Telegram not connected' };
    }

    // Discord has full send support
    if (platform === 'discord' && discordAdapter.connected()) {
      console.log('[IPC] Calling Discord sendMessage...');
      return await discordAdapter.sendMessage(platformConvId, content);
    }

    // Teams has full send support
    if (platform === 'teams' && teamsAdapter.connected()) {
      console.log('[IPC] Calling Teams sendMessage...');
      return await teamsAdapter.sendMessage(conversationId, content);
    }

    // Gmail - only replies supported
    if (platform === 'gmail' && gmailAdapter.connected()) {
      console.log('[IPC] Calling Gmail sendMessage (reply)...');
      return await gmailAdapter.sendMessage(conversationId, content);
    }

    // Twitter send (browser automation)
    if (platform === 'twitter') {
      console.log('[IPC] Twitter connected:', twitterAdapter.connected());
      if (twitterAdapter.connected()) {
        console.log('[IPC] Calling Twitter sendMessage...');
        const result = await twitterAdapter.sendMessage(platformConvId, content);
        console.log('[IPC] Twitter sendMessage result:', result);
        return result;
      }
      return { success: false, error: 'Twitter not connected' };
    }

    // LinkedIn send (Voyager API)
    if (platform === 'linkedin') {
      console.log('[IPC] LinkedIn connected:', linkedinAdapter.connected());
      if (linkedinAdapter.connected()) {
        console.log('[IPC] Calling LinkedIn sendMessage...');
        const result = await linkedinAdapter.sendMessage(conversationId, content);
        console.log('[IPC] LinkedIn sendMessage result:', result);
        return result;
      }
      return { success: false, error: 'LinkedIn not connected' };
    }

    // Other platforms - placeholder
    console.log('[IPC] Platform not supported for sending:', platform);
    const messageId = `msg_${Date.now()}`;
    return {
      success: true,
      messageId,
      sentAt: new Date().toISOString(),
    };
  } catch (error: any) {
    console.error('[IPC] data:send-message error:', error);
    return {
      success: false,
      error: error.message
    };
  }
});

ipcMain.handle('data:mark-read', async (_event, conversationId: string, platform: Platform) => {
  console.log(`[IPC] data:mark-read - ${platform}/${conversationId}`);
  try {
    // Will be implemented in platform adapters (Tasks 6-13)
    return createResponse(true);
  } catch (error: any) {
    console.error('[IPC] data:mark-read error:', error);
    return createResponse(false, undefined, error.message);
  }
});

// ============================================
// IPC Handlers - Settings
// ============================================

ipcMain.handle('settings:get', async (_event, key: string) => {
  try {
    return (appSettings as any)[key] ?? null;
  } catch (error: any) {
    console.error('[IPC] settings:get error:', error);
    return null;
  }
});

ipcMain.handle('settings:set', async (_event, key: string, value: any) => {
  try {
    (appSettings as any)[key] = value;
    // Will persist to storage in Task 17
    return createResponse(true);
  } catch (error: any) {
    console.error('[IPC] settings:set error:', error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('settings:all', async () => {
  return appSettings;
});

// ============================================
// IPC Handlers - Security (Password Protection)
// ============================================

// Password hash storage (in-memory, will be persisted via localStorage)
let passwordHash: string | null = null;
let isAppLocked: boolean = false;

// Simple hash function for password (in production, use bcrypt or similar)
function hashPassword(password: string): string {
  const crypto = require('crypto');
  return crypto.createHash('sha256').update(password + 'chat-orbitor-salt').digest('hex');
}

ipcMain.handle('security:is-password-set', async () => {
  // Check if password is set in localStorage
  const storedHash = localStorage.getPasswordHash();
  passwordHash = storedHash || null;
  return passwordHash !== null;
});

ipcMain.handle('security:set-password', async (_event, password: string) => {
  try {
    if (!password || password.length < 4) {
      return createResponse(false, undefined, 'Password must be at least 4 characters');
    }

    passwordHash = hashPassword(password);
    localStorage.setPasswordHash(passwordHash);

    // Update settings
    if (!appSettings.security) {
      appSettings.security = { passwordEnabled: true, lockOnMinimize: false, lockTimeout: 0 };
    }
    appSettings.security.passwordEnabled = true;

    console.log('[Security] Password set successfully');
    return createResponse(true);
  } catch (error: any) {
    console.error('[Security] set-password error:', error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('security:verify-password', async (_event, password: string) => {
  try {
    if (!passwordHash) {
      const storedHash = localStorage.getPasswordHash();
      passwordHash = storedHash || null;
    }

    if (!passwordHash) {
      return createResponse(false, undefined, 'No password set');
    }

    const inputHash = hashPassword(password);
    if (inputHash === passwordHash) {
      return createResponse(true);
    }

    return createResponse(false, undefined, 'Incorrect password');
  } catch (error: any) {
    console.error('[Security] verify-password error:', error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('security:remove-password', async (_event, currentPassword: string) => {
  try {
    if (!passwordHash) {
      const storedHash = localStorage.getPasswordHash();
      passwordHash = storedHash || null;
    }

    if (!passwordHash) {
      return createResponse(true); // No password to remove
    }

    const inputHash = hashPassword(currentPassword);
    if (inputHash !== passwordHash) {
      return createResponse(false, undefined, 'Incorrect password');
    }

    passwordHash = null;
    localStorage.setPasswordHash(null);

    // Update settings
    if (appSettings.security) {
      appSettings.security.passwordEnabled = false;
    }

    isAppLocked = false;

    console.log('[Security] Password removed successfully');
    return createResponse(true);
  } catch (error: any) {
    console.error('[Security] remove-password error:', error);
    return createResponse(false, undefined, error.message);
  }
});

ipcMain.handle('security:is-locked', async () => {
  return isAppLocked;
});

ipcMain.handle('security:lock', async () => {
  if (passwordHash || localStorage.getPasswordHash()) {
    isAppLocked = true;
    sendToRenderer('app-locked');
    console.log('[Security] App locked');
  }
});

ipcMain.handle('security:unlock', async (_event, password: string) => {
  try {
    if (!passwordHash) {
      const storedHash = localStorage.getPasswordHash();
      passwordHash = storedHash || null;
    }

    if (!passwordHash) {
      isAppLocked = false;
      return createResponse(true);
    }

    const inputHash = hashPassword(password);
    if (inputHash === passwordHash) {
      isAppLocked = false;
      sendToRenderer('app-unlocked');
      console.log('[Security] App unlocked');
      return createResponse(true);
    }

    return createResponse(false, undefined, 'Incorrect password');
  } catch (error: any) {
    console.error('[Security] unlock error:', error);
    return createResponse(false, undefined, error.message);
  }
});

// ============================================
// IPC Handlers - Instagram Sidecar
// ============================================

ipcMain.handle('instagram:sidecar-status', async () => {
  return instagramSidecar.getStatus();
});

ipcMain.handle('instagram:sidecar-restart', async () => {
  console.log('[IPC] instagram:sidecar-restart');
  instagramSidecar.stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const started = await instagramSidecar.start();
  return { success: started };
});

// Export for use by platform adapters
export { mainWindow, sendToRenderer };

// ============================================
// IPC Handlers - Facebook Sidecar
// ============================================

ipcMain.handle('facebook:sidecar-status', async () => {
  return facebookSidecar.getStatus();
});

ipcMain.handle('facebook:login-cookies', async (_event, cookies: { c_user: string; xs: string; fr?: string; datr?: string }) => {
  console.log('[IPC] facebook:login-cookies');
  try {
    const result = await facebookSidecar.loginWithCookies(cookies);
    if (result.success) {
      await sessionManager.saveSession('facebook', { cookies } as any, {
        userId: result.user_id,
        username: result.username,
      });
    }
    return result;
  } catch (error: any) {
    console.error('[IPC] facebook:login-cookies error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('facebook:login-credentials', async (_event, email: string, password: string) => {
  console.log('[IPC] facebook:login-credentials - HANDLER CALLED');
  try {
    const result = await facebookSidecar.loginWithCredentials(email, password);
    if (result.success) {
      await sessionManager.saveSession('facebook', { email, password } as any, {
        userId: result.user_id,
        username: result.username,
      });
      console.log('[IPC] Facebook Private API login successful:', result.username);
    }
    return result;
  } catch (error: any) {
    console.error('[IPC] facebook:login-credentials error:', error);
    return { success: false, error: error.message };
  }
});

ipcMain.handle('facebook:verify-otp', async (_event, code: string) => {
  console.log('[IPC] facebook:verify-otp');
  try {
    const response = await facebookSidecar.verifyOtp(code);
    return response;
  } catch (error: any) {
    console.error('[IPC] facebook:verify-otp error:', error);
    return { success: false, error: error.message };
  }
});



ipcMain.handle('facebook:sidecar-restart', async () => {
  console.log('[IPC] facebook:sidecar-restart');
  facebookSidecar.stop();
  await new Promise(resolve => setTimeout(resolve, 1000));
  const started = await facebookSidecar.start();
  return { success: started };
});
