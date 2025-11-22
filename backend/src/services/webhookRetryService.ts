import { Job } from 'bull';
import { webhookRetryQueue } from '../config/queues';
import { webhookService } from './webhookService';
import { Platform } from '../types';

/**
 * Interface for webhook retry job data
 */
interface WebhookRetryJobData {
  platform: Platform;
  accountId: string;
  messageData: any;
  originalPayload: any;
  attemptNumber: number;
  firstAttemptAt: Date;
}

/**
 * Service for handling webhook retry logic
 */
export class WebhookRetryService {
  constructor() {
    this.setupProcessor();
  }

  /**
   * Set up the Bull queue processor
   */
  private setupProcessor(): void {
    webhookRetryQueue.process(async (job: Job<WebhookRetryJobData>) => {
      const { platform, accountId, messageData, originalPayload, attemptNumber } = job.data;

      console.log(
        `Processing webhook retry for ${platform}, account ${accountId}, attempt ${attemptNumber}`
      );

      try {
        // Attempt to process the message again
        await webhookService.processIncomingMessage(accountId, messageData);

        console.log(
          `Webhook retry successful for ${platform}, account ${accountId} after ${attemptNumber} attempts`
        );

        return { success: true, attemptNumber };
      } catch (error) {
        console.error(
          `Webhook retry failed for ${platform}, account ${accountId}, attempt ${attemptNumber}:`,
          error
        );

        // Log the failure
        webhookService.logWebhookFailure(platform, error as Error, originalPayload);

        // Re-throw to trigger Bull's retry mechanism
        throw error;
      }
    });
  }

  /**
   * Add a failed webhook to the retry queue
   * @param platform - The platform name
   * @param accountId - The connected account ID
   * @param messageData - The parsed message data
   * @param originalPayload - The original webhook payload
   * @returns The created job
   */
  async addToRetryQueue(
    platform: Platform,
    accountId: string,
    messageData: any,
    originalPayload: any
  ): Promise<Job<WebhookRetryJobData>> {
    const jobData: WebhookRetryJobData = {
      platform,
      accountId,
      messageData,
      originalPayload,
      attemptNumber: 1,
      firstAttemptAt: new Date()
    };

    // Add job to queue with exponential backoff
    // Attempts: 1s, 5s, 15s (approximately)
    const job = await webhookRetryQueue.add(jobData, {
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000 // 1 second base delay
      }
    });

    console.log(
      `Added webhook retry job ${job.id} for ${platform}, account ${accountId}`
    );

    return job;
  }

  /**
   * Get failed webhook jobs for monitoring
   * @param limit - Maximum number of jobs to return
   * @returns Array of failed jobs
   */
  async getFailedJobs(limit: number = 50): Promise<Job<WebhookRetryJobData>[]> {
    return webhookRetryQueue.getFailed(0, limit - 1);
  }

  /**
   * Get job counts for monitoring
   * @returns Object with counts for different job states
   */
  async getJobCounts(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      webhookRetryQueue.getWaitingCount(),
      webhookRetryQueue.getActiveCount(),
      webhookRetryQueue.getCompletedCount(),
      webhookRetryQueue.getFailedCount(),
      webhookRetryQueue.getDelayedCount()
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Retry a specific failed job manually
   * @param jobId - The job ID to retry
   * @returns The retried job
   */
  async retryFailedJob(jobId: string): Promise<Job<WebhookRetryJobData> | null> {
    const job = await webhookRetryQueue.getJob(jobId);
    
    if (!job) {
      console.warn(`Job ${jobId} not found`);
      return null;
    }

    if (await job.isFailed()) {
      await job.retry();
      console.log(`Manually retrying job ${jobId}`);
      return job;
    }

    console.warn(`Job ${jobId} is not in failed state`);
    return null;
  }

  /**
   * Clean up old completed and failed jobs
   * @param olderThan - Remove jobs older than this many milliseconds (default: 24 hours)
   */
  async cleanOldJobs(olderThan: number = 24 * 60 * 60 * 1000): Promise<void> {
    const completedRemoved = await webhookRetryQueue.clean(olderThan, 'completed');
    const failedRemoved = await webhookRetryQueue.clean(olderThan, 'failed');

    console.log(
      `Cleaned up ${completedRemoved.length} completed and ${failedRemoved.length} failed webhook retry jobs`
    );
  }

  /**
   * Get statistics about webhook failures by platform
   * @returns Map of platform to failure count
   */
  async getFailureStatsByPlatform(): Promise<Map<Platform, number>> {
    const failedJobs = await this.getFailedJobs(1000);
    const stats = new Map<Platform, number>();

    for (const job of failedJobs) {
      const platform = job.data.platform;
      stats.set(platform, (stats.get(platform) || 0) + 1);
    }

    return stats;
  }

  /**
   * Remove all failed jobs (use with caution)
   */
  async clearFailedJobs(): Promise<void> {
    const failedJobs = await webhookRetryQueue.getFailed();
    
    for (const job of failedJobs) {
      await job.remove();
    }

    console.log(`Removed ${failedJobs.length} failed webhook retry jobs`);
  }
}

// Export singleton instance
export const webhookRetryService = new WebhookRetryService();
