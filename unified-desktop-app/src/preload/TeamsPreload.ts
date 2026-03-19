/**
 * Teams Web Bridge Preload Script
 * Runs inside the Teams web page context
 * 
 * Responsibilities:
 * - Detect login status
 * - Extract conversations and messages from DOM/internal state
 * - Send messages by simulating user interaction
 * - Forward events to main process
 */

import { contextBridge, ipcRenderer } from 'electron';

// ============================================
// Stealth Configuration
// ============================================

// Remove automation detection flags
const removeAutomationFlags = () => {
  // Remove webdriver flag
  Object.defineProperty(navigator, 'webdriver', {
    get: () => undefined,
  });
  
  // Remove automation-related properties
  delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Array;
  delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Promise;
  delete (window as any).cdc_adoQpoasnfa76pfcZLmcfl_Symbol;
};

// ============================================
// DOM Selectors (Teams v2 - Updated Dec 2024)
// ============================================

const SELECTORS = {
  // Login detection - Teams v2 specific
  appLoaded: '[data-tid="app-layout"], .app-layout, [class*="app-container"]',
  userAvatar: '[data-tid="avatar"], .fui-Avatar, [class*="avatar"]',
  chatList: '[data-tid="chat-list"], [class*="chat-list"], [role="tree"]',
  leftRail: '[data-tid="left-rail"], .left-rail, [class*="leftRail"]',
  
  // Conversation list - Teams v2
  conversationItem: '[data-tid="chat-list-item"], [role="treeitem"], [class*="chatListItem"]',
  conversationTitle: '[data-tid="chat-title"], [class*="title"], [class*="displayName"]',
  conversationPreview: '[data-tid="chat-preview"], [class*="preview"], [class*="lastMessage"]',
  conversationTime: '[data-tid="chat-time"], [class*="timestamp"], time',
  unreadBadge: '[data-tid="unread-badge"], [class*="unread"], [class*="badge"]',
  
  // Message area - Teams v2
  messageList: '[data-tid="message-list"], [class*="message-list"], [role="log"]',
  messageItem: '[data-tid="message-item"], [class*="message-item"], [data-is-focusable="true"]',
  messageBody: '[data-tid="message-body"], [class*="message-body"], [class*="messageContent"]',
  messageSender: '[data-tid="message-sender"], [class*="sender"], [class*="displayName"]',
  messageTime: '[data-tid="message-time"], [class*="timestamp"], time',
  
  // Input - Teams v2
  messageInput: '[data-tid="message-input"], [contenteditable="true"], [class*="ckeditor"], [role="textbox"]',
  sendButton: '[data-tid="send-button"], [class*="send"], button[aria-label*="Send"]',
  
  // Teams v2 specific
  chatPane: '.chat-pane, [class*="chatPane"]',
  threadBody: '.ts-message-list-container, [class*="messageListContainer"]',
};

// ============================================
// State Management
// ============================================

interface BridgeState {
  isLoggedIn: boolean;
  userId?: string;
  userName?: string;
  currentConversationId?: string;
  conversations: Map<string, any>;
  messages: Map<string, any[]>;
}

const state: BridgeState = {
  isLoggedIn: false,
  conversations: new Map(),
  messages: new Map(),
};

// ============================================
// Internal State Access (Primary Method)
// ============================================

/**
 * Try to access Teams' internal state store
 * Teams uses various frameworks - try to find the state
 */
