import Bull from 'bull';

/**
 * Bull queue configuration for background jobs
 */

// Get Redis connection options
const redisOptions = {
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD
};

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
  console.error(`Webhook retry job ${job?.id} failed:`, err.message);
});

messagePollingQueue.on('completed', (job) => {
  console.log(`Message polling job ${job.id} completed successfully`);
});

messagePollingQueue.on('failed', (job, err) => {
  console.error(`Message polling job ${job?.id} failed:`, err.message);
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
