const { app, BrowserWindow, Tray, Menu, ipcMain, shell } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');

// Store for persistent data
const store = new Store();

let mainWindow = null;
let tray = null;
let syncInterval = null;

// Chat Orbitor API URL
const API_BASE_URL = store.get('apiUrl') || 'https://chat-integrator.onrender.com';

// Platform configurations
const PLATFORMS = {
  twitter: {
    name: 'Twitter/X',
    icon: '🐦',
    cookieFields: ['auth_token', 'ct0'],
    apiEndpoint: '/api/platforms/twitter/sync-from-desktop'
  },
  linkedin: {
    name: 'LinkedIn',
    icon: '💼',
    cookieFields: ['li_at', 'JSESSIONID'],
    apiEndpoint: '/api/platforms/linkedin/sync-from-desktop'
  },
  instagram: {
    name: 'Instagram',
    icon: '📷',
    cookieFields: ['sessionid', 'csrftoken'],
    apiEndpoint: '/api/platforms/instagram/sync-from-desktop'
  },
  facebook: {
    name: 'Facebook',
    icon: '👥',
    cookieFields: ['c_user', 'xs'],
    apiEndpoint: '/api/platforms/facebook/sync-from-desktop'
  }
};

// Create the main window
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 550,
    height: 750,
    resizable: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js')
    },
    icon: path.join(__dirname, 'assets', 'icon.png'),
    show: false
  });

  mainWindow.loadFile('index.html');
  
  mainWindow.on('close', (event) => {
    if (!app.isQuitting) {
      event.preventDefault();
      mainWindow.hide();
    }
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });
}

// Create system tray
function createTray() {
  const { nativeImage } = require('electron');
  const fs = require('fs');
  
  let iconPath = path.join(__dirname, 'assets', 'tray-icon.png');
  let trayIcon;
  
  if (fs.existsSync(iconPath)) {
    trayIcon = nativeImage.createFromPath(iconPath);
  } else {
    const size = 16;
    const buffer = Buffer.alloc(size * size * 4);
    for (let i = 0; i < size * size; i++) {
      buffer[i * 4] = 102;
      buffer[i * 4 + 1] = 126;
      buffer[i * 4 + 2] = 234;
      buffer[i * 4 + 3] = 255;
    }
    trayIcon = nativeImage.createFromBuffer(buffer, { width: size, height: size });
  }
  
  tray = new Tray(trayIcon);
  
  const contextMenu = Menu.buildFromTemplate([
    { 
      label: 'Open Chat Orbitor Sync', 
      click: () => {
        if (mainWindow) {
          mainWindow.show();
        } else {
          createWindow();
        }
      }
    },
    { 
      label: 'Sync All Now', 
      click: () => syncAllPlatforms()
    },
    { type: 'separator' },
    { 
      label: 'Open Chat Orbitor', 
      click: () => shell.openExternal('https://chatorbitor.onrender.com')
    },
    { type: 'separator' },
    { 
      label: 'Quit', 
      click: () => {
        app.isQuitting = true;
        app.quit();
      }
    }
  ]);
  
  tray.setToolTip('Chat Orbitor - Multi-Platform Sync');
  tray.setContextMenu(contextMenu);
  
  tray.on('click', () => {
    if (mainWindow) {
      mainWindow.show();
    }
  });
}

// Sync all enabled platforms
async function syncAllPlatforms() {
  const chatOrbitorToken = store.get('chatorbitor_token');
  if (!chatOrbitorToken) {
    console.log('No Chat Orbitor token, skipping sync');
    return;
  }

  for (const [platform, config] of Object.entries(PLATFORMS)) {
    const cookies = store.get(`${platform}_cookies`);
    if (cookies && Object.keys(cookies).length > 0) {
      await syncPlatform(platform, cookies, chatOrbitorToken);
    }
  }
}

