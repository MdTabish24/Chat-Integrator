export type Platform = 'telegram' | 'twitter' | 'twitter-dm' | 'linkedin' | 'linkedin-dm' | 'instagram' | 'whatsapp' | 'facebook' | 'teams' | 'discord' | 'gmail';

export interface User {
  id: string;
  email: string;
  createdAt: string;
  updatedAt: string;
}

export interface ConnectedAccount {
  id: string;
  userId: string;
  platform: Platform;
  platformUserId: string;
  platformUsername: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Conversation {
  id: string;
  accountId: string;
  platformConversationId: string;
  participantName: string;
  participantId: string;
  participantAvatarUrl?: string;
  lastMessageAt: string;
  unreadCount: number;
  createdAt: string;
  updatedAt: string;
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
  deliveredAt?: string;
  createdAt: string;
}

export interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    retryable: boolean;
  };
}

export interface PlatformConfig {
  id: Platform;
  name: string;
  icon: string;
  color: string;
}
