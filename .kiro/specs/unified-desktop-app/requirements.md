# Requirements Document

## Introduction

This document defines the requirements for a Unified Desktop Application that combines the existing React frontend with Electron to create a standalone desktop app. The app will handle all social media DM fetching locally from the user's PC (using residential IP), eliminating the need for server-side API calls that get blocked. The app will use browser-based authentication for each platform and store sessions locally.

## Glossary

- **Desktop_App**: The Electron-based unified desktop application that wraps the React frontend
- **Platform_Authenticator**: Component that handles browser-based login for each social platform
- **Session_Manager**: Component that stores and manages authentication cookies/tokens locally
- **DM_Fetcher**: Component that fetches DMs from platforms using local browser sessions
- **Message_Aggregator**: Component that combines messages from all platforms into unified view
- **Local_Storage**: Electron-store based persistent storage for sessions and cached data
- **Platform_Adapter**: Platform-specific module that handles authentication and message fetching
- **Sync_Engine**: Background service that periodically syncs messages from all connected platforms

## Requirements

### Requirement 1: Desktop Application Shell

**User Story:** As a user, I want a native desktop application that runs on my PC, so that I can access all my DMs without browser limitations and API blocks.

#### Acceptance Criteria

1. THE Desktop_App SHALL be built using Electron with the existing React frontend embedded
2. THE Desktop_App SHALL support Windows, macOS, and Linux platforms
3. WHEN the Desktop_App starts, THE Desktop_App SHALL display the main dashboard with all connected platforms
4. THE Desktop_App SHALL minimize to system tray when closed (not quit)
5. WHEN the user clicks the tray icon, THE Desktop_App SHALL restore the main window
6. THE Desktop_App SHALL auto-start on system boot (optional, configurable)

### Requirement 2: Platform Authentication

**User Story:** As a user, I want to login to each social platform once using browser-based authentication, so that my sessions are stored locally and I don't need to re-login frequently.

#### Acceptance Criteria

1. WHEN a user clicks "Connect" for a platform, THE Platform_Authenticator SHALL open a browser window for that platform's login page
2. WHEN the user completes login, THE Platform_Authenticator SHALL capture and store authentication cookies/tokens
3. THE Session_Manager SHALL persist authentication data using electron-store
4. WHEN a session expires, THE Platform_Authenticator SHALL prompt the user to re-authenticate
5. THE Desktop_App SHALL support authentication for: Twitter/X, Instagram, Facebook Messenger, LinkedIn, WhatsApp (QR), Telegram, Discord

### Requirement 3: Twitter/X DM Fetching

**User Story:** As a user, I want to fetch my Twitter/X DMs locally, so that I can read and respond to messages without API rate limits.

#### Acceptance Criteria

1. WHEN authenticated, THE DM_Fetcher SHALL fetch Twitter DMs using the `inbox_initial_state.json` endpoint
2. THE Platform_Adapter SHALL use stored `auth_token` and `ct0` cookies for authentication
3. THE DM_Fetcher SHALL parse conversation threads with participant names and avatars
4. WHEN fetching fails due to session expiry, THE Platform_Adapter SHALL trigger re-authentication
5. THE DM_Fetcher SHALL respect rate limits (minimum 15 seconds between fetches)

### Requirement 4: Instagram DM Fetching

**User Story:** As a user, I want to fetch my Instagram DMs locally, so that I can manage personal messages without server IP blocks.

#### Acceptance Criteria

1. WHEN authenticated, THE DM_Fetcher SHALL fetch Instagram DMs using the `direct_v2/inbox` API
2. THE Platform_Adapter SHALL use stored `sessionid`, `csrftoken`, and `ds_user_id` cookies
3. THE DM_Fetcher SHALL parse conversation threads with participant names and profile pictures
4. WHEN fetching fails due to session expiry, THE Platform_Adapter SHALL trigger re-authentication
5. THE DM_Fetcher SHALL handle Instagram's anti-bot measures by using realistic browser headers

### Requirement 5: Facebook Messenger Fetching

**User Story:** As a user, I want to fetch my Facebook Messenger conversations locally, so that I can manage personal messages in the unified inbox.

#### Acceptance Criteria

1. WHEN authenticated, THE DM_Fetcher SHALL load Messenger web interface in a hidden browser window
2. THE Platform_Adapter SHALL use stored `c_user` and `xs` cookies for authentication
3. THE DM_Fetcher SHALL extract conversations using DOM scraping from Messenger UI
4. THE DM_Fetcher SHALL extract message content, sender info, and timestamps
5. WHEN the user sends a message, THE Platform_Adapter SHALL inject the message into Messenger UI

### Requirement 6: LinkedIn DM Fetching

**User Story:** As a user, I want to fetch my LinkedIn messages locally, so that I can manage professional conversations without CSRF errors.

#### Acceptance Criteria

1. WHEN authenticated, THE DM_Fetcher SHALL load LinkedIn messaging page in a browser window
2. THE Platform_Adapter SHALL use stored `li_at` and `JSESSIONID` cookies
3. THE DM_Fetcher SHALL extract conversations using DOM scraping from LinkedIn messaging UI
4. THE DM_Fetcher SHALL handle LinkedIn's passkey/WebAuthn prompts by blocking them
5. THE DM_Fetcher SHALL respect rate limits (minimum 60 seconds between fetches)

