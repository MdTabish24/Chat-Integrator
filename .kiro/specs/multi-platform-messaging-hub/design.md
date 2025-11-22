# Design Document: Multi-Platform Messaging Hub

## Overview

The Multi-Platform Messaging Hub is a web-based application that provides a unified inbox for messages across multiple social media and communication platforms. The system uses OAuth 2.0 for authentication, platform-specific APIs for message retrieval and sending, and webhooks for real-time message synchronization.

### Key Design Principles

- **API-First Integration**: Use only official platform APIs to ensure stability and compliance
- **Real-Time Synchronization**: Leverage webhooks where available, with polling fallback
- **Security by Default**: Encrypt sensitive data at rest and in transit
- **Scalable Architecture**: Microservices pattern for independent platform integrations
- **Responsive UI**: Card-based expandable interface for optimal user experience

## Architecture

### High-Level Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                        Frontend (React)                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐   │
│  │ Telegram │  │ Twitter  │  │ LinkedIn │  │   Teams  │   │
│  │   Card   │  │   Card   │  │   Card   │  │   Card   │   │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘   │
└─────────────────────────────────────────────────────────────┘
                            │
                            │ REST API / WebSocket
                            ▼
┌─────────────────────────────────────────────────────────────┐
│                    API Gateway (Node.js)                     │
│              Authentication, Rate Limiting, Routing          │
└─────────────────────────────────────────────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│   OAuth      │   │   Message    │   │   Webhook    │
│   Service    │   │  Aggregator  │   │   Handler    │
└──────────────┘   └──────────────┘   └──────────────┘
        │                   │                   │
        └───────────────────┼───────────────────┘
                            ▼
                ┌───────────────────────┐
                │   PostgreSQL Database │
                │  (Encrypted Storage)  │
                └───────────────────────┘
                            │
        ┌───────────────────┼───────────────────┐
        ▼                   ▼                   ▼
