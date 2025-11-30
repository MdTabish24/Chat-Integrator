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
  
  // Status updates
  onSyncStatus: (callback) => {
    ipcRenderer.on('sync-status', (event, data) => callback(data));
  }
});
