import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Conversation, Platform } from '../types';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import LoadingSpinner from './LoadingSpinner';
import EmptyState from './EmptyState';
import apiClient from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../contexts/ToastContext';

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
  }, [conversationId]);

  // Send message
  const handleSendMessage = async (content: string) => {
    if (!conversationId) return;
    setSendError(null);
    try {
      const response = await apiClient.post(`/api/messages/${conversationId}/send`, { content });
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
      <div className="flex-1 flex items-center justify-center bg-gray-50">
        <EmptyState
          icon={
            <svg className="w-16 h-16 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
    <div className="flex-1 flex flex-col bg-white">
      {/* Chat Header */}
      <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
        <div className="flex items-center space-x-3">
          {conversation?.participantAvatarUrl ? (
            <img
              src={conversation.participantAvatarUrl}
              alt={conversation.participantName}
              className="w-10 h-10 rounded-full"
            />
          ) : (
            <div className="w-10 h-10 bg-gray-300 rounded-full flex items-center justify-center">
              <span className="text-gray-600 font-medium">
                {conversation?.participantName?.charAt(0).toUpperCase() || '?'}
              </span>
            </div>
          )}
          <div>
            <h3 className="font-semibold text-gray-900">
              {conversation?.participantName || 'Loading...'}
            </h3>
            {isAuthenticated && (
              <div className="flex items-center space-x-1">
                <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                <span className="text-xs text-green-600">Live</span>
              </div>
            )}
          </div>
        </div>
        {/* Character count display area */}
        <div className="text-sm text-gray-500">
          {messages.length} messages
        </div>
      </div>

      {/* Messages Container */}
      <div
        ref={messagesContainerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-y-auto p-4 bg-gray-50"
      >
        {isLoading ? (
          <div className="flex items-center justify-center h-full">
            <LoadingSpinner size="lg" text="Loading messages..." />
          </div>
        ) : error ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <p className="text-red-600 mb-2">{error}</p>
              <button
                onClick={() => loadMessages(1, false)}
                className="text-blue-600 hover:underline"
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
                    <svg className="w-12 h-12 text-gray-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
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
        <div className="px-4 py-2 bg-red-50 border-t border-red-200">
          <div className="flex items-center justify-between">
            <span className="text-sm text-red-600">{sendError}</span>
            <button onClick={() => setSendError(null)} className="text-red-500 hover:text-red-700">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>
      )}

      {/* Message Input */}
      <MessageInput onSendMessage={handleSendMessage} disabled={isLoading || !!error} placeholder="Type a message..." />
    </div>
  );
};

export default ChatView;