┌──────────────┐   ┌──────────────┐   ┌──────────────┐
│  Telegram    │   │   Twitter    │   │  LinkedIn    │
│    API       │   │     API      │   │     API      │
└──────────────┘   └──────────────┘   └──────────────┘
```

### Technology Stack

**Frontend:**
- React 18+ with TypeScript
- Tailwind CSS for styling
- Socket.io-client for real-time updates
- Axios for HTTP requests
- React Query for data fetching and caching

**Backend:**
- Node.js with Express.js
- TypeScript for type safety
- Socket.io for WebSocket connections
- Bull for job queues (message polling, retry logic)
- Redis for caching and session management

**Database:**
- PostgreSQL 14+ for relational data
- pgcrypto extension for encryption

**Infrastructure:**
- Docker for containerization
- Nginx as reverse proxy
- Let's Encrypt for SSL certificates

## Components and Interfaces

### 1. Frontend Components

#### Platform Card Component
```typescript
interface PlatformCardProps {
  platform: 'telegram' | 'twitter' | 'linkedin' | 'instagram' | 'whatsapp' | 'facebook' | 'teams';
  unreadCount: number;
  isExpanded: boolean;
  conversations: Conversation[];
  onExpand: () => void;
  onConversationClick: (conversationId: string) => void;
}
```

#### Message Thread Component
```typescript
interface MessageThreadProps {
  conversationId: string;
  platform: string;
  messages: Message[];
  onSendMessage: (content: string) => Promise<void>;
  onLoadMore: () => void;
  hasMore: boolean;
}
```

#### Account Connection Component
```typescript
interface AccountConnectionProps {
  platforms: PlatformConfig[];
  connectedAccounts: ConnectedAccount[];
  onConnect: (platform: string) => void;
  onDisconnect: (accountId: string) => void;
}
```

### 2. Backend Services

#### OAuth Service

**Responsibilities:**
- Handle OAuth 2.0 authorization flow
- Store and refresh access tokens
- Manage token encryption/decryption

**API Endpoints:**
```
POST   /api/auth/connect/:platform
GET    /api/auth/callback/:platform
DELETE /api/auth/disconnect/:accountId
GET    /api/auth/accounts
```

**Platform-Specific OAuth Configurations:**

- **Telegram**: Bot API with user authorization
  - Scope: `messages:read`, `messages:write`
  - Token expiry: No expiration (bot token)
  
- **Twitter/X**: OAuth 2.0 with PKCE
  - Scope: `dm.read`, `dm.write`, `tweet.read`, `users.read`
  - Token expiry: 2 hours (requires refresh)
  
- **LinkedIn**: OAuth 2.0
  - Scope: `r_basicprofile`, `r_emailaddress`, `w_member_social`
  - Token expiry: 60 days
  
- **Instagram Business**: Facebook Graph API
  - Scope: `instagram_basic`, `instagram_manage_messages`
  - Token expiry: 60 days (long-lived token)
  
- **WhatsApp Business**: Cloud API
  - Scope: `whatsapp_business_messaging`
  - Token expiry: Never (system user token)
  
- **Facebook Pages**: Graph API
  - Scope: `pages_messaging`, `pages_manage_metadata`
  - Token expiry: 60 days
  
- **Microsoft Teams**: Microsoft Graph API
  - Scope: `Chat.Read`, `Chat.ReadWrite`, `ChatMessage.Send`
  - Token expiry: 1 hour (requires refresh)

#### Message Aggregator Service

**Responsibilities:**
- Fetch messages from platform APIs
- Store messages in database
- Handle pagination and message history
- Manage polling for non-webhook platforms

**API Endpoints:**
```
GET    /api/messages
GET    /api/messages/:conversationId
POST   /api/messages/:conversationId/send
PATCH  /api/messages/:messageId/read
GET    /api/conversations
```

**Platform Integration Modules:**

Each platform has a dedicated module implementing a common interface:

```typescript
interface PlatformAdapter {
  fetchMessages(accountId: string, since?: Date): Promise<Message[]>;
  sendMessage(accountId: string, conversationId: string, content: string): Promise<Message>;
  markAsRead(accountId: string, messageId: string): Promise<void>;
  getConversations(accountId: string): Promise<Conversation[]>;
}
```

**Polling Strategy:**
- Platforms without webhooks: Poll every 60 seconds
- Exponential backoff on API errors
- Respect rate limits (stored in Redis)

#### Webhook Handler Service

**Responsibilities:**
- Receive webhook notifications from platforms
- Validate webhook signatures
- Store incoming messages
- Emit real-time updates via WebSocket

**Webhook Endpoints:**
```
POST /api/webhooks/telegram
POST /api/webhooks/twitter
POST /api/webhooks/linkedin
POST /api/webhooks/instagram
POST /api/webhooks/whatsapp
POST /api/webhooks/facebook
POST /api/webhooks/teams
```

**Webhook Validation:**
- Telegram: Verify secret token
- Twitter: HMAC-SHA256 signature validation
- LinkedIn: Verify signature header
- Instagram/WhatsApp/Facebook: Verify app secret
- Teams: Validate JWT token

**Retry Logic:**
- Store failed webhook processing in job queue
- Retry up to 3 times with exponential backoff (1s, 5s, 15s)
- Log failures for monitoring

## Data Models

### Database Schema

#### users table
```sql
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW()
);
```

#### connected_accounts table
```sql
CREATE TABLE connected_accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  platform_user_id VARCHAR(255) NOT NULL,
  platform_username VARCHAR(255),
  access_token TEXT NOT NULL, -- encrypted
  refresh_token TEXT, -- encrypted
  token_expires_at TIMESTAMP,
  is_active BOOLEAN DEFAULT true,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(user_id, platform, platform_user_id)
);

CREATE INDEX idx_connected_accounts_user_id ON connected_accounts(user_id);
CREATE INDEX idx_connected_accounts_platform ON connected_accounts(platform);
```

#### conversations table
```sql
CREATE TABLE conversations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform_conversation_id VARCHAR(255) NOT NULL,
  participant_name VARCHAR(255),
  participant_id VARCHAR(255),
  participant_avatar_url TEXT,
  last_message_at TIMESTAMP,
  unread_count INTEGER DEFAULT 0,
  created_at TIMESTAMP DEFAULT NOW(),
  updated_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(account_id, platform_conversation_id)
);

