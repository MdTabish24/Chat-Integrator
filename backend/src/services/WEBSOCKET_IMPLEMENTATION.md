# WebSocket Implementation Guide

## Overview

The WebSocket service provides real-time updates for the Multi-Platform Messaging Hub using Socket.io. It enables instant notifications for new messages, unread count updates, and message status changes without requiring page refreshes.

## Architecture

### Components

1. **WebSocketService** (`websocketService.ts`)
   - Manages Socket.io server instance
   - Handles client authentication
   - Emits events to connected clients
   - Tracks active connections

2. **Integration Points**
   - **Webhook Handler**: Emits events when webhooks receive new messages
   - **Message Aggregator**: Emits events when messages are stored or marked as read
   - **Polling Service**: Emits events when polling fetches new messages

## Authentication Flow

### Client Connection

1. Client connects to WebSocket server
2. Client must authenticate within 10 seconds
3. Client sends `authenticate` event with JWT token
4. Server verifies token and joins client to user-specific room
5. Server sends `authenticated` event on success

### Example Client Code

```typescript
import io from 'socket.io-client';

const socket = io('http://localhost:3000', {
  transports: ['websocket', 'polling']
});

// Authenticate immediately after connection
socket.on('connect', () => {
  const token = localStorage.getItem('accessToken');
  socket.emit('authenticate', { token });
});

// Handle authentication success
socket.on('authenticated', (data) => {
  console.log('Authenticated:', data);
});

// Handle authentication error
socket.on('auth_error', (error) => {
  console.error('Auth error:', error);
});
```

## Events

### Client → Server Events

#### `authenticate`
Authenticate the WebSocket connection with a JWT token.

**Payload:**
```typescript
{
  token: string; // JWT access token
}
```

**Response:**
- `authenticated` event on success
- `auth_error` event on failure

### Server → Client Events

#### `authenticated`
Sent when authentication is successful.

**Payload:**
```typescript
{
  userId: string;
  email: string;
}
```

#### `auth_error`
Sent when authentication fails.

**Payload:**
```typescript
{
  message: string;
}
```

#### `new_message`
Sent when a new message is received.

**Payload:**
```typescript
{
  message: Message;
  conversation?: Conversation;
  timestamp: string;
}
```

**Example Handler:**
```typescript
socket.on('new_message', (data) => {
  console.log('New message:', data.message);
  // Update UI with new message
  updateMessageList(data.message);
  updateUnreadBadge();
});
```

#### `message_status_update`
Sent when a message status changes (e.g., marked as read).

**Payload:**
```typescript
{
  messageId: string;
  conversationId: string;
  status: 'read' | 'delivered';
  timestamp: string;
}
```

**Example Handler:**
```typescript
socket.on('message_status_update', (data) => {
  console.log('Message status updated:', data);
  // Update message status in UI
  updateMessageStatus(data.messageId, data.status);
});
```

#### `unread_count_update`
Sent when unread counts change.

**Payload:**
```typescript
{
  unreadCounts: Record<Platform, number>;
  totalUnread: number;
  timestamp: string;
}
```

**Example Handler:**
```typescript
socket.on('unread_count_update', (data) => {
  console.log('Unread counts:', data);
  // Update unread badges in UI
  updatePlatformBadges(data.unreadCounts);
  updateTotalUnreadBadge(data.totalUnread);
});
```

#### `conversation_update`
Sent when a conversation is updated.

**Payload:**
```typescript
{
  conversation: Conversation;
  timestamp: string;
}
```

**Example Handler:**
```typescript
socket.on('conversation_update', (data) => {
  console.log('Conversation updated:', data.conversation);
  // Update conversation in UI
  updateConversation(data.conversation);
});
```

#### `error`
Sent when an error occurs.

**Payload:**
```typescript
{
  error: string;
  code?: string;
  timestamp: string;
}
```

## Connection Management

### User Rooms

Each authenticated user is automatically joined to a user-specific room:
- Room name format: `user:{userId}`
- All events are emitted to the user's room
- Multiple connections from the same user share the same room

### Multiple Connections

The service supports multiple simultaneous connections per user:
- Same user can connect from multiple devices/tabs
- All connections receive the same events
- Connections are tracked independently