// Sync a specific platform
async function syncPlatform(platform, cookies, token) {
  const config = PLATFORMS[platform];
  if (!config) return;

  try {
    console.log(`[${platform}] Starting sync...`);
    if (mainWindow) {
      mainWindow.webContents.send('sync-status', { 
        platform, 
        syncing: true 
      });
    }

    let data;
    switch (platform) {
      case 'twitter':
        data = await fetchTwitterDMs(cookies);
        break;
      case 'linkedin':
        data = await fetchLinkedInMessages(cookies);
        break;
      case 'instagram':
        data = await fetchInstagramDMs(cookies);
        break;
      case 'facebook':
        data = await fetchFacebookMessages(cookies);
        break;
      default:
        throw new Error(`Unknown platform: ${platform}`);
    }

    // Send to backend
    const apiUrl = store.get('apiUrl') || API_BASE_URL;
    await axios.post(
      `${apiUrl}${config.apiEndpoint}`,
      { conversations: data },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );

    console.log(`[${platform}] Sync completed: ${data.length} conversations`);
    store.set(`${platform}_lastSync`, new Date().toISOString());
    
    if (mainWindow) {
      mainWindow.webContents.send('sync-status', { 
        platform, 
        success: true, 
        message: `Synced ${data.length} conversations`,
        lastSync: new Date().toISOString()
      });
    }

  } catch (error) {
    console.error(`[${platform}] Sync failed:`, error.message);
    if (mainWindow) {
      mainWindow.webContents.send('sync-status', { 
        platform, 
        success: false, 
        message: error.message 
      });
    }
  }
}

// ============ TWITTER ============
async function fetchTwitterDMs(cookies) {
  const headers = {
    'authorization': 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA',
    'cookie': `auth_token=${cookies.auth_token}; ct0=${cookies.ct0}`,
    'x-csrf-token': cookies.ct0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'content-type': 'application/json',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };
  
  const response = await axios.get(
    'https://api.twitter.com/1.1/dm/inbox_initial_state.json?include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1&include_can_media_tag=1&skip_status=1&dm_secret_conversations_enabled=false&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&count=50',
    { headers, timeout: 30000 }
  );
  
  return parseTwitterResponse(response.data);
}

function parseTwitterResponse(data) {
  const conversations = [];
  if (data.inbox_initial_state && data.inbox_initial_state.conversations) {
    for (const [convId, conv] of Object.entries(data.inbox_initial_state.conversations)) {
      const messages = [];
      if (data.inbox_initial_state.entries) {
        for (const entry of data.inbox_initial_state.entries) {
          if (entry.message && entry.message.conversation_id === convId) {
            const msg = entry.message.message_data;
            messages.push({
              id: entry.message.id,
              text: msg.text,
              senderId: msg.sender_id,
              createdAt: new Date(parseInt(entry.message.time)).toISOString()
            });
          }
        }
      }
      conversations.push({
        id: convId,
        participants: conv.participants || [],
        messages
      });
    }
  }
  return conversations;
}

