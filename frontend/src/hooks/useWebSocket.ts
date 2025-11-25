import { useEffect, useRef, useCallback, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { Message, Conversation, Platform } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (typeof window !== 'undefined' && window.location.origin) || 
  'http://localhost:8000';

interface UnreadCountUpdate {
  unreadCounts: Record<Platform, number>;
  totalUnread: number;
  timestamp: string;
}

interface NewMessageEvent {
  message: Message;
  conversation?: Conversation;
  timestamp: string;
}

interface MessageStatusUpdate {
  messageId: string;
  conversationId: string;
  status: 'read' | 'delivered';
  timestamp: string;
}

interface ConversationUpdateEvent {
  conversation: Conversation;
  timestamp: string;
}

interface WebSocketHookCallbacks {
  onNewMessage?: (data: NewMessageEvent) => void;
  onUnreadCountUpdate?: (data: UnreadCountUpdate) => void;
  onMessageStatusUpdate?: (data: MessageStatusUpdate) => void;
  onConversationUpdate?: (data: ConversationUpdateEvent) => void;
  onError?: (error: { error: string; code?: string }) => void;
}

export const useWebSocket = (callbacks: WebSocketHookCallbacks = {}) => {
  const socketRef = useRef<Socket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);

  const connect = useCallback(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      console.warn('No access token available for WebSocket connection');
      return;
    }

    if (socketRef.current?.connected) {
      console.log('WebSocket already connected');
      return;
    }

    console.log('Connecting to WebSocket...');

    const socket = io(API_BASE_URL, {
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 5000,
      reconnectionAttempts: 5,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      
      // Authenticate the socket
      socket.emit('authenticate', { token });
    });

    socket.on('authenticated', (data: { userId: string; email: string }) => {
      console.log('WebSocket authenticated:', data);
      setIsAuthenticated(true);
    });

    socket.on('auth_error', (data: { message: string }) => {
      console.error('WebSocket authentication error:', data.message);
      setIsAuthenticated(false);
      socket.disconnect();
    });

    socket.on('disconnect', (reason) => {
      console.log('WebSocket disconnected:', reason);
      setIsConnected(false);
      setIsAuthenticated(false);
    });

    socket.on('new_message', (data: NewMessageEvent) => {
      console.log('New message received:', data);
      callbacks.onNewMessage?.(data);
    });

    socket.on('unread_count_update', (data: UnreadCountUpdate) => {
      console.log('Unread count update:', data);
      callbacks.onUnreadCountUpdate?.(data);
    });

    socket.on('message_status_update', (data: MessageStatusUpdate) => {
      console.log('Message status update:', data);
      callbacks.onMessageStatusUpdate?.(data);
    });

    socket.on('conversation_update', (data: ConversationUpdateEvent) => {
      console.log('Conversation update:', data);
      callbacks.onConversationUpdate?.(data);
    });

    socket.on('error', (data: { error: string; code?: string }) => {
      console.error('WebSocket error:', data);
      callbacks.onError?.(data);
    });

    socket.on('connect_error', (error) => {
      console.error('WebSocket connection error:', error);
    });

    socket.on('reconnect', (attemptNumber) => {
      console.log('WebSocket reconnected after', attemptNumber, 'attempts');
    });

    socket.on('reconnect_failed', () => {
      console.error('WebSocket reconnection failed');
    });

  }, [callbacks]);

  const disconnect = useCallback(() => {
    if (socketRef.current) {
      console.log('Disconnecting WebSocket...');
      socketRef.current.disconnect();
      socketRef.current = null;
      setIsConnected(false);
      setIsAuthenticated(false);
    }
  }, []);

  useEffect(() => {
    connect();

    return () => {
      disconnect();
    };
  }, []);

  return {
    isConnected,
    isAuthenticated,
    reconnect: connect,
    disconnect,
  };
};
