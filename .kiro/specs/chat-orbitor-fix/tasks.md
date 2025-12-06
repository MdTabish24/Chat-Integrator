# Implementation Plan

## Phase 1: Critical Fixes (WebSocket & Telegram)

- [x] 1. Fix WebSocket routing configuration




  - [ ] 1.1 Fix corrupted routing.py file with correct WebSocket URL pattern
    - Replace truncated content with proper `re_path(r'ws/messages/$', consumers.MessagingConsumer.as_asgi())`
    - _Requirements: 1.1_
  - [ ]* 1.2 Write property test for WebSocket JWT authentication
    - **Property 1: WebSocket JWT Authentication**
    - **Validates: Requirements 1.2**

- [x] 2. Fix Telegram sync to show all conversations




  - [x] 2.1 Update Telegram sync service to handle all dialogs properly

    - Fix dialog iteration and message fetching
    - Ensure proper error handling for each dialog
    - _Requirements: 2.1, 2.2_
  - [x] 2.2 Fix Telegram message sending functionality


    - Ensure Telethon client connection is maintained
    - Add proper error handling and retry logic
    - _Requirements: 2.3_
  - [ ]* 2.3 Write property test for message encryption on storage
    - **Property 6: Message Encryption on Storage**
    - **Validates: Requirements 2.2**

- [x] 3. Checkpoint - Ensure WebSocket and Telegram work





  - Ensure all tests pass, ask the user if questions arise.

## Phase 2: Core Services (Encryption & Rate Limiting)

- [x] 4. Implement enhanced encryption service






  - [x] 4.1 Update crypto utility with AES-256-GCM encryption

    - Ensure proper IV generation and handling
    - Add validation for encrypted data format
    - _Requirements: 11.1_
  - [ ]* 4.2 Write property test for encryption round-trip
    - **Property 2: Encryption Round-Trip**
    - **Validates: Requirements 11.1, 3.1, 4.1**

- [x] 5. Implement rate limiter service





  - [x] 5.1 Create RateLimitConfig model and RateLimiter service


    - Implement per-platform rate limit configurations
    - Add request counting and window management
    - _Requirements: 12.1_
  - [x] 5.2 Implement random delay generator for human-like behavior


    - Add configurable min/max delay ranges
    - Implement random delay selection
    - _Requirements: 12.2_

  - [x] 5.3 Implement exponential backoff for error handling

    - Add backoff calculation with max cap
    - Integrate with platform adapters
    - _Requirements: 12.4_
  - [ ]* 5.4 Write property test for rate limiter enforcement
    - **Property 3: Rate Limiter Enforcement**
    - **Validates: Requirements 12.1, 3.2, 3.3, 4.2, 4.3**
  - [ ]* 5.5 Write property test for random delay range
    - **Property 4: Random Delay Range**
    - **Validates: Requirements 12.2, 3.4**
  - [ ]* 5.6 Write property test for exponential backoff
    - **Property 5: Exponential Backoff**
    - **Validates: Requirements 12.4**

- [x] 6. Checkpoint - Ensure core services work





  - Ensure all tests pass, ask the user if questions arise.

## Phase 3: Cookie-Based Platform Integrations

- [x] 7. Implement Twitter/X adapter using twikit





  - [x] 7.1 Create Twitter adapter with cookie-based authentication


    - Install twikit library
    - Implement cookie storage and retrieval
    - _Requirements: 3.1_

  - [x] 7.2 Implement Twitter DM fetching with rate limiting

    - Add 20-second polling interval
    - Implement conversation list retrieval
    - _Requirements: 3.2_
  - [x] 7.3 Implement Twitter DM sending with rate limiting


    - Add 60-second delay between messages
    - Implement daily limit tracking (15/day)
    - _Requirements: 3.3, 3.4_
  - [x] 7.4 Create Twitter views and URL routes


    - Add cookie submission endpoint
    - Add DM fetch and send endpoints
    - _Requirements: 3.1, 3.2, 3.3_

