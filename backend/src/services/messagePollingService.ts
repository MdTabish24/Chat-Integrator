import { Job } from 'bull';
import { messagePollingQueue } from '../config/queues';
import { messageAggregatorService } from './messageAggregatorService';
import { queryMany } from '../db/queryHelpers';
import { Platform, ConnectedAccount } from '../types';
import { RateLimitError, PlatformAPIError } from '../adapters/PlatformAdapter';

/**
 * Platforms that support webhooks and don't need polling
 * Based on design document:
 * - Telegram: Supports webhooks
 * - Instagram: Supports webhooks via Facebook Graph API
 * - WhatsApp: Supports webhooks via Cloud API
 * - Facebook: Supports webhooks via Graph API
 * - Teams: Supports webhooks via Microsoft Graph subscriptions
 * 
 * Platforms that need polling:
 * - Twitter: Webhook requires premium API access (polling for free tier)
 * - LinkedIn: Limited webhook support, polling recommended
 */
const WEBHOOK_ENABLED_PLATFORMS: Platform[] = [
  'telegram',
  'instagram',
  'whatsapp',
  'facebook',
  'teams'
];

/**
 * Interface for polling job data
 */
interface PollingJobData {
  accountId: string;
  platform: Platform;
  userId: string;
  lastPolledAt?: Date;
}

/**
 * Service for polling messages from platforms without webhooks
 */
export class MessagePollingService {
  private isInitialized = false;

  constructor() {
    // Don't initialize in constructor to allow manual initialization
  }

  /**
   * Initialize the polling service
   * Sets up the queue processor and schedules polling jobs
   */
  async initialize(): Promise<void> {
    if (this.isInitialized) {
      console.log('Message polling service already initialized');
      return;
    }

    console.log('Initializing message polling service...');

    // Set up the queue processor
    this.setupProcessor();

    // Schedule polling jobs for all active accounts
    await this.schedulePollingJobs();

    this.isInitialized = true;
    console.log('Message polling service initialized successfully');
  }

  /**
   * Set up the Bull queue processor
   */
  private setupProcessor(): void {
    messagePollingQueue.process(async (job: Job<PollingJobData>) => {
      const { accountId, platform, userId, lastPolledAt } = job.data;

      console.log(
        `Processing polling job for account ${accountId} (${platform})`
      );

      try {
        // Fetch messages since last poll (or last 24 hours if first poll)
        const since = lastPolledAt || new Date(Date.now() - 24 * 60 * 60 * 1000);
        
        const messages = await messageAggregatorService.fetchMessagesForAccount(
          accountId,
          since
        );

        console.log(
          `Polling completed for account ${accountId} (${platform}): ${messages.length} new messages`
        );

        // Emit WebSocket events for new messages if any were fetched
        if (messages.length > 0) {
          await this.emitPollingEvents(userId, messages.length);
        }

        // Reschedule the job for 60 seconds from now
        await this.schedulePollingJob(accountId, platform, userId, new Date());

        return {
          success: true,
          messageCount: messages.length,
          accountId,
          platform
        };
      } catch (error) {
        console.error(
          `Polling failed for account ${accountId} (${platform}):`,
          error
        );

        // Handle specific error types
        if (error instanceof RateLimitError) {
          console.warn(
            `Rate limit hit for ${platform}, will retry after ${error.retryAfter}s`
          );
          
          // Reschedule after rate limit expires
          await this.schedulePollingJob(
            accountId,
            platform,
            userId,
            lastPolledAt,
            error.retryAfter * 1000
          );
          
          // Don't throw to avoid Bull retry mechanism
          return {
            success: false,
            error: 'rate_limit',
            retryAfter: error.retryAfter,
            accountId,
            platform
          };
        }

        if (error instanceof PlatformAPIError) {
          console.error(
            `Platform API error for ${platform}: ${error.message}`
          );
          
          // If retryable, reschedule with backoff
          if (error.retryable) {
            await this.schedulePollingJob(
              accountId,
              platform,
              userId,
              lastPolledAt,
              120000 // 2 minutes backoff
            );
            
            return {
              success: false,
              error: 'api_error',
              retryable: true,
              accountId,
              platform
            };
          }
        }

        // For other errors, reschedule normally
        await this.schedulePollingJob(accountId, platform, userId, lastPolledAt);

        // Re-throw to trigger Bull's retry mechanism
        throw error;
      }
    });
  }

