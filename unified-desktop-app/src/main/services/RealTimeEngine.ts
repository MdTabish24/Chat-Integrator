import { EventEmitter } from 'events';
import { 
  getTwitterAdapter, 
  getInstagramAdapter, 
  getFacebookAdapter, 
  getLinkedInAdapter, 
  getWhatsAppAdapter, 
  getTelegramAdapter, 
  getDiscordAdapter 
} from '../adapters/index.js';
import { getSessionManager } from './SessionManager.js';
import type { 
  Platform, 
  NewMessageEvent, 
  ConnectionStatusEvent,
  PlatformStatus 
} from '../../shared/types.js';

/**
 * Real-Time Engine
 * Manages connections for all platforms and provides unified event system
 * Implements auto-reconnect with exponential backoff
 */

interface ReconnectState {
  attempts: number;
  lastAttempt: number;
  timeout: NodeJS.Timeout | null;
}

export class RealTimeEngine extends EventEmitter {
  private isRunning: boolean = false;
  private reconnectStates: Map<Platform, ReconnectState> = new Map();
  
  // Reconnect configuration
  private readonly MAX_RECONNECT_ATTEMPTS = 5;
  private readonly BASE_RECONNECT_DELAY = 5000; // 5 seconds
  private readonly MAX_RECONNECT_DELAY = 300000; // 5 minutes
  
  // Platform adapters
  private twitterAdapter = getTwitterAdapter();
  private instagramAdapter = getInstagramAdapter();
  private facebookAdapter = getFacebookAdapter();
  private linkedinAdapter = getLinkedInAdapter();
  private whatsappAdapter = getWhatsAppAdapter();
  private telegramAdapter = getTelegramAdapter();
  private discordAdapter = getDiscordAdapter();
  
  // Session manager
  private sessionManager = getSessionManager();

  constructor() {
    super();
    this.setupEventListeners();
  }

  /**
   * Set up event listeners for all platform adapters
   */
  private setupEventListeners(): void {
    // Twitter events
    this.twitterAdapter.on('newMessage', (event: NewMessageEvent) => {
      this.emit('newMessage', event);
    });
    this.twitterAdapter.on('connected', () => {
      this.handleConnectionSuccess('twitter');
    });
    this.twitterAdapter.on('disconnected', () => {
      this.handleDisconnection('twitter');
    });
    this.twitterAdapter.on('error', (data: any) => {
      this.handleConnectionError('twitter', data.error);
    });

    // Instagram events
    this.instagramAdapter.on('newMessage', (event: NewMessageEvent) => {
      this.emit('newMessage', event);
    });
    this.instagramAdapter.on('connected', () => {
      this.handleConnectionSuccess('instagram');
    });
    this.instagramAdapter.on('disconnected', () => {
      this.handleDisconnection('instagram');
    });
    this.instagramAdapter.on('error', (data: any) => {
      this.handleConnectionError('instagram', data.error);
    });

    // Facebook events
    this.facebookAdapter.on('connected', () => {
      this.handleConnectionSuccess('facebook');
    });
    this.facebookAdapter.on('disconnected', () => {
      this.handleDisconnection('facebook');
    });
    this.facebookAdapter.on('error', (data: any) => {
      this.handleConnectionError('facebook', data.error);
    });

    // LinkedIn events
    this.linkedinAdapter.on('connected', () => {
      this.handleConnectionSuccess('linkedin');
    });
    this.linkedinAdapter.on('disconnected', () => {
      this.handleDisconnection('linkedin');
    });
    this.linkedinAdapter.on('error', (data: any) => {
      this.handleConnectionError('linkedin', data.error);
    });

    // WhatsApp events
    this.whatsappAdapter.on('newMessage', (event: NewMessageEvent) => {
      this.emit('newMessage', event);
    });
    this.whatsappAdapter.on('connected', () => {
      this.handleConnectionSuccess('whatsapp');
    });
    this.whatsappAdapter.on('disconnected', () => {
      this.handleDisconnection('whatsapp');
    });
    this.whatsappAdapter.on('error', (data: any) => {
      this.handleConnectionError('whatsapp', data.error);
    });

    // Telegram events
    this.telegramAdapter.on('newMessage', (event: NewMessageEvent) => {
      this.emit('newMessage', event);
    });
    this.telegramAdapter.on('connected', () => {
      this.handleConnectionSuccess('telegram');
    });
    this.telegramAdapter.on('disconnected', () => {
      this.handleDisconnection('telegram');
    });
    this.telegramAdapter.on('error', (data: any) => {
      this.handleConnectionError('telegram', data.error);
    });

    // Discord events
    this.discordAdapter.on('newMessage', (event: NewMessageEvent) => {
      this.emit('newMessage', event);
    });
    this.discordAdapter.on('connected', () => {
      this.handleConnectionSuccess('discord');
    });
    this.discordAdapter.on('disconnected', () => {
      this.handleDisconnection('discord');
    });
    this.discordAdapter.on('error', (data: any) => {
      this.handleConnectionError('discord', data.error);
    });
  }

