import redisClient from '../config/redis';
import { Platform } from '../types';
import { AppError } from '../middleware/errorHandler';

/**
 * Platform-specific rate limit configurations
 * Based on official API documentation for each platform
 */
const PLATFORM_RATE_LIMITS: Record<
  Platform,
  {
    maxRequests: number;
    windowMs: number;
    description: string;
  }
> = {
  telegram: {
    maxRequests: 30,
    windowMs: 1000, // 30 requests per second
    description: 'Telegram Bot API',
  },
  twitter: {
    maxRequests: 300,
    windowMs: 15 * 60 * 1000, // 300 requests per 15 minutes
    description: 'Twitter API v2 DM endpoints',
  },
  linkedin: {
    maxRequests: 100,
    windowMs: 24 * 60 * 60 * 1000, // 100 requests per day
    description: 'LinkedIn Messaging API',
  },
  instagram: {
    maxRequests: 200,
    windowMs: 60 * 60 * 1000, // 200 requests per hour
    description: 'Instagram Graph API',
  },
  whatsapp: {
    maxRequests: 80,
    windowMs: 1000, // 80 requests per second
    description: 'WhatsApp Cloud API',
  },
  facebook: {
    maxRequests: 200,
    windowMs: 60 * 60 * 1000, // 200 requests per hour
    description: 'Facebook Graph API',
  },
  teams: {
    maxRequests: 10000,
    windowMs: 10 * 60 * 1000, // 10,000 requests per 10 minutes
    description: 'Microsoft Graph API',
  },
};

export class PlatformRateLimitService {
  /**
   * Check if a platform API call can be made without exceeding rate limits
   * @param accountId - Connected account ID
   * @param platform - Platform name
   * @param endpoint - API endpoint being called
   * @returns true if call can be made, throws error if rate limit exceeded
   */
  async checkRateLimit(
    accountId: string,
    platform: Platform,
    endpoint: string
  ): Promise<boolean> {
    const config = PLATFORM_RATE_LIMITS[platform];
    if (!config) {
      console.warn(`No rate limit configuration for platform: ${platform}`);
      return true;
    }

    const key = `platform:ratelimit:${platform}:${accountId}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Remove old entries
      await redisClient.zRemRangeByScore(key, 0, windowStart);

      // Count requests in current window
      const requestCount = await redisClient.zCard(key);

      // Check if rate limit exceeded
      if (requestCount >= config.maxRequests) {
        // Get oldest request to calculate retry time
        const oldestRequest = await redisClient.zRange(key, 0, 0);

        let retryAfter = Math.ceil(config.windowMs / 1000);
        if (oldestRequest.length > 0) {
          const oldestTimestamp = parseInt(oldestRequest[0]);
          retryAfter = Math.ceil((oldestTimestamp + config.windowMs - now) / 1000);
        }

        throw new AppError(
          `Platform API rate limit exceeded for ${platform}. Please try again later.`,
          429,
          'PLATFORM_RATE_LIMIT_EXCEEDED',
          true,
          {
            platform,
            endpoint,
            limit: config.maxRequests,
            windowMs: config.windowMs,
            retryAfter,
            description: config.description,
          }
        );
      }

      // Add current request
      await redisClient.zAdd(key, { score: now, value: `${now}:${endpoint}` });

      // Set expiry
      await redisClient.expire(key, Math.ceil(config.windowMs / 1000) + 60);

      return true;
    } catch (error) {
      if (error instanceof AppError) {
        throw error;
      }
      console.error('Platform rate limit check error:', error);
      // On Redis failure, allow the request through
      return true;
    }
  }

  /**
   * Record a platform API call for rate limiting
   * Use this after a successful API call
   */
  async recordApiCall(
    accountId: string,
    platform: Platform,
    endpoint: string
  ): Promise<void> {
    const config = PLATFORM_RATE_LIMITS[platform];
    if (!config) {
      return;
    }

    const key = `platform:ratelimit:${platform}:${accountId}`;
    const now = Date.now();

    try {
      await redisClient.zAdd(key, { score: now, value: `${now}:${endpoint}` });
      await redisClient.expire(key, Math.ceil(config.windowMs / 1000) + 60);
    } catch (error) {
      console.error('Failed to record platform API call:', error);
    }
  }

  /**
   * Get current rate limit status for a platform
   */
  async getRateLimitStatus(
    accountId: string,
    platform: Platform
  ): Promise<{
    limit: number;
    remaining: number;
    resetAt: Date;
    windowMs: number;
  }> {
    const config = PLATFORM_RATE_LIMITS[platform];
    if (!config) {
      return {
        limit: 0,
        remaining: 0,
        resetAt: new Date(),
        windowMs: 0,
      };
    }

    const key = `platform:ratelimit:${platform}:${accountId}`;
    const now = Date.now();
    const windowStart = now - config.windowMs;

    try {
      // Remove old entries
      await redisClient.zRemRangeByScore(key, 0, windowStart);

      // Count requests in current window
      const requestCount = await redisClient.zCard(key);
      const remaining = Math.max(0, config.maxRequests - requestCount);

      // Get oldest request to calculate reset time
      const oldestRequest = await redisClient.zRange(key, 0, 0);

      let resetAt = new Date(now + config.windowMs);
      if (oldestRequest.length > 0) {
        const oldestTimestamp = parseInt(oldestRequest[0]);
        resetAt = new Date(oldestTimestamp + config.windowMs);
      }

      return {
        limit: config.maxRequests,
        remaining,
        resetAt,
        windowMs: config.windowMs,
      };
    } catch (error) {
      console.error('Failed to get rate limit status:', error);
      return {
        limit: config.maxRequests,
        remaining: config.maxRequests,
        resetAt: new Date(now + config.windowMs),
        windowMs: config.windowMs,
      };
    }
  }

  /**
   * Get rate limit configuration for a platform
   */
  getPlatformConfig(platform: Platform) {
    return PLATFORM_RATE_LIMITS[platform];
  }

  /**
   * Get all platform rate limit configurations
   */
  getAllPlatformConfigs() {
    return PLATFORM_RATE_LIMITS;
  }
}

export const platformRateLimitService = new PlatformRateLimitService();
