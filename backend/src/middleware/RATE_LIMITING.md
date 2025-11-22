# Rate Limiting and API Usage Logging

This document describes the rate limiting and API usage logging implementation for the Multi-Platform Messaging Hub.

## Overview

The system implements two levels of rate limiting:

1. **User-level rate limiting**: Limits API requests per user to prevent abuse
2. **Platform-level rate limiting**: Enforces platform API rate limits to stay within provider constraints

Additionally, all API requests are logged for monitoring and analytics purposes.

## User-Level Rate Limiting

### Implementation

The `rateLimiter` middleware uses Redis sorted sets to track requests per user within a sliding time window.

**Default Configuration:**
- 100 requests per minute per user
- Applied to all `/api/*` routes
- Returns HTTP 429 (Too Many Requests) when exceeded

### Usage

```typescript
import { rateLimiter, strictRateLimiter, createRateLimiter } from './middleware/rateLimiter';

// Apply default rate limiter (100 req/min)
app.use('/api', rateLimiter);

// Apply strict rate limiter (20 req/min) to sensitive routes
app.use('/api/admin', strictRateLimiter);

// Create custom rate limiter
const customLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 50,
  keyPrefix: 'custom',
});
app.use('/api/custom', customLimiter);
```

### Response Headers

When rate limiting is active, the following headers are included in responses:

- `X-RateLimit-Limit`: Maximum requests allowed in the window
- `X-RateLimit-Remaining`: Requests remaining in current window
- `X-RateLimit-Reset`: ISO timestamp when the rate limit resets
- `Retry-After`: Seconds to wait before retrying (only when limit exceeded)

### Error Response

When rate limit is exceeded:

```json
{
  "error": {
    "code": "RATE_LIMIT_EXCEEDED",
    "message": "Rate limit exceeded. Please try again later.",
    "retryable": true,
    "details": {
      "limit": 100,
      "windowMs": 60000,
      "retryAfter": 45
    }
  }
}
```

## Platform-Level Rate Limiting

### Implementation

The `PlatformRateLimitService` enforces rate limits for each platform's API based on official documentation.

**Platform Configurations:**

| Platform  | Limit                      | Window       |
|-----------|----------------------------|--------------|
| Telegram  | 30 requests                | 1 second     |
| Twitter   | 300 requests               | 15 minutes   |
| LinkedIn  | 100 requests               | 24 hours     |
| Instagram | 200 requests               | 1 hour       |
| WhatsApp  | 80 requests                | 1 second     |
| Facebook  | 200 requests               | 1 hour       |
| Teams     | 10,000 requests            | 10 minutes   |

### Usage in Adapters

Platform adapters automatically check rate limits before making API calls:

```typescript
// In BasePlatformAdapter
protected async executeWithRetry<T>(
  fn: () => Promise<T>,
  accountId: string,
  endpoint: string = 'api'
): Promise<T> {
  // Check rate limit before making the request
  await this.checkRateLimit(accountId, endpoint);
  
  // Execute the function
  const result = await fn();
  
  // Log successful API usage
  await this.logPlatformApiUsage(accountId, endpoint);
  
  return result;
}
```

### Checking Rate Limit Status

```typescript
import { platformRateLimitService } from '../services/platformRateLimitService';

// Get current rate limit status
const status = await platformRateLimitService.getRateLimitStatus(
  accountId,
  'twitter'
);

console.log(status);
// {
//   limit: 300,
//   remaining: 245,
//   resetAt: Date,
//   windowMs: 900000
// }
```

## API Usage Logging

### Implementation

The `apiUsageLogger` middleware logs all successful API requests to the `api_usage_logs` table.

**Logged Information:**
- User ID
- Endpoint (method + path)
- Request count
- Timestamp

### Database Schema

```sql
CREATE TABLE api_usage_logs (
  id UUID PRIMARY KEY,
  user_id UUID REFERENCES users(id),
  account_id UUID REFERENCES connected_accounts(id),
  platform VARCHAR(50),
  endpoint VARCHAR(255),
  request_count INTEGER DEFAULT 1,
  timestamp TIMESTAMP DEFAULT NOW()
);
```

### Usage

The middleware is automatically applied to all `/api/*` routes:

```typescript
import { apiUsageLogger } from './middleware/apiUsageLogger';

app.use('/api', apiUsageLogger);
```

### Querying Usage Data

```typescript
import { query } from '../db/queryHelpers';

// Get API usage for a user in the last hour
const usage = await query(
  `SELECT endpoint, SUM(request_count) as total
   FROM api_usage_logs
   WHERE user_id = $1 AND timestamp >= NOW() - INTERVAL '1 hour'
   GROUP BY endpoint
   ORDER BY total DESC`,
  [userId]
);

// Get platform API usage for an account
const platformUsage = await query(
  `SELECT platform, endpoint, SUM(request_count) as total
   FROM api_usage_logs
   WHERE account_id = $1 AND timestamp >= $2
   GROUP BY platform, endpoint`,
  [accountId, since]
);
```

## Monitoring and Analytics

### Daily Reports

Generate daily API usage reports:

```typescript
const dailyReport = await query(
  `SELECT 
     DATE(timestamp) as date,
     platform,
     COUNT(*) as request_count,
     COUNT(DISTINCT user_id) as unique_users
   FROM api_usage_logs
   WHERE timestamp >= NOW() - INTERVAL '30 days'
   GROUP BY DATE(timestamp), platform
   ORDER BY date DESC, request_count DESC`
);
```

### Rate Limit Violations

Monitor rate limit violations by checking error logs:

```typescript
// Rate limit errors are logged with code 'RATE_LIMIT_EXCEEDED'
// or 'PLATFORM_RATE_LIMIT_EXCEEDED'
```

## Best Practices

1. **Graceful Degradation**: If Redis fails, rate limiting allows requests through rather than blocking all traffic
2. **Logging**: All rate limit checks and API calls are logged for debugging
3. **Headers**: Always include rate limit headers in responses for client awareness
4. **Retry Logic**: Clients should respect `Retry-After` headers when rate limited
5. **Monitoring**: Set up alerts for frequent rate limit violations

## Configuration

Rate limiting can be configured via environment variables:

```env
# Redis configuration
REDIS_HOST=localhost
REDIS_PORT=6379

# Rate limiting (optional, defaults shown)
USER_RATE_LIMIT_REQUESTS=100
USER_RATE_LIMIT_WINDOW_MS=60000
```

## Testing

Test rate limiting behavior:

```bash
# Test user rate limiting
for i in {1..101}; do
  curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/messages
done

# Should return 429 on 101st request
```

## Troubleshooting

### Rate Limit Not Working

1. Check Redis connection: `redis-cli ping`
2. Verify middleware is applied: Check `app.use()` order
3. Check authentication: Rate limiting only applies to authenticated users

### False Positives

1. Check Redis key expiry: Keys should expire after the window
2. Verify time synchronization across servers
3. Check for Redis memory issues: `redis-cli info memory`

### Performance Issues

1. Use Redis pipelining for batch operations
2. Set appropriate TTL on Redis keys
3. Monitor Redis memory usage and eviction policy
