import { Request, Response, NextFunction } from 'express';
import authService from '../services/authService';
import { JWTPayload } from '../types';

// Extend Express Request type to include user
declare global {
  namespace Express {
    interface Request {
      user?: JWTPayload;
    }
  }
}

/**
 * JWT authentication middleware for protected routes
 */
export const authenticateToken = (
  req: Request,
  res: Response,
  next: NextFunction
): void => {
  try {
    // Get token from Authorization header
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1]; // Bearer TOKEN

    if (!token) {
      res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'Access token is required',
          retryable: false,
        },
      });
      return;
    }

    // Verify token
    const payload = authService.verifyAccessToken(token);
    
    // Attach user to request
    req.user = payload;
    
    next();
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Invalid token';
    res.status(403).json({
      error: {
        code: 'FORBIDDEN',
        message,
        retryable: false,
      },
    });
  }
};

/**
 * Optional authentication middleware - doesn't fail if no token
 */
export const optionalAuth = (
  req: Request,
  _res: Response,
  next: NextFunction
): void => {
  try {
    const authHeader = req.headers['authorization'];
    const token = authHeader && authHeader.split(' ')[1];

    if (token) {
      const payload = authService.verifyAccessToken(token);
      req.user = payload;
    }
    
    next();
  } catch (error) {
    // Continue without authentication
    next();
  }
};
