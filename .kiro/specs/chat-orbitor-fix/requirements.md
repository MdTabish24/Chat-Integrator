# Requirements Document

## Introduction

Chat Orbitor is a unified messaging platform that aggregates conversations from multiple social media and communication platforms into a single dashboard. The system was migrated from TypeScript+PostgreSQL to Django+MySQL and requires fixes for existing functionality (Telegram, WebSocket) plus integration of new platforms (Twitter, LinkedIn, Instagram, Facebook, WhatsApp, Discord, Gmail, Teams) using cookie-based authentication for platforms that don't provide free DM API access.

## Glossary

- **Chat_Orbitor**: The unified messaging dashboard system
- **Platform_Adapter**: A service component that handles communication with a specific social platform
- **Cookie_Auth**: Authentication method using browser session cookies instead of OAuth tokens
- **Rate_Limiter**: Component that controls request frequency to avoid platform bans
- **Encryption_Service**: AES-256 encryption service for storing sensitive credentials
- **WebSocket_Service**: Real-time communication service for instant message updates
- **Sync_Service**: Background service that periodically fetches new messages from platforms

## Requirements

### Requirement 1: WebSocket Connection Fix

**User Story:** As a user, I want real-time message updates, so that I can see new messages instantly without refreshing.

#### Acceptance Criteria

1. WHEN the application starts THEN the Chat_Orbitor SHALL configure WebSocket routing for the 'websocket' scope type
2. WHEN a user connects via WebSocket THEN the Chat_Orbitor SHALL authenticate the connection using JWT tokens
3. WHEN a new message arrives THEN the Chat_Orbitor SHALL broadcast the message to the connected user within 2 seconds
4. IF WebSocket connection fails THEN the Chat_Orbitor SHALL attempt reconnection with exponential backoff

### Requirement 2: Telegram Integration Fix

**User Story:** As a user, I want to see all my Telegram conversations and send/receive messages, so that I can manage Telegram from the unified dashboard.

#### Acceptance Criteria

1. WHEN a user connects their Telegram account THEN the Chat_Orbitor SHALL fetch all dialogs (conversations) from Telegram
2. WHEN syncing messages THEN the Chat_Orbitor SHALL retrieve messages from each dialog and store them encrypted
3. WHEN a user sends a message THEN the Chat_Orbitor SHALL deliver the message via Telethon client and confirm delivery
4. WHEN new messages arrive THEN the Chat_Orbitor SHALL update the conversation list and notify via WebSocket
5. IF Telegram session expires THEN the Chat_Orbitor SHALL prompt user to re-authenticate

### Requirement 3: Twitter/X Integration (Cookie-Based)

**User Story:** As a user, I want to read and send Twitter DMs from the dashboard, so that I can manage Twitter conversations without switching apps.

#### Acceptance Criteria

1. WHEN a user provides Twitter cookies (auth_token, ct0) THEN the Chat_Orbitor SHALL encrypt and store the cookies securely
2. WHEN fetching DMs THEN the Chat_Orbitor SHALL use twikit library with rate limiting (1 request per 20 seconds)
3. WHEN sending a DM THEN the Chat_Orbitor SHALL enforce rate limiting (1 message per 60 seconds, max 15 per day)
4. WHEN polling for new messages THEN the Chat_Orbitor SHALL use random delays between 45-90 seconds
5. IF Twitter returns rate limit error THEN the Chat_Orbitor SHALL pause requests for 15 minutes

### Requirement 4: LinkedIn Integration (Cookie-Based)

**User Story:** As a user, I want to read and send LinkedIn messages from the dashboard, so that I can manage professional conversations efficiently.

#### Acceptance Criteria

1. WHEN a user provides LinkedIn cookies (li_at, JSESSIONID) THEN the Chat_Orbitor SHALL encrypt and store the cookies securely
2. WHEN fetching messages THEN the Chat_Orbitor SHALL use linkedin-api library with rate limiting (1 request per 30 seconds)
3. WHEN sending a message THEN the Chat_Orbitor SHALL enforce rate limiting (1 message per 2 minutes, max 10 per day)
4. IF LinkedIn returns authentication error THEN the Chat_Orbitor SHALL mark account as disconnected and notify user

### Requirement 5: Instagram Integration (Cookie-Based)

**User Story:** As a user, I want to read and send Instagram DMs from the dashboard, so that I can manage Instagram conversations centrally.

#### Acceptance Criteria

1. WHEN a user provides Instagram session credentials THEN the Chat_Orbitor SHALL use instagrapi library for authentication
2. WHEN fetching DMs THEN the Chat_Orbitor SHALL retrieve inbox threads with rate limiting (1 request per 30 seconds)
3. WHEN sending a DM THEN the Chat_Orbitor SHALL enforce rate limiting (1 message per 60 seconds, max 20 per day)
4. IF Instagram requires challenge verification THEN the Chat_Orbitor SHALL notify user to complete verification in browser

### Requirement 6: Facebook Messenger Integration (Cookie-Based)

**User Story:** As a user, I want to read and send Facebook messages from the dashboard, so that I can manage Facebook conversations centrally.

#### Acceptance Criteria