  /**
   * Handle successful connection
   */
  private handleConnectionSuccess(platform: Platform): void {
    console.log(`[RealTimeEngine] ${platform} connected`);
    
    // Reset reconnect state
    this.reconnectStates.delete(platform);
    
    // Emit connection status
    this.emit('connectionStatus', {
      platform,
      status: 'connected',
    } as ConnectionStatusEvent);
  }

  /**
   * Handle disconnection
   */
  private handleDisconnection(platform: Platform): void {
    console.log(`[RealTimeEngine] ${platform} disconnected`);
    
    // Emit connection status
    this.emit('connectionStatus', {
      platform,
      status: 'disconnected',
    } as ConnectionStatusEvent);
    
    // Attempt reconnect if engine is running
    if (this.isRunning) {
      this.scheduleReconnect(platform);
    }
  }

  /**
   * Handle connection error
   */
  private handleConnectionError(platform: Platform, error: string): void {
    console.error(`[RealTimeEngine] ${platform} error: ${error}`);
    
    // Emit connection status
    this.emit('connectionStatus', {
      platform,
      status: 'error',
      error,
    } as ConnectionStatusEvent);
    
    // Attempt reconnect if engine is running
    if (this.isRunning) {
      this.scheduleReconnect(platform);
    }
  }

  /**
   * Schedule reconnection with exponential backoff
   */
  private scheduleReconnect(platform: Platform): void {
    let state = this.reconnectStates.get(platform);
    
    if (!state) {
      state = { attempts: 0, lastAttempt: 0, timeout: null };
      this.reconnectStates.set(platform, state);
    }
    
    // Check if max attempts reached
    if (state.attempts >= this.MAX_RECONNECT_ATTEMPTS) {
      console.log(`[RealTimeEngine] ${platform} max reconnect attempts reached`);
      this.emit('connectionStatus', {
        platform,
        status: 'error',
        error: 'Max reconnection attempts reached. Please reconnect manually.',
      } as ConnectionStatusEvent);
      return;
    }
    
    // Clear existing timeout
    if (state.timeout) {
      clearTimeout(state.timeout);
    }
    
    // Calculate delay with exponential backoff
    const delay = Math.min(
      this.BASE_RECONNECT_DELAY * Math.pow(2, state.attempts),
      this.MAX_RECONNECT_DELAY
    );
    
    console.log(`[RealTimeEngine] Scheduling ${platform} reconnect in ${delay/1000}s (attempt ${state.attempts + 1}/${this.MAX_RECONNECT_ATTEMPTS})`);
    
    // Emit connecting status
    this.emit('connectionStatus', {
      platform,
      status: 'connecting',
    } as ConnectionStatusEvent);
    
    state.timeout = setTimeout(async () => {
      state!.attempts++;
      state!.lastAttempt = Date.now();
      
      await this.reconnectPlatform(platform);
    }, delay);
  }

