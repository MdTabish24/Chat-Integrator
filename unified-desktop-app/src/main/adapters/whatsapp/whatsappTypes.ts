/**
 * WhatsApp Type Definitions
 * Normalizes Baileys internal types to app's unified data model
 */

import type { Platform, Conversation, Message } from '../../../shared/types.js';

// Connection states
export type ConnectionState = 
  | 'OFFLINE' 
  | 'CONNECTING' 
  | 'QR_GENERATED' 
  | 'CONNECTED' 
  | 'DISCONNECTING';

// Session data structure
export interface SessionState {
  creds: any;
  keys: any;
  lastConnected?: number;
  phoneNumber?: string;
}

// Normalized chat from Baileys
export interface WhatsAppChat {
  id: string;
  name: string;
  isGroup: boolean;
  unreadCount: number;
  lastMessageTime: number;
  lastMessage?: string;
  participantCount?: number;
  profilePicUrl?: string;
}

// Normalized contact from Baileys
export interface WhatsAppContact {
  id: string;
  name?: string;
  pushName?: string;
  phoneNumber?: string;
  profilePicUrl?: string;
  isMyContact: boolean;
}

// Normalized message from Baileys
export interface WhatsAppMessage {
  id: string;
  chatId: string;
  senderId: string;
  senderName: string;
  content: string;
  timestamp: number;
  isOutgoing: boolean;
  isRead: boolean;
  hasMedia: boolean;
  mediaType?: 'image' | 'video' | 'audio' | 'document' | 'sticker';
  mediaKey?: string;
  quotedMessageId?: string;
  quotedContent?: string;
}

// Event payloads
export interface QRCodeEvent {
  qrCode: string;
}

export interface ConnectionEvent {
  state: ConnectionState;
  message?: string;
  phoneNumber?: string;
}

export interface NewMessageEvent {
  platform: Platform;
  conversationId: string;
  message: Message;
}

// Convert WhatsAppChat to app's Conversation
export function toConversation(chat: WhatsAppChat): Conversation {
  return {
    id: `whatsapp_${chat.id}`,
    platform: 'whatsapp',
    platformConversationId: chat.id,
    participantName: chat.name,
    participantId: chat.id,
    participantAvatarUrl: chat.profilePicUrl,
    lastMessage: chat.lastMessage || '',
    lastMessageAt: new Date(chat.lastMessageTime).toISOString(),
    unreadCount: chat.unreadCount,
  };
}

// Convert WhatsAppMessage to app's Message
export function toMessage(msg: WhatsAppMessage, chatId: string): Message {
  return {
    id: msg.id,
    conversationId: `whatsapp_${chatId}`,
    platformMessageId: msg.id,
    senderId: msg.senderId,
    senderName: msg.senderName,
    content: msg.content,
    messageType: msg.hasMedia ? 'file' : 'text',
    mediaUrl: undefined,
    isOutgoing: msg.isOutgoing,
    isRead: msg.isRead,
    sentAt: new Date(msg.timestamp).toISOString(),
  };
}
