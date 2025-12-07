import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Conversation, Platform } from '../types';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';
import apiClient from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../contexts/ToastContext';
import { useTheme } from '../contexts/ThemeContext';

interface ChatViewProps {
  conversationId: string | null;
  platform: Platform | null;
  onMessageSent?: () => void;
}

const ChatView: React.FC<ChatViewProps> = ({
  conversationId,
  platform,
  onMessageSent,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [page, setPage] = useState(1);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isInitialLoadRef = useRef(true);
  const shouldAutoScrollRef = useRef(true);

  const { showError: showToastError, showSuccess } = useToast();
  const { isDark } = useTheme();

  // WebSocket callbacks
  const handleNewMessage = useCallback((data: any) => {
    const { message } = data;
    if (message.conversationId === conversationId) {
      setMessages((prev) => {
        const exists = prev.some(m => m.id === message.id);
        if (exists) return prev;
        const updated = [...prev, message];
        if (shouldAutoScrollRef.current) {
          setTimeout(() => scrollToBottom(true), 100);
        }
        return updated;
      });
    }
  }, [conversationId]);

  const { isAuthenticated } = useWebSocket({
    onNewMessage: handleNewMessage,
    onError: (error) => console.error('WebSocket error:', error),
  });

  const scrollToBottom = useCallback((smooth = true) => {
    messagesEndRef.current?.scrollIntoView({ behavior: smooth ? 'smooth' : 'auto', block: 'end' });
  }, []);


  // Load conversation details
  const loadConversation = useCallback(async () => {
    if (!conversationId) return;
    try {
      const response = await apiClient.get('/api/conversations');
      const conversations = response.data.conversations || [];
      const rawConv = conversations.find((c: any) => c.id === conversationId);
      if (rawConv) {
        // Map snake_case to camelCase
        const conv: Conversation = {
          id: rawConv.id,
          accountId: rawConv.account_id || rawConv.accountId,
          platformConversationId: rawConv.platform_conversation_id || rawConv.platformConversationId,
          participantName: rawConv.participant_name || rawConv.participantName || 'Unknown',
          participantId: rawConv.participant_id || rawConv.participantId || '',
          participantAvatarUrl: rawConv.participant_avatar_url || rawConv.participantAvatarUrl || '',
          lastMessageAt: rawConv.last_message_at || rawConv.lastMessageAt,
          unreadCount: rawConv.unread_count || rawConv.unreadCount || 0,
          createdAt: rawConv.created_at || rawConv.createdAt,
          updatedAt: rawConv.updated_at || rawConv.updatedAt,
        };
        setConversation(conv);
      }
    } catch (err) {
      console.error('Error loading conversation:', err);
    }
  }, [conversationId]);

  // Load messages
  const loadMessages = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    if (!conversationId) return;
    try {
      if (append) setIsLoadingMore(true);
      else setIsLoading(true);
      setError(null);

      const limit = 50;
      const offset = (pageNum - 1) * limit;

      // For Facebook, fetch fresh messages via backend adapter (fbchat) and use them directly
      // This gives better history than the preview-based Desktop sync, especially for older chats
      if (platform === 'facebook' && pageNum === 1 && !append) {
        try {
          // Load conversation to get account ID and platform conversation ID (thread ID)
          const convResponse = await apiClient.get('/api/conversations');
          const conversations = convResponse.data.conversations || [];
          const conv = conversations.find((c: Conversation) => c.id === conversationId);

          if (conv) {
            const accountId = (conv as any).account_id || (conv as any).accountId;
            const platformConvId = (conv as any).platform_conversation_id || (conv as any).platformConversationId;

            if (accountId && platformConvId) {
              const fbResponse = await apiClient.get(`/api/platforms/facebook/messages/${accountId}`);

              // Handle auth/expiry errors from backend adapter
              if (fbResponse.data.error?.code === 'AUTH_EXPIRED') {
                setError('Facebook cookies have expired. Please re-login via the Desktop App (Open Facebook Login).');
                setIsLoading(false);
                return;
              }

              const fbMessagesRaw = fbResponse.data.messages || [];

              const fbMessages = fbMessagesRaw
                .filter((m: any) => {
                  const convId = m.conversationId || m.conversation_id || m.thread_id;
                  return convId === platformConvId;
                })
                .map((m: any) => {
                  const sentAt = m.sentAt || m.sent_at || new Date().toISOString();
                  return {
                    id: m.id || m.platformMessageId || m.platform_message_id || `fb_${Date.now()}_${Math.random()}`,
                    conversationId,
                    platformMessageId: m.platformMessageId || m.platform_message_id,
                    senderId: m.senderId || m.sender_id,
                    senderName: m.senderName || m.sender_name || 'Facebook User',
                    content: m.content || '',
                    messageType: m.messageType || m.message_type || 'text',
                    mediaUrl: m.mediaUrl || m.media_url,
                    isOutgoing: m.isOutgoing ?? m.is_outgoing ?? false,
                    isRead: m.isRead ?? m.is_read ?? true,
                    sentAt,
                    deliveredAt: m.deliveredAt || m.delivered_at || sentAt,
                    createdAt: m.createdAt || m.created_at || sentAt,
                  } as Message;
                });

              // Sort chronologically
              fbMessages.sort((a, b) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());

              setMessages(fbMessages);
              setHasMore(false);
              setIsLoading(false);

              // Mark messages as read (best-effort, using generic endpoint by DB id will not work here,
              // so we skip marking for now)
              return; // Skip loading from DB
            }
          }
        } catch (fbErr: any) {
          console.log('[facebook] API fetch failed, falling back to cached DB messages:', fbErr);
          // Fall through to the generic DB-based loader below
        }
      }

      // For LinkedIn, fetch fresh messages from API and use them directly
      if (platform === 'linkedin' && pageNum === 1 && !append) {
        try {
          // Get conversation to find account ID and platform conversation ID
          const convResponse = await apiClient.get('/api/conversations');
          const conversations = convResponse.data.conversations || [];
          const conv = conversations.find((c: Conversation) => c.id === conversationId);
          
          if (conv) {
            const accountId = conv.account_id || conv.accountId;
            const platformConvId = conv.platform_conversation_id || conv.platformConversationId;
            
            if (accountId && platformConvId) {
              // Fetch fresh messages from LinkedIn API and USE THEM DIRECTLY
              const linkedinResponse = await apiClient.get(`/api/platforms/linkedin/conversations/${accountId}/${platformConvId}/messages`);
              console.log('[linkedin] Fetched fresh messages from API:', linkedinResponse.data);
              
              // Check if cookies are expired
              if (linkedinResponse.data.cookiesExpired || linkedinResponse.data.error?.code === 'COOKIES_EXPIRED') {
                setError('LinkedIn cookies have expired. Please go to "Manage accounts" and re-connect LinkedIn with fresh cookies from your browser.');
                setIsLoading(false);
                return;
              }
              
              const freshMessages = (linkedinResponse.data.messages || []).map((m: any) => ({
                id: m.id || m.platformMessageId || `linkedin_${Date.now()}_${Math.random()}`,
                conversationId: conversationId,
                platformMessageId: m.platformMessageId || m.platform_message_id,
                senderId: m.senderId || m.sender_id,
                senderName: m.senderName || m.sender_name,
                content: m.content,
                messageType: m.messageType || m.message_type || 'text',
                mediaUrl: m.mediaUrl || m.media_url,
                isOutgoing: m.isOutgoing ?? m.is_outgoing ?? false,
                isRead: m.isRead ?? m.is_read ?? true,
                sentAt: m.sentAt || m.sent_at,
                deliveredAt: m.deliveredAt || m.delivered_at,
                createdAt: m.createdAt || m.created_at,
              }));
              
              // Sort by sentAt and use directly
              freshMessages.sort((a: any, b: any) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
              setMessages(freshMessages);
              setHasMore(false);
              setIsLoading(false);
              console.log('[linkedin] Using fresh messages directly:', freshMessages.length);
              return; // Skip loading from DB
            }
          }
        } catch (linkedinErr: any) {
          console.log('[linkedin] API fetch failed:', linkedinErr);
          // Check if it's a cookies expired error
          const errData = linkedinErr.response?.data;
          if (errData?.cookiesExpired || errData?.error?.code === 'COOKIES_EXPIRED') {
            setError('LinkedIn cookies have expired. Please go to "Manage accounts" and re-connect LinkedIn with fresh cookies from your browser.');
            setIsLoading(false);
            return;
          }
          // For other errors, fall back to cached data
          console.log('[linkedin] Will fall back to cached data');
        }
      }
      
      // For Discord, fetch fresh messages from API and use them directly
      if (platform === 'discord' && pageNum === 1 && !append) {
        try {
          // Get conversation to find account ID and platform conversation ID
          const convResponse = await apiClient.get('/api/conversations');
          const conversations = convResponse.data.conversations || [];
          const conv = conversations.find((c: Conversation) => c.id === conversationId);
          
          if (conv) {
            const accountId = conv.account_id || conv.accountId;
            const platformConvId = conv.platform_conversation_id || conv.platformConversationId;
            
            if (accountId && platformConvId) {
              // Fetch fresh messages from Discord API
              console.log('[discord] Fetching fresh messages from API...');
              const discordResponse = await apiClient.get(`/api/platforms/discord/conversations/${accountId}/${platformConvId}/messages`);
              console.log('[discord] Fetched fresh messages from API:', discordResponse.data);
              
              // Check for auth errors
              if (discordResponse.data.error?.code === 'AUTH_EXPIRED') {
                setError('Discord token is invalid or expired. Please go to "Manage accounts" and re-connect Discord.');
                setIsLoading(false);
                return;
              }
              
              const freshMessages = (discordResponse.data.messages || []).map((m: any) => ({
                id: m.id || m.platformMessageId || `discord_${Date.now()}_${Math.random()}`,
                conversationId: conversationId,
                platformMessageId: m.platformMessageId || m.platform_message_id,
                senderId: m.senderId || m.sender_id,
                senderName: m.senderName || m.sender_name,
                content: m.content,
                messageType: m.messageType || m.message_type || 'text',
                mediaUrl: m.mediaUrl || m.media_url,
                isOutgoing: m.isOutgoing ?? m.is_outgoing ?? false,
                isRead: m.isRead ?? m.is_read ?? true,
                sentAt: m.sentAt || m.sent_at,
                deliveredAt: m.deliveredAt || m.delivered_at,
                createdAt: m.createdAt || m.created_at,
              }));
              
              // Sort by sentAt and use directly
              freshMessages.sort((a: any, b: any) => new Date(a.sentAt).getTime() - new Date(b.sentAt).getTime());
              setMessages(freshMessages);
              setHasMore(false);
              setIsLoading(false);
              console.log('[discord] Using fresh messages directly:', freshMessages.length);
              return; // Skip loading from DB
            }
          }
        } catch (discordErr: any) {
          console.log('[discord] API fetch failed:', discordErr);
          // Check if it's an auth error
          const errData = discordErr.response?.data;
          if (errData?.error?.code === 'AUTH_EXPIRED') {
            setError('Discord token is invalid or expired. Please go to "Manage accounts" and re-connect Discord.');
            setIsLoading(false);
            return;
          }
          // For other errors, fall back to cached data
          console.log('[discord] Will fall back to cached data');
        }
      }
      
      const response = await apiClient.get(`/api/messages/${conversationId}`, {
        params: { limit, offset },
      });

      const newMessages = (response.data.messages || [])
        .map((m: any) => ({
          ...m,
          conversationId: m.conversation_id || m.conversationId,
          platformMessageId: m.platform_message_id || m.platformMessageId,
          senderId: m.sender_id || m.senderId,
          senderName: m.sender_name || m.senderName,
          content: m.content || '',
          messageType: m.message_type || m.messageType,
          mediaUrl: m.media_url || m.mediaUrl,
          isOutgoing: m.is_outgoing || m.isOutgoing,
          isRead: m.is_read || m.isRead,
          sentAt: m.sent_at || m.sentAt,
          deliveredAt: m.delivered_at || m.deliveredAt,
          createdAt: m.created_at || m.createdAt,
        }))
        // Filter out fake/preview messages
        .filter((m: any) => {
          const content = (m.content || '').toLowerCase();
          const platformMsgId = m.platformMessageId || '';
          
          // Skip preview messages
          if (platformMsgId.startsWith('preview_')) return false;
          
          // Skip E2EE notices
          if (content.includes('end-to-end encryption')) return false;
          if (content === '[end-to-end encrypted chat]') return false;
          if (content.includes('messages and calls are secured')) return false;
          
          // Skip "You: " prefixed messages (these are fake previews)
          if (content.startsWith('you:') && !m.isOutgoing) return false;
          
          return true;
        });

      const reversedMessages = [...newMessages].reverse();
      if (append) {
        setMessages((prev) => [...reversedMessages, ...prev]);
      } else {
        setMessages(reversedMessages);
      }
      setHasMore(response.data.hasMore || false);

      // Mark messages as read
      newMessages.filter((m: Message) => !m.isRead && !m.isOutgoing).forEach(async (message: Message) => {
        try {
          await apiClient.patch(`/api/messages/${message.id}/read`);
        } catch (err) {
          console.error('Error marking message as read:', err);
        }
      });
    } catch (err: any) {
      setError(err.response?.data?.error?.message || 'Failed to load messages');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [conversationId, platform]);

  // Send message
  const handleSendMessage = async (content: string) => {
    if (!conversationId) return;
    setSendError(null);
    try {
      const response = await apiClient.post(`/api/messages/${conversationId}/send`, { content });
      
      // Check if message is pending (Instagram via Desktop App)
      if (response.status === 202 || response.data.pendingId) {
        // Message queued for Desktop App - show as PENDING with clear indicator
        const pendingId = response.data.pendingId || `pending_${Date.now()}`;
        const pendingMessage: Message = {
          id: pendingId,
          conversationId: conversationId,
          platformMessageId: 'pending',
          senderId: 'me',
          senderName: 'You',
          content: `⏳ ${content}`,  // Show with pending indicator
          messageType: 'text',
          isOutgoing: true,
          isRead: false,  // Not read because not sent yet
          sentAt: new Date().toISOString(),
          createdAt: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, pendingMessage]);
        setTimeout(() => scrollToBottom(true), 100);
        showSuccess('📤 Message queued - Desktop App will send it (keep Desktop App running!)');
        
        // Store pending ID to track status
        const pendingCheckRef = { active: true };
        
        // Poll to check if message was sent or failed (without causing page reload)
        const checkPendingStatus = async () => {
          if (!pendingCheckRef.active) return;
          
          try {
            const checkResponse = await apiClient.get(`/api/platforms/instagram/pending`);
            const pendingMessages = checkResponse.data.pendingMessages || [];
            const stillPending = pendingMessages.some((m: any) => m.id === pendingId);
            
            if (!stillPending) {
              // Message was either sent or failed
              pendingCheckRef.active = false;
              
              // Update the pending message in place instead of reloading
              setMessages((prev) => {
                const idx = prev.findIndex(m => m.id === pendingId);
                if (idx !== -1) {
                  // Replace pending message with sent version
                  const updated = [...prev];
                  updated[idx] = {
                    ...updated[idx],
                    content: content,  // Remove pending indicator
                    platformMessageId: `sent_${Date.now()}`,
                    isRead: true,
                  };
                  return updated;
                }
                return prev;
              });
              showSuccess('✅ Message sent via Desktop App!');
              return;
            }
            
            // Keep checking
            setTimeout(checkPendingStatus, 5000);
          } catch (err) {
            // On error, try again
            setTimeout(checkPendingStatus, 5000);
          }
        };
        
        // Start checking after 3 seconds
        setTimeout(checkPendingStatus, 3000);
        
        // Stop checking after 60 seconds
        setTimeout(() => {
          pendingCheckRef.active = false;
        }, 60000);
        
        onMessageSent?.();
        return;
      }
      
      const m = response.data.message;
      // Map snake_case to camelCase
      const newMessage: Message = {
        ...m,
        conversationId: m.conversation_id || m.conversationId,
        platformMessageId: m.platform_message_id || m.platformMessageId,
        senderId: m.sender_id || m.senderId,
        senderName: m.sender_name || m.senderName,
        messageType: m.message_type || m.messageType,
        mediaUrl: m.media_url || m.mediaUrl,
        isOutgoing: m.is_outgoing ?? m.isOutgoing ?? true,
        isRead: m.is_read ?? m.isRead ?? true,
        sentAt: m.sent_at || m.sentAt,
        deliveredAt: m.delivered_at || m.deliveredAt,
        createdAt: m.created_at || m.createdAt,
      };
      setMessages((prev) => [...prev, newMessage]);
      setTimeout(() => scrollToBottom(true), 100);
      showSuccess('Message sent');
      onMessageSent?.();
    } catch (err: any) {
      const errorMessage = err.response?.data?.error?.message || 'Failed to send message';
      setSendError(errorMessage);
      showToastError(errorMessage);
      throw err;
    }
  };

  // Handle scroll
  const handleScroll = useCallback(() => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      if (scrollTop < 100 && !isLoadingMore && hasMore) {
        const nextPage = page + 1;
        setPage(nextPage);
        previousScrollHeightRef.current = scrollHeight;
        loadMessages(nextPage, true);
      }
      shouldAutoScrollRef.current = scrollHeight - scrollTop - clientHeight < 100;
    }
  }, [isLoadingMore, hasMore, page, loadMessages]);

  // Initial load
  useEffect(() => {
    if (conversationId) {
      isInitialLoadRef.current = true;
      setPage(1);
      loadConversation();
      loadMessages(1, false);
    } else {
      setMessages([]);
      setConversation(null);
    }
  }, [conversationId, loadConversation, loadMessages]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && isInitialLoadRef.current && messages.length > 0) {
      setTimeout(() => scrollToBottom(false), 100);
      isInitialLoadRef.current = false;
    }
  }, [isLoading, messages.length, scrollToBottom]);

  // Maintain scroll position after loading more
  useEffect(() => {
    if (!isLoadingMore && previousScrollHeightRef.current > 0 && messagesContainerRef.current) {
      const newScrollHeight = messagesContainerRef.current.scrollHeight;
      messagesContainerRef.current.scrollTop = newScrollHeight - previousScrollHeightRef.current;
      previousScrollHeightRef.current = 0;
    }
  }, [isLoadingMore]);


  // Empty state when no conversation selected
  if (!conversationId) {
    return (
      <div className={`flex-1 flex items-center justify-center chat-area-professional`}>
        <EmptyState
          icon={
            <svg className={`w-16 h-16 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
            </svg>
          }
          title="Select a conversation"
          description="Choose a conversation from the sidebar to start messaging"
        />
      </div>
    );
  }

  return (
    <div className={`flex-1 flex flex-col ${isDark ? 'bg-slate-900' : 'bg-white'}`}>
      {/* Chat Header */}
      <div className={`px-5 py-4 border-b flex items-center justify-between ${isDark ? 'border-gray-700 bg-slate-800' : 'border-gray-200 bg-white'}`}>
        <div className="flex items-center space-x-3">
          {conversation?.participantAvatarUrl ? (
            <img
              src={conversation.participantAvatarUrl}
              alt={conversation.participantName}
              className="w-11 h-11 rounded-xl shadow-md object-cover"
            />
          ) : (
            <div className={`w-11 h-11 rounded-xl flex items-center justify-center shadow-md ${isDark ? 'bg-gradient-to-br from-gray-700 to-gray-800' : 'bg-gradient-to-br from-gray-200 to-gray-300'}`}>
              <span className={`font-semibold ${isDark ? 'text-gray-300' : 'text-gray-600'}`}>
                {conversation?.participantName?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          )}
          <div>
            <h3 className={`font-semibold ${isDark ? 'text-white' : 'text-gray-900'}`}>
              {conversation?.participantName || 'Select a chat'}
            </h3>
            {platform && (
              <span className={`text-xs capitalize ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
                {platform}
              </span>
            )}
          </div>
        </div>
      </div>

      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className={`flex-1 overflow-y-auto p-4 chat-area-professional`}
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSpinner size="lg" text="Loading messages..." />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className={`mb-2 ${isDark ? 'text-red-400' : 'text-red-600'}`}>{error}</p>
              <button
                onClick={() => loadMessages(1, false)}
                className={`hover:underline ${isDark ? 'text-sky-400' : 'text-sky-600'}`}
              >
                Try again
              </button>
            </div>
          </div>
        ) : (
          <>
            {isLoadingMore && (
              <div className="flex justify-center py-4">
                <LoadingSpinner size="sm" />
              </div>
            )}
            {messages.length === 0 ? (
              <div className="flex items-center justify-center h-full">
                <EmptyState
                  icon={
                    <svg className={`w-12 h-12 ${isDark ? 'text-gray-600' : 'text-gray-400'}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
                    </svg>
                  }
                  title="No messages yet"
                  description="Start the conversation!"
                />
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble key={message.id} message={message} isOutgoing={message.isOutgoing} />
              ))
            )}
            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Send Error */}
      {sendError && (
        <div className={`px-4 py-2 border-t ${isDark ? 'bg-red-900/30 border-red-800' : 'bg-red-50 border-red-200'}`}>
          <div className="flex items-center justify-between">
            <span className={`text-sm ${isDark ? 'text-red-400' : 'text-red-600'}`}>{sendError}</span>
            <button onClick={() => setSendError(null)} className={isDark ? 'text-red-400 hover:text-red-300' : 'text-red-500 hover:text-red-700'}>
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Message Input */}
      <MessageInput 
        onSendMessage={handleSendMessage} 
        disabled={isLoading || !!error} 
        placeholder="Type a message..." 
      />
    </div>
  );
};

export default ChatView;
