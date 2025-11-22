import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

/**
 * CSRF Protection Middleware
 * 
 * Uses the Double Submit Cookie pattern:
 * 1. Server generates a random token and sends it as a cookie
 * 2. Client must include the same token in a custom header
 * 3. Server verifies both match
 */

const CSRF_TOKEN_LENGTH = 32;
const CSRF_COOKIE_NAME = 'csrf-token';
const CSRF_HEADER_NAME = 'x-csrf-token';

/**
 * Generate a CSRF token
 */
export const generateCsrfToken = (): string => {
  return crypto.randomBytes(CSRF_TOKEN_LENGTH).toString('hex');
};

/**
 * Middleware to set CSRF token cookie
 * Should be applied to routes that render forms or return the token
 */
export const setCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
  // Generate token if not exists
  let token = req.cookies?.[CSRF_COOKIE_NAME];
  
  if (!token) {
    token = generateCsrfToken();
    res.cookie(CSRF_COOKIE_NAME, token, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      sameSite: 'strict',
      maxAge: 24 * 60 * 60 * 1000, // 24 hours
    });
  }

  // Make token available to response
  res.locals.csrfToken = token;
  next();
};

/**
 * Middleware to verify CSRF token
 * Should be applied to state-changing routes (POST, PUT, PATCH, DELETE)
 */
export const verifyCsrfToken = (req: Request, res: Response, next: NextFunction): void => {
  // Skip CSRF check for safe methods
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    return next();
  }

  // Skip CSRF check for webhook endpoints (they use signature verification)
  if (req.path.startsWith('/api/webhooks/')) {
    return next();
  }

  const cookieToken = req.cookies?.[CSRF_COOKIE_NAME];
  const headerToken = req.headers[CSRF_HEADER_NAME] as string;

  // Check if both tokens exist
  if (!cookieToken || !headerToken) {
    res.status(403).json({
      error: {
        code: 'CSRF_TOKEN_MISSING',
        message: 'CSRF token is missing',
        retryable: false,
      },
    });
    return;
  }

  // Verify tokens match using constant-time comparison
  if (!crypto.timingSafeEqual(Buffer.from(cookieToken), Buffer.from(headerToken))) {
    res.status(403).json({
      error: {
        code: 'CSRF_TOKEN_INVALID',
        message: 'CSRF token is invalid',
        retryable: false,
      },
    });
    return;
  }

  next();
};

/**
 * Endpoint to get CSRF token
 * GET /api/csrf-token
 */
export const getCsrfToken = (req: Request, res: Response): void => {
  const token = res.locals.csrfToken || req.cookies?.[CSRF_COOKIE_NAME];
  
  if (!token) {
    res.status(500).json({
      error: {
        code: 'CSRF_TOKEN_GENERATION_FAILED',
        message: 'Failed to generate CSRF token',
        retryable: true,
      },
    });
    return;
  }

  res.json({ csrfToken: token });
};
