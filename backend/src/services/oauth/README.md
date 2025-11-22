# OAuth Services

This directory contains OAuth 2.0 implementations for all supported messaging platforms.

## Architecture

### Base Service
`OAuthBaseService` provides common OAuth 2.0 functionality:
- Authorization URL generation
- Token exchange (authorization code → access token)
- Token refresh with automatic retry
- Secure token storage with AES-256 encryption
- Token validation and expiry management

### Platform Services

Each platform has a dedicated service extending `OAuthBaseService`:

1. **TelegramOAuthService** - Telegram Bot API authentication
   - Uses Telegram Login Widget
   - Bot tokens don't expire
   - Validates auth data with HMAC-SHA256

2. **TwitterOAuthService** - Twitter/X OAuth 2.0 with PKCE
   - Implements PKCE flow for security
   - Tokens expire after 2 hours
   - Supports token revocation

3. **LinkedInOAuthService** - LinkedIn OAuth 2.0
   - Tokens expire after 60 days
   - No programmatic revocation

4. **InstagramOAuthService** - Instagram Business via Facebook Graph API
   - Exchanges short-lived for long-lived tokens (60 days)
   - Requires Facebook Business account

5. **WhatsAppOAuthService** - WhatsApp Cloud API
   - Uses system user tokens (no expiry)
   - Webhook verification support

6. **FacebookOAuthService** - Facebook Pages Messaging
   - Long-lived page access tokens (60 days)
   - Webhook subscription management

7. **MicrosoftTeamsOAuthService** - Microsoft Teams via Graph API
   - Tokens expire after 1 hour
   - Chat subscription management for webhooks

## Usage

### Factory Pattern

```typescript
import { getOAuthService } from './services/oauth';

const service = getOAuthService('twitter');
const authUrl = service.generateAuthorizationUrl(state);
```

### OAuth Flow

1. **Initiate Connection**
```typescript
GET /api/oauth/connect/:platform
```
Returns authorization URL for user to visit.

2. **Handle Callback**
```typescript
GET /api/oauth/callback/:platform?code=xxx&state=xxx
```
Exchanges code for tokens and stores them securely.

3. **Get Connected Accounts**
```typescript
GET /api/oauth/accounts
```
Returns list of user's connected accounts.

4. **Disconnect Account**
```typescript
DELETE /api/oauth/disconnect/:accountId
```
Revokes tokens and marks account as inactive.

5. **Refresh Token**
```typescript
POST /api/oauth/refresh/:accountId
```
Manually refresh an account's token.

## Security Features

- **CSRF Protection**: State parameter validation
- **Token Encryption**: AES-256 encryption at rest
- **Automatic Refresh**: Tokens refreshed before expiry
- **Retry Logic**: Exponential backoff for API failures
- **Secure Storage**: Encrypted tokens in PostgreSQL

## Environment Variables

Required for each platform:

```env
# Telegram
TELEGRAM_BOT_TOKEN=your_bot_token
TELEGRAM_BOT_USERNAME=your_bot_username

# Twitter/X
TWITTER_CLIENT_ID=your_client_id
TWITTER_CLIENT_SECRET=your_client_secret

# LinkedIn
LINKEDIN_CLIENT_ID=your_client_id
LINKEDIN_CLIENT_SECRET=your_client_secret

# Instagram
INSTAGRAM_APP_ID=your_app_id
INSTAGRAM_APP_SECRET=your_app_secret

# WhatsApp
WHATSAPP_PHONE_NUMBER_ID=your_phone_number_id
WHATSAPP_ACCESS_TOKEN=your_system_user_token
WHATSAPP_VERIFY_TOKEN=your_webhook_verify_token

# Facebook
FACEBOOK_APP_ID=your_app_id
FACEBOOK_APP_SECRET=your_app_secret

# Microsoft Teams
MICROSOFT_CLIENT_ID=your_client_id
MICROSOFT_CLIENT_SECRET=your_client_secret
MICROSOFT_TENANT_ID=common

# General
WEBHOOK_BASE_URL=https://your-domain.com
FRONTEND_URL=http://localhost:5173
```

## Token Expiry Reference

| Platform | Access Token Expiry | Refresh Token | Notes |
|----------|-------------------|---------------|-------|
| Telegram | Never | N/A | Bot tokens don't expire |
| Twitter | 2 hours | Yes | Requires frequent refresh |
| LinkedIn | 60 days | Yes | Long-lived tokens |
| Instagram | 60 days | No | Exchange for long-lived |
| WhatsApp | Never | N/A | System user tokens |
| Facebook | 60 days | No | Page access tokens |
| Microsoft Teams | 1 hour | Yes | Frequent refresh needed |

## Error Handling

All services implement consistent error handling:
- Network errors: Automatic retry with exponential backoff
- Token expiry: Automatic refresh before API calls
- Invalid tokens: Clear error messages for re-authentication
- Rate limits: Handled by platform adapters (future task)

## Testing

To test OAuth flows:
1. Set up platform developer accounts
2. Configure environment variables
3. Use sandbox/test credentials where available
4. Test authorization flow end-to-end
5. Verify token storage and encryption
6. Test token refresh mechanisms

## Future Enhancements

- Redis-based state storage (currently in-memory)
- Token rotation for enhanced security
- Multi-account support per platform
- OAuth scope management UI
- Token health monitoring
