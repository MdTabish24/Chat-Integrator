import { PlatformAdapter, PlatformAPIError, RateLimitError } from './PlatformAdapter';
import { Platform } from '../types';
import { platformRateLimitService } from '../services/platformRateLimitService';
import { logApiUsage } from '../db/queryHelpers';

/**
 * Retry configuration
 */
const MAX_RETRIES = 3;
const BASE_DELAY_MS = 1000; // 1 second

/**
 * Abstract base class for platform adapters with common functionality
 */
export abstract class BasePlatformAdapter implements PlatformAdapter {
  protected platform: Platform;

  constructor(platform: Platform) {
    this.platform = platform;
  }

  /**
   * Abstract methods that must be implemented by concrete adapters
   */
  abstract fetchMessages(accountId: string, since?: Date): Promise<any[]>;
  abstract sendMessage(accountId: string, conversationId: string, content: string): Promise<any>;
  abstract markAsRead(accountId: string, messageId: string): Promise<void>;
  abstract getConversations(accountId: string): Promise<any[]>;

  /**
   * Check and enforce rate limits using the platform rate limit service
   * @param accountId - The connected account ID
   * @param endpoint - The API endpoint being called
   * @throws RateLimitError if rate limit is exceeded
   */
  protected async checkRateLimit(accountId: string, endpoint: string = 'api'): Promise<void> {
    try {
      await platformRateLimitService.checkRateLimit(accountId, this.platform, endpoint);
    } catch (error) {
      if (error instanceof Error && error.message.includes('rate limit')) {
        // Convert AppError to RateLimitError for backward compatibility
        const retryAfter = (error as any).details?.retryAfter || 60;
        throw new RateLimitError(
          error.message,
          this.platform,
          retryAfter
        );
      }
      throw error;
    }
  }

  /**
   * Log platform API usage to database
   * @param accountId - The connected account ID
   * @param endpoint - The API endpoint that was called
   */
  protected async logPlatformApiUsage(accountId: string, endpoint: string): Promise<void> {
    try {
      await logApiUsage(accountId, this.platform, endpoint);
    } catch (error) {
      // Log error but don't fail the request
      console.error(`Failed to log API usage for ${this.platform}:`, error);
    }
  }

  /**
   * Execute an API call with retry logic and exponential backoff
   * @param fn - The function to execute
   * @param accountId - The connected account ID for rate limiting
   * @param endpoint - The API endpoint being called (for logging)
   * @returns The result of the function
   */
  protected async executeWithRetry<T>(
    fn: () => Promise<T>,
    accountId: string,
    endpoint: string = 'api'
  ): Promise<T> {
    let lastError: Error | undefined;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        // Check rate limit before making the request
        await this.checkRateLimit(accountId, endpoint);

        // Execute the function
        const result = await fn();

        // Log successful API usage
        await this.logPlatformApiUsage(accountId, endpoint);

        return result;
      } catch (error) {
        lastError = error as Error;

        // Don't retry if it's a rate limit error
        if (error instanceof RateLimitError) {
          throw error;
        }

        // Check if error is retryable
        const isRetryable = this.isRetryableError(error);

        if (!isRetryable || attempt === MAX_RETRIES - 1) {
          // Not retryable or last attempt, throw the error
          throw this.wrapError(error);
        }

        // Calculate delay with exponential backoff
        const delay = BASE_DELAY_MS * Math.pow(2, attempt);
        console.log(
          `Retry attempt ${attempt + 1}/${MAX_RETRIES} for ${this.platform} after ${delay}ms`
        );

        // Wait before retrying
        await this.sleep(delay);
      }
    }

    // Should never reach here, but TypeScript needs it
    throw this.wrapError(lastError!);
  }

  /**
   * Determine if an error is retryable
   * @param error - The error to check
   * @returns True if the error is retryable
   */
  protected isRetryableError(error: any): boolean {
    // Network errors are retryable
    if (error.code === 'ECONNRESET' || error.code === 'ETIMEDOUT' || error.code === 'ENOTFOUND') {
      return true;
    }

    // HTTP 5xx errors are retryable
    if (error.response?.status >= 500 && error.response?.status < 600) {
      return true;
    }

    // HTTP 429 (Too Many Requests) should be handled by rate limiting, but can be retried
    if (error.response?.status === 429) {
      return true;
    }

    // HTTP 408 (Request Timeout) is retryable
    if (error.response?.status === 408) {
      return true;
    }

    return false;
  }

  /**
   * Wrap an error in a PlatformAPIError
   * @param error - The error to wrap
   * @returns A PlatformAPIError
   */
  protected wrapError(error: any): PlatformAPIError {
    if (error instanceof PlatformAPIError) {
      return error;
    }

    const statusCode = error.response?.status;
    const retryable = this.isRetryableError(error);
    const message = error.response?.data?.message || error.message || 'Unknown error';

    return new PlatformAPIError(
      `${this.platform} API error: ${message}`,
      this.platform,
      statusCode,
      retryable,
      error
    );
  }

  /**
   * Sleep for a specified duration
   * @param ms - Milliseconds to sleep
   */
  protected sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  /**
   * Get access token for an account from the database
   * @param accountId - The connected account ID
   * @returns The decrypted access token
   */
  protected abstract getAccessToken(accountId: string): Promise<string>;

  /**
   * Handle token refresh if needed
   * @param accountId - The connected account ID
   */
  protected abstract refreshTokenIfNeeded(accountId: string): Promise<void>;
}
