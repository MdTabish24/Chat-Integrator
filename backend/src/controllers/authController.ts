import { Request, Response } from 'express';
import authService from '../services/authService';
import Joi from 'joi';

// Validation schemas
const registerSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().min(8).required(),
});

const loginSchema = Joi.object({
  email: Joi.string().email().required(),
  password: Joi.string().required(),
});

const refreshTokenSchema = Joi.object({
  refreshToken: Joi.string().required(),
});

export class AuthController {
  /**
   * Register a new user
   * POST /api/auth/register
   */
  async register(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const { error, value } = registerSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
            retryable: false,
          },
        });
        return;
      }

      const { email, password } = value;

      // Register user
      const user = await authService.register(email, password);

      // Generate tokens
      const tokens = await authService.generateTokens(user.id, user.email);

      res.status(201).json({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
        tokens,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Registration failed';
      const statusCode = message.includes('already exists') ? 409 : 500;

      res.status(statusCode).json({
        error: {
          code: statusCode === 409 ? 'USER_EXISTS' : 'REGISTRATION_FAILED',
          message,
          retryable: false,
        },
      });
    }
  }

  /**
   * Login user
   * POST /api/auth/login
   */
  async login(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const { error, value } = loginSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
            retryable: false,
          },
        });
        return;
      }

      const { email, password } = value;

      // Login user
      const { user, tokens } = await authService.login(email, password);

      res.status(200).json({
        user: {
          id: user.id,
          email: user.email,
          createdAt: user.createdAt,
        },
        tokens,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Login failed';
      
      res.status(401).json({
        error: {
          code: 'AUTHENTICATION_FAILED',
          message,
          retryable: false,
        },
      });
    }
  }

  /**
   * Refresh access token
   * POST /api/auth/refresh
   */
  async refresh(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const { error, value } = refreshTokenSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
            retryable: false,
          },
        });
        return;
      }

      const { refreshToken } = value;

      // Refresh tokens
      const tokens = await authService.refreshAccessToken(refreshToken);

      res.status(200).json({ tokens });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Token refresh failed';
      
      res.status(401).json({
        error: {
          code: 'TOKEN_REFRESH_FAILED',
          message,
          retryable: false,
        },
      });
    }
  }

  /**
   * Logout user
   * POST /api/auth/logout
   */
  async logout(req: Request, res: Response): Promise<void> {
    try {
      // Validate request body
      const { error, value } = refreshTokenSchema.validate(req.body);
      if (error) {
        res.status(400).json({
          error: {
            code: 'VALIDATION_ERROR',
            message: error.details[0].message,
            retryable: false,
          },
        });
        return;
      }

      const { refreshToken } = value;

      // Logout user
      await authService.logout(refreshToken);

      res.status(200).json({
        message: 'Logged out successfully',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Logout failed';
      
      res.status(500).json({
        error: {
          code: 'LOGOUT_FAILED',
          message,
          retryable: true,
        },
      });
    }
  }

  /**
   * Get current user info (protected route example)
   * GET /api/auth/me
   */
  async getCurrentUser(req: Request, res: Response): Promise<void> {
    try {
      if (!req.user) {
        res.status(401).json({
          error: {
            code: 'UNAUTHORIZED',
            message: 'User not authenticated',
            retryable: false,
          },
        });
        return;
      }

      // In a real app, you might want to fetch fresh user data from DB
      res.status(200).json({
        user: {
          id: req.user.userId,
          email: req.user.email,
        },
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to get user info';
      
      res.status(500).json({
        error: {
          code: 'USER_INFO_FAILED',
          message,
          retryable: true,
        },
      });
    }
  }
}

export default new AuthController();
