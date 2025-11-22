# Webhook Handler Service

This directory contains the webhook handling infrastructure for receiving real-time message notifications from various social media platforms.

## Overview

The webhook handler service provides:
- **Signature Verification**: Validates incoming webhooks using platform-specific signature methods
- **Common Processing Pipeline**: Unified message processing across all platforms
- **Retry Mechanism**: Automatic retry with exponential backoff for failed webhook processing
- **Error Logging**: Comprehensive logging for monitoring and debugging

## Architecture

```
Webhook Request → Signature Verification → Payload Validation → Message Parsing → Store Message
                                                                                        ↓
                                                                                   (on failure)
                                                                                        ↓
                                                                                  Retry Queue
                                                                                  (1s, 5s, 15s)
```

## Supported Platforms

### 1. Telegram
- **Endpoint**: `POST /api/webhooks/telegram`
- **Verification**: Secret token in `X-Telegram-Bot-Api-Secret-Token` header
- **Payload**: Standard Telegram Bot API update format

### 2. Twitter/X
- **Endpoint**: `POST /api/webhooks/twitter`
- **Verification**: HMAC-SHA256 signature in `X-Twitter-Webhooks-Signature` header
- **CRC Challenge**: `GET /api/webhooks/twitter?crc_token=...`
- **Payload**: Account Activity API format

### 3. LinkedIn
- **Endpoint**: `POST /api/webhooks/linkedin`
- **Verification**: HMAC-SHA256 signature in `X-Li-Signature` header
- **Payload**: LinkedIn webhook event format

### 4. Instagram Business
- **Endpoint**: `POST /api/webhooks/instagram`
- **Verification**: SHA256 signature in `X-Hub-Signature-256` header (Facebook Graph API)
- **Challenge**: `GET /api/webhooks/instagram?hub.mode=subscribe&hub.verify_token=...`
- **Payload**: Facebook Graph API webhook format

### 5. WhatsApp Business
- **Endpoint**: `POST /api/webhooks/whatsapp`
- **Verification**: SHA256 signature in `X-Hub-Signature-256` header (Facebook Graph API)
- **Challenge**: `GET /api/webhooks/whatsapp?hub.mode=subscribe&hub.verify_token=...`
- **Payload**: WhatsApp Cloud API webhook format

### 6. Facebook Pages
- **Endpoint**: `POST /api/webhooks/facebook`
- **Verification**: SHA256 signature in `X-Hub-Signature-256` header
- **Challenge**: `GET /api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=...`
- **Payload**: Facebook Graph API webhook format

### 7. Microsoft Teams
- **Endpoint**: `POST /api/webhooks/teams`
- **Verification**: JWT token in `Authorization` header
- **Validation**: `POST /api/webhooks/teams` with `validationToken` in body
- **Payload**: Microsoft Graph API change notification format

## Environment Variables

Required environment variables for webhook verification:

```env
# Telegram
TELEGRAM_WEBHOOK_SECRET=your_secret_token

# Twitter/X
TWITTER_CONSUMER_SECRET=your_consumer_secret

# LinkedIn
LINKEDIN_CLIENT_SECRET=your_client_secret

# Facebook/Instagram/WhatsApp
FACEBOOK_APP_SECRET=your_app_secret
INSTAGRAM_VERIFY_TOKEN=your_verify_token
WHATSAPP_VERIFY_TOKEN=your_verify_token
FACEBOOK_VERIFY_TOKEN=your_verify_token

# Microsoft Teams
TEAMS_APP_ID=your_app_id

# Redis (for Bull queue)
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password
```

## Retry Mechanism

Failed webhook processing is automatically retried using Bull queue with exponential backoff:

1. **First retry**: 1 second after failure
2. **Second retry**: ~5 seconds after first retry
3. **Third retry**: ~15 seconds after second retry

After 3 failed attempts, the job is marked as failed and logged for manual investigation.

### Monitoring Failed Webhooks

```typescript
import { webhookRetryService } from './services/webhookRetryService';

// Get failed jobs
const failedJobs = await webhookRetryService.getFailedJobs(50);

// Get job counts
const counts = await webhookRetryService.getJobCounts();
console.log(counts); // { waiting, active, completed, failed, delayed }

// Get failure statistics by platform
const stats = await webhookRetryService.getFailureStatsByPlatform();

// Manually retry a failed job
await webhookRetryService.retryFailedJob('job-id');

// Clean up old jobs (older than 24 hours)
await webhookRetryService.cleanOldJobs();
```

## Error Handling

All webhook errors are logged with:
- Platform name
- Error message and stack trace
- Truncated payload (first 500 characters)
- Timestamp

Errors are categorized as:
- **Signature verification failures**: 401 Unauthorized
- **Invalid payload structure**: 400 Bad Request
- **Processing failures**: 500 Internal Server Error (triggers retry)

## Testing Webhooks

### Local Testing with ngrok

1. Start ngrok: `ngrok http 3000`
2. Configure webhook URL in platform: `https://your-ngrok-url.ngrok.io/api/webhooks/{platform}`
3. Send test messages through the platform

### Manual Testing

```bash
# Test Telegram webhook
curl -X POST http://localhost:3000/api/webhooks/telegram \
  -H "Content-Type: application/json" \
  -H "X-Telegram-Bot-Api-Secret-Token: your_secret" \
  -d '{"message": {...}}'

# Test Facebook webhook verification
curl -X GET "http://localhost:3000/api/webhooks/facebook?hub.mode=subscribe&hub.verify_token=your_token&hub.challenge=test_challenge"
```

## Security Best Practices

1. **Always verify signatures**: Never process webhooks without signature verification
2. **Use HTTPS in production**: Webhooks should only be received over HTTPS
3. **Rotate secrets regularly**: Update webhook secrets and verification tokens periodically
4. **Rate limiting**: Implement rate limiting on webhook endpoints to prevent abuse
5. **Validate payload structure**: Always validate required fields before processing
6. **Log security events**: Log all signature verification failures for monitoring

## Future Enhancements

- [ ] WebSocket integration for real-time UI updates
- [ ] Webhook delivery monitoring dashboard
- [ ] Automatic webhook registration during OAuth flow
- [ ] Webhook payload validation schemas
- [ ] Dead letter queue for permanently failed webhooks
- [ ] Metrics and alerting for webhook failures
