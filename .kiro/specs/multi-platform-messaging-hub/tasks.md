# Implementation Plan

- [x] 1. Set up project structure and development environment
  - Initialize Node.js backend with TypeScript, Express, and necessary dependencies
  - Initialize React frontend with TypeScript, Tailwind CSS, and build configuration
  - Set up Docker Compose for PostgreSQL, Redis, and application containers
  - Configure environment variables for API keys and database credentials
  - Set up ESLint, Prettier, and Git hooks for code quality
  - _Requirements: Foundation for all subsequent tasks_

- [x] 2. Implement database schema and encryption utilities
  - Create PostgreSQL database with pgcrypto extension enabled
  - Write migration scripts for users, connected_accounts, conversations, messages, and api_usage_logs tables
  - Implement encryption/decryption utility functions using AES-256 for sensitive fields
  - Create database connection pool and query helper functions
  - Set up database indexes for performance optimization
  - _Requirements: 1.3, 6.1, 6.2_

- [x] 3. Build user authentication system
  - Create user registration endpoint with password hashing (bcrypt)
  - Implement login endpoint with JWT token generation
  - Create JWT middleware for protected routes
  - Implement refresh token mechanism with 7-day expiry
  - Build logout endpoint that invalidates tokens
  - _Requirements: 6.4, 6.5_

- [x] 4. Implement OAuth service for platform connections
  - [x] 4.1 Create OAuth base service with common authorization flow logic
    - Implement OAuth 2.0 authorization URL generation
    - Create callback handler for receiving authorization codes
    - Implement token exchange and secure storage with encryption
    - Build token refresh mechanism with automatic retry
    - _Requirements: 1.2, 1.3, 1.4, 6.1_
  
  - [x] 4.2 Implement all platform OAuth integrations
    - Configure OAuth for Telegram, Twitter/X, LinkedIn, Instagram, WhatsApp, Facebook, and Microsoft Teams
    - Implement platform-specific authorization flows with required scopes
    - Handle token refresh mechanisms for each platform
    - _Requirements: 1.1, 1.2, 1.3, 1.4_

- [x] 5. Create platform adapter interface and base implementation
  - Define PlatformAdapter interface with fetchMessages, sendMessage, markAsRead, and getConversations methods
  - Create abstract base class with common error handling and rate limiting logic
  - Implement rate limit tracking using Redis with platform-specific limits
  - Build retry mechanism with exponential backoff for API failures
  - _Requirements: 5.4, 8.2, 8.3_

- [x] 6. Implement platform-specific message adapters
  - [x] 6.1 Create Telegram adapter
    - Implement getUpdates or webhook-based message fetching
    - Build sendMessage method using Telegram Bot API
    - Handle media messages (photos, videos, documents)
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2_
  
  - [x] 6.2 Create Twitter/X adapter
    - Implement DM fetching using Twitter API v2
    - Build sendMessage method for direct messages
    - Handle rate limits (300 requests/15 minutes)
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2, 8.2_
  
  - [x] 6.3 Create LinkedIn adapter
    - Implement message fetching using LinkedIn Conversations API
    - Build sendMessage method for LinkedIn messages
    - Handle connection-only messaging restrictions
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2_
  
  - [x] 6.4 Create Instagram Business adapter
    - Implement message fetching using Facebook Graph API
    - Build sendMessage method for Instagram DMs
    - Handle media attachments
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2_
  
  - [x] 6.5 Create WhatsApp Business adapter
    - Implement webhook-based message receiving
    - Build sendMessage method using Cloud API
    - Handle message templates for outbound messages
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2_
  
  - [x] 6.6 Create Facebook Pages adapter
    - Implement message fetching using Graph API
    - Build sendMessage method for page messages
    - Handle page-scoped user IDs
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2_
  
  - [x] 6.7 Create Microsoft Teams adapter
    - Implement message fetching using Microsoft Graph API
    - Build sendMessage method for Teams chats
    - Handle chat subscriptions for real-time updates
    - Implement conversation list retrieval
    - _Requirements: 3.1, 3.5, 4.1, 4.2_

