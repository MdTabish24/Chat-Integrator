# Task 13 Verification Checklist

## Pre-Deployment Checklist

### Database Setup
- [ ] Run migration: `npm run migrate`
- [ ] Verify `api_usage_logs` table has `user_id` column
- [ ] Verify indexes are created

### Redis Setup
- [ ] Redis server is running
- [ ] Connection configured in `.env`
- [ ] Test connection: `redis-cli ping`

### Code Verification
- [x] All TypeScript files compile without errors
- [x] No linting errors
- [x] Middleware properly exported
- [x] Routes properly configured

## Functional Testing

### 1. User Rate Limiting

**Test:** Make 101 requests within 1 minute

```bash
TOKEN="your-jwt-token"
for i in {1..101}; do
  echo "Request $i"
  curl -s -w "\nStatus: %{http_code}\n" \
    -H "Authorization: Bearer $TOKEN" \
    http://localhost:3000/api/messages
done
```

**Expected:**
- First 100 requests: Status 200
- 101st request: Status 429
- Response includes `X-RateLimit-*` headers
- Response includes `Retry-After` header

### 2. API Usage Logging

**Test:** Make authenticated requests and verify logging

```bash
# Make some requests
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/messages
curl -H "Authorization: Bearer $TOKEN" http://localhost:3000/api/conversations
```

**Verify in database:**
```sql
SELECT * FROM api_usage_logs 
WHERE user_id = 'your-user-id' 
ORDER BY timestamp DESC 
LIMIT 10;
```

**Expected:**
- Entries created for each successful request
- Correct endpoint paths logged
- Timestamps are accurate

### 3. Platform Rate Limiting

**Test:** Check rate limit status endpoint

```bash
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/oauth/rate-limits
```

**Expected:**
```json
{
  "rateLimits": [
    {
      "accountId": "uuid",
      "platform": "twitter",
      "limit": 300,
      "remaining": 300,
      "resetAt": "2025-11-22T12:00:00Z",
      "windowMs": 900000
    }
  ]
}
```

### 4. Platform API Calls

**Test:** Trigger platform API call and verify rate limiting

```bash
# Sync messages (triggers platform API calls)
curl -X POST \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/messages/sync
```

**Verify:**
- Platform rate limit checked before API call
- API usage logged to database
- No errors in server logs

### 5. Rate Limit Headers

**Test:** Check response headers

```bash
curl -v -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/messages
```

**Expected headers:**
```
X-RateLimit-Limit: 100
X-RateLimit-Remaining: 99
X-RateLimit-Reset: 2025-11-22T12:01:00.000Z
```

### 6. Error Handling

**Test:** Simulate Redis failure

```bash
# Stop Redis
redis-cli shutdown

# Make request
curl -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/messages
```

**Expected:**
- Request succeeds (graceful degradation)
- Warning logged in server console
- No rate limiting applied

### 7. Unauthenticated Requests

**Test:** Make request without token

```bash
curl http://localhost:3000/api/messages
```

**Expected:**
- Status 401 (Unauthorized)
- No rate limiting applied
- No API usage logged

## Performance Testing

### Load Test

```bash
# Install Apache Bench
# apt-get install apache2-utils

# Test with 1000 requests, 10 concurrent
ab -n 1000 -c 10 \
  -H "Authorization: Bearer $TOKEN" \
  http://localhost:3000/api/messages
```

**Monitor:**
- Response times
- Redis memory usage
- Database connection pool
- Error rate

## Monitoring Setup

### Redis Monitoring

```bash
# Monitor Redis in real-time
redis-cli monitor

# Check memory usage
redis-cli info memory

# Check key count
redis-cli dbsize
```

### Database Monitoring

```sql
-- Check API usage logs growth
SELECT 
  DATE(timestamp) as date,
  COUNT(*) as log_count
FROM api_usage_logs
GROUP BY DATE(timestamp)
ORDER BY date DESC;

-- Check for missing user_id (should be none)
SELECT COUNT(*) 
FROM api_usage_logs 
WHERE user_id IS NULL;
```

### Application Logs

Monitor for:
- Rate limit exceeded events
- Redis connection errors
- API usage logging failures
- Platform rate limit violations

## Integration Verification

### Middleware Order

Verify in `backend/src/index.ts`:
```typescript
app.use('/api', rateLimiter);        // 1. Rate limiting
app.use('/api', apiUsageLogger);     // 2. Usage logging
app.use('/api/auth', authRoutes);    // 3. Routes
```

### Platform Adapters

Verify in any adapter (e.g., `TelegramAdapter.ts`):
- Calls `executeWithRetry()` with endpoint parameter
- Rate limits checked before API calls
- API usage logged after successful calls

## Rollback Plan

If issues occur:

1. **Disable rate limiting:**
```typescript
// In backend/src/index.ts
// Comment out:
// app.use('/api', rateLimiter);
```

2. **Disable API logging:**
```typescript
// Comment out:
// app.use('/api', apiUsageLogger);
```

3. **Revert database migration:**
```sql
ALTER TABLE api_usage_logs DROP COLUMN user_id;
ALTER TABLE api_usage_logs ALTER COLUMN account_id SET NOT NULL;
```

## Success Criteria

- [x] All code compiles without errors
- [ ] Database migration runs successfully
- [ ] Rate limiting works as expected
- [ ] API usage logging captures all requests
- [ ] Platform rate limits enforced
- [ ] Error handling works correctly
- [ ] Performance is acceptable
- [ ] Documentation is complete

## Known Limitations

1. Rate limiting requires Redis - gracefully degrades if unavailable
2. API usage logs can grow large - implement cleanup job in future
3. Platform rate limits are approximate - actual limits may vary
4. No distributed rate limiting across multiple servers (single Redis instance)

## Next Steps After Verification

1. Set up monitoring alerts
2. Create cleanup job for old API usage logs
3. Implement rate limit analytics dashboard
4. Add metrics export for Prometheus
5. Document rate limit policies for API consumers
