# Task 13: API Usage Logging and Rate Limiting Implementation

## Overview

This document summarizes the implementation of API usage logging and rate limiting middleware for the Multi-Platform Messaging Hub.

## Implementation Summary

### 1. API Usage Logging Middleware

**File:** `backend/src/middleware/apiUsageLogger.ts`

- Logs all successful API requests (2xx status codes) to the `api_usage_logs` table
- Logs after response is sent to avoid blocking requests
- Captures: user ID, endpoint (method + path), request count, timestamp
- Gracefully handles logging failures without affecting the request

**Database Migration:** `backend/src/db/migrations/003_add_user_id_to_api_usage_logs.sql`

- Added `user_id` column to `api_usage_logs` table
- Made `account_id` nullable to support both user-level and account-level logging
- Added index on `(user_id, timestamp)` for efficient queries

### 2. User-Level Rate Limiting Middleware

**File:** `backend/src/middleware/rateLimiter.ts`

**Features:**
- Uses Redis sorted sets for sliding window rate limiting
- Default: 100 requests per minute per user
- Includes rate limit headers in responses:
  - `X-RateLimit-Limit`
  - `X-RateLimit-Remaining`
  - `X-RateLimit-Reset`
  - `Retry-After` (when exceeded)
- Returns HTTP 429 with retry information when limit exceeded
- Gracefully degrades if Redis fails (allows requests through)

**Exported Functions:**
- `rateLimiter`: Default limiter (100 req/min)
- `strictRateLimiter`: Strict limiter (20 req/min)
- `createRateLimiter(options)`: Custom rate limiter factory

### 3. Platform API Rate Limiting Service

**File:** `backend/src/services/platformRateLimitService.ts`

**Features:**
- Enforces platform-specific API rate limits
- Tracks requests per account per platform
- Platform configurations:
  - Telegram: 30 req/sec
  - Twitter: 300 req/15min
  - LinkedIn: 100 req/day
  - Instagram: 200 req/hour
  - WhatsApp: 80 req/sec
  - Facebook: 200 req/hour
  - Teams: 10,000 req/10min

**Methods:**
- `checkRateLimit(accountId, platform, endpoint)`: Check before API call
- `recordApiCall(accountId, platform, endpoint)`: Record after successful call
- `getRateLimitStatus(accountId, platform)`: Get current status
- `getPlatformConfig(platform)`: Get platform configuration

### 4. Integration with Platform Adapters

**File:** `backend/src/adapters/BasePlatformAdapter.ts`

**Changes:**
- Updated `checkRateLimit()` to use `platformRateLimitService`
- Added `logPlatformApiUsage()` method for database logging
- Updated `executeWithRetry()` to:
  - Check rate limits before API calls
  - Log successful API usage after calls
  - Pass endpoint parameter for better tracking

### 5. Application-Wide Integration

**File:** `backend/src/index.ts`

**Changes:**
- Applied `rateLimiter` middleware to all `/api/*` routes
- Applied `apiUsageLogger` middleware to all `/api/*` routes
- Middleware order ensures authentication happens before rate limiting

### 6. Rate Limit Status Endpoint

**Files:**
- `backend/src/controllers/oauthController.ts`
- `backend/src/routes/oauthRoutes.ts`

**New Endpoint:** `GET /api/oauth/rate-limits`

Returns rate limit status for all connected accounts:
```json
{
  "rateLimits": [
    {
      "accountId": "uuid",
      "platform": "twitter",
      "limit": 300,
      "remaining": 245,
      "resetAt": "2025-11-22T12:00:00Z",
      "windowMs": 900000
    }
  ]
}
```

### 7. Documentation

**File:** `backend/src/middleware/RATE_LIMITING.md`

Comprehensive documentation covering:
- Implementation details
- Usage examples
- Configuration options
- Monitoring and analytics
- Best practices
- Troubleshooting

## Requirements Fulfilled

✅ **8.1**: API usage logging - All requests logged to `api_usage_logs` table

