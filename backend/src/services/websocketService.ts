import { Server as HTTPServer } from 'http';
import { Server as SocketIOServer, Socket } from 'socket.io';
import authService from './authService';
import { Message, Conversation, Platform } from '../types';

/**
 * WebSocket event types
 */
export enum WebSocketEvent {
  // Client -> Server
  AUTHENTICATE = 'authenticate',
  JOIN_ROOM = 'join_room',
  LEAVE_ROOM = 'leave_room',
  
  // Server -> Client
  AUTHENTICATED = 'authenticated',
  AUTH_ERROR = 'auth_error',
  NEW_MESSAGE = 'new_message',
  MESSAGE_STATUS_UPDATE = 'message_status_update',
  UNREAD_COUNT_UPDATE = 'unread_count_update',
  CONVERSATION_UPDATE = 'conversation_update',
  ERROR = 'error'
}

/**
 * Interface for authenticated socket
 */
interface AuthenticatedSocket extends Socket {
  userId?: string;
  email?: string;
}

/**
 * WebSocket service for real-time updates
 * Manages Socket.io connections and event emissions
 */
export class WebSocketService {
  private io: SocketIOServer | null = null;
  private authenticatedSockets: Map<string, Set<string>> = new Map(); // userId -> Set of socket IDs

  /**
   * Initialize Socket.io server
   * @param httpServer - The HTTP server instance
   */
  initialize(httpServer: HTTPServer): void {
    if (this.io) {
      console.log('WebSocket service already initialized');
      return;
    }

    console.log('Initializing WebSocket service...');

    this.io = new SocketIOServer(httpServer, {
      cors: {
        origin: process.env.FRONTEND_URL || 'http://localhost:5173',
        credentials: true
      },
      transports: ['websocket', 'polling']
    });

    this.setupConnectionHandler();

    console.log('WebSocket service initialized successfully');
  }

  /**
   * Set up connection handler for new socket connections
   */
  private setupConnectionHandler(): void {
    if (!this.io) return;

    this.io.on('connection', (socket: AuthenticatedSocket) => {
      console.log(`New WebSocket connection: ${socket.id}`);

      // Handle authentication
      socket.on(WebSocketEvent.AUTHENTICATE, async (data: { token: string }) => {
        try {
          await this.authenticateSocket(socket, data.token);
        } catch (error) {
          const message = error instanceof Error ? error.message : 'Authentication failed';
          socket.emit(WebSocketEvent.AUTH_ERROR, { message });
          socket.disconnect();
        }
      });

      // Handle disconnection
      socket.on('disconnect', () => {
        this.handleDisconnect(socket);
      });

      // Set a timeout for authentication
      setTimeout(() => {
        if (!socket.userId) {
          console.log(`Socket ${socket.id} failed to authenticate within timeout`);
          socket.emit(WebSocketEvent.AUTH_ERROR, { message: 'Authentication timeout' });
          socket.disconnect();
        }
      }, 10000); // 10 second timeout
    });
  }

  /**
   * Authenticate a socket connection using JWT
   * @param socket - The socket to authenticate
   * @param token - The JWT access token
   */
  private async authenticateSocket(socket: AuthenticatedSocket, token: string): Promise<void> {
    try {
      // Verify JWT token
      const payload = authService.verifyAccessToken(token);

      // Attach user info to socket
      socket.userId = payload.userId;
      socket.email = payload.email;

      // Join user-specific room
      const userRoom = this.getUserRoom(payload.userId);
      socket.join(userRoom);

      // Track authenticated socket
      if (!this.authenticatedSockets.has(payload.userId)) {
        this.authenticatedSockets.set(payload.userId, new Set());
      }
      this.authenticatedSockets.get(payload.userId)!.add(socket.id);

      console.log(`Socket ${socket.id} authenticated for user ${payload.userId}`);

      // Send authentication success
      socket.emit(WebSocketEvent.AUTHENTICATED, {
        userId: payload.userId,
        email: payload.email
      });

    } catch (error) {
      console.error(`Authentication failed for socket ${socket.id}:`, error);
      throw error;
    }
  }

  /**
   * Handle socket disconnection
   * @param socket - The disconnected socket
   */
  private handleDisconnect(socket: AuthenticatedSocket): void {
    console.log(`Socket disconnected: ${socket.id}`);

    if (socket.userId) {
      const userSockets = this.authenticatedSockets.get(socket.userId);
      if (userSockets) {
        userSockets.delete(socket.id);
        if (userSockets.size === 0) {
          this.authenticatedSockets.delete(socket.userId);
        }
      }
    }
  }

  /**
   * Get the room name for a user
   * @param userId - The user ID
   * @returns The room name
   */
  private getUserRoom(userId: string): string {
    return `user:${userId}`;
  }

  /**
   * Emit a new message event to a user
   * @param userId - The user ID to send the event to
   * @param message - The new message
   * @param conversation - The conversation the message belongs to
   */
  emitNewMessage(userId: string, message: Message, conversation?: Conversation): void {
    if (!this.io) {
      console.warn('WebSocket service not initialized');
      return;
    }

    const userRoom = this.getUserRoom(userId);
    
    this.io.to(userRoom).emit(WebSocketEvent.NEW_MESSAGE, {
      message,
      conversation,
      timestamp: new Date().toISOString()
    });

    console.log(`Emitted new message event to user ${userId}`);
  }