  /**
   * Attempt to reconnect a platform
   */
  private async reconnectPlatform(platform: Platform): Promise<void> {
    console.log(`[RealTimeEngine] Attempting to reconnect ${platform}...`);
    
    // Check if we have valid session
    if (!this.sessionManager.hasValidSession(platform)) {
      console.log(`[RealTimeEngine] No valid session for ${platform}, skipping reconnect`);
      return;
    }
    
    const session = this.sessionManager.getSession(platform);
    if (!session?.credentials) {
      console.log(`[RealTimeEngine] No credentials for ${platform}, skipping reconnect`);
      return;
    }
    
    try {
      await this.connectPlatform(platform, session.credentials);
    } catch (error: any) {
      console.error(`[RealTimeEngine] Reconnect failed for ${platform}: ${error.message}`);
    }
  }


  /**
   * Connect a specific platform
   */
  private async connectPlatform(platform: Platform, credentials: any): Promise<boolean> {
    try {
      switch (platform) {
        case 'twitter':
          if (credentials.cookies) {
            const result = await this.twitterAdapter.connect({ cookies: credentials.cookies });
            return result.success;
          }
          break;
          
        case 'instagram':
          if (credentials.cookies) {
            const result = await this.instagramAdapter.connect({ cookies: credentials.cookies });
            return result.success;
          }
          break;
          
        case 'facebook':
          if (credentials.cookies) {
            const result = await this.facebookAdapter.connect({ cookies: credentials.cookies });
            return result.success;
          }
          break;
          
        case 'linkedin':
          if (credentials.cookies) {
            const result = await this.linkedinAdapter.connect({ cookies: credentials.cookies });
            return result.success;
          }
          break;
          
        case 'whatsapp':
          // WhatsApp uses QR code, auto-reconnect via LocalAuth
          const waResult = await this.whatsappAdapter.connect();
          return waResult.success;
          
        case 'telegram':
          if (credentials.sessionString && credentials.apiId && credentials.apiHash) {
            const result = await this.telegramAdapter.connectWithSession(credentials);
            return result.success;
          }
          break;
          
        case 'discord':
          if (credentials.token) {
            const result = await this.discordAdapter.connect({ token: credentials.token });
            return result.success;
          }
          break;
      }
      
      return false;
    } catch (error: any) {
      console.error(`[RealTimeEngine] Connect ${platform} error: ${error.message}`);
      return false;
    }
  }

  /**
   * Start all connections for platforms with valid sessions
   */
  async startAllConnections(): Promise<void> {
    if (this.isRunning) {
      console.log('[RealTimeEngine] Already running');
      return;
    }
    
    this.isRunning = true;
    console.log('[RealTimeEngine] Starting all connections...');
    
    const platforms: Platform[] = ['twitter', 'instagram', 'facebook', 'linkedin', 'whatsapp', 'telegram', 'discord'];
    
    for (const platform of platforms) {
      if (this.sessionManager.hasValidSession(platform)) {
        const session = this.sessionManager.getSession(platform);
        if (session?.credentials) {
          console.log(`[RealTimeEngine] Connecting ${platform}...`);
          
          // Emit connecting status
          this.emit('connectionStatus', {
            platform,
            status: 'connecting',
          } as ConnectionStatusEvent);
          
          // Connect asynchronously (don't wait)
          this.connectPlatform(platform, session.credentials).catch((err) => {
            console.error(`[RealTimeEngine] Failed to connect ${platform}: ${err.message}`);
          });
        }
      }
    }
  }

  /**
   * Stop all connections
   */
  async stopAllConnections(): Promise<void> {
    if (!this.isRunning) {
      console.log('[RealTimeEngine] Not running');
      return;
    }
    
    this.isRunning = false;
    console.log('[RealTimeEngine] Stopping all connections...');
    
    // Clear all reconnect timeouts
    for (const [platform, state] of this.reconnectStates) {
      if (state.timeout) {
        clearTimeout(state.timeout);
      }
    }
    this.reconnectStates.clear();
    
    // Disconnect all platforms
    try {
      await Promise.allSettled([
        this.twitterAdapter.disconnect?.(),
        this.instagramAdapter.disconnect?.(),
        this.facebookAdapter.disconnect?.(),
        this.linkedinAdapter.disconnect?.(),
        this.whatsappAdapter.disconnect(),
        this.telegramAdapter.disconnect(),
        this.discordAdapter.disconnect(),
      ]);
    } catch (error: any) {
      console.error('[RealTimeEngine] Error stopping connections:', error.message);
    }
    
    console.log('[RealTimeEngine] All connections stopped');
  }