const findInternalState = (): any => {
  // Try Redux store
  if ((window as any).__REDUX_STORE__) {
    return (window as any).__REDUX_STORE__.getState();
  }
  
  // Try window store
  if ((window as any).__store__) {
    return (window as any).__store__.getState?.() || (window as any).__store__;
  }
  
  // Try React DevTools
  const reactRoot = document.getElementById('root') || document.getElementById('app');
  if (reactRoot && (reactRoot as any)._reactRootContainer) {
    try {
      const fiber = (reactRoot as any)._reactRootContainer._internalRoot?.current;
      if (fiber?.memoizedState) {
        return fiber.memoizedState;
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // Try Angular
  if ((window as any).angular) {
    try {
      const injector = (window as any).angular.element(document.body).injector();
      if (injector) {
        return injector.get('$rootScope');
      }
    } catch (e) {
      // Ignore
    }
  }
  
  // Try to find any global state object
  const possibleStores = ['__TEAMS_STATE__', '__APP_STATE__', 'teamsState', 'appState'];
  for (const key of possibleStores) {
    if ((window as any)[key]) {
      return (window as any)[key];
    }
  }
  
  return null;
};

/**
 * Extract conversations from internal state
 */
const extractConversationsFromState = (internalState: any): any[] => {
  if (!internalState) return [];
  
  const conversations: any[] = [];
  
  // Try common state paths
  const possiblePaths = [
    internalState.chats?.items,
    internalState.conversations?.list,
    internalState.chat?.conversations,
    internalState.entities?.chats,
  ];
  
  for (const items of possiblePaths) {
    if (Array.isArray(items)) {
      return items;
    }
    if (items && typeof items === 'object') {
      return Object.values(items);
    }
  }
  
  return conversations;
};

// ============================================
// DOM Extraction (Fallback Method)
// ============================================

/**
 * Extract conversations from DOM - Teams v2
 */
const extractConversationsFromDOM = (): any[] => {
  const conversations: any[] = [];
  
  // Try multiple selectors for Teams v2
  let items = document.querySelectorAll(SELECTORS.conversationItem);
  
  // If no items found, try role-based selector
  if (items.length === 0) {
    items = document.querySelectorAll('[role="treeitem"]');
  }
  
  // Try class-based fallback
  if (items.length === 0) {
    items = document.querySelectorAll('[class*="chatListItem"], [class*="chat-list-item"]');
  }
  
  console.log('[TeamsPreload] Found', items.length, 'conversation items');
  
  items.forEach((item, index) => {
    try {
      // Get conversation ID from various attributes
      const id = item.getAttribute('data-tid') || 
                 item.getAttribute('data-conversation-id') ||
                 item.getAttribute('id') ||
                 item.getAttribute('data-key') ||
                 `conv_${index}_${Date.now()}`;
      
      // Extract title - try multiple selectors
      let title = '';
      const titleEl = item.querySelector(SELECTORS.conversationTitle) ||
                      item.querySelector('[class*="title"]') ||
                      item.querySelector('[class*="displayName"]') ||
                      item.querySelector('span[dir="auto"]');
      if (titleEl) {
        title = titleEl.textContent?.trim() || '';
      }
      
      // If no title found, try aria-label
      if (!title) {
        title = item.getAttribute('aria-label')?.split(',')[0] || 'Unknown Chat';
      }
      
      // Extract preview/last message
      let preview = '';
      const previewEl = item.querySelector(SELECTORS.conversationPreview) ||
                        item.querySelector('[class*="preview"]') ||
                        item.querySelector('[class*="lastMessage"]') ||
                        item.querySelector('[class*="secondary"]');
      if (previewEl) {
        preview = previewEl.textContent?.trim() || '';
      }
      
      // Extract time
      let time = '';
      const timeEl = item.querySelector(SELECTORS.conversationTime) ||
                     item.querySelector('time') ||
                     item.querySelector('[class*="timestamp"]');
      if (timeEl) {
        time = timeEl.getAttribute('datetime') || timeEl.textContent?.trim() || '';
      }
      
      // Check for unread
      const unreadEl = item.querySelector(SELECTORS.unreadBadge) ||
                       item.querySelector('[class*="unread"]') ||
                       item.querySelector('[class*="badge"]');
      const unreadCount = unreadEl ? parseInt(unreadEl.textContent || '1') || 1 : 0;
      
      // Determine chat type
      let chatType: 'oneOnOne' | 'group' | 'meeting' | 'channel' = 'oneOnOne';
      if (title.includes(',') || item.querySelector('[class*="group"]')) {
        chatType = 'group';
      }
      if (title.toLowerCase().includes('meeting') || item.querySelector('[class*="meeting"]')) {
        chatType = 'meeting';
      }
      
      conversations.push({
        id,
        type: chatType,
        title: title || 'Unknown',
        participants: [{ id: 'unknown', name: title || 'Unknown' }],
        lastMessage: preview,
        lastMessageTime: time || new Date().toISOString(),
        unreadCount,
      });
    } catch (e) {
      console.error('[TeamsPreload] Error extracting conversation:', e);
    }
  });
  
  console.log('[TeamsPreload] Extracted', conversations.length, 'conversations');
  return conversations;
};

/**
 * Extract messages from DOM
 */
const extractMessagesFromDOM = (conversationId: string): any[] => {
  const messages: any[] = [];
  
  let items = document.querySelectorAll(SELECTORS.messageItem);
  if (items.length === 0) {
    items = document.querySelectorAll('[data-is-focusable="true"], [class*="message-item"]');
  }
  
  items.forEach((item, index) => {
    try {
      const id = item.getAttribute('data-tid') || 
                 item.getAttribute('data-message-id') || 
                 `msg_${index}`;
      
      const bodyEl = item.querySelector(SELECTORS.messageBody) || 
                     item.querySelector('[class*="body"], [class*="content"]');
      const senderEl = item.querySelector(SELECTORS.messageSender) || 
                       item.querySelector('[class*="sender"], [class*="displayName"]');
      const timeEl = item.querySelector(SELECTORS.messageTime) || 
                     item.querySelector('time, [class*="timestamp"]');
      
      const isOutgoing = item.classList.contains('outgoing') || 
                         item.getAttribute('data-is-from-me') === 'true' ||
                         item.querySelector('[class*="fromMe"]') !== null;
      
      messages.push({
        id,
        conversationId,
        senderId: isOutgoing ? state.userId || 'me' : 'other',
        senderName: senderEl?.textContent?.trim() || (isOutgoing ? 'You' : 'Unknown'),
        content: bodyEl?.textContent?.trim() || '',
        timestamp: timeEl?.textContent?.trim() || new Date().toISOString(),
        isOutgoing,
      });
    } catch (e) {
      console.error('[TeamsPreload] Error extracting message:', e);
    }
  });
  
  return messages;
};

// ============================================
// Login Detection
// ============================================

const checkLoginStatus = (): boolean => {
  // Check for Teams v2 app loaded indicators
  // Look for chat list, left rail, or user avatar
  const chatList = document.querySelector(SELECTORS.chatList);
  const leftRail = document.querySelector(SELECTORS.leftRail);
  const userAvatar = document.querySelector(SELECTORS.userAvatar);
  const chatPane = document.querySelector(SELECTORS.chatPane);
  
  // Also check for "Chat" text in navigation
  const chatNav = document.querySelector('[aria-label="Chat"], [data-tid="chat-tab"]');
  
  // Check URL - if we're on teams.microsoft.com and not on login page
  const isTeamsUrl = window.location.href.includes('teams.microsoft.com') || 
                     window.location.href.includes('teams.live.com');
  const isLoginPage = window.location.href.includes('login') || 
                      window.location.href.includes('oauth') ||
                      window.location.href.includes('microsoftonline');
  
  const isLoggedIn = isTeamsUrl && !isLoginPage && !!(chatList || leftRail || userAvatar || chatPane || chatNav);
  
  if (isLoggedIn) {
    console.log('[TeamsPreload] Login detected - chatList:', !!chatList, 'leftRail:', !!leftRail, 'avatar:', !!userAvatar);
  }
  
  return isLoggedIn;
};

const extractUserInfo = (): { userId: string; userName: string } | null => {
  // Try to get from internal state
  const internalState = findInternalState();
  if (internalState?.user) {
    return {
      userId: internalState.user.id || internalState.user.userId,
      userName: internalState.user.displayName || internalState.user.name,
    };
  }
  
  // Try to get from DOM - Teams v2 specific
  // Look for user name in profile button or avatar
  const profileBtn = document.querySelector('[data-tid="me-control"], [aria-label*="profile"], [class*="me-control"]');
  const userName = profileBtn?.getAttribute('aria-label')?.replace('Profile, ', '') ||
                   profileBtn?.textContent?.trim();
  
  // Try avatar aria-label
  const avatar = document.querySelector('[data-tid="avatar"], .fui-Avatar');
  const avatarName = avatar?.getAttribute('aria-label') || avatar?.getAttribute('title');
  
  // Try to find name in header
  const headerName = document.querySelector('[class*="userName"], [class*="displayName"]')?.textContent;
  
  const finalName = userName || avatarName || headerName || 'Teams User';
  
  if (finalName && finalName !== 'Teams User') {
    console.log('[TeamsPreload] Extracted user name:', finalName);
    return {
      userId: 'teams_user_' + Date.now(),
      userName: finalName.trim(),
    };
  }
  
  // Fallback - just return generic user
  return {
    userId: 'teams_user_' + Date.now(),
    userName: 'Teams User',
  };
};

// ============================================
// Message Sending
// ============================================

const sendMessage = async (conversationId: string, content: string): Promise<{ success: boolean; messageId?: string; error?: string }> => {
  try {
    // Find message input
    let input = document.querySelector(SELECTORS.messageInput) as HTMLElement;
    if (!input) {
      input = document.querySelector('[contenteditable="true"], [role="textbox"]') as HTMLElement;
    }
    
    if (!input) {
      return { success: false, error: 'Message input not found' };
    }
    
    // Focus and insert text
    input.focus();
    
    // Small delay to mimic human behavior
    await delay(100 + Math.random() * 200);
    
    // Insert text
    if (input.getAttribute('contenteditable') === 'true') {
      input.innerHTML = content;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    } else if (input instanceof HTMLTextAreaElement || input instanceof HTMLInputElement) {
      input.value = content;
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
    
    // Small delay
    await delay(100 + Math.random() * 200);
    
    // Find and click send button
    let sendBtn = document.querySelector(SELECTORS.sendButton) as HTMLElement;
    if (!sendBtn) {
      sendBtn = document.querySelector('[class*="send"]') as HTMLElement;
    }
    
    if (sendBtn) {
      sendBtn.click();
    } else {
      // Try Enter key
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    }
    
    // Wait for message to appear
    await delay(500);
    
    return { success: true, messageId: `msg_${Date.now()}` };
  } catch (error: any) {
    return { success: false, error: error.message };
  }
};

// ============================================
// Mutation Observer (Real-time Updates)
// ============================================

let observer: MutationObserver | null = null;

const setupMutationObserver = () => {
  if (observer) return;
  
  observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      // Check for new messages
      if (mutation.type === 'childList') {
        mutation.addedNodes.forEach((node) => {
          if (node instanceof HTMLElement) {
            // Check if it's a new message
            if (node.matches?.(SELECTORS.messageItem) || 
                node.matches?.('[class*="message-item"]') ||
                node.querySelector?.(SELECTORS.messageItem)) {
              
              // Extract and send new message
              const messages = extractMessagesFromDOM(state.currentConversationId || '');
              if (messages.length > 0) {
                const lastMsg = messages[messages.length - 1];
                ipcRenderer.send('teams-bridge:new-message', lastMsg);
              }
            }
            
            // Check if it's a new conversation
            if (node.matches?.(SELECTORS.conversationItem) ||
                node.matches?.('[class*="chatListItem"]')) {
              // Refresh conversations
              const conversations = extractConversationsFromDOM();
              ipcRenderer.send('teams-bridge:conversations', conversations);
            }
          }
        });
      }
    }
  });
  
  // Observe the entire document for changes
  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
  
  console.log('[TeamsPreload] Mutation observer started');
};

// ============================================
// IPC Communication
// ============================================

const setupIpcListeners = () => {
  // Check login status
  ipcRenderer.on('teams-bridge:check-login', () => {
    const isLoggedIn = checkLoginStatus();
    if (isLoggedIn && !state.isLoggedIn) {
      state.isLoggedIn = true;
      const userInfo = extractUserInfo();
      if (userInfo) {
        state.userId = userInfo.userId;
        state.userName = userInfo.userName;
      }
      ipcRenderer.send('teams-bridge:logged-in', {
        userId: state.userId,
        userName: state.userName,
      });
    }
  });
  
  // Extract data
  ipcRenderer.on('teams-bridge:extract', (_event, data: { type: string; conversationId?: string }) => {
    if (data.type === 'conversations') {
      // Try internal state first
      const internalState = findInternalState();
      let conversations = extractConversationsFromState(internalState);
      
      // Fallback to DOM
      if (conversations.length === 0) {
        conversations = extractConversationsFromDOM();
      }
      
      ipcRenderer.send('teams-bridge:conversations', conversations);
    } else if (data.type === 'messages' && data.conversationId) {
      const messages = extractMessagesFromDOM(data.conversationId);
      ipcRenderer.send('teams-bridge:messages', {
        conversationId: data.conversationId,
        messages,
      });
    }
  });
  
  // Load specific conversation
  ipcRenderer.on('teams-bridge:load-conversation', (_event, conversationId: string) => {
    state.currentConversationId = conversationId;
    
    // Try to click on the conversation in the list
    const convItems = document.querySelectorAll(SELECTORS.conversationItem);
    convItems.forEach((item) => {
      const id = item.getAttribute('data-tid') || item.getAttribute('data-conversation-id');
      if (id === conversationId) {
        (item as HTMLElement).click();
      }
    });
    
    // Wait for messages to load, then extract
    setTimeout(() => {
      const messages = extractMessagesFromDOM(conversationId);
      ipcRenderer.send('teams-bridge:messages', { conversationId, messages });
    }, 1000);
  });
  
  // Send message
  ipcRenderer.on('teams-bridge:send-message', async (_event, data: { conversationId: string; content: string }) => {
    const result = await sendMessage(data.conversationId, data.content);
    ipcRenderer.send('teams-bridge:message-sent', result);
  });
  
  // Switch tenant
  ipcRenderer.on('teams-bridge:switch-tenant', (_event, tenantId: string) => {
    // Look for tenant switcher in UI
    const tenantSwitcher = document.querySelector('[data-tid="tenant-switcher"]') ||
                           document.querySelector('[class*="tenant"]');
    if (tenantSwitcher) {
      (tenantSwitcher as HTMLElement).click();
      // Would need to find and click the specific tenant
    }
  });
};

// ============================================
// Utilities
// ============================================

const delay = (ms: number): Promise<void> => {
  return new Promise(resolve => setTimeout(resolve, ms));
};

// ============================================
// Initialization
// ============================================

const init = () => {
  console.log('[TeamsPreload] Initializing...');
  
  // Remove automation flags
  removeAutomationFlags();
  
  // Setup IPC listeners
  setupIpcListeners();
  
  // Wait for page to load
  if (document.readyState === 'complete') {
    onPageLoad();
  } else {
    window.addEventListener('load', onPageLoad);
  }
};

const onPageLoad = () => {
  console.log('[TeamsPreload] Page loaded, URL:', window.location.href);
  
  // Setup mutation observer for real-time updates
  setupMutationObserver();
  
  // Check login status more frequently initially
  let checkCount = 0;
  const maxChecks = 60; // Check for 3 minutes max
  
  const loginChecker = setInterval(() => {
    checkCount++;
    const isLoggedIn = checkLoginStatus();
    
    if (isLoggedIn && !state.isLoggedIn) {
      state.isLoggedIn = true;
      const userInfo = extractUserInfo();
      if (userInfo) {
        state.userId = userInfo.userId;
        state.userName = userInfo.userName;
      }
      
      console.log('[TeamsPreload] ✓ Login detected:', state.userName);
      ipcRenderer.send('teams-bridge:logged-in', {
        userId: state.userId,
        userName: state.userName,
      });
      
      // Initial data extraction after a delay
      setTimeout(() => {
        console.log('[TeamsPreload] Extracting initial conversations...');
        const conversations = extractConversationsFromDOM();
        console.log('[TeamsPreload] Sending', conversations.length, 'conversations to main');
        ipcRenderer.send('teams-bridge:conversations', conversations);
      }, 2000);
      
      // Slow down checks after login
      clearInterval(loginChecker);
      
      // Setup periodic re-check (every 30 seconds)
      setInterval(() => {
        if (!checkLoginStatus() && state.isLoggedIn) {
          state.isLoggedIn = false;
          ipcRenderer.send('teams-bridge:logged-out');
        }
      }, 30000);
      
    } else if (!isLoggedIn && state.isLoggedIn) {
      state.isLoggedIn = false;
      console.log('[TeamsPreload] Logout detected');
      ipcRenderer.send('teams-bridge:logged-out');
    }
    
    // Stop checking after max attempts if not logged in
    if (checkCount >= maxChecks && !state.isLoggedIn) {
      console.log('[TeamsPreload] Max login checks reached, stopping');
      clearInterval(loginChecker);
    }
  }, 3000); // Check every 3 seconds
  
  // Also do an immediate check
  setTimeout(() => {
    console.log('[TeamsPreload] Immediate login check...');
    const isLoggedIn = checkLoginStatus();
    if (isLoggedIn && !state.isLoggedIn) {
      state.isLoggedIn = true;
      const userInfo = extractUserInfo();
      state.userId = userInfo?.userId;
      state.userName = userInfo?.userName;
      
      console.log('[TeamsPreload] ✓ Immediate login detected:', state.userName);
      ipcRenderer.send('teams-bridge:logged-in', {
        userId: state.userId,
        userName: state.userName,
      });
      
      setTimeout(() => {
        const conversations = extractConversationsFromDOM();
        ipcRenderer.send('teams-bridge:conversations', conversations);
      }, 2000);
    }
  }, 5000); // Check after 5 seconds
  
  // Cleanup on unload
  window.addEventListener('beforeunload', () => {
    clearInterval(loginChecker);
    if (observer) {
      observer.disconnect();
    }
  });
};

// Start
init();
