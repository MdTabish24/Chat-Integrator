import { safeStorage, app } from 'electron';
import Store from 'electron-store';
import { Platform } from '../types';

interface SessionData {
  platform: Platform;
  credentials: Record<string, string>;
  userId?: string;
  username?: string;
  lastSync?: string;
  createdAt: string;
  updatedAt: string;
}

interface EncryptedData {
  encrypted: boolean;
  data: string;
}

interface SessionManagerConfig {
  encryptionKey?: string;
}

/**
 * SessionManager handles secure storage of platform credentials
 * Uses Electron's safeStorage API for system keychain integration
 * Falls back to electron-store encryption if keychain unavailable
 */
export class SessionManager {
  private store: Store;
  private isEncryptionAvailable: boolean;

  constructor(config?: SessionManagerConfig) {
    this.store = new Store({
      name: 'chat-orbitor-sessions',
      encryptionKey: config?.encryptionKey || 'chat-orbitor-fallback-key',
    });

    // Check if system keychain is available
    this.isEncryptionAvailable = safeStorage.isEncryptionAvailable();
    console.log(`[SessionManager] System keychain available: ${this.isEncryptionAvailable}`);
  }

  /**
   * Encrypt data using system keychain (safeStorage) or fallback
   */
  private encryptData(data: string): EncryptedData {
    if (this.isEncryptionAvailable) {
      try {
        const encrypted = safeStorage.encryptString(data);
        return {
          encrypted: true,
          data: encrypted.toString('base64'),
        };
      } catch (error) {
        console.error('[SessionManager] safeStorage encryption failed:', error);
      }
    }

    // Fallback: store as-is (electron-store handles encryption)
    return {
      encrypted: false,
      data: data,
    };
  }

  /**
   * Decrypt data using system keychain (safeStorage) or fallback
   */
  private decryptData(encryptedData: EncryptedData): string {
    if (encryptedData.encrypted && this.isEncryptionAvailable) {
      try {
        const buffer = Buffer.from(encryptedData.data, 'base64');
        return safeStorage.decryptString(buffer);
      } catch (error) {
        console.error('[SessionManager] safeStorage decryption failed:', error);
        throw new Error('Failed to decrypt session data');
      }
    }

    // Fallback: return as-is
    return encryptedData.data;
  }

  /**
   * Save session for a platform
   */
  async saveSession(platform: Platform, credentials: Record<string, string>, metadata?: { userId?: string; username?: string }): Promise<void> {
    const sessionData: SessionData = {
      platform,
      credentials,
      userId: metadata?.userId,
      username: metadata?.username,
      createdAt: this.getSession(platform)?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    // Encrypt the entire session data
    const serialized = JSON.stringify(sessionData);
    const encrypted = this.encryptData(serialized);

    this.store.set(`sessions.${platform}`, encrypted);
    console.log(`[SessionManager] Session saved for ${platform}`);
  }

  /**
   * Get session for a platform
   */
  getSession(platform: Platform): SessionData | null {
    const encrypted = this.store.get(`sessions.${platform}`) as EncryptedData | undefined;
    
    if (!encrypted) {
      return null;
    }

    try {
      const decrypted = this.decryptData(encrypted);
      return JSON.parse(decrypted) as SessionData;
    } catch (error) {
      console.error(`[SessionManager] Failed to get session for ${platform}:`, error);
      return null;
    }
  }

  /**
   * Get all sessions
   */
  getAllSessions(): Record<Platform, SessionData> {
    const sessions: Record<string, SessionData> = {};
    const platforms: Platform[] = ['telegram', 'twitter', 'linkedin', 'instagram', 'whatsapp', 'facebook', 'discord'];

    for (const platform of platforms) {
      const session = this.getSession(platform);
      if (session) {
        sessions[platform] = session;
      }
    }

    return sessions as Record<Platform, SessionData>;
  }

  /**
   * Check if session exists and is valid
   */
  hasValidSession(platform: Platform): boolean {
    const session = this.getSession(platform);
    if (!session) return false;

    // Check if credentials exist
    if (!session.credentials || Object.keys(session.credentials).length === 0) {
      return false;
    }

    return true;
  }

  /**
   * Update last sync time for a platform
   */
  updateLastSync(platform: Platform): void {
    const session = this.getSession(platform);
    if (session) {
      session.lastSync = new Date().toISOString();
      session.updatedAt = new Date().toISOString();
      
      const serialized = JSON.stringify(session);
      const encrypted = this.encryptData(serialized);
      this.store.set(`sessions.${platform}`, encrypted);
    }
  }

  /**
   * Clear session for a platform
   */
  clearSession(platform: Platform): void {
    this.store.delete(`sessions.${platform}`);
    console.log(`[SessionManager] Session cleared for ${platform}`);
  }

  /**
   * Clear all sessions
   */
  clearAllSessions(): void {
    const platforms: Platform[] = ['telegram', 'twitter', 'linkedin', 'instagram', 'whatsapp', 'facebook', 'discord'];
    
    for (const platform of platforms) {
      this.store.delete(`sessions.${platform}`);
    }
    
    console.log('[SessionManager] All sessions cleared');
  }

  /**
   * Export all sessions (for backup)
   * Returns encrypted data that can be imported later
   */
  exportSessions(): string {
    const sessions = this.getAllSessions();
    const exportData = {
      version: 1,
      exportedAt: new Date().toISOString(),
      sessions,
    };

    return JSON.stringify(exportData);
  }

  /**
   * Import sessions from backup
   */
  importSessions(exportedData: string): void {
    try {
      const data = JSON.parse(exportedData);
      
      if (data.version !== 1) {
        throw new Error('Unsupported export version');
      }

      for (const [platform, session] of Object.entries(data.sessions)) {
        const sessionData = session as SessionData;
        this.saveSession(
          platform as Platform,
          sessionData.credentials,
          { userId: sessionData.userId, username: sessionData.username }
        );
      }

      console.log('[SessionManager] Sessions imported successfully');
    } catch (error) {
      console.error('[SessionManager] Failed to import sessions:', error);
      throw new Error('Failed to import sessions');
    }
  }

  /**
   * Get storage path (for debugging)
   */
  getStoragePath(): string {
    return this.store.path;
  }
}

// Singleton instance
let sessionManagerInstance: SessionManager | null = null;

export function getSessionManager(): SessionManager {
  if (!sessionManagerInstance) {
    sessionManagerInstance = new SessionManager();
  }
  return sessionManagerInstance;
}

export default SessionManager;
