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
      const conv = conversations.find((c: Conversation) => c.id === conversationId);
      if (conv) setConversation(conv);
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

      const newMessages = (response.data.messages || []).map((m: any) => ({
        ...m,
        conversationId: m.conversation_id || m.conversationId,
        platformMessageId: m.platform_message_id || m.platformMessageId,
        senderId: m.sender_id || m.senderId,
        senderName: m.sender_name || m.senderName,
        messageType: m.message_type || m.messageType,
        mediaUrl: m.media_url || m.mediaUrl,
        isOutgoing: m.is_outgoing || m.isOutgoing,
        isRead: m.is_read || m.isRead,
        sentAt: m.sent_at || m.sentAt,
        deliveredAt: m.delivered_at || m.deliveredAt,
        createdAt: m.created_at || m.createdAt,
      }));

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
              className="w-11 h-11 rounded-xl shadow-md"
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
              {conversation?.participantName || 'Loading...'}
            </h3>
            {isAuthenticated && (
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 bg-emerald-500 rounded-full animate-pulse" />
                <span className={`text-xs ${isDark ? 'text-emerald-400' : 'text-emerald-600'}`}>Live</span>
              </div>
            )}
          </div>
        </div>
        {/* Character count display area */}
        <div className={`text-sm ${isDark ? 'text-gray-400' : 'text-gray-500'}`}>
          {messages.length} messages
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

      {/* Instagram Info */}
      {platform === 'instagram' && (
        <div className={`px-4 py-2 border-t ${isDark ? 'bg-pink-900/20 border-pink-800' : 'bg-gradient-to-r from-pink-50 to-purple-50 border-pink-200'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className={`w-4 h-4 ${isDark ? 'text-pink-400' : 'text-pink-500'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 2.163c3.204 0 3.584.012 4.85.07 3.252.148 4.771 1.691 4.919 4.919.058 1.265.069 1.645.069 4.849 0 3.205-.012 3.584-.069 4.849-.149 3.225-1.664 4.771-4.919 4.919-1.266.058-1.644.07-4.85.07-3.204 0-3.584-.012-4.849-.07-3.26-.149-4.771-1.699-4.919-4.92-.058-1.265-.07-1.644-.07-4.849 0-3.204.013-3.583.07-4.849.149-3.227 1.664-4.771 4.919-4.919 1.266-.057 1.645-.069 4.849-.069zM12 0C8.741 0 8.333.014 7.053.072 2.695.272.273 2.69.073 7.052.014 8.333 0 8.741 0 12c0 3.259.014 3.668.072 4.948.2 4.358 2.618 6.78 6.98 6.98C8.333 23.986 8.741 24 12 24c3.259 0 3.668-.014 4.948-.072 4.354-.2 6.782-2.618 6.979-6.98.059-1.28.073-1.689.073-4.948 0-3.259-.014-3.667-.072-4.947-.196-4.354-2.617-6.78-6.979-6.98C15.668.014 15.259 0 12 0z"/>
              </svg>
              <span className={`text-xs ${isDark ? 'text-pink-300' : 'text-pink-700'}`}>
                <strong>Instagram:</strong> Desktop App must be running. If message fails, re-login in Desktop App.
              </span>
            </div>
            <button 
              onClick={() => loadMessages(1, false)} 
              className={`text-xs underline ${isDark ? 'text-pink-400 hover:text-pink-300' : 'text-pink-600 hover:text-pink-800'}`}
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Discord Info */}
      {platform === 'discord' && (
        <div className={`px-4 py-2 border-t ${isDark ? 'bg-indigo-900/20 border-indigo-800' : 'bg-gradient-to-r from-indigo-50 to-purple-50 border-indigo-200'}`}>
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2">
              <svg className={`w-4 h-4 ${isDark ? 'text-indigo-400' : 'text-indigo-500'}`} fill="currentColor" viewBox="0 0 24 24">
                <path d="M20.317 4.3698a19.7913 19.7913 0 00-4.8851-1.5152.0741.0741 0 00-.0785.0371c-.211.3753-.4447.8648-.6083 1.2495-1.8447-.2762-3.68-.2762-5.4868 0-.1636-.3933-.4058-.8742-.6177-1.2495a.077.077 0 00-.0785-.037 19.7363 19.7363 0 00-4.8852 1.515.0699.0699 0 00-.0321.0277C.5334 9.0458-.319 13.5799.0992 18.0578a.0824.0824 0 00.0312.0561c2.0528 1.5076 4.0413 2.4228 5.9929 3.0294a.0777.0777 0 00.0842-.0276c.4616-.6304.8731-1.2952 1.226-1.9942a.076.076 0 00-.0416-.1057c-.6528-.2476-1.2743-.5495-1.8722-.8923a.077.077 0 01-.0076-.1277c.1258-.0943.2517-.1923.3718-.2914a.0743.0743 0 01.0776-.0105c3.9278 1.7933 8.18 1.7933 12.0614 0a.0739.0739 0 01.0785.0095c.1202.099.246.1981.3728.2924a.077.077 0 01-.0066.1276 12.2986 12.2986 0 01-1.873.8914.0766.0766 0 00-.0407.1067c.3604.698.7719 1.3628 1.225 1.9932a.076.076 0 00.0842.0286c1.961-.6067 3.9495-1.5219 6.0023-3.0294a.077.077 0 00.0313-.0552c.5004-5.177-.8382-9.6739-3.5485-13.6604a.061.061 0 00-.0312-.0286z"/>
              </svg>
              <span className={`text-xs ${isDark ? 'text-indigo-300' : 'text-indigo-700'}`}>
                <strong>Discord:</strong> Messages sent directly via Discord API. Token must be valid.
              </span>
            </div>
            <button 
              onClick={() => loadMessages(1, false)} 
              className={`text-xs underline ${isDark ? 'text-indigo-400 hover:text-indigo-300' : 'text-indigo-600 hover:text-indigo-800'}`}
            >
              Refresh
            </button>
          </div>
        </div>
      )}

      {/* Message Input */}
      <MessageInput 
        onSendMessage={handleSendMessage} 
        disabled={isLoading || !!error} 
        placeholder={platform === 'instagram' ? "Type message (sent via Desktop App)..." : "Type a message..."} 
      />
    </div>
  );
};

export default ChatView;