### Requirement 7: WhatsApp Integration

**User Story:** As a user, I want to connect my WhatsApp account using QR code, so that I can manage WhatsApp messages in the unified inbox.

#### Acceptance Criteria

1. WHEN the user clicks "Connect WhatsApp", THE Platform_Authenticator SHALL display a QR code for WhatsApp Web login
2. THE Platform_Adapter SHALL use whatsapp-web.js library for WhatsApp integration
3. WHEN authenticated, THE DM_Fetcher SHALL fetch WhatsApp chats and messages in real-time
4. THE DM_Fetcher SHALL support sending text messages through WhatsApp
5. WHEN WhatsApp session disconnects, THE Platform_Adapter SHALL notify the user and prompt for re-scan

### Requirement 8: Telegram Integration

**User Story:** As a user, I want to connect my Telegram account, so that I can manage Telegram messages in the unified inbox.

#### Acceptance Criteria

1. THE Platform_Adapter SHALL use Telegram's official API (api_id + api_hash) for authentication
2. WHEN authenticated, THE DM_Fetcher SHALL fetch Telegram chats and messages
3. THE DM_Fetcher SHALL support both personal chats and group messages
4. THE Platform_Adapter SHALL handle Telegram's 2FA if enabled
5. THE DM_Fetcher SHALL receive real-time message updates via Telegram's MTProto

### Requirement 9: Discord Integration

**User Story:** As a user, I want to connect my Discord account, so that I can manage Discord DMs in the unified inbox.

#### Acceptance Criteria

1. THE Platform_Adapter SHALL use Discord bot token or user token for authentication
2. WHEN authenticated, THE DM_Fetcher SHALL fetch Discord DM channels and messages
3. THE DM_Fetcher SHALL support sending messages through Discord
4. THE Platform_Adapter SHALL handle Discord's rate limits appropriately

### Requirement 10: Unified Message View

**User Story:** As a user, I want to see all my messages from different platforms in one unified interface, so that I can manage all conversations efficiently.

#### Acceptance Criteria

1. THE Message_Aggregator SHALL combine conversations from all connected platforms
2. THE Desktop_App SHALL display conversations grouped by platform in the sidebar
3. WHEN a user selects a conversation, THE Desktop_App SHALL display the full message thread
4. THE Desktop_App SHALL show unread message counts per platform and total
5. THE Desktop_App SHALL support real-time updates when new messages arrive
6. THE Desktop_App SHALL allow sending messages from the unified interface

### Requirement 11: Real-Time Messaging

**User Story:** As a user, I want to receive messages in real-time (not sync-based), so that I can have instant conversations like native apps.

#### Acceptance Criteria

1. THE Real_Time_Engine SHALL maintain persistent connections for platforms that support it (WhatsApp, Telegram, Discord)
2. WHEN a new message arrives on any platform, THE Desktop_App SHALL display it within 5 seconds
3. THE Real_Time_Engine SHALL use long-polling (5-10 second intervals) for platforms without native real-time (Twitter, Instagram)
4. THE Real_Time_Engine SHALL use DOM MutationObserver for browser-based platforms (Facebook, LinkedIn)
5. WHEN the Desktop_App is minimized to tray, THE Real_Time_Engine SHALL continue receiving messages
6. WHEN new messages are detected, THE Desktop_App SHALL show system notifications immediately
7. THE Real_Time_Engine SHALL automatically reconnect if connection is lost
8. THE Desktop_App SHALL show typing indicators where supported (WhatsApp, Telegram)
9. THE Desktop_App SHALL show read receipts where supported (WhatsApp, Telegram, Instagram)

### Requirement 12: Local Data Storage

**User Story:** As a user, I want my messages and sessions stored locally, so that I have fast access and privacy.

#### Acceptance Criteria

1. THE Local_Storage SHALL store authentication sessions encrypted using electron-store
2. THE Local_Storage SHALL cache fetched conversations and messages locally
3. THE Local_Storage SHALL support data export for backup purposes
4. WHEN the user logs out of a platform, THE Local_Storage SHALL clear that platform's data
5. THE Local_Storage SHALL implement data retention policies (configurable)

### Requirement 13: UI/UX Consistency

**User Story:** As a user, I want the desktop app to look and feel like the existing web interface, so that I have a familiar experience.

#### Acceptance Criteria

1. THE Desktop_App SHALL use the existing React frontend components
2. THE Desktop_App SHALL support dark and light themes
3. THE Desktop_App SHALL be responsive and performant
4. THE Desktop_App SHALL show loading states during sync operations
5. THE Desktop_App SHALL display error messages clearly when operations fail

### Requirement 14: Security

**User Story:** As a user, I want my authentication data to be secure, so that my social media accounts are protected.

#### Acceptance Criteria

1. THE Session_Manager SHALL encrypt stored credentials using system keychain where available
2. THE Desktop_App SHALL not transmit authentication tokens to any external server
3. THE Desktop_App SHALL implement secure IPC between main and renderer processes
4. WHEN the app is locked, THE Desktop_App SHALL require re-authentication to access
5. THE Desktop_App SHALL support optional app-level password protection
