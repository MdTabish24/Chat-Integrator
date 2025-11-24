import Bull from 'bull';

/**
 * Bull queue configuration for background jobs
 */

// Get Redis connection options optimized for Upstash
// Parse REDIS_URL if provided, otherwise use individual env vars
let redisOptions: any;

if (process.env.REDIS_URL) {
  // Parse redis://default:password@host:port format
  const url = new URL(process.env.REDIS_URL);
  redisOptions = {
    host: url.hostname,
    port: parseInt(url.port || '6379'),
    password: url.password,
    tls: {
      rejectUnauthorized: false // Required for Upstash
    },
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    connectTimeout: 10000,
    keepAlive: 30000,
    family: 4,
    retryStrategy: (times: number) => {
      if (times > 3) {
        console.error('Redis max retries reached for Bull queue');
        return null;
      }
      const delay = Math.min(times * 1000, 3000);
      console.log(`Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    }
  };
} else {
  redisOptions = {
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379'),
    password: process.env.REDIS_PASSWORD,
    tls: process.env.REDIS_HOST?.includes('upstash.io') ? {
      rejectUnauthorized: false
    } : undefined,
    maxRetriesPerRequest: 3,
    enableReadyCheck: false,
    connectTimeout: 10000,
    keepAlive: 30000,
    family: 4,
    retryStrategy: (times: number) => {
      if (times > 3) {
        console.error('Redis max retries reached for Bull queue');
        return null;
      }
      const delay = Math.min(times * 1000, 3000);
      console.log(`Redis retry attempt ${times}, waiting ${delay}ms`);
      return delay;
    }
  };
}

/**
 * Queue for retrying failed webhook processing
 */
export const webhookRetryQueue = new Bull('webhook-retry', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 1000 // Start with 1 second, then 5s, then 15s (exponential)
    },
    removeOnComplete: true,
    removeOnFail: false // Keep failed jobs for monitoring
  }
});

/**
 * Queue for polling messages from platforms without webhooks
 */
export const messagePollingQueue = new Bull('message-polling', {
  redis: redisOptions,
  defaultJobOptions: {
    attempts: 3,
    backoff: {
      type: 'exponential',
      delay: 2000
    },
    removeOnComplete: true,
    removeOnFail: false
  }
});

// Log queue events
webhookRetryQueue.on('completed', (job) => {
  console.log(`Webhook retry job ${job.id} completed successfully`);
});

webhookRetryQueue.on('failed', (job, err) => {
  console.error(`Webhook retry job ${job?.id} failed:`, err?.message || err);
});

messagePollingQueue.on('completed', (job) => {
  console.log(`Message polling job ${job.id} completed successfully`);
});

messagePollingQueue.on('failed', (job, err) => {
  console.error(`Message polling job ${job?.id} failed:`, err?.message || err);
});

// Graceful shutdown
process.on('SIGTERM', async () => {
  console.log('Closing Bull queues...');
  await webhookRetryQueue.close();
  await messagePollingQueue.close();
});

export default {
  webhookRetryQueue,
  messagePollingQueue
};