✅ **8.2**: Rate limiting - 100 requests/minute per user enforced via Redis

✅ **8.3**: Rate limit enforcement - Applied to all protected API endpoints

✅ **6.4**: Platform rate limits - Checked before making platform API calls

## Testing

### Manual Testing

1. **User Rate Limiting:**
```bash
# Make 101 requests to trigger rate limit
for i in {1..101}; do
  curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/messages
done
```

2. **Platform Rate Limiting:**
```bash
# Check rate limit status
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/oauth/rate-limits
```

3. **API Usage Logging:**
```sql
-- Query logged API usage
SELECT endpoint, COUNT(*) as request_count
FROM api_usage_logs
WHERE user_id = 'user-uuid'
  AND timestamp >= NOW() - INTERVAL '1 hour'
GROUP BY endpoint
ORDER BY request_count DESC;
```

### Integration Points

- ✅ Middleware applied to all API routes
- ✅ Platform adapters check rate limits before API calls
- ✅ Database logging integrated with query helpers
- ✅ Redis used for distributed rate limiting
- ✅ Error handling with graceful degradation

## Configuration

### Environment Variables

```env
# Redis (required for rate limiting)
REDIS_HOST=localhost
REDIS_PORT=6379

# Optional rate limit overrides
USER_RATE_LIMIT_REQUESTS=100
USER_RATE_LIMIT_WINDOW_MS=60000
```

### Database Setup

Run migrations to add user_id column:
```bash
npm run migrate
```

## Monitoring

### Key Metrics to Monitor

1. **Rate Limit Violations:**
   - Count of 429 responses
   - Users hitting limits frequently

2. **API Usage Patterns:**
   - Requests per endpoint
   - Peak usage times
   - Platform API consumption

3. **Redis Performance:**
   - Memory usage
   - Key expiration
   - Connection errors

### Queries for Analytics

```sql
-- Daily API usage by platform
SELECT 
  DATE(timestamp) as date,
  platform,
  COUNT(*) as requests,
  COUNT(DISTINCT user_id) as unique_users
FROM api_usage_logs
WHERE timestamp >= NOW() - INTERVAL '30 days'
GROUP BY DATE(timestamp), platform
ORDER BY date DESC, requests DESC;

-- Top API consumers
SELECT 
  user_id,
  COUNT(*) as total_requests,
  COUNT(DISTINCT endpoint) as unique_endpoints
FROM api_usage_logs
WHERE timestamp >= NOW() - INTERVAL '24 hours'
GROUP BY user_id
ORDER BY total_requests DESC
LIMIT 10;
```

## Next Steps

1. Set up monitoring alerts for rate limit violations
2. Create admin dashboard for API usage visualization
3. Implement rate limit quotas per user tier (if applicable)
4. Add metrics export for Prometheus/Grafana
5. Consider implementing request queuing for rate-limited requests

## Files Created/Modified

### Created:
- `backend/src/middleware/apiUsageLogger.ts`
- `backend/src/middleware/rateLimiter.ts`
- `backend/src/middleware/index.ts`
- `backend/src/services/platformRateLimitService.ts`
- `backend/src/db/migrations/003_add_user_id_to_api_usage_logs.sql`
- `backend/src/middleware/RATE_LIMITING.md`
- `backend/TASK_13_IMPLEMENTATION_SUMMARY.md`

### Modified:
- `backend/src/adapters/BasePlatformAdapter.ts`
- `backend/src/index.ts`
- `backend/src/controllers/oauthController.ts`
- `backend/src/routes/oauthRoutes.ts`

## Conclusion

Task 13 has been successfully implemented with comprehensive rate limiting and API usage logging. The implementation includes:

- User-level rate limiting (100 req/min)
- Platform-specific rate limiting
- Complete API usage logging
- Monitoring endpoints
- Comprehensive documentation
- Graceful error handling

All requirements (8.1, 8.2, 8.3, 6.4) have been fulfilled.