- [x] 7. Build message aggregator service
  - Create service to fetch messages from all connected accounts
  - Implement message storage with encryption in database
  - Build conversation creation and update logic
  - Implement unread count calculation and tracking
  - Create pagination logic for message history retrieval
  - _Requirements: 2.1, 2.2, 3.1, 3.2, 3.3, 5.2, 6.2_

- [x] 8. Implement API endpoints for message operations
  - Create GET /api/messages endpoint to fetch messages with pagination
  - Create GET /api/messages/:conversationId endpoint for conversation threads
  - Create POST /api/messages/:conversationId/send endpoint for sending messages
  - Create PATCH /api/messages/:messageId/read endpoint to mark messages as read
  - Create GET /api/conversations endpoint to list all conversations with unread counts
  - Implement request validation and error handling for all endpoints
  - _Requirements: 2.2, 2.3, 3.1, 3.2, 4.1, 4.3, 4.4_

- [x] 9. Build account management API endpoints
  - Create GET /api/oauth/accounts endpoint to list connected accounts
  - Create DELETE /api/oauth/disconnect/:accountId endpoint to disconnect accounts
  - Implement token revocation with platform APIs
  - Build cleanup logic to mark accounts as inactive on disconnect
  - _Requirements: 1.5, 7.1, 7.2, 7.3, 7.4, 7.5, 6.3_

- [x] 10. Implement webhook handler service




  - [x] 10.1 Create webhook routes and base handler


    - Create webhook routes file with endpoints for all platforms
    - Implement webhook signature verification for each platform
    - Create common webhook processing pipeline
    - Build error handling and logging for webhook failures
    - _Requirements: 5.1, 5.4, 6.4_
  
  - [x] 10.2 Implement platform-specific webhook controllers

    - Create webhook controllers for Telegram, Twitter, LinkedIn, Instagram, WhatsApp, Facebook, and Teams
    - Implement platform-specific payload parsing using adapter methods
    - Handle webhook challenge/verification requests
    - Integrate with message aggregator to store incoming messages
    - _Requirements: 5.1, 5.2_
  
  - [x] 10.3 Build webhook retry mechanism with Bull queue


    - Set up Bull queue for failed webhook processing
    - Create retry logic with exponential backoff (1s, 5s, 15s)
    - Log webhook failures for monitoring
    - _Requirements: 5.4_

- [x] 11. Create polling service for non-webhook platforms





  - Set up Bull queue for background job scheduling
  - Create polling jobs that run every 60 seconds for each connected account
  - Implement platform detection to skip webhook-enabled platforms
  - Build error handling for polling failures
  - Integrate with message aggregator service
  - _Requirements: 5.5_

- [x] 12. Build real-time update system with WebSocket





  - Set up Socket.io server integrated with Express
  - Implement user authentication for WebSocket connections using JWT
  - Create event emitters for new messages, unread count updates, and message status changes
  - Emit events from webhook handler and polling service when new messages arrive
  - _Requirements: 2.5, 5.3_

- [x] 13. Implement API usage logging and rate limiting middleware





  - Create middleware to log API requests to api_usage_logs table
  - Implement rate limiting middleware using Redis (100 requests/minute per user)
  - Apply rate limiting to all protected API endpoints
  - Build rate limit checking before making platform API calls
  - _Requirements: 8.1, 8.2, 8.3, 6.4_

- [x] 14. Build frontend authentication UI





  - Create login page with email/password form and validation
  - Create registration page with validation
  - Implement JWT token storage in localStorage
  - Build authentication context provider for React
  - Create protected route wrapper component
  - Implement automatic token refresh logic
  - Add routing with react-router-dom
  - _Requirements: Foundation for frontend features_

- [x] 15. Create account connection UI





  - Build account connection page with platform cards for all 7 platforms
  - Implement OAuth redirect flow for each platform
  - Create callback page to handle OAuth responses and display success/error
  - Build connected accounts list with disconnect buttons
  - Implement confirmation dialog for account disconnection
  - _Requirements: 1.1, 1.2, 1.5, 7.1, 7.2, 7.3, 7.5_