CREATE INDEX idx_conversations_account_id ON conversations(account_id);
CREATE INDEX idx_conversations_last_message ON conversations(last_message_at DESC);
```

#### messages table
```sql
CREATE TABLE messages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id UUID REFERENCES conversations(id) ON DELETE CASCADE,
  platform_message_id VARCHAR(255) NOT NULL,
  sender_id VARCHAR(255) NOT NULL,
  sender_name VARCHAR(255),
  content TEXT NOT NULL, -- encrypted
  message_type VARCHAR(50) DEFAULT 'text', -- text, image, video, file
  media_url TEXT,
  is_outgoing BOOLEAN DEFAULT false,
  is_read BOOLEAN DEFAULT false,
  sent_at TIMESTAMP NOT NULL,
  delivered_at TIMESTAMP,
  created_at TIMESTAMP DEFAULT NOW(),
  UNIQUE(conversation_id, platform_message_id)
);

CREATE INDEX idx_messages_conversation_id ON messages(conversation_id);
CREATE INDEX idx_messages_sent_at ON messages(sent_at DESC);
CREATE INDEX idx_messages_is_read ON messages(is_read) WHERE is_read = false;
```

#### api_usage_logs table
```sql
CREATE TABLE api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  account_id UUID REFERENCES connected_accounts(id) ON DELETE CASCADE,
  platform VARCHAR(50) NOT NULL,
  endpoint VARCHAR(255) NOT NULL,
  request_count INTEGER DEFAULT 1,
  timestamp TIMESTAMP DEFAULT NOW()
);

CREATE INDEX idx_api_usage_platform_timestamp ON api_usage_logs(platform, timestamp);
```

### TypeScript Interfaces

```typescript
interface User {
  id: string;
  email: string;
  createdAt: Date;
  updatedAt: Date;
}

