const { app, BrowserWindow, Tray, Menu, ipcMain, shell, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');

// Store for persistent data
const store = new Store();

let mainWindow = null;
let tray = null;
let syncInterval = null;
let instagramLoginWindow = null;

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

    const apiUrl = store.get('apiUrl') || API_BASE_URL;

    // LinkedIn: Just submit cookies to backend (LinkedIn blocks direct API calls from desktop)
    if (platform === 'linkedin') {
      await axios.post(
        `${apiUrl}/api/platforms/linkedin/cookies`,
        { 
          li_at: cookies.li_at,
          JSESSIONID: cookies.JSESSIONID,
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 60000,
          maxRedirects: 0  // Don't follow redirects
        }
      );
      console.log(`[linkedin] Cookies submitted to backend - use web app to sync messages`);
      store.set(`${platform}_lastSync`, new Date().toISOString());
      if (mainWindow) {
        mainWindow.webContents.send('sync-status', { 
          platform, 
          success: true, 
          message: 'Connected! Use web app to sync messages',
          lastSync: new Date().toISOString()
        });
      }
      return;
    }

    let data;
    switch (platform) {
      case 'twitter':
        data = await fetchTwitterDMs(cookies);
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

    // Send to backend (include cookies for auto-account creation)
    await axios.post(
      `${apiUrl}${config.apiEndpoint}`,
      { 
        conversations: data,
        cookies: cookies  // Send cookies so backend can auto-create account if needed
      },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minutes for slow server
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
    { headers, timeout: 60000 }
  );
  
  return parseTwitterResponse(response.data);
}

function parseTwitterResponse(data) {
  const conversations = [];
  const users = data.inbox_initial_state?.users || {};
  
  if (data.inbox_initial_state && data.inbox_initial_state.conversations) {
    for (const [convId, conv] of Object.entries(data.inbox_initial_state.conversations)) {
      const messages = [];
      if (data.inbox_initial_state.entries) {
        for (const entry of data.inbox_initial_state.entries) {
          if (entry.message && entry.message.conversation_id === convId) {
            const msg = entry.message.message_data;
            const senderUser = users[msg.sender_id] || {};
            messages.push({
              id: entry.message.id,
              text: msg.text,
              senderId: msg.sender_id,
              senderName: senderUser.name || senderUser.screen_name || 'Unknown',
              senderUsername: senderUser.screen_name || '',
              createdAt: new Date(parseInt(entry.message.time)).toISOString()
            });
          }
        }
      }
      
      // Get participant details from users object
      const participantIds = conv.participants?.map(p => p.user_id) || [];
      const participantsWithNames = participantIds.map(userId => {
        const user = users[userId] || {};
        return {
          user_id: userId,
          name: user.name || user.screen_name || 'Twitter User',
          screen_name: user.screen_name || '',
          profile_image_url: user.profile_image_url_https || ''
        };
      });
      
      conversations.push({
        id: convId,
        participants: participantsWithNames,
        messages
      });
    }
  }
  return conversations;
}

// ============ LINKEDIN ============
async function fetchLinkedInMessages(cookies) {
  // LinkedIn blocks direct API calls from desktop apps (IP blocking)
  // Just return empty - cookies will be submitted to backend which handles sync
  console.log('[linkedin] Desktop fetch skipped - LinkedIn blocks direct API calls');
  console.log('[linkedin] Cookies will be submitted to backend for sync');
  return [];
}

function parseLinkedInResponse(data) {
  const conversations = [];
  const elements = data.elements || [];
  
  // LinkedIn includes related data in 'included' array
  const included = data.included || [];
  const profilesMap = {};
  const messagesMap = {};
  
  // Build lookup maps from included data
  for (const item of included) {
    if (item.$type === 'com.linkedin.voyager.identity.shared.MiniProfile' || item.firstName) {
      const id = item.entityUrn?.split(':').pop() || item['*miniProfile']?.split(':').pop() || '';
      if (id) {
        profilesMap[id] = {
          id,
          name: `${item.firstName || ''} ${item.lastName || ''}`.trim() || 'LinkedIn User',
          avatar: item.picture?.['com.linkedin.common.VectorImage']?.rootUrl || ''
        };
      }
    }
    if (item.$type === 'com.linkedin.voyager.messaging.event.MessageEvent' || item.body) {
      const id = item.entityUrn?.split(':').pop() || '';
      if (id) {
        messagesMap[id] = {
          id,
          text: item.body || item.attributedBody?.text || '',
          senderId: item['*from']?.split(':').pop() || '',
          createdAt: item.createdAt ? new Date(item.createdAt).toISOString() : new Date().toISOString()
        };
      }
    }
  }
  
  for (const conv of elements) {
    const convId = conv.entityUrn?.split(':').pop() || conv['*thread']?.split(':').pop() || '';
    
    // Get participants from conversation or included data
    const participants = [];
    const participantRefs = conv.participants || conv['*participants'] || [];
    
    for (const p of participantRefs) {
      let profile = null;
      
      // Handle different participant formats
      if (typeof p === 'string') {
        const profileId = p.split(':').pop();
        profile = profilesMap[profileId];
      } else {
        const member = p['com.linkedin.voyager.messaging.MessagingMember'] || p;
        const miniProfile = member.miniProfile || {};
        const profileId = miniProfile.entityUrn?.split(':').pop() || member['*miniProfile']?.split(':').pop() || '';
        
        profile = profilesMap[profileId] || {
          id: profileId,
          name: `${miniProfile.firstName || ''} ${miniProfile.lastName || ''}`.trim() || 'LinkedIn User',
          avatar: miniProfile.picture?.['com.linkedin.common.VectorImage']?.rootUrl || ''
        };
      }
      
      if (profile) {
        participants.push(profile);
      }
    }

    // Get messages from events or included data
    const messages = [];
    const events = conv.events || [];
    
    for (const event of events) {
      let msgText = '';
      let msgId = '';
      let senderId = '';
      let createdAt = new Date().toISOString();
      
      // Handle different event formats
      if (typeof event === 'string') {
        const eventId = event.split(':').pop();
        const msg = messagesMap[eventId];
        if (msg) {
          messages.push(msg);
          continue;
        }
      }
      
      msgId = event.entityUrn?.split(':').pop() || event.dashEntityUrn?.split(':').pop() || '';
      createdAt = event.createdAt ? new Date(event.createdAt).toISOString() : new Date().toISOString();
      
      // Try different paths for message body
      const eventContent = event.eventContent || {};
      const msgEvent = eventContent['com.linkedin.voyager.messaging.event.MessageEvent'] || eventContent;
      msgText = msgEvent.body || msgEvent.attributedBody?.text || event.body || '';
      
      // Get sender
      const fromMember = event.from?.['com.linkedin.voyager.messaging.MessagingMember'] || event.from || {};
      senderId = fromMember.miniProfile?.entityUrn?.split(':').pop() || 
                 fromMember['*miniProfile']?.split(':').pop() || 
                 event['*from']?.split(':').pop() || '';
      
      if (msgId) {
        messages.push({
          id: msgId,
          text: msgText || '[No content]',
          senderId,
          createdAt
        });
      }
    }

    if (convId) {
      // Get last activity time
      const lastActivity = conv.lastActivityAt || conv.lastReadAt || Date.now();
      
      conversations.push({
        id: convId,
        participants,
        messages,
        lastActivityAt: new Date(lastActivity).toISOString()
      });
    }
  }
  
  return conversations;
}

// ============ INSTAGRAM ============
async function fetchInstagramDMs(cookies) {
  console.log('[instagram] Fetching DMs with cookies...');
  console.log('[instagram] sessionid:', cookies.sessionid ? 'present' : 'missing');
  console.log('[instagram] csrftoken:', cookies.csrftoken ? 'present' : 'missing');
  
  const headers = {
    'cookie': `sessionid=${cookies.sessionid}; csrftoken=${cookies.csrftoken}; ds_user_id=${cookies.ds_user_id || ''}`,
    'x-csrftoken': cookies.csrftoken,
    'x-ig-app-id': '936619743392459',
    'x-requested-with': 'XMLHttpRequest',
    'x-ig-www-claim': '0',
    'origin': 'https://www.instagram.com',
    'referer': 'https://www.instagram.com/direct/inbox/',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
  };

  try {
    const response = await axios.get(
      'https://www.instagram.com/api/v1/direct_v2/inbox/',
      { 
        headers, 
        timeout: 60000,
        maxRedirects: 5,
        validateStatus: function (status) {
          return status < 500; // Accept any status < 500
        }
      }
    );
    
    console.log('[instagram] Response status:', response.status);
    
    if (response.status === 401 || response.status === 403) {
      throw new Error('Instagram session expired. Please login again.');
    }
    
    if (!response.data || !response.data.inbox) {
      console.log('[instagram] Response data:', JSON.stringify(response.data).substring(0, 500));
      throw new Error('Invalid response from Instagram. Please try logging in again.');
    }

    return parseInstagramResponse(response.data);
  } catch (error) {
    console.error('[instagram] Fetch error:', error.message);
    if (error.response) {
      console.error('[instagram] Response status:', error.response.status);
      console.error('[instagram] Response data:', JSON.stringify(error.response.data).substring(0, 500));
    }
    throw error;
  }
}

function parseInstagramResponse(data) {
  const conversations = [];
  const threads = data.inbox?.threads || [];
  
  for (const thread of threads) {
    const participants = (thread.users || []).map(u => ({
      id: u.pk?.toString() || '',
      name: u.full_name || u.username || ''
    }));

    const messages = (thread.items || []).map(item => {
      // Extract text from various Instagram message types
      let text = '';
      
      // Regular text message
      if (item.text) {
        text = item.text;
      }
      // Link share
      else if (item.link?.text) {
        text = item.link.text;
      }
      // Reel share
      else if (item.reel_share) {
        text = item.reel_share.text || '[Shared a Reel]';
      }
      // Story share
      else if (item.story_share) {
        text = item.story_share.message || '[Shared a Story]';
      }
      // Media share (posts)
      else if (item.media_share) {
        const caption = item.media_share.caption?.text || '';
        text = caption ? `[Post] ${caption.substring(0, 100)}` : '[Shared a Post]';
      }
      // Clip (Reels in DM)
      else if (item.clip) {
        const caption = item.clip.clip?.caption?.text || '';
        text = caption ? `[Clip] ${caption.substring(0, 100)}` : '[Shared a Clip]';
      }
      // Voice message
      else if (item.voice_media) {
        text = '[Voice Message]';
      }
      // Visual media (photo/video)
      else if (item.visual_media) {
        text = '[Photo/Video]';
      }
      // Animated media (GIF)
      else if (item.animated_media) {
        text = '[GIF]';
      }
      // Like/reaction
      else if (item.like) {
        text = '❤️';
      }
      // Reactions
      else if (item.reactions) {
        text = '[Reaction]';
      }
      // Placeholder message
      else if (item.placeholder) {
        text = item.placeholder.message || '[Message unavailable]';
      }
      // Action log (e.g., "liked a message")
      else if (item.action_log) {
        text = item.action_log.description || '[Action]';
      }
      // Default fallback
      else {
        text = '[Media]';
      }
      
      return {
        id: item.item_id || '',
        text: text,
        senderId: item.user_id?.toString() || '',
        createdAt: new Date(item.timestamp / 1000).toISOString()
      };
    });

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
      timeout: 60000,
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

// Twitter login with username/password via backend API
ipcMain.handle('login-twitter', async (event, { username, password, email }) => {
  try {
    const token = store.get('chatorbitor_token');
    if (!token) {
      return { success: false, error: 'Please save your Chat Orbitor token first' };
    }
    
    const apiUrl = store.get('apiUrl') || API_BASE_URL;
    const response = await axios.post(
      `${apiUrl}/api/platforms/twitter/login`,
      { username, password, email },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000 // 2 minutes for login (server can be slow)
      }
    );
    
    if (response.data.success) {
      // Store a flag that Twitter is connected via login
      store.set('twitter_cookies', { connected_via_login: true });
      store.set('twitter_account_id', response.data.accountId);
      return { success: true, accountId: response.data.accountId };
    } else {
      return { success: false, error: response.data.error?.message || 'Login failed' };
    }
  } catch (error) {
    console.error('[twitter] Login error:', error.response?.data || error.message);
    return { 
      success: false, 
      error: error.response?.data?.error?.message || error.message || 'Login failed'
    };
  }
});

// Instagram browser-based login (opens Instagram in a window, extracts cookies after login)
ipcMain.handle('login-instagram-browser', async () => {
  return new Promise((resolve) => {
    try {
      const token = store.get('chatorbitor_token');
      if (!token) {
        resolve({ success: false, error: 'Please save your Chat Orbitor token first' });
        return;
      }

      // Close existing Instagram login window if open
      if (instagramLoginWindow && !instagramLoginWindow.isDestroyed()) {
        instagramLoginWindow.close();
      }

      // Create a new session for Instagram login (isolated from main app)
      const instagramSession = session.fromPartition('instagram-login');
      
      // Clear any existing cookies to start fresh
      instagramSession.clearStorageData({ storages: ['cookies'] });

      // Create Instagram login window
      instagramLoginWindow = new BrowserWindow({
        width: 450,
        height: 700,
        resizable: true,
        title: 'Login to Instagram',
        parent: mainWindow,
        modal: false,
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: instagramSession
        }
      });

      // Load Instagram login page
      instagramLoginWindow.loadURL('https://www.instagram.com/accounts/login/');

      console.log('[instagram] Login window opened');

      // Notify main window that login window is open
      if (mainWindow) {
        mainWindow.webContents.send('instagram-login-status', { status: 'window_opened' });
      }

      // Check for successful login by monitoring URL and cookies
      let loginCheckInterval = null;
      let isResolved = false;

      const checkForLogin = async () => {
        if (isResolved) return;
        
        try {
          if (instagramLoginWindow.isDestroyed()) {
            clearInterval(loginCheckInterval);
            if (!isResolved) {
              isResolved = true;
              resolve({ success: false, error: 'Login window was closed' });
            }
            return;
          }

          const currentURL = instagramLoginWindow.webContents.getURL();
          
          // Check if user is logged in (URL changed to home or feed)
          if (currentURL.includes('instagram.com') && 
              !currentURL.includes('/accounts/login') && 
              !currentURL.includes('/challenge') &&
              !currentURL.includes('/two_factor')) {
            
            // Get cookies from the session
            const cookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
            
            // Find required cookies
            let sessionid = '';
            let csrftoken = '';
            let ds_user_id = '';

            for (const cookie of cookies) {
              if (cookie.name === 'sessionid') sessionid = cookie.value;
              if (cookie.name === 'csrftoken') csrftoken = cookie.value;
              if (cookie.name === 'ds_user_id') ds_user_id = cookie.value;
            }

            console.log('[instagram] Checking cookies - sessionid:', !!sessionid, 'csrftoken:', !!csrftoken);

            // If we have the required cookies, login was successful
            if (sessionid && csrftoken) {
              clearInterval(loginCheckInterval);
              isResolved = true;

              console.log('[instagram] Login successful! Extracting cookies...');

              // Save cookies
              const instagramCookies = { sessionid, csrftoken, ds_user_id };
              store.set('instagram_cookies', instagramCookies);

              // Close login window
              if (!instagramLoginWindow.isDestroyed()) {
                instagramLoginWindow.close();
              }

              // Notify main window
              if (mainWindow) {
                mainWindow.webContents.send('instagram-login-status', { 
                  status: 'success',
                  message: 'Login successful!'
                });
              }

              resolve({ success: true, cookies: instagramCookies });
              
              // Auto-sync after successful login
              const chatToken = store.get('chatorbitor_token');
              if (chatToken) {
                setTimeout(() => {
                  syncPlatform('instagram', instagramCookies, chatToken);
                }, 1000);
              }
            }
          }
        } catch (err) {
          console.error('[instagram] Error checking login status:', err.message);
        }
      };

      // Start checking for login every 2 seconds
      loginCheckInterval = setInterval(checkForLogin, 2000);

      // Also check when page finishes loading
      instagramLoginWindow.webContents.on('did-finish-load', () => {
        setTimeout(checkForLogin, 1000);
      });

      // Handle window close
      instagramLoginWindow.on('closed', () => {
        clearInterval(loginCheckInterval);
        instagramLoginWindow = null;
        
        if (!isResolved) {
          isResolved = true;
          if (mainWindow) {
            mainWindow.webContents.send('instagram-login-status', { 
              status: 'cancelled',
              message: 'Login cancelled'
            });
          }
          resolve({ success: false, error: 'Login window was closed' });
        }
      });

      // Timeout after 5 minutes
      setTimeout(() => {
        if (!isResolved) {
          clearInterval(loginCheckInterval);
          isResolved = true;
          
          if (instagramLoginWindow && !instagramLoginWindow.isDestroyed()) {
            instagramLoginWindow.close();
          }
          
          resolve({ success: false, error: 'Login timed out. Please try again.' });
        }
      }, 5 * 60 * 1000);

    } catch (error) {
      console.error('[instagram] Login error:', error.message);
      resolve({ success: false, error: error.message });
    }
  });
});

// Close Instagram login window
ipcMain.handle('close-instagram-login', async () => {
  if (instagramLoginWindow && !instagramLoginWindow.isDestroyed()) {
    instagramLoginWindow.close();
  }
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