// ============ LINKEDIN ============
async function fetchLinkedInMessages(cookies) {
  const headers = {
    'cookie': `li_at=${cookies.li_at}; JSESSIONID=${cookies.JSESSIONID}`,
    'csrf-token': cookies.JSESSIONID.replace(/"/g, ''),
    'x-restli-protocol-version': '2.0.0',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  // Get conversations
  const response = await axios.get(
    'https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX',
    { headers, timeout: 30000 }
  );

  return parseLinkedInResponse(response.data);
}

function parseLinkedInResponse(data) {
  const conversations = [];
  const elements = data.elements || [];
  
  for (const conv of elements) {
    const participants = (conv.participants || []).map(p => ({
      id: p.miniProfile?.entityUrn || '',
      name: `${p.miniProfile?.firstName || ''} ${p.miniProfile?.lastName || ''}`.trim()
    }));

    const messages = (conv.events || []).map(event => ({
      id: event.entityUrn || '',
      text: event.eventContent?.messageEvent?.body || '',
      senderId: event.from?.miniProfile?.entityUrn || '',
      createdAt: new Date(event.createdAt).toISOString()
    }));

    conversations.push({
      id: conv.entityUrn || '',
      participants,
      messages
    });
  }
  
  return conversations;
}

// ============ INSTAGRAM ============
async function fetchInstagramDMs(cookies) {
  const headers = {
    'cookie': `sessionid=${cookies.sessionid}; csrftoken=${cookies.csrftoken}`,
    'x-csrftoken': cookies.csrftoken,
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  const response = await axios.get(
    'https://www.instagram.com/api/v1/direct_v2/inbox/',
    { headers, timeout: 30000 }
  );

  return parseInstagramResponse(response.data);
}

function parseInstagramResponse(data) {
  const conversations = [];
  const threads = data.inbox?.threads || [];
  
  for (const thread of threads) {
    const participants = (thread.users || []).map(u => ({
      id: u.pk?.toString() || '',
      name: u.full_name || u.username || ''
    }));

    const messages = (thread.items || []).map(item => ({
      id: item.item_id || '',
      text: item.text || item.link?.text || '[Media]',
      senderId: item.user_id?.toString() || '',
      createdAt: new Date(item.timestamp / 1000).toISOString()
    }));

    conversations.push({
      id: thread.thread_id || '',
      participants,
      messages
    });
  }
  
  return conversations;
}

// ============ FACEBOOK ============
async function fetchFacebookMessages(cookies) {
  const headers = {
    'cookie': `c_user=${cookies.c_user}; xs=${cookies.xs}`,
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  // Facebook Messenger API is complex, using a simplified approach
  const response = await axios.get(
    'https://www.facebook.com/api/graphql/',
    { 
      headers, 
      timeout: 30000,
      params: {
        doc_id: '6195354443842040', // Inbox query
        variables: JSON.stringify({ limit: 20 })
      }
    }
  );

  return parseFacebookResponse(response.data);
}

function parseFacebookResponse(data) {
  const conversations = [];
  // Facebook's response structure varies, this is a simplified parser
  try {
    const threads = data?.data?.viewer?.message_threads?.nodes || [];
    for (const thread of threads) {
      const participants = (thread.all_participants?.nodes || []).map(p => ({
        id: p.messaging_actor?.id || '',
        name: p.messaging_actor?.name || ''
      }));

      const messages = (thread.messages?.nodes || []).map(msg => ({
        id: msg.message_id || '',
        text: msg.message?.text || '[Media]',
        senderId: msg.message_sender?.id || '',
        createdAt: new Date(msg.timestamp_precise).toISOString()
      }));

      conversations.push({
        id: thread.thread_key?.thread_fbid || '',
        participants,
        messages
      });
    }
  } catch (e) {
    console.error('Facebook parse error:', e);
  }
  return conversations;
}

// ============ IPC HANDLERS ============
ipcMain.handle('get-platforms', () => PLATFORMS);

ipcMain.handle('save-credentials', async (event, { platform, cookies, chatOrbitorToken }) => {
  if (chatOrbitorToken) {
    store.set('chatorbitor_token', chatOrbitorToken);
  }
  if (platform && cookies) {
    store.set(`${platform}_cookies`, cookies);
  }
  return { success: true };
});

ipcMain.handle('get-credentials', async () => {
  const result = {
    chatOrbitorToken: store.get('chatorbitor_token') || '',
    apiUrl: store.get('apiUrl') || API_BASE_URL,
    platforms: {}
  };
  
  for (const platform of Object.keys(PLATFORMS)) {
    result.platforms[platform] = {
      cookies: store.get(`${platform}_cookies`) || {},
      lastSync: store.get(`${platform}_lastSync`) || null
    };
  }
  
  return result;
});

ipcMain.handle('sync-platform', async (event, platform) => {
  const cookies = store.get(`${platform}_cookies`);
  const token = store.get('chatorbitor_token');
  if (cookies && token) {
    await syncPlatform(platform, cookies, token);
  }
  return { success: true };
});

ipcMain.handle('sync-all', async () => {
  await syncAllPlatforms();
  return { success: true };
});

ipcMain.handle('clear-platform', async (event, platform) => {
  store.delete(`${platform}_cookies`);
  store.delete(`${platform}_lastSync`);
  return { success: true };
});

ipcMain.handle('clear-all', async () => {
  store.clear();
  return { success: true };
});

// Start auto-sync interval (every 5 minutes)
function startAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  syncInterval = setInterval(() => {
    syncAllPlatforms();
  }, 5 * 60 * 1000);
  
  // Initial sync after 10 seconds
  setTimeout(() => {
    syncAllPlatforms();
  }, 10000);
}

// App lifecycle
app.whenReady().then(() => {
  createWindow();
  createTray();
  startAutoSync();
});

app.on('window-all-closed', () => {
  // Keep running in tray
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

app.on('before-quit', () => {
  app.isQuitting = true;
});