1. WHEN a user provides Facebook cookies (c_user, xs) THEN the Chat_Orbitor SHALL encrypt and store the cookies securely
2. WHEN fetching messages THEN the Chat_Orbitor SHALL use fbchat-v2 library with rate limiting (1 request per 30 seconds)
3. WHEN sending a message THEN the Chat_Orbitor SHALL enforce rate limiting (1 message per 60 seconds)
4. IF Facebook session expires THEN the Chat_Orbitor SHALL notify user to refresh cookies

### Requirement 7: WhatsApp Integration (Browser-Based)

**User Story:** As a user, I want to read and send WhatsApp messages from the dashboard, so that I can manage WhatsApp conversations without phone.

#### Acceptance Criteria

1. WHEN a user initiates WhatsApp connection THEN the Chat_Orbitor SHALL display QR code for WhatsApp Web authentication
2. WHEN authenticated THEN the Chat_Orbitor SHALL use Playwright to interact with WhatsApp Web
3. WHEN fetching messages THEN the Chat_Orbitor SHALL scrape conversation list with rate limiting (1 refresh per 30 seconds)
4. WHEN sending a message THEN the Chat_Orbitor SHALL type and send via browser automation with human-like delays
5. IF WhatsApp Web session disconnects THEN the Chat_Orbitor SHALL notify user to scan QR code again

### Requirement 8: Microsoft Teams Integration (OAuth)

**User Story:** As a user, I want to read and send Teams messages for work/education accounts, so that I can manage professional communications.

#### Acceptance Criteria

1. WHEN a user connects Teams account THEN the Chat_Orbitor SHALL authenticate via Microsoft OAuth for work/education accounts
2. WHEN fetching messages THEN the Chat_Orbitor SHALL use Microsoft Graph API with proper scopes
3. WHEN sending a message THEN the Chat_Orbitor SHALL deliver via Graph API and confirm delivery
4. IF OAuth token expires THEN the Chat_Orbitor SHALL refresh the token automatically

### Requirement 9: Discord Integration (Bot/User Token)

**User Story:** As a user, I want to read and send Discord DMs from the dashboard, so that I can manage Discord conversations centrally.

#### Acceptance Criteria

1. WHEN a user provides Discord token THEN the Chat_Orbitor SHALL encrypt and store the token securely
2. WHEN fetching DMs THEN the Chat_Orbitor SHALL use discord.py library with rate limiting
3. WHEN sending a DM THEN the Chat_Orbitor SHALL deliver via Discord API with rate limiting (5 messages per 5 seconds)
4. IF Discord returns rate limit THEN the Chat_Orbitor SHALL respect the retry-after header

### Requirement 10: Gmail Integration (OAuth)

**User Story:** As a user, I want to see unread emails (excluding spam/promotions) and reply to them, so that I can manage important emails from the dashboard.

#### Acceptance Criteria

1. WHEN a user connects Gmail THEN the Chat_Orbitor SHALL authenticate via Google OAuth with gmail.readonly and gmail.send scopes
2. WHEN fetching emails THEN the Chat_Orbitor SHALL retrieve only unread emails from Primary category (exclude Spam, Promotions, Social)
3. WHEN displaying emails THEN the Chat_Orbitor SHALL show sender, subject, and preview
4. WHEN user replies to an email THEN the Chat_Orbitor SHALL send reply via Gmail API (no compose new email option)
5. IF OAuth token expires THEN the Chat_Orbitor SHALL refresh the token automatically

### Requirement 11: Credential Security

**User Story:** As a user, I want my credentials stored securely, so that my accounts remain safe even if database is compromised.

#### Acceptance Criteria

1. WHEN storing any credential (cookie, token, session) THEN the Chat_Orbitor SHALL encrypt using AES-256-GCM
2. WHEN retrieving credentials THEN the Chat_Orbitor SHALL decrypt only in memory, never log plaintext
3. WHEN user disconnects an account THEN the Chat_Orbitor SHALL permanently delete all stored credentials

### Requirement 12: Rate Limiting and Ban Prevention

**User Story:** As a user, I want the system to protect my accounts from being banned, so that I can use the service safely.

#### Acceptance Criteria

1. WHEN making API requests THEN the Chat_Orbitor SHALL enforce platform-specific rate limits
2. WHEN sending messages THEN the Chat_Orbitor SHALL add random delays to simulate human behavior
3. WHEN rate limit is hit THEN the Chat_Orbitor SHALL pause requests and notify user
4. WHEN multiple errors occur THEN the Chat_Orbitor SHALL implement exponential backoff

### Requirement 13: UI Dashboard Update

**User Story:** As a user, I want a clean dashboard showing all platforms with expandable conversation lists, so that I can easily navigate between platforms.

#### Acceptance Criteria

1. WHEN user views dashboard THEN the Chat_Orbitor SHALL display all connected platforms in a sidebar with icons
2. WHEN user clicks a platform THEN the Chat_Orbitor SHALL expand to show conversation list for that platform
3. WHEN user selects a conversation THEN the Chat_Orbitor SHALL display message thread in main panel
4. WHEN user types a message THEN the Chat_Orbitor SHALL show send button and character count
5. WHEN viewing header THEN the Chat_Orbitor SHALL show "Manage accounts" button, Gmail icon, and Logout button