  /**
   * Emit a message status update event
   * @param userId - The user ID to send the event to
   * @param messageId - The message ID
   * @param status - The new status (e.g., 'read', 'delivered')
   * @param conversationId - The conversation ID
   */
  emitMessageStatusUpdate(
    userId: string,
    messageId: string,
    status: 'read' | 'delivered',
    conversationId: string
  ): void {
    if (!this.io) {
      console.warn('WebSocket service not initialized');
      return;
    }

    const userRoom = this.getUserRoom(userId);
    
    this.io.to(userRoom).emit(WebSocketEvent.MESSAGE_STATUS_UPDATE, {
      messageId,
      conversationId,
      status,
      timestamp: new Date().toISOString()
    });

    console.log(`Emitted message status update to user ${userId}: ${messageId} -> ${status}`);
  }

  /**
   * Emit an unread count update event
   * @param userId - The user ID to send the event to
   * @param unreadCounts - Map of platform to unread count
   * @param totalUnread - Total unread count across all platforms
   */
  emitUnreadCountUpdate(
    userId: string,
    unreadCounts: Map<Platform, number>,
    totalUnread: number
  ): void {
    if (!this.io) {
      console.warn('WebSocket service not initialized');
      return;
    }

    const userRoom = this.getUserRoom(userId);
    
    // Convert Map to object for JSON serialization
    const unreadCountsObj: Record<string, number> = {};
    unreadCounts.forEach((count, platform) => {
      unreadCountsObj[platform] = count;
    });

    this.io.to(userRoom).emit(WebSocketEvent.UNREAD_COUNT_UPDATE, {
      unreadCounts: unreadCountsObj,
      totalUnread,
      timestamp: new Date().toISOString()
    });

    console.log(`Emitted unread count update to user ${userId}: ${totalUnread} total`);
  }

  /**
   * Emit a conversation update event
   * @param userId - The user ID to send the event to
   * @param conversation - The updated conversation
   */
  emitConversationUpdate(userId: string, conversation: Conversation): void {
    if (!this.io) {
      console.warn('WebSocket service not initialized');
      return;
    }

    const userRoom = this.getUserRoom(userId);
    
    this.io.to(userRoom).emit(WebSocketEvent.CONVERSATION_UPDATE, {
      conversation,
      timestamp: new Date().toISOString()
    });

    console.log(`Emitted conversation update to user ${userId}: ${conversation.id}`);
  }

  /**
   * Emit an error event to a specific user
   * @param userId - The user ID to send the event to
   * @param error - The error message
   * @param code - Optional error code
   */
  emitError(userId: string, error: string, code?: string): void {
    if (!this.io) {
      console.warn('WebSocket service not initialized');
      return;
    }

    const userRoom = this.getUserRoom(userId);
    
    this.io.to(userRoom).emit(WebSocketEvent.ERROR, {
      error,
      code,
      timestamp: new Date().toISOString()
    });

    console.log(`Emitted error to user ${userId}: ${error}`);
  }

  /**
   * Get the number of connected sockets for a user
   * @param userId - The user ID
   * @returns The number of connected sockets
   */
  getUserConnectionCount(userId: string): number {
    const userSockets = this.authenticatedSockets.get(userId);
    return userSockets ? userSockets.size : 0;
  }

  /**
   * Check if a user has any active connections
   * @param userId - The user ID
   * @returns True if the user has at least one active connection
   */
  isUserConnected(userId: string): boolean {
    return this.getUserConnectionCount(userId) > 0;
  }

  /**
   * Get total number of connected clients
   * @returns The total number of connected sockets
   */
  getTotalConnections(): number {
    let total = 0;
    this.authenticatedSockets.forEach(sockets => {
      total += sockets.size;
    });
    return total;
  }

  /**
   * Get statistics about WebSocket connections
   * @returns Connection statistics
   */
  getStats(): {
    totalConnections: number;
    authenticatedUsers: number;
    averageConnectionsPerUser: number;
  } {
    const totalConnections = this.getTotalConnections();
    const authenticatedUsers = this.authenticatedSockets.size;
    const averageConnectionsPerUser = authenticatedUsers > 0 
      ? totalConnections / authenticatedUsers 
      : 0;

    return {
      totalConnections,
      authenticatedUsers,
      averageConnectionsPerUser: Math.round(averageConnectionsPerUser * 100) / 100
    };
  }

  /**
   * Disconnect all sockets for a specific user
   * Useful when a user logs out or their session is invalidated
   * @param userId - The user ID
   */
  disconnectUser(userId: string): void {
    if (!this.io) return;

    const userSockets = this.authenticatedSockets.get(userId);
    if (!userSockets) return;

    userSockets.forEach(socketId => {
      const socket = this.io!.sockets.sockets.get(socketId);
      if (socket) {
        socket.disconnect(true);
      }
    });

    this.authenticatedSockets.delete(userId);
    console.log(`Disconnected all sockets for user ${userId}`);
  }

  /**
   * Shutdown the WebSocket service gracefully
   */
  async shutdown(): Promise<void> {
    if (!this.io) return;

    console.log('Shutting down WebSocket service...');

    // Disconnect all clients
    this.io.disconnectSockets(true);

    // Close the server
    await new Promise<void>((resolve) => {
      this.io!.close(() => {
        console.log('WebSocket service shut down successfully');
        resolve();
      });
    });

    this.io = null;
    this.authenticatedSockets.clear();
  }
}

// Export singleton instance
export const websocketService = new WebSocketService();
