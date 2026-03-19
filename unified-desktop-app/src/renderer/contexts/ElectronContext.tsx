import React, { createContext, useContext, useEffect, useState, useCallback, ReactNode } from 'react';
import type { 
  Platform, 
  PlatformCredentials, 
  PlatformStatus, 
  Conversation, 
  Message,
  NewMessageEvent,
  ConnectionStatusEvent,
  TypingIndicatorEvent,
  AppSettings,
} from '../../shared/types.js';

interface ElectronContextType {
  // App state
  isElectron: boolean;
  appVersion: string;
  osPlatform: string;
  
  // Platform statuses
  platformStatuses: Record<Platform, PlatformStatus>;
  
  // Conversations & Messages
  conversations: Conversation[];
  isLoadingConversations: boolean;
  
  // Real-time events
  newMessages: NewMessageEvent[];
  typingIndicators: Map<string, TypingIndicatorEvent>;
  
  // Platform operations
  connectPlatform: (platform: Platform, credentials: PlatformCredentials) => Promise<any>;
  disconnectPlatform: (platform: Platform) => Promise<void>;
  refreshPlatformStatus: (platform: Platform) => Promise<void>;
  refreshAllStatuses: () => Promise<void>;
  
  // Data operations
  getConversations: (platform?: Platform) => Promise<Conversation[]>;
  getMessages: (conversationId: string, platform: Platform) => Promise<Message[]>;
  sendMessage: (conversationId: string, platform: Platform, content: string) => Promise<any>;
  markAsRead: (conversationId: string, platform: Platform) => Promise<void>;
  
  // Settings operations
  getSettings: () => Promise<Partial<AppSettings>>;
  updateSetting: (key: string, value: any) => Promise<void>;
  
  // Session operations
  hasValidSession: (platform: Platform) => Promise<boolean>;
  clearSession: (platform: Platform) => Promise<void>;
  clearAllSessions: () => Promise<void>;
  
  // Window operations
  minimizeToTray: () => void;
  quitApp: () => void;
  
  // Utility
  clearNewMessage: (messageId: string) => void;
}

const ElectronContext = createContext<ElectronContextType | undefined>(undefined);

export const useElectron = (): ElectronContextType => {
  const context = useContext(ElectronContext);
  if (!context) {
    throw new Error('useElectron must be used within an ElectronProvider');
  }
  return context;
};

interface ElectronProviderProps {
  children: ReactNode;
}

const ALL_PLATFORMS: Platform[] = ['telegram', 'twitter', 'linkedin', 'instagram', 'whatsapp', 'facebook', 'discord'];

