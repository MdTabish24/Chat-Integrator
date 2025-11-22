# Message Polling Service

## Overview

The Message Polling Service is responsible for periodically fetching messages from platforms that don't support webhooks or where webhook support is limited. This ensures that messages from all connected platforms are synchronized to the Messaging Hub, even when real-time webhook notifications are not available.

## Architecture

The service uses Bull queue for job scheduling and processing, with Redis as the backing store. Each connected account that requires polling gets its own recurring job that runs every 60 seconds.

## Webhook vs Polling Platforms

### Webhook-Enabled Platforms (No Polling Needed)
- **Telegram**: Supports webhooks via Bot API
- **Instagram Business**: Supports webhooks via Facebook Graph API
- **WhatsApp Business**: Supports webhooks via Cloud API
- **Facebook Pages**: Supports webhooks via Graph API
- **Microsoft Teams**: Supports webhooks via Microsoft Graph subscriptions

### Polling-Required Platforms
- **Twitter/X**: Webhook requires premium API access; polling used for free tier
- **LinkedIn**: Limited webhook support; polling recommended for reliability

## How It Works

### 1. Initialization

When the server starts, the polling service:
1. Sets up the Bull queue processor
2. Queries the database for all active accounts that need polling
3. Schedules a polling job for each account

```typescript
await messagePollingService.initialize();
```

### 2. Job Processing

Each polling job:
1. Fetches messages from the platform API using the Message Aggregator Service
2. Stores new messages in the database with encryption
3. Handles rate limits and API errors gracefully
4. Reschedules itself for 60 seconds later

### 3. Account Lifecycle Integration

**When an account is connected:**
```typescript
await messagePollingService.addAccountToPolling(accountId, platform, userId);
```

**When an account is disconnected:**
```typescript
await messagePollingService.removeAccountFromPolling(accountId);
```

## Error Handling

### Rate Limit Errors
- When a rate limit is hit, the job reschedules itself after the rate limit reset time
- No retry attempts are made until the rate limit expires
- Logs a warning for monitoring

### Platform API Errors
- Retryable errors: Job reschedules with 2-minute backoff
- Non-retryable errors: Job fails and triggers Bull's retry mechanism (up to 3 attempts)
- All errors are logged for monitoring

### Network Errors
- Handled by Bull's built-in retry mechanism
- Exponential backoff: 2s, 4s, 8s

## Configuration

### Polling Interval
Default: 60 seconds (60000ms)

Can be customized per job:
```typescript
await messagePollingService.schedulePollingJob(
  accountId,
  platform,
  userId,
  lastPolledAt,
  30000 // 30 seconds
);
```

### Retry Configuration
Defined in `backend/src/config/queues.ts`:
```typescript
{
  attempts: 3,
  backoff: {
    type: 'exponential',
    delay: 2000
  }
}
```

## API Methods

### Core Methods

#### `initialize(): Promise<void>`
Initializes the polling service and schedules jobs for all active accounts.

#### `schedulePollingJob(accountId, platform, userId, lastPolledAt?, delayMs?): Promise<Job>`
Schedules a polling job for a specific account.

#### `addAccountToPolling(accountId, platform, userId): Promise<void>`
Adds a newly connected account to the polling schedule.

#### `removeAccountFromPolling(accountId): Promise<void>`
Removes a disconnected account from the polling schedule.

### Monitoring Methods

#### `getPollingStats(): Promise<JobStats>`
Returns statistics about polling jobs (waiting, active, completed, failed, delayed).

#### `getFailedJobs(limit?): Promise<Job[]>`
Returns failed polling jobs for monitoring and debugging.

#### `retryFailedJob(jobId): Promise<Job | null>`
Manually retries a specific failed job.

### Utility Methods

#### `triggerImmediatePolling(accountId): Promise<void>`
Triggers immediate polling for an account (useful for manual refresh).

