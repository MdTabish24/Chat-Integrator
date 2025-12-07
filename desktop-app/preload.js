const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
  // Get platform configurations
  getPlatforms: () => ipcRenderer.invoke('get-platforms'),
  
  // Credentials management
  saveCredentials: (data) => ipcRenderer.invoke('save-credentials', data),
  getCredentials: () => ipcRenderer.invoke('get-credentials'),
  
  // Sync operations
  syncPlatform: (platform) => ipcRenderer.invoke('sync-platform', platform),
  syncAll: () => ipcRenderer.invoke('sync-all'),
  
  // Clear operations
  clearPlatform: (platform) => ipcRenderer.invoke('clear-platform', platform),
  clearAll: () => ipcRenderer.invoke('clear-all'),
  
  // Twitter login with username/password
  loginTwitter: (data) => ipcRenderer.invoke('login-twitter', data),
  
  // Instagram browser-based login (opens Instagram website)
  loginInstagramBrowser: () => ipcRenderer.invoke('login-instagram-browser'),
  closeInstagramLogin: () => ipcRenderer.invoke('close-instagram-login'),
  
  // WhatsApp operations (via whatsapp-web.js)
  whatsappConnect: () => ipcRenderer.invoke('whatsapp-connect'),
  whatsappDisconnect: () => ipcRenderer.invoke('whatsapp-disconnect'),
  whatsappStatus: () => ipcRenderer.invoke('whatsapp-status'),
  whatsappSync: () => ipcRenderer.invoke('whatsapp-sync'),
  whatsappSend: (data) => ipcRenderer.invoke('whatsapp-send', data),
  
  // Status updates
  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (event, data) => callback(data));
  },
  
  // Instagram login status updates
  onInstagramLoginStatus: (callback) => {
    ipcRenderer.on('instagram-login-status', (event, data) => callback(data));
  },
  
  // WhatsApp status updates (QR code, connection, etc.)
  onWhatsAppStatus: (callback) => {
    ipcRenderer.on('whatsapp-status', (event, data) => callback(data));
  },
  
  // WhatsApp real-time message updates
  onWhatsAppRealtimeMessage: (callback) => {
    ipcRenderer.on('whatsapp-realtime-message', (event, data) => callback(data));
  },
  
  // WhatsApp message sent confirmation
  onWhatsAppMessageSent: (callback) => {
    ipcRenderer.on('whatsapp-message-sent', (event, data) => callback(data));
  },
  
  // Instagram message sent confirmation
  onInstagramMessageSent: (callback) => {
    ipcRenderer.on('instagram-message-sent', (event, data) => callback(data));
  }
});