- [x] 8. Implement LinkedIn adapter using linkedin-api





  - [x] 8.1 Create LinkedIn adapter with cookie-based authentication


    - Install linkedin-api library
    - Implement cookie storage (li_at, JSESSIONID)
    - _Requirements: 4.1_
  - [x] 8.2 Implement LinkedIn message fetching with rate limiting


    - Add 30-second polling interval
    - Implement conversation list retrieval
    - _Requirements: 4.2_
  - [x] 8.3 Implement LinkedIn message sending with rate limiting


    - Add 2-minute delay between messages
    - Implement daily limit tracking (10/day)
    - _Requirements: 4.3_

  - [x] 8.4 Create LinkedIn views and URL routes

    - Add cookie submission endpoint
    - Add message fetch and send endpoints
    - _Requirements: 4.1, 4.2, 4.3_

- [x] 9. Implement Instagram adapter using instagrapi





  - [x] 9.1 Create Instagram adapter with session authentication


    - Install instagrapi library
    - Implement session storage and retrieval
    - _Requirements: 5.1_
  - [x] 9.2 Implement Instagram DM fetching with rate limiting


    - Add 30-second polling interval
    - Implement inbox thread retrieval
    - _Requirements: 5.2_

  - [x] 9.3 Implement Instagram DM sending with rate limiting

    - Add 60-second delay between messages
    - Implement daily limit tracking (20/day)
    - _Requirements: 5.3_
  - [x] 9.4 Create Instagram views and URL routes


    - Add login endpoint
    - Add DM fetch and send endpoints
    - _Requirements: 5.1, 5.2, 5.3_

- [x] 10. Implement Facebook adapter using fbchat-v2





  - [x] 10.1 Create Facebook adapter with cookie-based authentication


    - Install fbchat-v2 library
    - Implement cookie storage (c_user, xs)
    - _Requirements: 6.1_

  - [x] 10.2 Implement Facebook message fetching with rate limiting

    - Add 30-second polling interval
    - Implement thread list retrieval
    - _Requirements: 6.2_


  - [x] 10.3 Implement Facebook message sending with rate limiting
    - Add 60-second delay between messages
    - _Requirements: 6.3_

  - [x] 10.4 Create Facebook views and URL routes

    - Add cookie submission endpoint
    - Add message fetch and send endpoints
    - _Requirements: 6.1, 6.2, 6.3_

- [x] 11. Checkpoint - Ensure cookie-based platforms work





  - Ensure all tests pass, ask the user if questions arise.

## Phase 4: OAuth & Browser-Based Integrations

- [x] 12. Implement WhatsApp adapter using Playwright



  - [x] 12.1 Create WhatsApp adapter with QR code authentication


    - Install playwright library
    - Implement QR code generation and display
    - _Requirements: 7.1_

  - [x] 12.2 Implement WhatsApp Web session management
    - Handle browser automation lifecycle
    - Implement session persistence
    - _Requirements: 7.2_

  - [x] 12.3 Implement WhatsApp message fetching via browser scraping
    - Add 30-second refresh interval
    - Implement conversation list scraping

    - _Requirements: 7.3_
  - [x] 12.4 Implement WhatsApp message sending with human-like delays
    - Add typing simulation
    - Implement random delays
    - _Requirements: 7.4_
  - [x] 12.5 Create WhatsApp views and URL routes



    - Add QR code endpoint
    - Add message fetch and send endpoints
    - _Requirements: 7.1, 7.3, 7.4_

- [x] 13. Fix Microsoft Teams adapter (OAuth)





  - [x] 13.1 Update Teams OAuth flow for work/education accounts


    - Verify Microsoft Graph API scopes
    - Fix token refresh logic
    - _Requirements: 8.1_
  - [x] 13.2 Implement Teams message fetching via Graph API


    - Add chat list retrieval
    - Implement message history fetching
    - _Requirements: 8.2_

  - [x] 13.3 Implement Teams message sending via Graph API

    - Add message delivery confirmation
    - _Requirements: 8.3_

- [x] 14. Implement Discord adapter using discord.py





  - [x] 14.1 Create Discord adapter with token authentication


    - Install discord.py library
    - Implement token storage
    - _Requirements: 9.1_
  - [x] 14.2 Implement Discord DM fetching with rate limiting


    - Add DM channel retrieval
    - Implement message history fetching
    - _Requirements: 9.2_

  - [x] 14.3 Implement Discord DM sending with rate limiting

    - Respect Discord's built-in rate limits
    - Add retry-after handling
    - _Requirements: 9.3, 9.4_


  - [x] 14.4 Create Discord views and URL routes
    - Add token submission endpoint
    - Add DM fetch and send endpoints
    - _Requirements: 9.1, 9.2, 9.3_

