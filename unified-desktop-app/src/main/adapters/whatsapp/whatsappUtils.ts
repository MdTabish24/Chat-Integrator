/**
 * WhatsApp Utility Functions
 * Session encryption, message parsing, error recovery
 */

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'crypto';
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import path from 'path';
import { app } from 'electron';
import type { SessionState, WhatsAppMessage, WhatsAppChat } from './whatsappTypes.js';

const ENCRYPTION_KEY = 'chat-orbitor-whatsapp-session-key-2024';
const ALGORITHM = 'aes-256-gcm';

/**
 * Get session file path
 */
export function getSessionPath(): string {
  const sessionsDir = path.join(app.getPath('userData'), 'sessions');
  if (!existsSync(sessionsDir)) {
    mkdirSync(sessionsDir, { recursive: true });
  }
  return path.join(sessionsDir, 'whatsapp_baileys.enc');
}

/**
 * Encrypt and save session data
 */
export function saveSession(session: SessionState): void {
  try {
    const sessionPath = getSessionPath();
    const data = JSON.stringify(session);
    
    const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = randomBytes(16);
    
    const cipher = createCipheriv(ALGORITHM, key, iv);
    let encrypted = cipher.update(data, 'utf8', 'hex');
    encrypted += cipher.final('hex');
    const authTag = cipher.getAuthTag();
    
    const payload = {
      iv: iv.toString('hex'),
      authTag: authTag.toString('hex'),
      data: encrypted,
    };
    
    writeFileSync(sessionPath, JSON.stringify(payload), 'utf8');
    console.log('[WhatsAppUtils] Session saved successfully');
  } catch (error: any) {
    console.error('[WhatsAppUtils] Failed to save session:', error.message);
  }
}

/**
 * Load and decrypt session data
 */
export function loadSession(): SessionState | null {
  try {
    const sessionPath = getSessionPath();
    
    if (!existsSync(sessionPath)) {
      return null;
    }
    
    const payload = JSON.parse(readFileSync(sessionPath, 'utf8'));
    const key = scryptSync(ENCRYPTION_KEY, 'salt', 32);
    const iv = Buffer.from(payload.iv, 'hex');
    const authTag = Buffer.from(payload.authTag, 'hex');
    
    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    
    let decrypted = decipher.update(payload.data, 'hex', 'utf8');
    decrypted += decipher.final('utf8');
    
    return JSON.parse(decrypted);
  } catch (error: any) {
    console.error('[WhatsAppUtils] Failed to load session:', error.message);
    return null;
  }
}

/**
 * Clear saved session
 */
export function clearSession(): void {
  try {
    const sessionPath = getSessionPath();
    if (existsSync(sessionPath)) {
      const fs = require('fs');
      fs.unlinkSync(sessionPath);
    }
  } catch (error: any) {
    console.error('[WhatsAppUtils] Failed to clear session:', error.message);
  }
}

/**
 * Extract text content from Baileys message object
 * Handles all message types including protocol buffer format
 */
function extractMessageContent(messageContent: any): { content: string; hasMedia: boolean; mediaType?: WhatsAppMessage['mediaType'] } {
  if (!messageContent) {
    return { content: '', hasMedia: false };
  }

  // Direct conversation text
  if (messageContent.conversation) {
    return { content: messageContent.conversation, hasMedia: false };
  }

  // Extended text message (with mentions, links, etc)
  if (messageContent.extendedTextMessage?.text) {
    return { content: messageContent.extendedTextMessage.text, hasMedia: false };
  }

  // Image message
  if (messageContent.imageMessage) {
    return { 
      content: messageContent.imageMessage.caption || '📷 Photo', 
      hasMedia: true, 
      mediaType: 'image' 
    };
  }

  // Video message
  if (messageContent.videoMessage) {
    return { 
      content: messageContent.videoMessage.caption || '🎥 Video', 
      hasMedia: true, 
      mediaType: 'video' 
    };
  }

  // Audio/Voice message
  if (messageContent.audioMessage) {
    const isVoice = messageContent.audioMessage.ptt;
    return { 
      content: isVoice ? '🎤 Voice message' : '🎵 Audio', 
      hasMedia: true, 
      mediaType: 'audio' 
    };
  }

  // Document
  if (messageContent.documentMessage) {
    return { 
      content: `📄 ${messageContent.documentMessage.fileName || 'Document'}`, 
      hasMedia: true, 
      mediaType: 'document' 
    };
  }

  // Sticker
  if (messageContent.stickerMessage) {
    return { content: '🎭 Sticker', hasMedia: true, mediaType: 'sticker' };
  }

  // Contact card
  if (messageContent.contactMessage) {
    return { content: `👤 Contact: ${messageContent.contactMessage.displayName || 'Contact'}`, hasMedia: false };
  }

  // Location
  if (messageContent.locationMessage) {
    return { content: '📍 Location', hasMedia: false };
  }

  // Live location
  if (messageContent.liveLocationMessage) {
    return { content: '📍 Live Location', hasMedia: false };
  }

  // Poll
  if (messageContent.pollCreationMessage || messageContent.pollCreationMessageV3) {
    const poll = messageContent.pollCreationMessage || messageContent.pollCreationMessageV3;
    return { content: `📊 Poll: ${poll.name || 'Poll'}`, hasMedia: false };
  }

  // Reaction
  if (messageContent.reactionMessage) {
    return { content: messageContent.reactionMessage.text || '👍', hasMedia: false };
  }

  // Protocol message (read receipts, etc) - skip these
  if (messageContent.protocolMessage) {
    return { content: '', hasMedia: false };
  }

  // Sender key distribution - skip
  if (messageContent.senderKeyDistributionMessage) {
    return { content: '', hasMedia: false };
  }

  // Message context info only - skip
  if (messageContent.messageContextInfo && Object.keys(messageContent).length === 1) {
    return { content: '', hasMedia: false };
  }

  // View once image/video
  if (messageContent.viewOnceMessage || messageContent.viewOnceMessageV2) {
    const inner = messageContent.viewOnceMessage?.message || messageContent.viewOnceMessageV2?.message;
    if (inner?.imageMessage) {
      return { content: '📷 View once photo', hasMedia: true, mediaType: 'image' };
    }
    if (inner?.videoMessage) {
      return { content: '🎥 View once video', hasMedia: true, mediaType: 'video' };
    }
    return { content: '👁️ View once message', hasMedia: true };
  }

  // Ephemeral message wrapper
  if (messageContent.ephemeralMessage?.message) {
    return extractMessageContent(messageContent.ephemeralMessage.message);
  }

  // Button response
  if (messageContent.buttonsResponseMessage) {
    return { content: messageContent.buttonsResponseMessage.selectedDisplayText || 'Button response', hasMedia: false };
  }

  // List response
  if (messageContent.listResponseMessage) {
    return { content: messageContent.listResponseMessage.title || 'List response', hasMedia: false };
  }

  // Template button reply
  if (messageContent.templateButtonReplyMessage) {
    return { content: messageContent.templateButtonReplyMessage.selectedDisplayText || 'Button reply', hasMedia: false };
  }

  // If we have any text-like content, try to extract it
  const keys = Object.keys(messageContent);
  for (const key of keys) {
    const val = messageContent[key];
    if (val && typeof val === 'object') {
      if (val.text) return { content: val.text, hasMedia: false };
      if (val.caption) return { content: val.caption, hasMedia: true };
      if (val.conversation) return { content: val.conversation, hasMedia: false };
    }
  }

  // Unknown but has content - don't show [Message]
  return { content: '', hasMedia: false };
}

