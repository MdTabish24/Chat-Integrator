// Re-export shared types for main process
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
  SessionData,
  SendMessageRequest,
  SendMessageResponse,
} from '../../shared/types.js';

// Main process specific types
export interface SyncResult {
  platform: import('../../shared/types.js').Platform;
  success: boolean;
  conversationsCount?: number;
  messagesCount?: number;
  error?: string;
}

export interface PlatformAdapter {
  platform: import('../../shared/types.js').Platform;
  connect(credentials: import('../../shared/types.js').PlatformCredentials): Promise<void>;
  disconnect(): Promise<void>;
  isConnected(): boolean;
  fetchConversations(): Promise<import('../../shared/types.js').Conversation[]>;
  fetchMessages(conversationId: string): Promise<import('../../shared/types.js').Message[]>;
  sendMessage(conversationId: string, content: string): Promise<import('../../shared/types.js').SendMessageResponse>;
  startRealTime?(): void;
  stopRealTime?(): void;
}
