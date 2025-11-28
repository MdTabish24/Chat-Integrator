import { useEffect, useRef, useCallback, useState } from 'react';
import { Message, Conversation, Platform } from '../types';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 
  (typeof window !== 'undefined' && window.location.origin) || 
  'http://localhost:8000';

const WS_BASE_URL = API_BASE_URL.replace('http://', 'ws://').replace('https://', 'wss://');

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
  const socketRef = useRef<WebSocket | null>(null);
  const [isConnected, setIsConnected] = useState(false);
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const reconnectTimeoutRef = useRef<NodeJS.Timeout>();
  const reconnectAttemptsRef = useRef(0);
  const callbacksRef = useRef(callbacks);

  // Update callbacks ref without triggering reconnect
  useEffect(() => {
    callbacksRef.current = callbacks;
  }, [callbacks]);

  const connect = useCallback(() => {
    const token = localStorage.getItem('access_token');
    if (!token) {
      console.warn('No access token available for WebSocket connection');
      return;
    }

    if (socketRef.current?.readyState === WebSocket.OPEN) {
      console.log('WebSocket already connected');
      return;
    }

    console.log('Connecting to WebSocket...');

    const ws = new WebSocket(`${WS_BASE_URL}/ws/messages/?token=${token}`);
    socketRef.current = ws;

    ws.onopen = () => {
      console.log('WebSocket connected');
      setIsConnected(true);
      reconnectAttemptsRef.current = 0;
    };

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data);
        const eventType = data.event;

        switch (eventType) {
          case 'authenticated':
            console.log('WebSocket authenticated:', data.data);
            setIsAuthenticated(true);
            break;

          case 'new_message':
            console.log('New message received:', data.data);
            callbacksRef.current.onNewMessage?.(data.data);
            break;

          case 'unread_count_update':
            console.log('Unread count update:', data.data);
            callbacksRef.current.onUnreadCountUpdate?.(data.data);
            break;

          case 'message_status_update':
            console.log('Message status update:', data.data);
            callbacksRef.current.onMessageStatusUpdate?.(data.data);
            break;

          case 'conversation_update':
            console.log('Conversation update:', data.data);
            callbacksRef.current.onConversationUpdate?.(data.data);
            break;

          case 'error':
            console.error('WebSocket error:', data.data);
            callbacksRef.current.onError?.(data.data);
            break;

          default:
            console.log('Unknown event type:', eventType, data);
        }
      } catch (err) {
        console.error('Error parsing WebSocket message:', err);
      }
    };

    ws.onerror = (error) => {
      console.error('WebSocket error:', error);
      setIsConnected(false);
      setIsAuthenticated(false);
    };

    ws.onclose = () => {
      console.log('WebSocket disconnected');
      setIsConnected(false);
      setIsAuthenticated(false);

      // Reconnect with exponential backoff
      if (reconnectAttemptsRef.current < 5) {
        const delay = Math.min(1000 * Math.pow(2, reconnectAttemptsRef.current), 5000);
        console.log(`Reconnecting in ${delay}ms...`);
        reconnectTimeoutRef.current = setTimeout(() => {
          reconnectAttemptsRef.current++;
          connect();
        }, delay);
      }
    };
  }, []);

  const disconnect = useCallback(() => {
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current);
    }
    if (socketRef.current) {
      console.log('Disconnecting WebSocket...');
      socketRef.current.close();
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