  /**
   * Schedule polling jobs for all active accounts that need polling
   */
  async schedulePollingJobs(): Promise<void> {
    const accounts = await this.getAccountsNeedingPolling();

    console.log(
      `Scheduling polling jobs for ${accounts.length} accounts`
    );

    for (const account of accounts) {
      try {
        await this.schedulePollingJob(
          account.id,
          account.platform as Platform,
          account.userId
        );
      } catch (error) {
        console.error(
          `Failed to schedule polling job for account ${account.id}:`,
          error
        );
      }
    }
  }

  /**
   * Schedule a polling job for a specific account
   * @param accountId - The connected account ID
   * @param platform - The platform name
   * @param userId - The user ID
   * @param lastPolledAt - Optional timestamp of last poll
   * @param delayMs - Optional delay in milliseconds (default: 60000 = 60 seconds)
   */
  async schedulePollingJob(
    accountId: string,
    platform: Platform,
    userId: string,
    lastPolledAt?: Date,
    delayMs: number = 60000
  ): Promise<Job<PollingJobData>> {
    const jobData: PollingJobData = {
      accountId,
      platform,
      userId,
      lastPolledAt
    };

    // Remove any existing jobs for this account to avoid duplicates
    await this.removeJobsForAccount(accountId);

    // Add job with delay
    const job = await messagePollingQueue.add(jobData, {
      delay: delayMs,
      jobId: `poll-${accountId}`, // Use consistent job ID to prevent duplicates
      removeOnComplete: true,
      removeOnFail: false
    });

    console.log(
      `Scheduled polling job ${job.id} for account ${accountId} (${platform}) in ${delayMs / 1000}s`
    );

    return job;
  }

  /**
   * Get all active accounts that need polling (non-webhook platforms)
   * @returns Array of connected accounts
   */
  private async getAccountsNeedingPolling(): Promise<ConnectedAccount[]> {
    const accounts = await queryMany<ConnectedAccount>(
      `SELECT * FROM connected_accounts 
       WHERE is_active = true 
       AND platform NOT IN (${WEBHOOK_ENABLED_PLATFORMS.map((_, i) => `$${i + 1}`).join(', ')})`,
      WEBHOOK_ENABLED_PLATFORMS
    );

    return accounts;
  }

  /**
   * Remove polling jobs for a specific account
   * Used when an account is disconnected or to prevent duplicates
   * @param accountId - The connected account ID
   */
  async removeJobsForAccount(accountId: string): Promise<void> {
    const jobId = `poll-${accountId}`;
    
    try {
      const job = await messagePollingQueue.getJob(jobId);
      
      if (job) {
        await job.remove();
        console.log(`Removed polling job for account ${accountId}`);
      }
    } catch (error) {
      // Job might not exist, which is fine
      console.debug(`No polling job found for account ${accountId}`);
    }
  }

  /**
   * Add a new account to the polling schedule
   * Called when a new account is connected
   * @param accountId - The connected account ID
   * @param platform - The platform name
   * @param userId - The user ID
   */
  async addAccountToPolling(
    accountId: string,
    platform: Platform,
    userId: string
  ): Promise<void> {
    try {
      // Check if platform needs polling
      if (WEBHOOK_ENABLED_PLATFORMS.includes(platform)) {
        console.log(
          `Platform ${platform} uses webhooks, skipping polling setup`
        );
        return;
      }

      console.log(
        `Adding account ${accountId} (${platform}) to polling schedule`
      );

      await this.schedulePollingJob(accountId, platform, userId);
      console.log(`Successfully scheduled polling for account ${accountId}`);
    } catch (error) {
      console.error(`Failed to add account ${accountId} to polling:`, error);
      throw error;
    }
  }

  /**
   * Remove an account from the polling schedule
   * Called when an account is disconnected
   * @param accountId - The connected account ID
   */
  async removeAccountFromPolling(accountId: string): Promise<void> {
    console.log(`Removing account ${accountId} from polling schedule`);
    await this.removeJobsForAccount(accountId);
  }