- [x] 16. Build main dashboard with platform cards





  - Create dashboard layout with responsive grid
  - Implement PlatformCard component with expand/collapse functionality
  - Build unread count badge display
  - Create conversation list within expanded cards
  - Implement real-time updates via WebSocket for unread counts
  - Add loading states and error handling
  - _Requirements: 2.1, 2.2, 2.3, 2.4, 2.5_

- [x] 17. Implement message thread UI





  - Create MessageThread component with scrollable message list
  - Build message bubble components for incoming and outgoing messages
  - Implement message input field with send button
  - Create media message display (images, videos, files)
  - Build infinite scroll for loading older messages
  - Implement auto-scroll to bottom on new messages
  - Add message status indicators (sent, delivered)
  - _Requirements: 3.1, 3.2, 3.3, 3.4, 3.5, 4.1, 4.3, 4.4, 4.5_

- [x] 18. Implement real-time message updates in frontend





  - Set up Socket.io client connection with authentication
  - Implement event listeners for new messages
  - Update unread counts in real-time
  - Add message status updates (delivered, read)
  - Implement reconnection logic on connection loss
  - Update UI components to reflect real-time changes
  - _Requirements: 2.5, 5.3_

- [x] 19. Build error handling and user feedback UI





  - Create error notification component (toast/snackbar)
  - Implement error display for failed message sends with retry button
  - Build connection error indicators for disconnected accounts
  - Create loading spinners for async operations
  - Implement empty states for no messages/conversations
  - _Requirements: 1.5, 4.4_

- [x] 20. Implement security enhancements





  - Create CSRF protection middleware
  - Implement XSS sanitization for message content
  - Verify SQL injection prevention with parameterized queries (already implemented)
  - Add input validation schemas using Joi for remaining endpoints
  - Configure HTTPS enforcement in production environment
  - _Requirements: 6.4_

- [ ]* 21. Write unit tests for backend services
  - Write tests for OAuth service methods
  - Write tests for platform adapters
  - Write tests for message aggregator service
  - Write tests for webhook handler
  - Write tests for encryption utilities
  - Write tests for API endpoints
  - _Requirements: All requirements (validation)_

- [ ]* 22. Write integration tests
  - Write tests for OAuth flow end-to-end
  - Write tests for message fetch and store pipeline
  - Write tests for webhook processing
  - Write tests for WebSocket real-time updates
  - Write tests for database transactions
  - _Requirements: All requirements (validation)_

- [ ]* 23. Write end-to-end tests
  - Write tests for user connects platform account flow
  - Write tests for viewing unread messages
  - Write tests for sending messages
  - Write tests for receiving new messages
  - Write tests for disconnecting accounts
  - _Requirements: All requirements (validation)_

- [ ]* 24. Set up monitoring and logging infrastructure
  - Configure structured logging with Winston or Pino
  - Set up error tracking with Sentry
  - Implement API usage dashboard for monitoring rate limits
  - Create health check endpoints for uptime monitoring (already exists)
  - Build admin panel for viewing API usage logs
  - _Requirements: 8.1, 8.4, 8.5_

- [ ]* 25. Create deployment configuration
  - Write Dockerfile for backend application
  - Write Dockerfile for frontend application
  - Create Docker Compose file for production deployment
  - Configure Nginx as reverse proxy with SSL
  - Set up environment variable management
  - Create database backup and restore scripts
  - _Requirements: Foundation for production deployment_

- [ ]* 26. Implement data retention and cleanup jobs
  - Create scheduled job to delete messages older than 90 days
  - Implement user data deletion on account closure (GDPR compliance)
  - Build cleanup job for expired tokens
  - Create database vacuum and optimization jobs
  - _Requirements: 6.3_

- [ ]* 27. Build admin monitoring dashboard
  - Create admin UI for viewing system health
  - Implement API usage charts per platform
  - Build webhook failure monitoring view
  - Create user account management interface
  - Implement rate limit status display
  - _Requirements: 8.1, 8.4, 8.5_
