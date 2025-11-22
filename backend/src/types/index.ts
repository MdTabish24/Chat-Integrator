export type Platform = 'telegram' | 'twitter' | 'linkedin' | 'instagram' | 'whatsapp' | 'facebook' | 'teams';

export interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface ConnectedAccount {
  id: string;
  userId: string;
  platform: Platform;
  platformUserId: string;
  platformUsername: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface Conversation {
  id: string;
  accountId: string;
  platformConversationId: string;
  participantName: string;
  participantId: string;
  participantAvatarUrl?: string;
  lastMessageAt: Date;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
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
  sentAt: Date;
  deliveredAt?: Date;
  createdAt: Date;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    retryable: boolean;
  };
}

// Auth types
export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
}

export interface JWTPayload {
  userId: string;
  email: string;
}

export interface RefreshToken {
  id: string;
  userId: string;
  token: string;
  expiresAt: Date;
  createdAt: Date;
  revokedAt?: Date;
}

// WebSocket event payloads
export interface NewMessageEvent {
  message: Message;
  conversation?: Conversation;
  timestamp: string;
}

export interface MessageStatusUpdateEvent {
  messageId: string;
  conversationId: string;
  status: 'read' | 'delivered';
  timestamp: string;
}

export interface UnreadCountUpdateEvent {
  unreadCounts: Record<Platform, number>;
  totalUnread: number;
  timestamp: string;
}

export interface ConversationUpdateEvent {
  conversation: Conversation;
  timestamp: string;
}
