import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Message, Conversation } from '../types';
import MessageBubble from './MessageBubble';
import MessageInput from './MessageInput';
import LoadingSpinner from './LoadingSpinner';
import ErrorDisplay from './ErrorDisplay';
import EmptyState from './EmptyState';
import apiClient from '../config/api';
import { useWebSocket } from '../hooks/useWebSocket';
import { useToast } from '../contexts/ToastContext';

interface MessageThreadProps {
  conversationId: string;
  platform?: string;
  onClose: () => void;
  onMessageSent?: () => void;
}

const MessageThread: React.FC<MessageThreadProps> = ({
  conversationId,
  platform,
  onClose,
  onMessageSent,
}) => {
  const [messages, setMessages] = useState<Message[]>([]);
  const [conversation, setConversation] = useState<Conversation | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedMessage, setFailedMessage] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const messagesContainerRef = useRef<HTMLDivElement>(null);
  const previousScrollHeightRef = useRef<number>(0);
  const isInitialLoadRef = useRef(true);
  const shouldAutoScrollRef = useRef(true);
  
  const { showError: showToastError, showSuccess } = useToast();

  // WebSocket callbacks for real-time updates
  const handleNewMessage = useCallback((data: any) => {
    const { message, conversation: updatedConversation } = data;
    
    // Only process messages for the current conversation
    if (message.conversationId === conversationId) {
      console.log('Real-time message received for current conversation:', message);
      
      // Check if message already exists (avoid duplicates)
      setMessages((prev) => {
        const exists = prev.some(m => m.id === message.id);
        if (exists) {
          return prev;
        }
        
        // Add new message to the list
        const updated = [...prev, message];
        
        // Auto-scroll if user is near bottom
        if (shouldAutoScrollRef.current) {
          setTimeout(() => scrollToBottom(true), 100);
        }
        
        return updated;
      });
      
      // Update conversation if provided
      if (updatedConversation && updatedConversation.id === conversationId) {
        setConversation(updatedConversation);
      }
    }
  }, [conversationId]);

  const handleMessageStatusUpdate = useCallback((data: any) => {
    const { messageId, status, conversationId: updatedConversationId } = data;
    
    // Only process updates for the current conversation
    if (updatedConversationId === conversationId) {
      console.log('Real-time message status update:', messageId, status);
      
      setMessages((prev) => {
        return prev.map(message => {
          if (message.id === messageId) {
            // Update message status
            if (status === 'read') {
              return { ...message, isRead: true };
            } else if (status === 'delivered') {
              return { ...message, deliveredAt: new Date().toISOString() };
            }
          }
          return message;
        });
      });
    }
  }, [conversationId]);

  const handleConversationUpdate = useCallback((data: any) => {
    const { conversation: updatedConversation } = data;
    
    // Update conversation if it's the current one
    if (updatedConversation.id === conversationId) {
      console.log('Real-time conversation update:', updatedConversation);
      setConversation(updatedConversation);
    }
  }, [conversationId]);

  // Initialize WebSocket with callbacks
  const { isAuthenticated } = useWebSocket({
    onNewMessage: handleNewMessage,
    onMessageStatusUpdate: handleMessageStatusUpdate,
    onConversationUpdate: handleConversationUpdate,
    onError: (error) => {
      console.error('WebSocket error in MessageThread:', error);
    },
  });

  // Scroll to bottom
  const scrollToBottom = useCallback((smooth = true) => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ 
        behavior: smooth ? 'smooth' : 'auto',
        block: 'end'
      });
    }
  }, []);

  // Load conversation details
  const loadConversation = useCallback(async () => {
    try {
      // Get conversation from the conversations list
      const response = await apiClient.get('/api/conversations');
      const conversations = response.data.conversations || [];
      const conv = conversations.find((c: Conversation) => c.id === conversationId);
      if (conv) {
        setConversation(conv);
      }
    } catch (err: any) {
      console.error('Error loading conversation:', err);
    }
  }, [conversationId]);

  // Load messages
  const loadMessages = useCallback(async (pageNum: number = 1, append: boolean = false) => {
    try {
      if (append) {
        setIsLoadingMore(true);
      } else {
        setIsLoading(true);
      }
      setError(null);

      const limit = 50;
      const offset = (pageNum - 1) * limit;
      
      const response = await apiClient.get(`/api/messages/${conversationId}`, {
        params: {
          limit,
          offset,
        },
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
      const hasMoreMessages = response.data.hasMore || false;

      // Backend returns messages in DESC order (newest first), reverse for chat display
      const reversedMessages = [...newMessages].reverse();

      if (append) {
        // Prepend older messages (which are now at the beginning after reverse)
        setMessages((prev) => [...reversedMessages, ...prev]);
      } else {
        setMessages(reversedMessages);
      }

      setHasMore(hasMoreMessages);

      // Mark messages as read
      if (newMessages.length > 0) {
        markMessagesAsRead(newMessages);
      }
    } catch (err: any) {
      console.error('Error loading messages:', err);
      setError(err.response?.data?.error?.message || 'Failed to load messages');
    } finally {
      setIsLoading(false);
      setIsLoadingMore(false);
    }
  }, [conversationId]);

  // Mark messages as read
  const markMessagesAsRead = async (messagesToMark: Message[]) => {
    const unreadMessages = messagesToMark.filter(m => !m.isRead && !m.isOutgoing);
    
    for (const message of unreadMessages) {
      try {
        await apiClient.patch(`/api/messages/${message.id}/read`);
      } catch (err) {
        console.error('Error marking message as read:', err);
      }
    }
  };

  // Send message
  const handleSendMessage = async (content: string) => {
    setSendError(null);
    setFailedMessage(null);
    
    try {
      const response = await apiClient.post(`/api/messages/${conversationId}/send`, {
        content,
      });

      const newMessage = response.data.message;
      
      // Add the new message to the list
      setMessages((prev) => [...prev, newMessage]);
      
      // Scroll to bottom after sending
      setTimeout(() => scrollToBottom(true), 100);
      
      // Show success toast
      showSuccess('Message sent successfully');
      
      // Notify parent component
      if (onMessageSent) {
        onMessageSent();
      }
    } catch (err: any) {
      console.error('Error sending message:', err);
      const errorMessage = err.response?.data?.error?.message || 'Failed to send message';
      setSendError(errorMessage);
      setFailedMessage(content);
      showToastError(errorMessage);
      throw err;
    }
  };

  // Retry sending failed message
  const handleRetryMessage = async () => {
    if (failedMessage) {
      try {
        await handleSendMessage(failedMessage);
        setSendError(null);
        setFailedMessage(null);
      } catch (err) {
        // Error already handled in handleSendMessage
      }
    }
  };

  // Load more messages (infinite scroll)
  const handleLoadMore = useCallback(() => {
    if (!isLoadingMore && hasMore) {
      const nextPage = page + 1;
      setPage(nextPage);
      
      // Store current scroll position
      if (messagesContainerRef.current) {
        previousScrollHeightRef.current = messagesContainerRef.current.scrollHeight;
      }
      
      loadMessages(nextPage, true);
    }
  }, [isLoadingMore, hasMore, page, loadMessages]);

  // Handle scroll for infinite scroll and auto-scroll detection
  const handleScroll = useCallback(() => {
    if (messagesContainerRef.current) {
      const { scrollTop, scrollHeight, clientHeight } = messagesContainerRef.current;
      
      // Load more when scrolled near the top
      if (scrollTop < 100 && !isLoadingMore && hasMore) {
        handleLoadMore();
      }
      
      // Determine if user is near bottom (within 100px)
      const isNearBottom = scrollHeight - scrollTop - clientHeight < 100;
      shouldAutoScrollRef.current = isNearBottom;
    }
  }, [isLoadingMore, hasMore, handleLoadMore]);

  // Initial load
  useEffect(() => {
    loadConversation();
    loadMessages(1, false);
  }, [conversationId, loadConversation, loadMessages]);

  // Scroll to bottom on initial load
  useEffect(() => {
    if (!isLoading && isInitialLoadRef.current && messages.length > 0) {
      setTimeout(() => scrollToBottom(false), 100);
      isInitialLoadRef.current = false;
    }
  }, [isLoading, messages.length, scrollToBottom]);

  // Maintain scroll position after loading more messages
  useEffect(() => {
    if (isLoadingMore === false && previousScrollHeightRef.current > 0) {
      if (messagesContainerRef.current) {
        const newScrollHeight = messagesContainerRef.current.scrollHeight;
        const scrollDiff = newScrollHeight - previousScrollHeightRef.current;
        messagesContainerRef.current.scrollTop = scrollDiff;
        previousScrollHeightRef.current = 0;
      }
    }
  }, [isLoadingMore]);

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 z-50 flex items-center justify-center p-4">
      <div className="bg-white rounded-lg shadow-xl w-full max-w-4xl h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-gray-200">
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
              <div className="flex items-center space-x-2">
                <h2 className="text-lg font-semibold text-gray-900">
                  {conversation?.participantName || 'Loading...'}
                </h2>
                {/* Real-time status indicator */}
                {isAuthenticated && (
                  <div className="flex items-center space-x-1" title="Real-time updates active">
                    <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse" />
                    <span className="text-xs text-green-600">Live</span>
                  </div>
                )}
              </div>
              {conversation?.participantId && (
                <p className="text-sm text-gray-500">
                  {conversation.participantId}
                </p>
              )}
            </div>
          </div>
          
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-gray-600 transition-colors"
          >
            <svg
              className="w-6 h-6"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Messages Container */}
        <div
          ref={messagesContainerRef}
          onScroll={handleScroll}
          className="flex-1 overflow-y-auto p-4 bg-gray-50"
        >
          {/* Loading indicator for initial load */}
          {isLoading ? (
            <div className="flex items-center justify-center h-full">
              <LoadingSpinner size="lg" text="Loading messages..." />
            </div>
          ) : error ? (
            <ErrorDisplay
              message={error}
              title="Failed to load messages"
              onRetry={() => loadMessages(1, false)}
            />
          ) : (
            <>
              {/* Load more indicator */}
              {isLoadingMore && (
                <div className="flex justify-center py-4">
                  <LoadingSpinner size="md" />
                </div>
              )}

              {/* Messages */}
              {messages.length === 0 ? (
                <EmptyState
                  icon={
                    <svg
                      className="w-16 h-16 text-gray-400"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z"
                      />
                    </svg>
                  }
                  title="No messages yet"
                  description="Start the conversation!"
                />
              ) : (
                messages.map((message) => (
                  <MessageBubble
                    key={message.id}
                    message={message}
                    isOutgoing={message.isOutgoing}
                  />
                ))
              )}

              {/* Scroll anchor */}
              <div ref={messagesEndRef} />
            </>
          )}
        </div>

        {/* Send error message with retry */}
        {sendError && (
          <div className="px-4 py-3 bg-red-50 border-t border-red-200">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-2 flex-1">
                <svg
                  className="w-5 h-5 text-red-500 flex-shrink-0"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 8v4m0 4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
                  />
                </svg>
                <span className="text-sm text-red-600 flex-1">{sendError}</span>
              </div>
              <div className="flex items-center space-x-2 ml-4">
                {failedMessage && (
                  <button
                    onClick={handleRetryMessage}
                    className="px-3 py-1 text-sm font-medium text-white bg-red-600 rounded hover:bg-red-700 focus:outline-none focus:ring-2 focus:ring-red-500"
                  >
                    Retry
                  </button>
                )}
                <button
                  onClick={() => {
                    setSendError(null);
                    setFailedMessage(null);
                  }}
                  className="text-red-500 hover:text-red-700 focus:outline-none"
                >
                  <svg
                    className="w-5 h-5"
                    fill="none"
                    stroke="currentColor"
                    viewBox="0 0 24 24"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Message Input */}
        {platform !== 'twitter' ? (
          <MessageInput
            onSendMessage={handleSendMessage}
            disabled={isLoading || !!error}
            placeholder="Type a message..."
          />
        ) : (
          <div className="p-4 bg-gray-50 border-t border-gray-200 text-center text-sm text-gray-500">
            Twitter mentions are read-only. Reply directly on Twitter.
          </div>
        )}
      </div>
    </div>
  );
};

export default MessageThread;