/**
 * Parse Baileys message to normalized format
 */
export function parseMessage(msg: any, myJid: string): WhatsAppMessage | null {
  try {
    const key = msg.key;
    const messageContent = msg.message;
    
    if (!key) return null;
    if (!messageContent) return null;
    
    // SKIP reactions - they're not real messages
    if (messageContent.reactionMessage) return null;
    
    const { content, hasMedia, mediaType } = extractMessageContent(messageContent);
    if (!content) return null;
    
    const isOutgoing = key.fromMe || false;
    const chatId = key.remoteJid || '';
    if (chatId === 'status@broadcast') return null;
    
    const senderId = isOutgoing ? myJid : (key.participant || chatId);
    
    // Get sender name from pushName or contact
    let senderName = 'Unknown';
    if (isOutgoing) {
      senderName = 'You';
    } else if (msg.pushName) {
      senderName = msg.pushName;
    } else {
      // Extract phone number from JID
      senderName = senderId.split('@')[0]?.split(':')[0] || 'Unknown';
    }
    
    return {
      id: key.id || `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
      chatId,
      senderId,
      senderName,
      content,
      timestamp: (msg.messageTimestamp || Math.floor(Date.now() / 1000)) * 1000,
      isOutgoing,
      isRead: false,
      hasMedia,
      mediaType,
      quotedMessageId: messageContent.extendedTextMessage?.contextInfo?.stanzaId,
      quotedContent: messageContent.extendedTextMessage?.contextInfo?.quotedMessage?.conversation,
    };
  } catch (error: any) {
    console.error('[WhatsAppUtils] Failed to parse message:', error.message);
    return null;
  }
}

/**
 * Parse Baileys chat to normalized format
 */
export function parseChat(chat: any): WhatsAppChat {
  const id = chat.id || '';
  const isGroup = id.endsWith('@g.us');
  
  // Get name from various sources
  let name = chat.name || chat.subject || chat.notify || '';
  if (!name && !isGroup) {
    // For individual chats, use phone number
    name = id.split('@')[0]?.split(':')[0] || 'Unknown';
  }
  if (!name) {
    name = 'Unknown';
  }
  
  // Get last message content - try multiple sources
  let lastMessage = '';
  if (chat.lastMessage?.message) {
    const { content } = extractMessageContent(chat.lastMessage.message);
    lastMessage = content;
  } else if (chat.lastMessageContent) {
    lastMessage = chat.lastMessageContent;
  }
  
  // Get timestamp - use the most recent available
  let timestamp = Date.now();
  if (chat.conversationTimestamp) {
    timestamp = chat.conversationTimestamp * 1000;
  } else if (chat.lastMessageRecvTimestamp) {
    timestamp = chat.lastMessageRecvTimestamp * 1000;
  } else if (chat.lastMessage?.messageTimestamp) {
    timestamp = chat.lastMessage.messageTimestamp * 1000;
  }
  
  return {
    id,
    name,
    isGroup,
    unreadCount: chat.unreadCount || 0,
    lastMessageTime: timestamp,
    lastMessage,
    participantCount: isGroup ? (chat.participants?.length || 0) : undefined,
  };
}

/**
 * Calculate exponential backoff delay
 */
export function getBackoffDelay(attempt: number, maxDelay: number = 30000): number {
  const delay = Math.min(Math.pow(2, attempt) * 1000, maxDelay);
  return delay + Math.random() * 1000;
}

/**
 * Check if error requires fresh QR scan
 */
export function requiresFreshAuth(error: any): boolean {
  const code = error?.output?.statusCode || error?.statusCode;
  return code === 401 || code === 410 || error?.message?.includes('logged out');
}