- [x] 15. Implement Gmail adapter using Google OAuth





  - [x] 15.1 Create Gmail adapter with OAuth authentication


    - Implement Google OAuth flow
    - Request gmail.readonly and gmail.send scopes
    - _Requirements: 10.1_
  - [x] 15.2 Implement Gmail fetching (unread Primary only)


    - Filter out Spam, Promotions, Social categories
    - Retrieve sender, subject, preview
    - _Requirements: 10.2, 10.3_
  - [x] 15.3 Implement Gmail reply functionality (no compose)


    - Add reply-to-thread functionality
    - Disable new email composition
    - _Requirements: 10.4_
  - [x] 15.4 Create Gmail views and URL routes


    - Add OAuth callback endpoint
    - Add email fetch and reply endpoints
    - _Requirements: 10.1, 10.2, 10.4_
  - [x] 15.5 Write property test for Gmail Primary filter



    - **Property 8: Gmail Filter - Primary Only**
    - **Validates: Requirements 10.2**

- [x] 16. Checkpoint - Ensure OAuth platforms work





  - Ensure all tests pass, ask the user if questions arise.

## Phase 5: Account Management & Security

- [x] 17. Implement account disconnect with credential cleanup






  - [x] 17.1 Update disconnect endpoint to delete all credentials

    - Clear access_token, refresh_token, cookies fields
    - Remove from active sessions
    - _Requirements: 11.3_
  - [ ]* 17.2 Write property test for account disconnect cleanup
    - **Property 9: Account Disconnect Cleanup**
    - **Validates: Requirements 11.3**

<!-- - [ ] 18. Implement daily limit tracking and enforcement
  - [ ] 18.1 Add daily message count tracking to ConnectedAccount
    - Add daily_message_count and daily_count_reset_at fields
    - Implement count increment on send
    - _Requirements: 3.3, 4.3, 5.3_
  - [ ] 18.2 Implement daily limit enforcement in send methods
    - Check limit before sending
    - Reset count at midnight
    - _Requirements: 3.3, 4.3, 5.3_
  - [ ]* 18.3 Write property test for daily limit enforcement
    - **Property 10: Daily Limit Enforcement**
    - **Validates: Requirements 3.3, 4.3, 5.3** -->

- [x] 19. Checkpoint - Ensure security features work





  - Ensure all tests pass, ask the user if questions arise.

## Phase 6: Frontend UI Update

- [x] 20. Update Dashboard layout per design mockup





  - [x] 20.1 Create new sidebar component with platform list


    - Add platform icons (Telegram, Twitter, LinkedIn, etc.)
    - Implement expandable conversation lists
    - _Requirements: 13.1, 13.2_

  - [x] 20.2 Update header with Manage accounts, Gmail icon, Logout

    - Add "Manage accounts" button
    - Add Gmail notification icon
    - Style Logout button
    - _Requirements: 13.5_

  - [x] 20.3 Update chat view component

    - Display message thread in main panel
    - Add message input with send button
    - _Requirements: 13.3, 13.4_
  - [x] 20.4 Create Accounts management page


    - Show all platforms with Connect/Disconnect buttons
    - Display connection status
    - _Requirements: 13.1_

- [x] 21. Add cookie input UI for cookie-based platforms
  - [x] 21.1 Create cookie input modal for Twitter
    - Add fields for auth_token and ct0
    - Add consent checkbox
    - _Requirements: 3.1_
  - [x] 21.2 Create cookie input modal for LinkedIn
    - Add fields for li_at and JSESSIONID
    - Add consent checkbox
    - _Requirements: 4.1_
  - [x] 21.3 Create cookie input modal for Facebook

    - Add fields for c_user and xs
    - Add consent checkbox
    - _Requirements: 6.1_

- [x] 22. Add QR code display for WhatsApp





  - [x] 22.1 Create WhatsApp QR code modal


    - Display QR code from backend
    - Add refresh button
    - Show connection status
    - _Requirements: 7.1_

- [x] 23. Final Checkpoint - Ensure all features work





  - Ensure all tests pass, ask the user if questions arise.
