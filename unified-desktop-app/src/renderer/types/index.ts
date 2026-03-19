// Re-export shared types for renderer
export type { 
  Platform, 
  Conversation, 
  Message, 
  PlatformCredentials, 
  PlatformStatus,
  NewMessageEvent,
  ConnectionStatusEvent,
  TypingIndicatorEvent,
  AppSettings,
  IPCResponse,
  ElectronAPI,
} from '../../shared/types.js';

// Renderer-specific types
export interface PlatformData {
  platform: import('../../shared/types.js').Platform;
  name: string;
  icon: string;
  color: string;
  unreadCount: number;
  conversations: import('../../shared/types.js').Conversation[];
  isExpanded: boolean;
  isLoading: boolean;
  isConnected: boolean;
  error?: string;
}

export interface ChatTab {
  id: string;
  conversationId: string;
  platform: import('../../shared/types.js').Platform;
  participantName: string;
  participantAvatarUrl?: string;
}

export interface PlatformConfig {
  id: import('../../shared/types.js').Platform;
  name: string;
  icon: string;
  color: string;
}

export interface ConnectedAccount {
  platform: import('../../shared/types.js').Platform;
  username: string;
  isConnected: boolean;
  lastSync?: Date;
}
