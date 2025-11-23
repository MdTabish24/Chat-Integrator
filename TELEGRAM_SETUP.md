# Telegram User Authentication Setup

## Overview
Telegram Login Widget allows users to connect their personal Telegram accounts to receive all their messages on the dashboard.

## Setup Steps

### 1. Configure Bot Domain in BotFather

1. Open Telegram and search for `@BotFather`
2. Send command: `/setdomain`
3. Select your bot
4. Enter domain: `chatintegrator.onrender.com`

This allows the Telegram Login Widget to work on your domain.

### 2. Environment Variables

Make sure these are set in Render dashboard:

```
TELEGRAM_BOT_TOKEN=<your_bot_token>
TELEGRAM_BOT_USERNAME=<your_bot_username>
FRONTEND_URL=https://chatintegrator.onrender.com
WEBHOOK_BASE_URL=https://chatintegrator.onrender.com
```

### 3. How It Works

1. User clicks "Connect Telegram" on Accounts page
2. Redirected to `/auth/telegram` page with Telegram Login Widget
3. User clicks "Login with Telegram" button
4. Telegram app opens and asks for permission
5. User approves and data is sent back to our backend
6. Backend validates the data and stores user's Telegram account
7. User can now receive ALL their Telegram messages on dashboard

### 4. Receiving Messages

Once connected, the user will receive:
- All personal messages sent to their Telegram account
- Group messages (if bot is added to groups)
- Channel messages (if bot is admin)

Messages are fetched via:
- **Webhook**: Real-time delivery when someone sends a message
- **Polling**: Backup method that checks for new messages every 30 seconds

### 5. Testing

1. Deploy the updated code to Render
2. Set domain in BotFather
3. Go to your deployed URL /accounts
4. Click "Connect Telegram"
5. Authorize with your Telegram account
6. Send a message to yourself on Telegram
7. Check dashboard - message should appear!

## Important Notes

- **Bot API Limitation**: Telegram Bot API can only see messages sent TO the bot, not all user's personal chats
- **For Full Access**: Would need Telegram Client API (MTProto) which requires phone number verification
- **Current Implementation**: Users interact through the bot, and those conversations appear on dashboard
- **Privacy**: Bot can only access messages explicitly sent to it

## Alternative: Full User Account Access

If you want users to see ALL their Telegram chats (not just bot conversations), you need:

1. **Telegram Client API (MTProto)** instead of Bot API
2. **Phone number verification** for each user
3. **Session management** for persistent connections
4. Libraries: `telegram` (GramJS) or similar

This is more complex but provides complete access to user's Telegram account.

See TELEGRAM_FULL_ACCESS_SETUP.md for implementation details.