### Disconnection

When a client disconnects:
- Socket is removed from tracking
- User room is automatically cleaned up if no more connections
- No manual cleanup required

## Integration Examples

### Emitting Events from Backend

#### From Webhook Handler

```typescript
import { websocketService } from './websocketService';

// After storing a message
websocketService.emitNewMessage(userId, message, conversation);

// After updating unread counts
const unreadCounts = await messageAggregatorService.getUnreadCountByPlatform(userId);
const totalUnread = await messageAggregatorService.getTotalUnreadCount(userId);
websocketService.emitUnreadCountUpdate(userId, unreadCounts, totalUnread);
```

#### From Message Aggregator

```typescript
// After marking messages as read
websocketService.emitMessageStatusUpdate(userId, messageId, 'read', conversationId);

// After conversation update
websocketService.emitConversationUpdate(userId, conversation);
```

## Monitoring

### Health Check

The `/health` endpoint includes WebSocket statistics:

```bash
curl http://localhost:3000/health
```

**Response:**
```json
{
  "status": "ok",
  "timestamp": "2024-01-01T00:00:00.000Z",
  "services": {
    "database": "connected",
    "redis": "connected",
    "websocket": {
      "status": "active",
      "connections": 5,
      "authenticatedUsers": 3
    }
  }
}
```

### Service Methods

```typescript
// Get connection statistics
const stats = websocketService.getStats();
// Returns: { totalConnections, authenticatedUsers, averageConnectionsPerUser }

// Check if user is connected
const isConnected = websocketService.isUserConnected(userId);

// Get connection count for user
const count = websocketService.getUserConnectionCount(userId);

// Disconnect all sockets for a user (e.g., on logout)
websocketService.disconnectUser(userId);
```

## Security

### Authentication

- JWT tokens are verified on connection
- Invalid tokens result in immediate disconnection
- 10-second authentication timeout
- Tokens are not stored, only verified

### Authorization

- Users only receive events for their own data
- Room-based isolation prevents cross-user events
- No ability to join other users' rooms

### CORS

CORS is configured to allow connections from the frontend:
```typescript
cors: {
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true
}
```

Update `FRONTEND_URL` environment variable for production.

## Troubleshooting

### Connection Issues

**Problem:** Client can't connect
- Check CORS configuration
- Verify WebSocket port is accessible
- Check firewall rules

**Problem:** Authentication fails
- Verify JWT token is valid
- Check token expiration
- Ensure token is sent in correct format

### Event Issues

**Problem:** Events not received
- Verify client is authenticated
- Check client is listening for correct event names
- Verify user ID matches

**Problem:** Duplicate events
- Check for multiple socket connections
- Verify event handlers aren't registered multiple times

### Performance

**Problem:** High memory usage
- Monitor connection count
- Check for connection leaks
- Verify disconnections are handled properly

## Testing

### Manual Testing

1. Start the server
2. Connect with a WebSocket client (e.g., Socket.io client)
3. Authenticate with a valid JWT token
4. Trigger events (send message, mark as read, etc.)
5. Verify events are received

### Example Test Script

```typescript
import io from 'socket.io-client';

const socket = io('http://localhost:3000');

socket.on('connect', () => {
  console.log('Connected');
  socket.emit('authenticate', { token: 'YOUR_JWT_TOKEN' });
});

socket.on('authenticated', (data) => {
  console.log('Authenticated:', data);
});

socket.on('new_message', (data) => {
  console.log('New message:', data);
});

socket.on('unread_count_update', (data) => {
  console.log('Unread count update:', data);
});

socket.on('disconnect', () => {
  console.log('Disconnected');
});
```

## Environment Variables

```env
# Frontend URL for CORS
FRONTEND_URL=http://localhost:5173

# Server port (WebSocket uses same port as HTTP)
PORT=3000
```

## Future Enhancements

- [ ] Reconnection logic with exponential backoff
- [ ] Event acknowledgments
- [ ] Typing indicators
- [ ] Online/offline status
- [ ] Message delivery receipts
- [ ] Presence system
- [ ] Rate limiting per connection
- [ ] Redis adapter for horizontal scaling
