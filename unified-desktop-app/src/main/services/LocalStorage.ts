import Store from 'electron-store';
import type { 
  Platform, 
  Conversation, 
  Message,
  AppSettings 
} from '../../shared/types.js';

/**
 * Local Storage Service
 * Provides persistent storage for conversations, messages, and settings
 * Uses electron-store for cross-platform storage
 */

// Storage schema
interface StorageSchema {
  // Conversations cache
  conversations: Record<string, Conversation>;
  
  // Messages cache (keyed by conversationId)
  messages: Record<string, Message[]>;
  
  // App settings
  settings: AppSettings;
  
  // Last sync timestamps per platform
  lastSync: Record<Platform, string>;
  
  // Export metadata
  exportMetadata: {
    lastExport: string | null;
    version: string;
  };
  
  // Security data (stored separately from settings)
  securityData: {
    passwordHash: string | null;
  };
}

// Default settings
const DEFAULT_SETTINGS: AppSettings = {
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

export class LocalStorage {
  private store: Store<StorageSchema>;

  constructor() {
    this.store = new Store<StorageSchema>({
      name: 'chat-orbitor-data',
      defaults: {
        conversations: {},
        messages: {},
        settings: DEFAULT_SETTINGS,
        lastSync: {} as Record<Platform, string>,
        exportMetadata: {
          lastExport: null,
          version: '1.0.0',
        },
        securityData: {
          passwordHash: null,
        },
      },
    });
  }

  // ============================================
  // Conversation Methods
  // ============================================

  /**
   * Save a conversation to storage
   */
  saveConversation(conversation: Conversation): void {
    const conversations = this.store.get('conversations', {});
    conversations[conversation.id] = conversation;
    this.store.set('conversations', conversations);
  }

  /**
   * Save multiple conversations
   */
  saveConversations(conversationList: Conversation[]): void {
    const conversations = this.store.get('conversations', {});
    for (const conv of conversationList) {
      conversations[conv.id] = conv;
    }
    this.store.set('conversations', conversations);
  }

  /**
   * Get a conversation by ID
   */
  getConversation(conversationId: string): Conversation | null {
    const conversations = this.store.get('conversations', {});
    return conversations[conversationId] || null;
  }

  /**
   * Get all conversations
   */
  getAllConversations(): Conversation[] {
    const conversations = this.store.get('conversations', {});
    return Object.values(conversations);
  }

  /**
   * Get conversations for a specific platform
   */
  getPlatformConversations(platform: Platform): Conversation[] {
    const conversations = this.store.get('conversations', {});
    return Object.values(conversations).filter(conv => conv.platform === platform);
  }

  /**
   * Delete a conversation
   */
  deleteConversation(conversationId: string): void {
    const conversations = this.store.get('conversations', {});
    delete conversations[conversationId];
    this.store.set('conversations', conversations);
    
    // Also delete associated messages
    this.deleteMessages(conversationId);
  }

  /**
   * Clear all conversations for a platform
   */
  clearPlatformConversations(platform: Platform): void {
    const conversations = this.store.get('conversations', {});
    const filtered: Record<string, Conversation> = {};
    
    for (const [id, conv] of Object.entries(conversations)) {
      if (conv.platform !== platform) {
        filtered[id] = conv;
      } else {
        // Delete associated messages
        this.deleteMessages(id);
      }
    }
    
    this.store.set('conversations', filtered);
  }

  /**
   * Clear all conversations
   */
  clearAllConversations(): void {
    this.store.set('conversations', {});
    this.store.set('messages', {});
  }

  // ============================================
  // Message Methods
  // ============================================

  /**
   * Save messages for a conversation
   */
  saveMessages(conversationId: string, messageList: Message[]): void {
    const messages = this.store.get('messages', {});
    messages[conversationId] = messageList;
    this.store.set('messages', messages);
  }

  /**
   * Append a message to a conversation
   */
  appendMessage(conversationId: string, message: Message): void {
    const messages = this.store.get('messages', {});
    if (!messages[conversationId]) {
      messages[conversationId] = [];
    }
    
    // Check if message already exists
    const exists = messages[conversationId].some(m => m.id === message.id);
    if (!exists) {
      messages[conversationId].push(message);
      this.store.set('messages', messages);
    }
  }

  /**
   * Get messages for a conversation
   */
  getMessages(conversationId: string): Message[] {
    const messages = this.store.get('messages', {});
    return messages[conversationId] || [];
  }

  /**
   * Delete messages for a conversation
   */
  deleteMessages(conversationId: string): void {
    const messages = this.store.get('messages', {});
    delete messages[conversationId];
    this.store.set('messages', messages);
  }

  /**
   * Clear all messages for a platform
   */
  clearPlatformMessages(platform: Platform): void {
    const conversations = this.getPlatformConversations(platform);
    const messages = this.store.get('messages', {});
    
    for (const conv of conversations) {
      delete messages[conv.id];
    }
    
    this.store.set('messages', messages);
  }

  // ============================================
  // Settings Methods
  // ============================================

  /**
   * Get all settings
   */
  getSettings(): AppSettings {
    return this.store.get('settings', DEFAULT_SETTINGS);
  }

  /**
   * Get a specific setting
   */
  getSetting<K extends keyof AppSettings>(key: K): AppSettings[K] {
    const settings = this.store.get('settings', DEFAULT_SETTINGS);
    return settings[key];
  }

  /**
   * Set a specific setting
   */
  setSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): void {
    const settings = this.store.get('settings', DEFAULT_SETTINGS);
    settings[key] = value;
    this.store.set('settings', settings);
  }

  /**
   * Update multiple settings
   */
  updateSettings(updates: Partial<AppSettings>): void {
    const settings = this.store.get('settings', DEFAULT_SETTINGS);
    const updated = { ...settings, ...updates };
    this.store.set('settings', updated);
  }

  /**
   * Reset settings to defaults
   */
  resetSettings(): void {
    this.store.set('settings', DEFAULT_SETTINGS);
  }

  // ============================================
  // Security / Password Methods
  // ============================================

  /**
   * Get stored password hash
   */
  getPasswordHash(): string | null {
    const securityData = this.store.get('securityData', { passwordHash: null });
    return securityData.passwordHash;
  }

  /**
   * Set password hash
   */
  setPasswordHash(hash: string | null): void {
    this.store.set('securityData', { passwordHash: hash });
  }

  // ============================================
  // Sync Timestamp Methods
  // ============================================

  /**
   * Update last sync timestamp for a platform
   */
  updateLastSync(platform: Platform): void {
    const lastSync = this.store.get('lastSync', {} as Record<Platform, string>);
    lastSync[platform] = new Date().toISOString();
    this.store.set('lastSync', lastSync);
  }

  /**
   * Get last sync timestamp for a platform
   */
  getLastSync(platform: Platform): string | null {
    const lastSync = this.store.get('lastSync', {} as Record<Platform, string>);
    return lastSync[platform] || null;
  }

  /**
   * Get all last sync timestamps
   */
  getAllLastSync(): Record<Platform, string> {
    return this.store.get('lastSync', {} as Record<Platform, string>);
  }


  // ============================================
  // Export/Import Methods
  // ============================================

  /**
   * Export all data to JSON string
   */
  exportData(): string {
    const exportData = {
      version: '1.0.0',
      exportedAt: new Date().toISOString(),
      data: {
        conversations: this.store.get('conversations', {}),
        messages: this.store.get('messages', {}),
        settings: this.store.get('settings', DEFAULT_SETTINGS),
        lastSync: this.store.get('lastSync', {} as Record<Platform, string>),
      },
    };
    
    // Update export metadata
    this.store.set('exportMetadata', {
      lastExport: exportData.exportedAt,
      version: exportData.version,
    });
    
    return JSON.stringify(exportData, null, 2);
  }

  /**
   * Import data from JSON string
   */
  importData(jsonString: string): { success: boolean; error?: string; stats?: { conversations: number; messages: number } } {
    try {
      const importData = JSON.parse(jsonString);
      
      // Validate structure
      if (!importData.version || !importData.data) {
        return { success: false, error: 'Invalid export file format' };
      }
      
      // Import conversations
      if (importData.data.conversations) {
        const existingConversations = this.store.get('conversations', {});
        const merged = { ...existingConversations, ...importData.data.conversations };
        this.store.set('conversations', merged);
      }
      
      // Import messages
      if (importData.data.messages) {
        const existingMessages = this.store.get('messages', {});
        const merged = { ...existingMessages, ...importData.data.messages };
        this.store.set('messages', merged);
      }
      
      // Import settings (optional - don't overwrite by default)
      // if (importData.data.settings) {
      //   this.store.set('settings', importData.data.settings);
      // }
      
      // Import lastSync
      if (importData.data.lastSync) {
        const existingLastSync = this.store.get('lastSync', {} as Record<Platform, string>);
        const merged = { ...existingLastSync, ...importData.data.lastSync };
        this.store.set('lastSync', merged);
      }
      
      const conversationCount = Object.keys(importData.data.conversations || {}).length;
      const messageCount = Object.values(importData.data.messages || {}).reduce(
        (sum: number, msgs: any) => sum + (Array.isArray(msgs) ? msgs.length : 0), 0
      ) as number;
      
      return { 
        success: true, 
        stats: { 
          conversations: conversationCount, 
          messages: messageCount 
        } 
      };
    } catch (error: any) {
      return { success: false, error: `Import failed: ${error.message}` };
    }
  }

  /**
   * Get export metadata
   */
  getExportMetadata(): { lastExport: string | null; version: string } {
    return this.store.get('exportMetadata', { lastExport: null, version: '1.0.0' });
  }

  // ============================================
  // Platform Logout / Data Clearing
  // ============================================

  /**
   * Clear all data for a specific platform
   * Called when user logs out of a platform
   */
  clearPlatformData(platform: Platform): void {
    console.log(`[LocalStorage] Clearing data for ${platform}`);
    
    // Clear conversations
    this.clearPlatformConversations(platform);
    
    // Clear messages (already done in clearPlatformConversations)
    
    // Clear last sync
    const lastSync = this.store.get('lastSync', {} as Record<Platform, string>);
    delete lastSync[platform];
    this.store.set('lastSync', lastSync);
    
    console.log(`[LocalStorage] Data cleared for ${platform}`);
  }

  /**
   * Clear all cached data (conversations and messages)
   * Keeps settings and sessions
   */
  clearAllCachedData(): void {
    console.log('[LocalStorage] Clearing all cached data');
    this.store.set('conversations', {});
    this.store.set('messages', {});
    this.store.set('lastSync', {});
    console.log('[LocalStorage] All cached data cleared');
  }

  /**
   * Factory reset - clear everything
   */
  factoryReset(): void {
    console.log('[LocalStorage] Factory reset');
    this.store.clear();
    console.log('[LocalStorage] Factory reset complete');
  }

  // ============================================
  // Utility Methods
  // ============================================

  /**
   * Get storage statistics
   */
  getStats(): { 
    conversationCount: number; 
    messageCount: number; 
    platforms: Platform[];
    storageSize: string;
  } {
    const conversations = this.store.get('conversations', {});
    const messages = this.store.get('messages', {});
    
    const conversationCount = Object.keys(conversations).length;
    const messageCount = Object.values(messages).reduce(
      (sum, msgs) => sum + msgs.length, 0
    );
    
    // Get unique platforms
    const platforms = [...new Set(
      Object.values(conversations).map(conv => conv.platform)
    )] as Platform[];
    
    // Estimate storage size
    const dataString = JSON.stringify(this.store.store);
    const sizeBytes = new Blob([dataString]).size;
    const storageSize = this.formatBytes(sizeBytes);
    
    return { conversationCount, messageCount, platforms, storageSize };
  }

  /**
   * Format bytes to human readable string
   */
  private formatBytes(bytes: number): string {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  }

  /**
   * Get the underlying store path
   */
  getStorePath(): string {
    return this.store.path;
  }
}

// Export singleton instance
let localStorage: LocalStorage | null = null;

export function getLocalStorage(): LocalStorage {
  if (!localStorage) {
    localStorage = new LocalStorage();
  }
  return localStorage;
}
