const { app, BrowserWindow, Tray, Menu, ipcMain, shell, session } = require('electron');
const path = require('path');
const Store = require('electron-store');
const axios = require('axios');
const https = require('https');

// Create axios instance for Instagram that doesn't follow redirects
const instagramAxios = axios.create({
  maxRedirects: 0,
  timeout: 30000,
  httpsAgent: new https.Agent({
    rejectUnauthorized: true,
  }),
  validateStatus: () => true, // Accept all status codes
});

// Store for persistent data
const store = new Store();

let mainWindow = null;
let tray = null;
let syncInterval = null;
let instagramLoginWindow = null;

// WhatsApp Web.js client
let whatsappClient = null;
let whatsappQRCode = null;
let whatsappStatus = 'disconnected'; // disconnected, connecting, qr_ready, connected

// Chat Orbitor API URL
const API_BASE_URL = store.get('apiUrl') || 'https://chat-integrator.onrender.com';

// Platform configurations
const PLATFORMS = {
  whatsapp: {
    name: 'WhatsApp',
    icon: '💬',
    cookieFields: [],  // No cookies needed - uses QR code
    apiEndpoint: '/api/platforms/whatsapp/sync-from-desktop'
  },
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
      
      // Show notification that app is still running
      if (tray) {
        tray.displayBalloon({
          title: 'Chat Orbitor',
          content: '✅ Still running in background! Instagram messages will sync automatically.',
          iconType: 'info'
        });
      }
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
    // WhatsApp uses special sync (whatsapp-web.js)
    if (platform === 'whatsapp') {
      if (whatsappStatus === 'connected') {
        await syncWhatsAppMessages();
      }
      continue;
    }
    
    // Other platforms use cookies
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

    // WhatsApp: Use whatsapp-web.js client (no cookies needed)
    if (platform === 'whatsapp') {
      await syncWhatsAppMessages();
      return;
    }

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
        console.log(`[instagram] Syncing with ds_user_id: ${cookies.ds_user_id || 'NOT SET'}`);
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
// Track last Twitter fetch time
let lastTwitterFetch = 0;
const TWITTER_MIN_INTERVAL = 15000; // 15 seconds between fetches

async function fetchTwitterDMs(cookies, retryCount = 0) {
  // Rate limit check
  const now = Date.now();
  const timeSinceLastFetch = now - lastTwitterFetch;
  if (timeSinceLastFetch < TWITTER_MIN_INTERVAL && retryCount === 0) {
    console.log(`[twitter] Rate limit: waiting ${Math.ceil((TWITTER_MIN_INTERVAL - timeSinceLastFetch) / 1000)}s`);
    await new Promise(resolve => setTimeout(resolve, TWITTER_MIN_INTERVAL - timeSinceLastFetch));
  }

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
  
  try {
    const response = await axios.get(
      'https://api.twitter.com/1.1/dm/inbox_initial_state.json?include_profile_interstitial_type=1&include_blocking=1&include_blocked_by=1&include_followed_by=1&include_want_retweets=1&include_mute_edge=1&include_can_dm=1&include_can_media_tag=1&skip_status=1&dm_secret_conversations_enabled=false&cards_platform=Web-12&include_cards=1&include_ext_alt_text=true&include_quote_count=true&include_reply_count=1&tweet_mode=extended&count=50',
      { headers, timeout: 60000 }
    );
    
    lastTwitterFetch = Date.now();
    return parseTwitterResponse(response.data);
  } catch (error) {
    console.error('[twitter] Fetch error:', error.message);
    
    // Retry on connection errors
    const isRetryableError = error.message.includes('ECONNRESET') || 
                            error.message.includes('ETIMEDOUT') ||
                            error.message.includes('socket hang up');
    
    if (isRetryableError && retryCount < 3) {
      const waitTime = Math.pow(2, retryCount) * 3000; // 3s, 6s, 12s
      console.log(`[twitter] Retrying in ${waitTime/1000}s... (attempt ${retryCount + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return fetchTwitterDMs(cookies, retryCount + 1);
    }
    
    throw error;
  }
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
// Track last Instagram fetch time to avoid rate limiting
let lastInstagramFetch = 0;
const INSTAGRAM_MIN_INTERVAL = 20000; // 20 seconds between fetches (reduced for faster updates)

// Track auto-relogin attempts to prevent spam
let lastAutoReloginAttempt = 0;
const AUTO_RELOGIN_COOLDOWN = 60000; // 1 minute between auto-relogin attempts

// Auto-relogin function - opens login window automatically when session expires
async function triggerInstagramAutoRelogin() {
  const now = Date.now();
  
  // Prevent spam - only allow one auto-relogin per minute
  if (now - lastAutoReloginAttempt < AUTO_RELOGIN_COOLDOWN) {
    console.log('[instagram] Auto-relogin skipped - cooldown active');
    return;
  }
  
  lastAutoReloginAttempt = now;
  
  // Check if login window is already open
  if (instagramLoginWindow && !instagramLoginWindow.isDestroyed()) {
    console.log('[instagram] Login window already open');
    instagramLoginWindow.focus();
    return;
  }
  
  console.log('[instagram] Opening auto-relogin window...');
  
  // Show notification to user
  if (mainWindow) {
    mainWindow.webContents.send('sync-status', { 
      platform: 'instagram', 
      success: false, 
      message: 'Session expired - login window opening...'
    });
  }
  
  // Trigger the browser login (same as clicking the button)
  // This will open the login window
  const instagramSession = session.fromPartition('instagram-login');
  
  // Create login window
  instagramLoginWindow = new BrowserWindow({
    width: 450,
    height: 700,
    resizable: true,
    title: 'Instagram Auto-Relogin',
    parent: mainWindow,
    modal: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      session: instagramSession
    }
  });

  // Load Instagram - it should auto-login if session is partially valid
  // or show login page if fully expired
  instagramLoginWindow.loadURL('https://www.instagram.com/');
  
  console.log('[instagram] Auto-relogin window opened - waiting for user to login...');
  
  // Check for successful login
  let isResolved = false;
  
  const checkForLogin = async () => {
    if (isResolved) return;
    
    try {
      if (!instagramLoginWindow || instagramLoginWindow.isDestroyed()) {
        return;
      }

      const currentURL = instagramLoginWindow.webContents.getURL();
      
      // Check if user is logged in (URL not on login page)
      if (currentURL.includes('instagram.com') && 
          !currentURL.includes('/accounts/login') && 
          !currentURL.includes('/challenge') &&
          !currentURL.includes('/two_factor')) {
        
        // Get cookies
        const cookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
        
        let sessionid = '';
        let csrftoken = '';
        let ds_user_id = '';
        let mid = '';
        let ig_did = '';
        let rur = '';

        for (const cookie of cookies) {
          if (cookie.name === 'sessionid') sessionid = cookie.value;
          if (cookie.name === 'csrftoken') csrftoken = cookie.value;
          if (cookie.name === 'ds_user_id') ds_user_id = cookie.value;
          if (cookie.name === 'mid') mid = cookie.value;
          if (cookie.name === 'ig_did') ig_did = cookie.value;
          if (cookie.name === 'rur') rur = cookie.value;
        }

        if (sessionid && csrftoken) {
          isResolved = true;
          
          console.log('[instagram] Auto-relogin successful!');
          
          // Save cookies
          const instagramCookies = { sessionid, csrftoken, ds_user_id, mid, ig_did, rur };
          store.set('instagram_cookies', instagramCookies);

          // Close login window
          if (!instagramLoginWindow.isDestroyed()) {
            instagramLoginWindow.close();
          }

          // Notify UI
          if (mainWindow) {
            mainWindow.webContents.send('sync-status', { 
              platform: 'instagram', 
              success: true,
              message: 'Auto-relogin successful! Syncing...'
            });
            mainWindow.webContents.send('instagram-login-status', { 
              status: 'success',
              message: 'Auto-relogin successful!'
            });
          }
          
          // Trigger sync after successful login
          const chatToken = store.get('chatorbitor_token');
          if (chatToken) {
            setTimeout(() => {
              syncPlatform('instagram', instagramCookies, chatToken);
            }, 2000);
          }
          
          return;
        }
      }
      
      // Keep checking every 2 seconds
      setTimeout(checkForLogin, 2000);
      
    } catch (err) {
      console.error('[instagram] Auto-relogin check error:', err.message);
    }
  };

  // Start checking
  instagramLoginWindow.webContents.on('did-finish-load', () => {
    setTimeout(checkForLogin, 1000);
  });

  // Handle window close
  instagramLoginWindow.on('closed', () => {
    instagramLoginWindow = null;
    isResolved = true;
  });
  
  // Timeout after 3 minutes
  setTimeout(() => {
    if (!isResolved && instagramLoginWindow && !instagramLoginWindow.isDestroyed()) {
      console.log('[instagram] Auto-relogin timeout - closing window');
      instagramLoginWindow.close();
    }
  }, 3 * 60 * 1000);
}

async function fetchInstagramDMs(cookies, retryCount = 0) {
  // Rate limit check - don't fetch too frequently
  const now = Date.now();
  const timeSinceLastFetch = now - lastInstagramFetch;
  if (timeSinceLastFetch < INSTAGRAM_MIN_INTERVAL && retryCount === 0) {
    console.log(`[instagram] Rate limit: waiting ${Math.ceil((INSTAGRAM_MIN_INTERVAL - timeSinceLastFetch) / 1000)}s before next fetch`);
    await new Promise(resolve => setTimeout(resolve, INSTAGRAM_MIN_INTERVAL - timeSinceLastFetch));
  }
  
  // Try to get fresh cookies from the browser session if available
  try {
    const instagramSession = session.fromPartition('instagram-login');
    const browserCookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
    
    if (browserCookies && browserCookies.length > 0) {
      let freshSessionId = '';
      let freshCsrfToken = '';
      let freshDsUserId = '';
      
      for (const cookie of browserCookies) {
        if (cookie.name === 'sessionid') freshSessionId = cookie.value;
        if (cookie.name === 'csrftoken') freshCsrfToken = cookie.value;
        if (cookie.name === 'ds_user_id') freshDsUserId = cookie.value;
      }
      
      // If browser session has valid cookies, use them (they're more up-to-date)
      if (freshSessionId && freshCsrfToken) {
        if (freshSessionId !== cookies.sessionid) {
          console.log('[instagram] Using fresh cookies from browser session');
          cookies.sessionid = freshSessionId;
          cookies.csrftoken = freshCsrfToken;
          if (freshDsUserId) cookies.ds_user_id = freshDsUserId;
          
          // Save the fresh cookies
          store.set('instagram_cookies', cookies);
        }
      }
    }
  } catch (e) {
    // Browser session not available, use stored cookies
  }
  
  console.log('[instagram] Fetching DMs with cookies...');
  console.log('[instagram] sessionid:', cookies.sessionid ? 'present' : 'missing');
  console.log('[instagram] csrftoken:', cookies.csrftoken ? 'present' : 'missing');
  
  // Check if cookies exist
  if (!cookies.sessionid || !cookies.csrftoken) {
    throw new Error('Instagram session not found. Please login via "Open Instagram Login" button.');
  }
  
  // Build cookie string with all cookies
  const cookieString = [
    `sessionid=${cookies.sessionid}`,
    `csrftoken=${cookies.csrftoken}`,
    cookies.ds_user_id ? `ds_user_id=${cookies.ds_user_id}` : '',
    'ig_nrcb=1',
  ].filter(Boolean).join('; ');
  
  const headers = {
    'authority': 'www.instagram.com',
    'accept': '*/*',
    'accept-language': 'en-US,en;q=0.9',
    'cookie': cookieString,
    'origin': 'https://www.instagram.com',
    'referer': 'https://www.instagram.com/direct/inbox/',
    'sec-ch-prefers-color-scheme': 'dark',
    'sec-ch-ua': '"Not_A Brand";v="8", "Chromium";v="120"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"Windows"',
    'sec-fetch-dest': 'empty',
    'sec-fetch-mode': 'cors',
    'sec-fetch-site': 'same-origin',
    'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'x-asbd-id': '129477',
    'x-csrftoken': cookies.csrftoken,
    'x-ig-app-id': '936619743392459',
    'x-ig-www-claim': 'hmac.AR3W0DThY2Mu5Fag4sW5u3RhaR3qhFD_5wvYbOJOD9qaPjM',
    'x-requested-with': 'XMLHttpRequest',
  };

  try {
    const response = await axios.get(
      'https://www.instagram.com/api/v1/direct_v2/inbox/',
      { 
        headers, 
        timeout: 60000,
        maxRedirects: 0, // Don't follow redirects - if redirected, session is invalid
        validateStatus: function (status) {
          return status < 400 || status === 302 || status === 301;
        }
      }
    );
    
    // Check for redirect (means session expired)
    if (response.status === 301 || response.status === 302) {
      const location = response.headers.location || '';
      console.log('[instagram] Redirected to:', location);
      if (location.includes('login') || location.includes('accounts')) {
        // AUTO-RELOGIN: Automatically open login window instead of throwing error
        console.log('[instagram] Session expired - attempting auto-relogin...');
        
        // Trigger auto-relogin (don't wait for it)
        triggerInstagramAutoRelogin();
        
        throw new Error('Instagram session expired. Auto-relogin triggered - please complete login in popup.');
      }
    }
    
    lastInstagramFetch = Date.now();
    console.log('[instagram] Response status:', response.status);
    
    if (response.status === 401 || response.status === 403) {
      throw new Error('Instagram session expired. Please login again via "Open Instagram Login".');
    }
    
    if (!response.data || !response.data.inbox) {
      // Check if it's a login redirect response
      const dataStr = JSON.stringify(response.data || {}).substring(0, 500);
      console.log('[instagram] Response data:', dataStr);
      
      if (dataStr.includes('login') || dataStr.includes('Login') || dataStr.includes('<!DOCTYPE')) {
        throw new Error('Instagram session expired. Please click "Open Instagram Login" to re-login.');
      }
      
      throw new Error('Invalid response from Instagram. Please try logging in again.');
    }

    return parseInstagramResponse(response.data);
  } catch (error) {
    console.error('[instagram] Fetch error:', error.message);
    
    // Check if it's a redirect error (session expired)
    if (error.message.includes('redirect') || error.message.includes('Maximum')) {
      // Clear cookies and ask for re-login
      console.log('[instagram] Session appears to be expired. Please re-login.');
      throw new Error('Instagram session expired. Please click "Open Instagram Login" to re-login.');
    }
    
    // Retry on SSL/connection errors (max 3 retries with exponential backoff)
    const isRetryableError = error.message.includes('SSL') || 
                            error.message.includes('ECONNRESET') || 
                            error.message.includes('ETIMEDOUT') ||
                            error.message.includes('CLOSE_NOTIFY') ||
                            error.message.includes('socket hang up');
    
    if (isRetryableError && retryCount < 3) {
      const waitTime = Math.pow(2, retryCount) * 5000; // 5s, 10s, 20s
      console.log(`[instagram] Retrying in ${waitTime/1000}s... (attempt ${retryCount + 1}/3)`);
      await new Promise(resolve => setTimeout(resolve, waitTime));
      return fetchInstagramDMs(cookies, retryCount + 1);
    }
    
    if (error.response) {
      console.error('[instagram] Response status:', error.response.status);
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

// ============ WHATSAPP (via whatsapp-web.js) ============
// Initialize WhatsApp client
async function initWhatsApp() {
  // Check if already initializing or connected
  if (whatsappStatus === 'connecting' || whatsappStatus === 'connected') {
    console.log('[whatsapp] Already connecting/connected');
    return;
  }
  
  try {
    // Dynamically require whatsapp-web.js (may not be installed yet)
    const { Client, LocalAuth } = require('whatsapp-web.js');
    const qrcode = require('qrcode');
    
    whatsappStatus = 'connecting';
    console.log('[whatsapp] Initializing WhatsApp client...');
    
    // Notify UI
    if (mainWindow) {
      mainWindow.webContents.send('whatsapp-status', { 
        status: 'connecting',
        message: 'Initializing WhatsApp...'
      });
    }
    
    // Create WhatsApp client with local authentication (stores session)
    whatsappClient = new Client({
      authStrategy: new LocalAuth({
        dataPath: path.join(app.getPath('userData'), 'whatsapp-session')
      }),
      puppeteer: {
        headless: true,
        args: [
          '--no-sandbox',
          '--disable-setuid-sandbox',
          '--disable-dev-shm-usage',
          '--disable-accelerated-2d-canvas',
          '--disable-gpu',
          '--window-size=1280,800'
        ]
      }
    });
    
    // QR Code event - user needs to scan
    whatsappClient.on('qr', async (qr) => {
      console.log('[whatsapp] QR code received');
      whatsappStatus = 'qr_ready';
      
      // Convert QR to base64 image
      try {
        whatsappQRCode = await qrcode.toDataURL(qr, { width: 256 });
        console.log('[whatsapp] QR code generated');
        
        // Notify UI
        if (mainWindow) {
          mainWindow.webContents.send('whatsapp-status', { 
            status: 'qr_ready',
            qrCode: whatsappQRCode,
            message: 'Scan QR code with WhatsApp'
          });
        }
      } catch (err) {
        console.error('[whatsapp] QR generation error:', err);
      }
    });
    
    // Ready event - connected successfully
    whatsappClient.on('ready', async () => {
      console.log('[whatsapp] Connected successfully!');
      whatsappStatus = 'connected';
      whatsappQRCode = null;
      
      // Get user info
      const info = whatsappClient.info;
      const phoneNumber = info?.wid?.user || 'Unknown';
      
      // Store connected state
      store.set('whatsapp_cookies', { connected: true, phoneNumber });
      store.set('whatsapp_lastConnect', new Date().toISOString());
      
      // Notify UI
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-status', { 
          status: 'connected',
          phoneNumber,
          message: 'WhatsApp connected!'
        });
      }
      
      // Initial sync
      setTimeout(() => {
        syncWhatsAppMessages();
      }, 2000);
    });
    
    // Authentication failure
    whatsappClient.on('auth_failure', (msg) => {
      console.error('[whatsapp] Authentication failed:', msg);
      whatsappStatus = 'disconnected';
      
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-status', { 
          status: 'error',
          message: 'Authentication failed. Please try again.'
        });
      }
    });
    
    // Disconnected
    whatsappClient.on('disconnected', (reason) => {
      console.log('[whatsapp] Disconnected:', reason);
      whatsappStatus = 'disconnected';
      store.delete('whatsapp_cookies');
      
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-status', { 
          status: 'disconnected',
          message: 'WhatsApp disconnected: ' + reason
        });
      }
    });
    
    // Initialize the client
    await whatsappClient.initialize();
    
  } catch (error) {
    console.error('[whatsapp] Init error:', error.message);
    whatsappStatus = 'disconnected';
    
    // Check if it's a missing dependency error
    if (error.message.includes("Cannot find module 'whatsapp-web.js'")) {
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-status', { 
          status: 'error',
          message: 'WhatsApp module not installed. Restart app after npm install.'
        });
      }
    } else {
      if (mainWindow) {
        mainWindow.webContents.send('whatsapp-status', { 
          status: 'error',
          message: 'WhatsApp init failed: ' + error.message
        });
      }
    }
  }
}

// Sync WhatsApp messages to backend
async function syncWhatsAppMessages() {
  if (!whatsappClient || whatsappStatus !== 'connected') {
    console.log('[whatsapp] Not connected, skipping sync');
    return [];
  }
  
  const token = store.get('chatorbitor_token');
  if (!token) {
    console.log('[whatsapp] No Chat Orbitor token, skipping sync');
    return [];
  }
  
  try {
    console.log('[whatsapp] Starting message sync...');
    
    if (mainWindow) {
      mainWindow.webContents.send('sync-status', { 
        platform: 'whatsapp', 
        syncing: true 
      });
    }
    
    // Get all chats
    const chats = await whatsappClient.getChats();
    console.log(`[whatsapp] Found ${chats.length} chats`);
    
    const conversations = [];
    
    // Process each chat (limit to first 50 for performance)
    for (const chat of chats.slice(0, 50)) {
      try {
        // Get last 20 messages from each chat
        const messages = await chat.fetchMessages({ limit: 20 });
        
        const participants = [];
        
        // Get contact info
        if (chat.isGroup) {
          // Group chat - get participant info
          const groupParticipants = chat.participants || [];
          for (const p of groupParticipants.slice(0, 10)) {  // Limit participants
            participants.push({
              id: p.id?._serialized || p.id || '',
              name: p.id?._serialized?.split('@')[0] || 'Group Member'
            });
          }
        } else {
          // Individual chat
          const contact = await chat.getContact();
          participants.push({
            id: contact.id?._serialized || chat.id?._serialized || '',
            name: contact.pushname || contact.name || contact.number || 'Unknown'
          });
        }
        
        const parsedMessages = messages.map(msg => ({
          id: msg.id?._serialized || msg.id?.id || '',
          text: msg.body || (msg.hasMedia ? '[Media]' : ''),
          senderId: msg.from || '',
          senderName: msg.fromMe ? 'You' : (msg._data?.notifyName || 'Contact'),
          isFromMe: msg.fromMe,
          createdAt: new Date(msg.timestamp * 1000).toISOString(),
          type: msg.type || 'chat'
        }));
        
        conversations.push({
          id: chat.id?._serialized || '',
          name: chat.name || 'Unknown Chat',
          isGroup: chat.isGroup,
          participants,
          messages: parsedMessages,
          unreadCount: chat.unreadCount || 0,
          lastMessageAt: messages.length > 0 
            ? new Date(messages[0].timestamp * 1000).toISOString() 
            : null
        });
        
      } catch (chatErr) {
        console.error(`[whatsapp] Error processing chat: ${chatErr.message}`);
      }
    }
    
    console.log(`[whatsapp] Processed ${conversations.length} conversations`);
    
    // Send to backend
    const apiUrl = store.get('apiUrl') || API_BASE_URL;
    
    await axios.post(
      `${apiUrl}/api/platforms/whatsapp/sync-from-desktop`,
      { conversations },
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 120000
      }
    );
    
    console.log('[whatsapp] Sync completed successfully');
    store.set('whatsapp_lastSync', new Date().toISOString());
    
    if (mainWindow) {
      mainWindow.webContents.send('sync-status', { 
        platform: 'whatsapp', 
        success: true,
        message: `Synced ${conversations.length} conversations`,
        lastSync: new Date().toISOString()
      });
    }
    
    return conversations;
    
  } catch (error) {
    console.error('[whatsapp] Sync error:', error.message);
    
    if (mainWindow) {
      mainWindow.webContents.send('sync-status', { 
        platform: 'whatsapp', 
        success: false,
        message: error.message
      });
    }
    
    return [];
  }
}

// Send WhatsApp message
async function sendWhatsAppMessage(chatId, text) {
  if (!whatsappClient || whatsappStatus !== 'connected') {
    throw new Error('WhatsApp not connected');
  }
  
  try {
    // Find the chat
    const chat = await whatsappClient.getChatById(chatId);
    if (!chat) {
      throw new Error('Chat not found');
    }
    
    // Send message
    const msg = await chat.sendMessage(text);
    
    console.log(`[whatsapp] Message sent to ${chatId}`);
    
    return {
      success: true,
      messageId: msg.id?._serialized || msg.id?.id || '',
      timestamp: new Date().toISOString()
    };
    
  } catch (error) {
    console.error('[whatsapp] Send error:', error.message);
    throw error;
  }
}

// Disconnect WhatsApp
async function disconnectWhatsApp() {
  if (whatsappClient) {
    try {
      await whatsappClient.logout();
      await whatsappClient.destroy();
    } catch (e) {
      console.log('[whatsapp] Cleanup error:', e.message);
    }
    whatsappClient = null;
  }
  
  whatsappStatus = 'disconnected';
  whatsappQRCode = null;
  store.delete('whatsapp_cookies');
  store.delete('whatsapp_lastSync');
  
  console.log('[whatsapp] Disconnected and cleaned up');
  
  if (mainWindow) {
    mainWindow.webContents.send('whatsapp-status', { 
      status: 'disconnected',
      message: 'WhatsApp disconnected'
    });
  }
}

// Get WhatsApp status
function getWhatsAppStatus() {
  return {
    status: whatsappStatus,
    qrCode: whatsappQRCode,
    connected: whatsappStatus === 'connected',
    phoneNumber: store.get('whatsapp_cookies')?.phoneNumber || null
  };
}

// ============ IPC HANDLERS ============
ipcMain.handle('get-platforms', () => PLATFORMS);

// WhatsApp IPC handlers
ipcMain.handle('whatsapp-connect', async () => {
  await initWhatsApp();
  return getWhatsAppStatus();
});

ipcMain.handle('whatsapp-disconnect', async () => {
  await disconnectWhatsApp();
  return { success: true };
});

ipcMain.handle('whatsapp-status', () => {
  return getWhatsAppStatus();
});

ipcMain.handle('whatsapp-sync', async () => {
  return await syncWhatsAppMessages();
});

ipcMain.handle('whatsapp-send', async (event, { chatId, text }) => {
  return await sendWhatsAppMessage(chatId, text);
});

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
            
            // Find ALL required cookies (more cookies = better authentication)
            let sessionid = '';
            let csrftoken = '';
            let ds_user_id = '';
            let mid = '';
            let ig_did = '';
            let rur = '';

            for (const cookie of cookies) {
              if (cookie.name === 'sessionid') sessionid = cookie.value;
              if (cookie.name === 'csrftoken') csrftoken = cookie.value;
              if (cookie.name === 'ds_user_id') ds_user_id = cookie.value;
              if (cookie.name === 'mid') mid = cookie.value;
              if (cookie.name === 'ig_did') ig_did = cookie.value;
              if (cookie.name === 'rur') rur = cookie.value;
            }

            console.log('[instagram] Checking cookies - sessionid:', !!sessionid, 'csrftoken:', !!csrftoken, 'ds_user_id:', ds_user_id || 'NOT FOUND');

            // If we have the required cookies, login was successful
            if (sessionid && csrftoken) {
              clearInterval(loginCheckInterval);
              isResolved = true;

              console.log('[instagram] Login successful! Extracting ALL cookies...');
              console.log('[instagram] ds_user_id (your Instagram ID):', ds_user_id || 'NOT FOUND!');
              console.log('[instagram] mid:', mid ? 'present' : 'missing');
              console.log('[instagram] ig_did:', ig_did ? 'present' : 'missing');
              
              if (!ds_user_id) {
                console.log('[instagram] WARNING: ds_user_id not found. Outgoing messages may not be detected correctly!');
              }

              // Save ALL cookies (needed for POST operations)
              const instagramCookies = { 
                sessionid, 
                csrftoken, 
                ds_user_id,
                mid: mid || '',
                ig_did: ig_did || '',
                rur: rur || ''
              };
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

// Start auto-sync interval (every 1 minute for near real-time updates)
function startAutoSync() {
  if (syncInterval) {
    clearInterval(syncInterval);
  }
  
  // Sync every 1 minute instead of 5 minutes for faster updates
  syncInterval = setInterval(() => {
    syncAllPlatforms();
  }, 1 * 60 * 1000); // 1 minute
  
  // Initial sync after 5 seconds
  setTimeout(() => {
    syncAllPlatforms();
  }, 5000);
  
  console.log('[sync] Auto-sync started - syncing every 1 minute');
}

// ============ INSTAGRAM SEND MESSAGE (via Desktop App) ============
let pendingMessageInterval = null;

// Start polling for pending Instagram messages
function startPendingMessagePoll() {
  if (pendingMessageInterval) {
    clearInterval(pendingMessageInterval);
  }
  
  // Poll every 5 seconds for pending messages
  pendingMessageInterval = setInterval(async () => {
    await checkAndSendPendingMessages();
  }, 5000);
  
  // Also check immediately
  setTimeout(async () => {
    await checkAndSendPendingMessages();
  }, 2000);
}

// Check for pending messages and send them
async function checkAndSendPendingMessages() {
  const token = store.get('chatorbitor_token');
  const instagramCookies = store.get('instagram_cookies');
  
  if (!token || !instagramCookies || !instagramCookies.sessionid) {
    return; // No token or no Instagram session
  }
  
  const apiUrl = store.get('apiUrl') || API_BASE_URL;
  
  try {
    // Fetch pending messages from backend
    const response = await axios.get(
      `${apiUrl}/api/platforms/instagram/pending`,
      {
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        timeout: 30000
      }
    );
    
    const pendingMessages = response.data.pendingMessages || [];
    
    if (pendingMessages.length > 0) {
      console.log(`[instagram] Found ${pendingMessages.length} pending messages to send`);
      
      // Send each message
      for (const msg of pendingMessages) {
        await sendInstagramMessage(msg, instagramCookies, token, apiUrl);
        // Wait a bit between messages to avoid rate limiting
        await new Promise(resolve => setTimeout(resolve, 2000));
      }
    }
  } catch (error) {
    // Only log if it's not a 401 (which is expected if not logged in)
    if (error.response?.status !== 401) {
      console.error('[instagram] Error checking pending messages:', error.message);
    }
  }
}

// Track messages being sent to avoid duplicate sends
const sendingMessages = new Set();

// Instagram Send Window (hidden browser window for sending)
let instagramSendWindow = null;

// Send Instagram message using Electron browser automation (MOST RELIABLE METHOD)
// This method opens Instagram's actual web interface and types/sends the message
async function sendInstagramMessage(msg, cookies, token, apiUrl) {
  // Prevent duplicate sends
  if (sendingMessages.has(msg.id)) {
    console.log(`[instagram] Message ${msg.id} already being sent, skipping...`);
    return;
  }
  sendingMessages.add(msg.id);
  
  console.log(`[instagram] Sending message ${msg.id} to thread ${msg.platformConversationId}`);
  console.log(`[instagram] Content: "${msg.content.substring(0, 50)}..."`);
  
  try {
    // METHOD: Browser Automation (open Instagram DM page and type message)
    console.log('[instagram] Using browser automation to send message...');
    
    const result = await sendMessageViaBrowser(msg, cookies);
    
    if (result.success) {
      // Report success to backend
      await axios.post(
        `${apiUrl}/api/platforms/instagram/message-sent`,
        {
          pending_id: msg.id,
          success: true,
          platform_message_id: result.messageId || `sent_${Date.now()}`
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
      
      console.log(`[instagram] Message ${msg.id} sent successfully!`);
      sendingMessages.delete(msg.id);
      
      // Notify UI
      if (mainWindow) {
        mainWindow.webContents.send('instagram-message-sent', {
          success: true,
          pendingId: msg.id,
          message: 'Message sent!'
        });
      }
      return;
    } else {
      throw new Error(result.error || 'Failed to send message');
    }
    
  } catch (error) {
    sendingMessages.delete(msg.id);
    
    const errorMsg = error.message || 'Unknown error';
    console.error(`[instagram] Failed to send message ${msg.id}:`, errorMsg);
    
    // Report failure to backend
    try {
      await axios.post(
        `${apiUrl}/api/platforms/instagram/message-sent`,
        {
          pending_id: msg.id,
          success: false,
          error: errorMsg
        },
        {
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          timeout: 30000
        }
      );
    } catch (reportErr) {
      console.error('[instagram] Failed to report error:', reportErr.message);
    }
    
    // Notify UI
    if (mainWindow) {
      mainWindow.webContents.send('instagram-message-sent', {
        success: false,
        pendingId: msg.id,
        error: errorMsg
      });
    }
  }
}

// Send message using browser automation (opens actual Instagram page)
function sendMessageViaBrowser(msg, cookies) {
  return new Promise(async (resolve) => {
    try {
      // Use the same session as the login window
      const instagramSession = session.fromPartition('instagram-login');
      
      // Make sure cookies are set in the session
      const cookiesToSet = [
        { url: 'https://www.instagram.com', name: 'sessionid', value: cookies.sessionid, domain: '.instagram.com' },
        { url: 'https://www.instagram.com', name: 'csrftoken', value: cookies.csrftoken, domain: '.instagram.com' },
      ];
      
      if (cookies.ds_user_id) {
        cookiesToSet.push({ url: 'https://www.instagram.com', name: 'ds_user_id', value: cookies.ds_user_id, domain: '.instagram.com' });
      }
      if (cookies.mid) {
        cookiesToSet.push({ url: 'https://www.instagram.com', name: 'mid', value: cookies.mid, domain: '.instagram.com' });
      }
      if (cookies.ig_did) {
        cookiesToSet.push({ url: 'https://www.instagram.com', name: 'ig_did', value: cookies.ig_did, domain: '.instagram.com' });
      }
      
      for (const cookie of cookiesToSet) {
        try {
          await instagramSession.cookies.set(cookie);
        } catch (e) {
          console.log('[instagram] Cookie set warning:', e.message);
        }
      }
      
      // Close existing send window
      if (instagramSendWindow && !instagramSendWindow.isDestroyed()) {
        instagramSendWindow.close();
      }
      
      // Create hidden browser window
      instagramSendWindow = new BrowserWindow({
        width: 800,
        height: 600,
        show: false,  // Hidden window
        webPreferences: {
          nodeIntegration: false,
          contextIsolation: true,
          session: instagramSession
        }
      });
      
      const threadUrl = `https://www.instagram.com/direct/t/${msg.platformConversationId}/`;
      console.log('[instagram] Loading thread:', threadUrl);
      
      instagramSendWindow.loadURL(threadUrl);
      
      let isResolved = false;
      let retryCount = 0;
      const maxRetries = 3;
      
      const tryToSend = async () => {
        if (isResolved) return;
        
        try {
          // Check if page loaded correctly (not login page)
          const currentURL = instagramSendWindow.webContents.getURL();
          console.log('[instagram] Current URL:', currentURL);
          
          if (currentURL.includes('/accounts/login') || currentURL.includes('/challenge')) {
            isResolved = true;
            if (instagramSendWindow && !instagramSendWindow.isDestroyed()) {
              instagramSendWindow.close();
            }
            resolve({ success: false, error: 'Instagram session expired. Please re-login via Desktop App.' });
            return;
          }
          
          // Execute script to find and type in the message input, then send
          const result = await instagramSendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                // Find message input - Instagram uses contenteditable div or textarea
                const messageInput = document.querySelector('textarea[placeholder*="Message"]') ||
                                    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                                    document.querySelector('div[aria-label*="Message"]') ||
                                    document.querySelector('[data-lexical-editor="true"]');
                
                if (!messageInput) {
                  return { success: false, error: 'Message input not found. Try clicking on chat first.' };
                }
                
                // Focus and set the message content
                messageInput.focus();
                
                // For textarea
                if (messageInput.tagName === 'TEXTAREA') {
                  messageInput.value = ${JSON.stringify(msg.content)};
                  messageInput.dispatchEvent(new Event('input', { bubbles: true }));
                } else {
                  // For contenteditable div
                  messageInput.textContent = ${JSON.stringify(msg.content)};
                  messageInput.dispatchEvent(new InputEvent('input', { bubbles: true, data: ${JSON.stringify(msg.content)} }));
                }
                
                // Wait a moment for Instagram to process
                return { success: true, step: 'typed' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[instagram] Type result:', result);
          
          if (!result.success) {
            if (retryCount < maxRetries) {
              retryCount++;
              console.log(`[instagram] Retrying... (${retryCount}/${maxRetries})`);
              setTimeout(tryToSend, 2000);
              return;
            }
            isResolved = true;
            if (instagramSendWindow && !instagramSendWindow.isDestroyed()) {
              instagramSendWindow.close();
            }
            resolve({ success: false, error: result.error || 'Could not type message' });
            return;
          }
          
          // Wait a moment then click send button
          await new Promise(r => setTimeout(r, 500));
          
          const sendResult = await instagramSendWindow.webContents.executeJavaScript(`
            (function() {
              try {
                // Find send button - various selectors Instagram uses
                const sendButton = document.querySelector('button[type="submit"]') ||
                                  document.querySelector('div[role="button"][tabindex="0"]:has(svg)') ||
                                  Array.from(document.querySelectorAll('div[role="button"]')).find(b => b.textContent === 'Send');
                
                // Alternative: Press Enter key
                const messageInput = document.querySelector('textarea[placeholder*="Message"]') ||
                                    document.querySelector('div[contenteditable="true"][role="textbox"]') ||
                                    document.querySelector('[data-lexical-editor="true"]');
                
                if (messageInput) {
                  // Simulate Enter key press
                  const enterEvent = new KeyboardEvent('keydown', {
                    key: 'Enter',
                    code: 'Enter',
                    keyCode: 13,
                    which: 13,
                    bubbles: true
                  });
                  messageInput.dispatchEvent(enterEvent);
                  return { success: true, method: 'enter' };
                }
                
                if (sendButton) {
                  sendButton.click();
                  return { success: true, method: 'click' };
                }
                
                return { success: false, error: 'Send button not found' };
              } catch (e) {
                return { success: false, error: e.message };
              }
            })();
          `);
          
          console.log('[instagram] Send result:', sendResult);
          
          // Wait for message to be sent
          await new Promise(r => setTimeout(r, 2000));
          
          isResolved = true;
          
          // IMPORTANT: Extract updated cookies BEFORE closing window
          // Instagram updates cookies after actions - we need to save them
          try {
            const updatedCookies = await instagramSession.cookies.get({ domain: '.instagram.com' });
            let newSessionId = '';
            let newCsrfToken = '';
            let newDsUserId = '';
            let newMid = '';
            let newIgDid = '';
            let newRur = '';
            
            for (const cookie of updatedCookies) {
              if (cookie.name === 'sessionid') newSessionId = cookie.value;
              if (cookie.name === 'csrftoken') newCsrfToken = cookie.value;
              if (cookie.name === 'ds_user_id') newDsUserId = cookie.value;
              if (cookie.name === 'mid') newMid = cookie.value;
              if (cookie.name === 'ig_did') newIgDid = cookie.value;
              if (cookie.name === 'rur') newRur = cookie.value;
            }
            
            // Save updated cookies if they changed
            if (newSessionId && newCsrfToken) {
              const currentCookies = store.get('instagram_cookies') || {};
              const updatedStoredCookies = {
                sessionid: newSessionId,
                csrftoken: newCsrfToken,
                ds_user_id: newDsUserId || currentCookies.ds_user_id || '',
                mid: newMid || currentCookies.mid || '',
                ig_did: newIgDid || currentCookies.ig_did || '',
                rur: newRur || currentCookies.rur || ''
              };
              
              // Check if cookies actually changed
              if (newSessionId !== currentCookies.sessionid || newCsrfToken !== currentCookies.csrftoken) {
                console.log('[instagram] Cookies updated after send - saving new session');
                store.set('instagram_cookies', updatedStoredCookies);
              }
            }
          } catch (cookieErr) {
            console.log('[instagram] Could not extract updated cookies:', cookieErr.message);
          }
          
          // Close the window
          if (instagramSendWindow && !instagramSendWindow.isDestroyed()) {
            instagramSendWindow.close();
          }
          
          if (sendResult.success) {
            resolve({ success: true, messageId: `browser_${Date.now()}` });
          } else {
            resolve({ success: false, error: sendResult.error || 'Failed to send' });
          }
          
        } catch (err) {
          console.error('[instagram] Browser automation error:', err.message);
          if (retryCount < maxRetries) {
            retryCount++;
            console.log(`[instagram] Retrying... (${retryCount}/${maxRetries})`);
            setTimeout(tryToSend, 2000);
          } else {
            isResolved = true;
            if (instagramSendWindow && !instagramSendWindow.isDestroyed()) {
              instagramSendWindow.close();
            }
            resolve({ success: false, error: err.message });
          }
        }
      };
      
      // Start trying to send after page loads
      instagramSendWindow.webContents.on('did-finish-load', () => {
        console.log('[instagram] Page loaded, waiting for DOM...');
        setTimeout(tryToSend, 3000);  // Wait 3s for Instagram's JS to load
      });
      
      // Timeout after 30 seconds
      setTimeout(() => {
        if (!isResolved) {
          isResolved = true;
          if (instagramSendWindow && !instagramSendWindow.isDestroyed()) {
            instagramSendWindow.close();
          }
          resolve({ success: false, error: 'Timeout: Page took too long to load' });
        }
      }, 30000);
      
    } catch (err) {
      console.error('[instagram] Browser send error:', err.message);
      resolve({ success: false, error: err.message });
    }
  });
}

// Auto-start on Windows login
function setupAutoLaunch() {
  const AutoLaunch = require('auto-launch');
  
  const autoLauncher = new AutoLaunch({
    name: 'Chat Orbitor',
    isHidden: true,  // Start minimized
  });
  
  // Enable auto-launch by default
  autoLauncher.isEnabled().then((isEnabled) => {
    if (!isEnabled) {
      autoLauncher.enable();
      console.log('[app] Auto-launch enabled - app will start on Windows login');
    }
  }).catch((err) => {
    console.log('[app] Auto-launch setup skipped:', err.message);
  });
}

// App lifecycle
app.whenReady().then(async () => {
  createWindow();
  createTray();
  startAutoSync();
  startPendingMessagePoll(); // Start polling for pending Instagram messages
  
  // Setup auto-launch (start on Windows login)
  try {
    setupAutoLaunch();
  } catch (err) {
    console.log('[app] Auto-launch not available:', err.message);
  }
  
  // Check if WhatsApp was previously connected (LocalAuth will restore session)
  const whatsappCookies = store.get('whatsapp_cookies');
  if (whatsappCookies && whatsappCookies.connected) {
    console.log('[whatsapp] Previous session found, attempting to restore...');
    // Wait a bit for app to fully initialize
    setTimeout(async () => {
      try {
        await initWhatsApp();
      } catch (err) {
        console.log('[whatsapp] Session restore failed:', err.message);
      }
    }, 3000);
  }
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
