/**
 * Platform Adapters Index
 * Export all platform adapters from a single location
 */

export { TwitterAdapter, getTwitterAdapter } from './TwitterAdapter.js';
export { InstagramAdapter, getInstagramAdapter } from './InstagramAdapter.js';
export { FacebookAdapter, getFacebookAdapter } from './FacebookAdapter.js';
export { LinkedInAdapter, getLinkedInAdapter } from './LinkedInAdapter.js';
// Use Baileys adapter for WhatsApp (fast, socket-based)
export { WhatsAppBaileysAdapter as WhatsAppAdapter, getWhatsAppBaileysAdapter as getWhatsAppAdapter } from './whatsapp/WhatsAppBaileysAdapter.js';
export { TelegramAdapter, getTelegramAdapter } from './TelegramAdapter.js';
export { DiscordAdapter, getDiscordAdapter } from './DiscordAdapter.js';
export { TeamsAdapter, getTeamsAdapter } from './TeamsAdapter.js';
export { GmailAdapter, getGmailAdapter } from './GmailAdapter.js';