interface ConnectedAccount {
  id: string;
  userId: string;
  platform: Platform;
  platformUserId: string;
  platformUsername: string;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

interface Conversation {
  id: string;
  accountId: string;
  platformConversationId: string;
  participantName: string;
  participantId: string;
  participantAvatarUrl?: string;
  lastMessageAt: Date;
  unreadCount: number;
  createdAt: Date;
  updatedAt: Date;
}

interface Message {
  id: string;
  conversationId: string;
  platformMessageId: string;
  senderId: string;
  senderName: string;
  content: string;
  messageType: 'text' | 'image' | 'video' | 'file';
  mediaUrl?: string;
  isOutgoing: boolean;
  isRead: boolean;
  sentAt: Date;
  deliveredAt?: Date;
  createdAt: Date;
}

type Platform = 'telegram' | 'twitter' | 'linkedin' | 'instagram' | 'whatsapp' | 'facebook' | 'teams';
```

## Error Handling

### Error Categories

1. **Authentication Errors**
   - Token expired: Attempt automatic refresh
   - Token revoked: Notify user, prompt re-authentication
   - OAuth failure: Display error message with retry option

2. **API Errors**
   - Rate limit exceeded: Queue request, retry after reset
   - Network timeout: Retry with exponential backoff (max 3 attempts)
   - Invalid request: Log error, notify user
   - Platform API down: Display status message, queue operations

3. **Database Errors**
   - Connection failure: Retry connection, use connection pool
   - Constraint violation: Log error, return user-friendly message
   - Encryption failure: Log critical error, fail securely

4. **Webhook Errors**
   - Invalid signature: Log security event, reject request
   - Malformed payload: Log error, return 400 status
   - Processing failure: Queue for retry

### Error Response Format

```typescript
interface ErrorResponse {
  error: {
    code: string;
    message: string;
    details?: any;
    retryable: boolean;
  };
}
```

### Logging Strategy

- **Info**: Successful operations, webhook receipts
- **Warning**: Rate limit approaching, retry attempts
- **Error**: API failures, authentication errors
- **Critical**: Database failures, security violations

Use structured logging (JSON format) with correlation IDs for request tracing.

## Testing Strategy

### Unit Tests

**Coverage Target: 80%+**

- Service layer methods (OAuth, Message Aggregator, Webhook Handler)
- Platform adapter implementations
- Encryption/decryption utilities
- Database query functions
- API endpoint handlers

**Tools:**
- Jest for test framework
- Supertest for API testing
- Mock platform API responses

### Integration Tests

**Coverage:**
- OAuth flow end-to-end
- Message fetch and store pipeline
- Webhook receipt and processing
- WebSocket real-time updates
- Database transactions

**Tools:**
- Docker Compose for test environment
- Test database with seed data
- Mock webhook servers

### End-to-End Tests

**Scenarios:**
- User connects a platform account
- User views unread messages
- User sends a message
- User receives a new message (webhook simulation)
- User disconnects an account

**Tools:**
- Playwright for browser automation
- Test user accounts for each platform (sandbox/test environments)

### Security Testing

- SQL injection prevention
- XSS protection
- CSRF token validation
- Encryption verification
- Rate limiting effectiveness
- Webhook signature validation

### Performance Testing

- Load testing: 1000 concurrent users
- Message throughput: 100 messages/second
- API response time: < 200ms (p95)
- Database query optimization
- WebSocket connection stability

## Security Considerations

### Data Encryption

- **At Rest**: AES-256 encryption for tokens and message content using pgcrypto
- **In Transit**: TLS 1.3 for all API communications
- **Key Management**: Environment variables for encryption keys, rotate quarterly

### Authentication & Authorization

- JWT tokens for user sessions (15-minute expiry)
- Refresh tokens (7-day expiry)
- RBAC for admin functions
- Rate limiting: 100 requests/minute per user

### Platform API Security

- Store API credentials in environment variables
- Use webhook signature validation
- Implement request signing for outgoing API calls
- Monitor for suspicious activity (unusual API usage patterns)

### Compliance

- GDPR: User data deletion on account closure
- Data retention: Messages stored for 90 days (configurable)
- Privacy policy: Clear disclosure of data usage
- Terms of service: Platform API usage compliance

## Deployment Architecture

### Production Environment

```
┌─────────────────────────────────────────┐
│         Load Balancer (Nginx)           │
└─────────────────────────────────────────┘
                    │
        ┌───────────┴───────────┐
        ▼                       ▼
┌──────────────┐        ┌──────────────┐
│  App Server  │        │  App Server  │
│   (Node.js)  │        │   (Node.js)  │
└──────────────┘        └──────────────┘
        │                       │
        └───────────┬───────────┘
                    ▼
        ┌───────────────────────┐
        │   PostgreSQL Primary  │
        │   (with replication)  │
        └───────────────────────┘
                    │
                    ▼
        ┌───────────────────────┐
        │    Redis Cluster      │
        │  (Cache & Sessions)   │
        └───────────────────────┘
```

### Scaling Strategy

- Horizontal scaling: Add app server instances behind load balancer
- Database: Read replicas for query distribution
- Redis: Cluster mode for high availability
- Job queue: Separate worker processes for background tasks

### Monitoring & Observability

- Application metrics: Prometheus + Grafana
- Error tracking: Sentry
- Log aggregation: ELK Stack (Elasticsearch, Logstash, Kibana)
- Uptime monitoring: UptimeRobot
- API usage dashboards: Custom admin panel

## Platform-Specific Implementation Notes

### Telegram
- Use Bot API with long polling or webhooks
- No token expiry, but validate bot token periodically
- Support for media messages (photos, videos, documents)

### Twitter/X
- OAuth 2.0 with PKCE flow
- Rate limits: 300 requests/15 minutes for DM endpoints
- Webhook requires premium API access (consider polling for free tier)

### LinkedIn
- OAuth 2.0 flow
- Limited messaging API (only for connections)
- Rate limits: Varies by endpoint, typically 100 requests/day for messaging

### Instagram Business
- Requires Facebook Business account
- Graph API v17.0+
- Webhook for real-time messages
- Rate limits: 200 calls/hour per user

### WhatsApp Business
- Cloud API (recommended) or On-Premises API
- Webhook for incoming messages
- Message templates required for outbound messages (after 24-hour window)
- Pricing: Free tier available, then per-message cost

### Facebook Pages
- Graph API with page access token
- Webhook for page messages
- Rate limits: 200 calls/hour per user

### Microsoft Teams
- Microsoft Graph API
- OAuth 2.0 with Azure AD
- Webhook via Microsoft Graph subscriptions
- Rate limits: 10,000 requests/10 minutes per app

## Future Enhancements

1. **Message Search**: Full-text search across all platforms
2. **Smart Notifications**: AI-powered priority inbox
3. **Message Templates**: Quick replies and canned responses
4. **Analytics Dashboard**: Message volume, response time metrics
5. **Mobile Apps**: iOS and Android native applications
6. **Group Chat Support**: Multi-participant conversations
7. **File Sharing**: Direct file uploads through the hub
8. **Voice/Video**: Integration with platform calling features