export const ElectronProvider: React.FC<ElectronProviderProps> = ({ children }) => {
  const [isElectron] = useState(() => !!window.electronAPI);
  const [appVersion, setAppVersion] = useState('1.0.0');
  const [osPlatform, setOsPlatform] = useState('');
  const [platformStatuses, setPlatformStatuses] = useState<Record<Platform, PlatformStatus>>({} as Record<Platform, PlatformStatus>);
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [isLoadingConversations, setIsLoadingConversations] = useState(false);
  const [newMessages, setNewMessages] = useState<NewMessageEvent[]>([]);
  const [typingIndicators, setTypingIndicators] = useState<Map<string, TypingIndicatorEvent>>(new Map());

  // Initialize app info and set up event listeners
  useEffect(() => {
    if (!isElectron) return;

    // Get app info
    window.electronAPI.getAppVersion().then(setAppVersion).catch(console.error);
    window.electronAPI.getPlatform().then(setOsPlatform).catch(console.error);

    // Initialize platform statuses
    initializePlatformStatuses();

    // Set up event listeners
    const unsubscribeNewMessage = window.electronAPI.onNewMessage((data: NewMessageEvent) => {
      console.log('[ElectronContext] New message received:', data);
      setNewMessages(prev => [...prev, data]);
      
      // Update conversation list with new message
      setConversations(prev => {
        const updated = [...prev];
        const convIndex = updated.findIndex(c => c.id === data.conversationId);
        if (convIndex >= 0) {
          updated[convIndex] = {
            ...updated[convIndex],
            lastMessage: data.message.content,
            lastMessageAt: data.message.sentAt,
            unreadCount: updated[convIndex].unreadCount + 1,
          };
          // Sort by last message time
          updated.sort((a, b) => new Date(b.lastMessageAt).getTime() - new Date(a.lastMessageAt).getTime());
        }
        return updated;
      });
    });

    const unsubscribeConnectionStatus = window.electronAPI.onConnectionStatus((data: ConnectionStatusEvent) => {
      console.log('[ElectronContext] Connection status changed:', data);
      setPlatformStatuses(prev => ({
        ...prev,
        [data.platform]: {
          ...prev[data.platform],
          platform: data.platform,
          connected: data.status === 'connected',
          error: data.error,
        },
      }));
    });

    const unsubscribeTypingIndicator = window.electronAPI.onTypingIndicator((data: TypingIndicatorEvent) => {
      const key = `${data.platform}_${data.conversationId}_${data.userId}`;
      setTypingIndicators(prev => {
        const updated = new Map(prev);
        if (data.isTyping) {
          updated.set(key, data);
        } else {
          updated.delete(key);
        }
        return updated;
      });
    });

    const unsubscribeSyncAll = window.electronAPI.onSyncAllPlatforms(() => {
      console.log('[ElectronContext] Sync all platforms triggered from tray');
      refreshAllStatuses();
      loadAllConversations();
    });

    const unsubscribeOpenSettings = window.electronAPI.onOpenSettings(() => {
      console.log('[ElectronContext] Open settings triggered from tray');
      // Navigate to settings - this will be handled by the component
      window.dispatchEvent(new CustomEvent('open-settings'));
    });

    const unsubscribeOpenConversation = window.electronAPI.onOpenConversation((data) => {
      console.log('[ElectronContext] Open conversation triggered from notification:', data);
      // Dispatch event to open the conversation
      window.dispatchEvent(new CustomEvent('open-conversation', { detail: data }));
    });

    // WhatsApp chats updated listener
    const unsubscribeWhatsAppChats = window.electronAPI.whatsapp.onChatsUpdated((data) => {
      console.log('[ElectronContext] WhatsApp chats updated:', data.conversations.length);
      setConversations(prev => {
        // Remove old whatsapp conversations and add new ones
        const nonWhatsApp = prev.filter(c => c.platform !== 'whatsapp');
        return [...nonWhatsApp, ...data.conversations];
      });
    });

    return () => {
      unsubscribeNewMessage();
      unsubscribeConnectionStatus();
      unsubscribeTypingIndicator();
      unsubscribeSyncAll();
      unsubscribeOpenSettings();
      unsubscribeOpenConversation();
      unsubscribeWhatsAppChats();
    };
  }, [isElectron]);

  const initializePlatformStatuses = async () => {
    if (!isElectron) return;
    
    try {
      const statuses = await window.electronAPI.platform.getAllStatuses();
      setPlatformStatuses(statuses);
    } catch (error) {
      console.error('[ElectronContext] Failed to get platform statuses:', error);
      // Initialize with disconnected status for all platforms
      const defaultStatuses: Record<Platform, PlatformStatus> = {} as Record<Platform, PlatformStatus>;
      ALL_PLATFORMS.forEach(p => {
        defaultStatuses[p] = { platform: p, connected: false };
      });
      setPlatformStatuses(defaultStatuses);
    }
  };

  const loadAllConversations = async () => {
    if (!isElectron) return;
    
    setIsLoadingConversations(true);
    try {
      const convs = await window.electronAPI.data.getConversations();
      setConversations(convs);
    } catch (error) {
      console.error('[ElectronContext] Failed to load conversations:', error);
    } finally {
      setIsLoadingConversations(false);
    }
  };

  // Platform operations
  const connectPlatform = useCallback(async (platform: Platform, credentials: PlatformCredentials) => {
    if (!isElectron) {
      console.warn('[ElectronContext] Not running in Electron');
      return null;
    }
    
    try {
      const result = await window.electronAPI.platform.connect(platform, credentials);
      
      if (result.success) {
        setPlatformStatuses(prev => ({
          ...prev,
          [platform]: { 
            platform, 
            connected: true, 
            lastSync: new Date().toISOString(),
            userId: result.userId,
            username: result.username,
          },
        }));
        
        // Refresh conversations after connecting
        loadAllConversations();
      }
      
      return result;
    } catch (error) {
      setPlatformStatuses(prev => ({
        ...prev,
        [platform]: { platform, connected: false, error: String(error) },
      }));
      throw error;
    }
  }, [isElectron]);

  const disconnectPlatform = useCallback(async (platform: Platform) => {
    if (!isElectron) return;
    
    await window.electronAPI.platform.disconnect(platform);
    setPlatformStatuses(prev => ({
      ...prev,
      [platform]: { platform, connected: false },
    }));
    
    // Remove conversations for this platform
    setConversations(prev => prev.filter(c => c.platform !== platform));
  }, [isElectron]);

  const refreshPlatformStatus = useCallback(async (platform: Platform) => {
    if (!isElectron) return;
    
    try {
      const status = await window.electronAPI.platform.getStatus(platform);
      setPlatformStatuses(prev => ({
        ...prev,
        [platform]: status,
      }));
    } catch (error) {
      console.error(`[ElectronContext] Failed to refresh ${platform} status:`, error);
    }
  }, [isElectron]);

  const refreshAllStatuses = useCallback(async () => {
    if (!isElectron) return;
    await initializePlatformStatuses();
  }, [isElectron]);

  // Data operations
  const getConversations = useCallback(async (platform?: Platform): Promise<Conversation[]> => {
    if (!isElectron) return [];
    
    try {
      const convs = await window.electronAPI.data.getConversations(platform);
      
      // Update local state if fetching all
      if (!platform) {
        setConversations(convs);
      }
      
      return convs;
    } catch (error) {
      console.error('[ElectronContext] Failed to get conversations:', error);
      return [];
    }
  }, [isElectron]);

  const getMessages = useCallback(async (conversationId: string, platform: Platform): Promise<Message[]> => {
    if (!isElectron) return [];
    
    try {
      return await window.electronAPI.data.getMessages(conversationId, platform);
    } catch (error) {
      console.error('[ElectronContext] Failed to get messages:', error);
      return [];
    }
  }, [isElectron]);

  const sendMessage = useCallback(async (conversationId: string, platform: Platform, content: string) => {
    console.log('[ElectronContext] sendMessage called:', conversationId, platform, content.substring(0, 30));
    
    if (!isElectron) {
      console.log('[ElectronContext] Not in Electron!');
      return null;
    }
    
    console.log('[ElectronContext] Calling window.electronAPI.data.sendMessage...');
    const result = await window.electronAPI.data.sendMessage(conversationId, platform, content);
    console.log('[ElectronContext] sendMessage result:', result);
    return result;
  }, [isElectron]);

  const markAsRead = useCallback(async (conversationId: string, platform: Platform) => {
    if (!isElectron) return;
    
    await window.electronAPI.data.markAsRead(conversationId, platform);
    
    // Update local state
    setConversations(prev => {
      const updated = [...prev];
      const convIndex = updated.findIndex(c => c.id === conversationId);
      if (convIndex >= 0) {
        updated[convIndex] = { ...updated[convIndex], unreadCount: 0 };
      }
      return updated;
    });
  }, [isElectron]);

  // Settings operations
  const getSettings = useCallback(async (): Promise<Partial<AppSettings>> => {
    if (!isElectron) return {};
    return await window.electronAPI.settings.getAll();
  }, [isElectron]);

  const updateSetting = useCallback(async (key: string, value: any) => {
    if (!isElectron) return;
    await window.electronAPI.settings.set(key, value);
  }, [isElectron]);

  // Session operations
  const hasValidSession = useCallback(async (platform: Platform): Promise<boolean> => {
    if (!isElectron) return false;
    return await window.electronAPI.session.hasValid(platform);
  }, [isElectron]);

  const clearSession = useCallback(async (platform: Platform) => {
    if (!isElectron) return;
    await window.electronAPI.session.clear(platform);
  }, [isElectron]);

  const clearAllSessions = useCallback(async () => {
    if (!isElectron) return;
    await window.electronAPI.session.clearAll();
  }, [isElectron]);

  // Window operations
  const minimizeToTray = useCallback(() => {
    if (isElectron) {
      window.electronAPI.minimizeToTray();
    }
  }, [isElectron]);

  const quitApp = useCallback(() => {
    if (isElectron) {
      window.electronAPI.quitApp();
    }
  }, [isElectron]);

  // Utility
  const clearNewMessage = useCallback((messageId: string) => {
    setNewMessages(prev => prev.filter(m => m.message.id !== messageId));
  }, []);

  return (
    <ElectronContext.Provider
      value={{
        isElectron,
        appVersion,
        osPlatform,
        platformStatuses,
        conversations,
        isLoadingConversations,
        newMessages,
        typingIndicators,
        connectPlatform,
        disconnectPlatform,
        refreshPlatformStatus,
        refreshAllStatuses,
        getConversations,
        getMessages,
        sendMessage,
        markAsRead,
        getSettings,
        updateSetting,
        hasValidSession,
        clearSession,
        clearAllSessions,
        minimizeToTray,
        quitApp,
        clearNewMessage,
      }}
    >
      {children}
    </ElectronContext.Provider>
  );
};
