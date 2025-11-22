import { Request, Response, NextFunction } from 'express';
import { query } from '../db/queryHelpers';

/**
 * Middleware to log API requests to api_usage_logs table
 * Logs after the response is sent to avoid blocking the request
 */
export const apiUsageLogger = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  // Only log for authenticated users
  if (!req.user) {
    next();
    return;
  }

  const userId = req.user.userId;
  const endpoint = `${req.method} ${req.route?.path || req.path}`;
  const timestamp = new Date();

  // Log after response is sent
  res.on('finish', async () => {
    try {
      // Only log successful requests (2xx status codes)
      if (res.statusCode >= 200 && res.statusCode < 300) {
        await query(
          `INSERT INTO api_usage_logs (user_id, endpoint, request_count, timestamp)
           VALUES ($1, $2, $3, $4)
           ON CONFLICT DO NOTHING`,
          [userId, endpoint, 1, timestamp]
        );
      }
    } catch (error) {
      // Log error but don't fail the request
      console.error('Failed to log API usage:', error);
    }
  });

  next();
};