  /**
   * Get polling statistics
   * @returns Statistics about polling jobs
   */
  async getPollingStats(): Promise<{
    waiting: number;
    active: number;
    completed: number;
    failed: number;
    delayed: number;
  }> {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      messagePollingQueue.getWaitingCount(),
      messagePollingQueue.getActiveCount(),
      messagePollingQueue.getCompletedCount(),
      messagePollingQueue.getFailedCount(),
      messagePollingQueue.getDelayedCount()
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Get failed polling jobs for monitoring
   * @param limit - Maximum number of jobs to return
   * @returns Array of failed jobs
   */
  async getFailedJobs(limit: number = 50): Promise<Job<PollingJobData>[]> {
    return messagePollingQueue.getFailed(0, limit - 1);
  }

  /**
   * Retry a specific failed polling job manually
   * @param jobId - The job ID to retry
   * @returns The retried job
   */
  async retryFailedJob(jobId: string): Promise<Job<PollingJobData> | null> {
    const job = await messagePollingQueue.getJob(jobId);
    
    if (!job) {
      console.warn(`Job ${jobId} not found`);
      return null;
    }

    if (await job.isFailed()) {
      await job.retry();
      console.log(`Manually retrying polling job ${jobId}`);
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
    const completedRemoved = await messagePollingQueue.clean(olderThan, 'completed');
    const failedRemoved = await messagePollingQueue.clean(olderThan, 'failed');

    console.log(
      `Cleaned up ${completedRemoved.length} completed and ${failedRemoved.length} failed polling jobs`
    );
  }

  /**
   * Trigger immediate polling for a specific account
   * Useful for manual refresh or testing
   * @param accountId - The connected account ID
   */
  async triggerImmediatePolling(accountId: string): Promise<void> {
    const account = await queryMany<ConnectedAccount>(
      `SELECT * FROM connected_accounts WHERE id = $1 AND is_active = true`,
      [accountId]
    );

    if (account.length === 0) {
      throw new Error(`Account ${accountId} not found or inactive`);
    }

    const { platform, userId } = account[0];

    if (WEBHOOK_ENABLED_PLATFORMS.includes(platform as Platform)) {
      throw new Error(
        `Platform ${platform} uses webhooks, polling not needed`
      );
    }

    console.log(`Triggering immediate polling for account ${accountId}`);

    // Schedule with no delay
    await this.schedulePollingJob(
      accountId,
      platform as Platform,
      userId,
      undefined,
      0 // No delay
    );
  }

  /**
   * Check if a platform needs polling
   * @param platform - The platform to check
   * @returns True if the platform needs polling
   */
  static needsPolling(platform: Platform): boolean {
    return !WEBHOOK_ENABLED_PLATFORMS.includes(platform);
  }

  /**
   * Get list of platforms that need polling
   * @returns Array of platform names
   */
  static getPollingPlatforms(): Platform[] {
    const allPlatforms: Platform[] = [
      'telegram',
      'twitter',
      'linkedin',
      'instagram',
      'whatsapp',
      'facebook',
      'teams'
    ];

    return allPlatforms.filter(p => !WEBHOOK_ENABLED_PLATFORMS.includes(p));
  }

  /**
   * Emit WebSocket events after polling completes
   * @param userId - The user ID
   * @param messageCount - Number of new messages fetched
   */
  private async emitPollingEvents(userId: string, messageCount: number): Promise<void> {
    try {
      const { websocketService } = await import('./websocketService');

      // Get and emit updated unread counts
      const unreadCounts = await messageAggregatorService.getUnreadCountByPlatform(userId);
      const totalUnread = await messageAggregatorService.getTotalUnreadCount(userId);
      
      websocketService.emitUnreadCountUpdate(userId, unreadCounts, totalUnread);

      console.log(`Emitted polling update to user ${userId}: ${messageCount} new messages`);
    } catch (error) {
      console.error('Error emitting polling events:', error);
      // Don't throw - WebSocket emission failure shouldn't break polling
    }
  }

  /**
   * Shutdown the polling service gracefully
   */
  async shutdown(): Promise<void> {
    console.log('Shutting down message polling service...');
    
    await messagePollingQueue.close();
    
    this.isInitialized = false;
    console.log('Message polling service shut down successfully');
  }
}

// Export singleton instance
export const messagePollingService = new MessagePollingService();
