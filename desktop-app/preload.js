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
  
  // Status updates
  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (event, data) => callback(data));
  },
  
  // Instagram login status updates
  onInstagramLoginStatus: (callback) => {
    ipcRenderer.on('instagram-login-status', (event, data) => callback(data));
  }
});