#### `cleanOldJobs(olderThan?): Promise<void>`
Cleans up old completed and failed jobs (default: 24 hours).

#### `static needsPolling(platform): boolean`
Checks if a platform requires polling.

#### `static getPollingPlatforms(): Platform[]`
Returns list of platforms that need polling.

## Usage Examples

### Manual Polling Trigger
```typescript
// Trigger immediate polling for an account
await messagePollingService.triggerImmediatePolling(accountId);
```

### Monitoring
```typescript
// Get polling statistics
const stats = await messagePollingService.getPollingStats();
console.log(`Active polling jobs: ${stats.active}`);
console.log(`Failed polling jobs: ${stats.failed}`);

// Get failed jobs
const failedJobs = await messagePollingService.getFailedJobs(10);
for (const job of failedJobs) {
  console.log(`Failed job: ${job.id}, Account: ${job.data.accountId}`);
}
```

### Cleanup
```typescript
// Clean up jobs older than 24 hours
await messagePollingService.cleanOldJobs();

// Clean up jobs older than 1 hour
await messagePollingService.cleanOldJobs(60 * 60 * 1000);
```

## Integration Points

### 1. OAuth Controller
- `handleCallback`: Adds account to polling when connected
- `disconnectAccount`: Removes account from polling when disconnected

### 2. Message Aggregator Service
- `fetchMessagesForAccount`: Called by polling jobs to fetch messages
- Handles encryption, storage, and conversation management

### 3. Bull Queue
- Job scheduling and processing
- Retry logic and error handling
- Job persistence via Redis

## Monitoring and Observability

### Logs
- Job scheduling: `Scheduled polling job {jobId} for account {accountId}`
- Job completion: `Polling completed for account {accountId}: {count} new messages`
- Job failure: `Polling failed for account {accountId}: {error}`
- Rate limits: `Rate limit hit for {platform}, will retry after {seconds}s`

### Metrics to Monitor
- Active polling jobs count
- Failed polling jobs count
- Average polling duration
- Messages fetched per poll
- Rate limit hits per platform

### Health Checks
```typescript
const stats = await messagePollingService.getPollingStats();
if (stats.failed > 10) {
  // Alert: High number of failed polling jobs
}
```

## Performance Considerations

### Database Load
- Each polling job queries the database for account details
- Messages are inserted with encryption
- Consider connection pooling for high account counts

### API Rate Limits
- Rate limits are enforced per platform via Redis
- Polling respects platform-specific rate limits
- Failed rate limit checks reschedule jobs appropriately

### Redis Memory
- Completed jobs are removed automatically
- Failed jobs are kept for monitoring (clean up periodically)
- Job data is minimal (accountId, platform, userId, timestamp)

## Future Enhancements

1. **Adaptive Polling Intervals**: Adjust polling frequency based on message activity
2. **Priority Polling**: Poll high-activity accounts more frequently
3. **Batch Processing**: Fetch messages for multiple accounts in parallel
4. **Smart Scheduling**: Distribute polling jobs evenly across time to avoid spikes
5. **Platform-Specific Optimizations**: Use platform-specific features (e.g., Twitter's since_id)

## Troubleshooting

### Jobs Not Running
1. Check Redis connection: `redis-cli ping`
2. Check Bull queue status: `await messagePollingService.getPollingStats()`
3. Verify accounts exist: Query `connected_accounts` table

### High Failure Rate
1. Check platform API status
2. Review rate limit configuration
3. Check access token validity
4. Review error logs for specific failures

### Duplicate Jobs
- Jobs use consistent IDs (`poll-{accountId}`) to prevent duplicates
- Old jobs are removed before scheduling new ones
- If duplicates occur, check Redis for stale job data

## Related Documentation

- [Message Aggregator Service](./messageAggregatorService.ts)
- [Webhook Service](./webhookService.ts)
- [Queue Configuration](../config/queues.ts)
- [Platform Adapters](../adapters/README.md)
