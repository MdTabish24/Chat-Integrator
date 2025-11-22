import { Request, Response, NextFunction } from 'express';
import redisClient from '../config/redis';
import { AppError } from './errorHandler';

interface RateLimitOptions {
  windowMs: number; // Time window in milliseconds
  maxRequests: number; // Maximum requests per window
  keyPrefix?: string; // Redis key prefix
  skipSuccessfulRequests?: boolean; // Only count failed requests
}

/**
 * Rate limiting middleware using Redis
 * Default: 100 requests per minute per user
 */
export const createRateLimiter = (options: RateLimitOptions) => {
  const {
    windowMs,
    maxRequests,
    keyPrefix = 'ratelimit',
    skipSuccessfulRequests = false,
  } = options;

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    try {
      // Only rate limit authenticated users
      if (!req.user) {
        next();
        return;
      }

      const userId = req.user.userId;
      const key = `${keyPrefix}:${userId}`;
      const now = Date.now();
      const windowStart = now - windowMs;

      // Use Redis sorted set to track requests with timestamps
      const multi = redisClient.multi();

      // Remove old entries outside the time window
      multi.zRemRangeByScore(key, 0, windowStart);

      // Count requests in current window
      multi.zCard(key);

      // Add current request
      multi.zAdd(key, { score: now, value: `${now}` });

      // Set expiry on the key
      multi.expire(key, Math.ceil(windowMs / 1000));

      const results = await multi.exec();

      if (!results) {
        throw new Error('Redis transaction failed');
      }

      // Get the count before adding current request
      const requestCount = results[1] as number;

      // Check if rate limit exceeded
      if (requestCount >= maxRequests) {
        // Calculate retry after time
        const oldestRequest = await redisClient.zRange(key, 0, 0);

        let retryAfter = Math.ceil(windowMs / 1000);
        if (oldestRequest.length > 0) {
          const oldestTimestamp = parseInt(oldestRequest[0]);
          retryAfter = Math.ceil((oldestTimestamp + windowMs - now) / 1000);
        }

        res.setHeader('X-RateLimit-Limit', maxRequests.toString());
        res.setHeader('X-RateLimit-Remaining', '0');
        res.setHeader('X-RateLimit-Reset', new Date(now + retryAfter * 1000).toISOString());
        res.setHeader('Retry-After', retryAfter.toString());

        throw new AppError(
          'Rate limit exceeded. Please try again later.',
          429,
          'RATE_LIMIT_EXCEEDED',
          true,
          {
            limit: maxRequests,
            windowMs,
            retryAfter,
          }
        );
      }

      // Set rate limit headers
      const remaining = maxRequests - requestCount - 1;
      res.setHeader('X-RateLimit-Limit', maxRequests.toString());
      res.setHeader('X-RateLimit-Remaining', remaining.toString());
      res.setHeader('X-RateLimit-Reset', new Date(now + windowMs).toISOString());

      // If skipSuccessfulRequests is true, remove the request on successful response
      if (skipSuccessfulRequests) {
        res.on('finish', async () => {
          if (res.statusCode >= 200 && res.statusCode < 300) {
            try {
              await redisClient.zRem(key, `${now}`);
            } catch (error) {
              console.error('Failed to remove successful request from rate limit:', error);
            }
          }
        });
      }

      next();
    } catch (error) {
      if (error instanceof AppError) {
        next(error);
      } else {
        console.error('Rate limiter error:', error);
        // On Redis failure, allow the request through
        next();
      }
    }
  };
};

/**
 * Default rate limiter: 100 requests per minute per user
 */
export const rateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 100,
  keyPrefix: 'ratelimit:api',
});

/**
 * Strict rate limiter for sensitive operations: 20 requests per minute
 */
export const strictRateLimiter = createRateLimiter({
  windowMs: 60 * 1000, // 1 minute
  maxRequests: 20,
  keyPrefix: 'ratelimit:strict',
});