  /**
   * Get connection status for all platforms
   */
  getAllStatuses(): Record<Platform, PlatformStatus> {
    const statuses: Record<string, PlatformStatus> = {};
    const platforms: Platform[] = ['twitter', 'instagram', 'facebook', 'linkedin', 'whatsapp', 'telegram', 'discord'];
    
    for (const platform of platforms) {
      const session = this.sessionManager.getSession(platform);
      let connected = false;
      
      switch (platform) {
        case 'twitter':
          connected = this.twitterAdapter.connected();
          break;
        case 'instagram':
          connected = this.instagramAdapter.connected();
          break;
        case 'facebook':
          connected = this.facebookAdapter.connected();
          break;
        case 'linkedin':
          connected = this.linkedinAdapter.connected();
          break;
        case 'whatsapp':
          connected = this.whatsappAdapter.connected();
          break;
        case 'telegram':
          connected = this.telegramAdapter.connected();
          break;
        case 'discord':
          connected = this.discordAdapter.connected();
          break;
      }
      
      statuses[platform] = {
        platform,
        connected,
        lastSync: session?.lastSync,
        username: session?.username,
        userId: session?.userId,
      };
    }
    
    return statuses as Record<Platform, PlatformStatus>;
  }

  /**
   * Get status for a specific platform
   */
  getStatus(platform: Platform): PlatformStatus {
    const session = this.sessionManager.getSession(platform);
    let connected = false;
    
    switch (platform) {
      case 'twitter':
        connected = this.twitterAdapter.connected();
        break;
      case 'instagram':
        connected = this.instagramAdapter.connected();
        break;
      case 'facebook':
        connected = this.facebookAdapter.connected();
        break;
      case 'linkedin':
        connected = this.linkedinAdapter.connected();
        break;
      case 'whatsapp':
        connected = this.whatsappAdapter.connected();
        break;
      case 'telegram':
        connected = this.telegramAdapter.connected();
        break;
      case 'discord':
        connected = this.discordAdapter.connected();
        break;
    }
    
    return {
      platform,
      connected,
      lastSync: session?.lastSync,
      username: session?.username,
      userId: session?.userId,
    };
  }

  /**
   * Check if engine is running
   */
  isEngineRunning(): boolean {
    return this.isRunning;
  }

  /**
   * Get reconnect state for a platform
   */
  getReconnectState(platform: Platform): ReconnectState | undefined {
    return this.reconnectStates.get(platform);
  }

  /**
   * Reset reconnect attempts for a platform
   */
  resetReconnectAttempts(platform: Platform): void {
    this.reconnectStates.delete(platform);
  }

  /**
   * Force reconnect a platform
   */
  async forceReconnect(platform: Platform): Promise<boolean> {
    console.log(`[RealTimeEngine] Force reconnecting ${platform}...`);
    
    // Reset reconnect state
    this.reconnectStates.delete(platform);
    
    // Check for valid session
    if (!this.sessionManager.hasValidSession(platform)) {
      console.log(`[RealTimeEngine] No valid session for ${platform}`);
      return false;
    }
    
    const session = this.sessionManager.getSession(platform);
    if (!session?.credentials) {
      console.log(`[RealTimeEngine] No credentials for ${platform}`);
      return false;
    }
    
    return await this.connectPlatform(platform, session.credentials);
  }
}

// Export singleton instance
let realTimeEngine: RealTimeEngine | null = null;

export function getRealTimeEngine(): RealTimeEngine {
  if (!realTimeEngine) {
    realTimeEngine = new RealTimeEngine();
  }
  return realTimeEngine;
}
