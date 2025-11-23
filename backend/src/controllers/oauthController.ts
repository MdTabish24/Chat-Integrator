import { Request, Response } from 'express';
import { getOAuthService } from '../services/oauth';
import { Platform } from '../types';
import { platformRateLimitService } from '../services/platformRateLimitService';
import crypto from 'crypto';

// Store state parameters temporarily (in production, use Redis)
const stateStore = new Map<string, { userId: string; platform: Platform; timestamp: number }>();

// Clean up old state entries every 10 minutes
setInterval(() => {
  const now = Date.now();
  const tenMinutes = 10 * 60 * 1000;
  
  for (const [state, data] of stateStore.entries()) {
    if (now - data.timestamp > tenMinutes) {
      stateStore.delete(state);
    }
  }
}, 10 * 60 * 1000);

/**
 * Initiate OAuth connection for a platform
 * GET /api/oauth/connect/:platform
 */
export const initiateConnection = async (req: Request, res: Response): Promise<void> => {
  try {
    const platform = req.params.platform as Platform;
    const userId = (req as any).user?.userId; // From auth middleware

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
          retryable: false,
        },
      });
    }

    // Validate platform
    const validPlatforms: Platform[] = [
      'telegram',
      'twitter',
      'linkedin',
      'instagram',
      'whatsapp',
      'facebook',
      'teams',
    ];

    if (!validPlatforms.includes(platform)) {
      return res.status(400).json({
        error: {
          code: 'INVALID_PLATFORM',
          message: `Invalid platform: ${platform}`,
          retryable: false,
        },
      });
    }

    // Generate state parameter for CSRF protection
    const state = crypto.randomBytes(32).toString('hex');
    stateStore.set(state, { userId, platform, timestamp: Date.now() });

    // Get OAuth service and generate authorization URL
    const oauthService = getOAuthService(platform);
    const authUrl = oauthService.generateAuthorizationUrl(state);

    res.json({
      authorizationUrl: authUrl,
      state,
    });
  } catch (error: any) {
    console.error('[oauth] Failed to initiate connection:', error);
    res.status(500).json({
      error: {
        code: 'CONNECTION_FAILED',
        message: error.message || 'Failed to initiate OAuth connection',
        retryable: true,
      },
    });
  }
};

/**
 * Handle OAuth callback
 * GET/POST /api/oauth/callback/:platform
 */
export const handleCallback = async (req: Request, res: Response) => {
  try {
    const platform = req.params.platform as Platform;
    
    // For Telegram, data comes in POST body
    const isTelegram = platform === 'telegram';
    const data = isTelegram ? req.body : req.query;
    const { code, state, error, error_description } = data;

    // Check for OAuth errors
    if (error) {
      console.error(`[oauth] ${platform} authorization error:`, error_description || error);
      const frontendUrl = process.env.FRONTEND_URL || process.env.WEBHOOK_BASE_URL || 'https://chatintegrator.onrender.com';
      return res.redirect(
        `${frontendUrl}/accounts?error=${error}&platform=${platform}`
      );
    }

    if (!code || !state) {
      return res.status(400).json({
        error: {
          code: 'INVALID_CALLBACK',
          message: 'Missing code or state parameter',
          retryable: false,
        },
      });
    }

    // Verify state parameter
    const stateData = stateStore.get(state as string);
    if (!stateData || stateData.platform !== platform) {
      return res.status(400).json({
        error: {
          code: 'INVALID_STATE',
          message: 'Invalid or expired state parameter',
          retryable: false,
        },
      });
    }

    // Clean up state
    stateStore.delete(state as string);

    const { userId } = stateData;

    // Get OAuth service
    const oauthService = getOAuthService(platform);

    // For Telegram, validate auth data and get user info directly
    let tokens, userInfo;
    if (platform === 'telegram') {
      // Telegram sends user data directly
      tokens = await oauthService.exchangeCodeForToken('', data);
      userInfo = await oauthService.getUserInfo(tokens.accessToken);
    } else {
      // Standard OAuth flow
      tokens = await oauthService.exchangeCodeForToken(code as string, { state: state as string });
      userInfo = await oauthService.getUserInfo(tokens.accessToken);
    }

    // Store tokens securely
    const accountId = await oauthService.storeTokens(
      userId,
      userInfo.userId,
      userInfo.username,
      tokens
    );

    console.log(`[oauth] ${platform} connected successfully for user ${userId}`);

    // Add account to polling service if needed
    try {
      const { messagePollingService } = await import('../services/messagePollingService');
      await messagePollingService.addAccountToPolling(accountId, platform, userId);
    } catch (error) {
      console.error(`[oauth] Failed to add account to polling service:`, error);
      // Don't fail the connection if polling setup fails
    }

    // Redirect to frontend success page
    const frontendUrl = process.env.FRONTEND_URL || process.env.WEBHOOK_BASE_URL || 'https://chatintegrator.onrender.com';
    res.redirect(
      `${frontendUrl}/accounts?success=true&platform=${platform}&accountId=${accountId}`
    );
  } catch (error: any) {
    console.error('[oauth] Callback handling failed:', error);
    const platform = req.params.platform;
    const frontendUrl = process.env.FRONTEND_URL || process.env.WEBHOOK_BASE_URL || 'https://chatintegrator.onrender.com';
    res.redirect(
      `${frontendUrl}/accounts?error=callback_failed&platform=${platform}&message=${encodeURIComponent(error.message)}`
    );
  }
};

/**
 * Get connected accounts for current user
 * GET /api/oauth/accounts
 */
export const getConnectedAccounts = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
          retryable: false,
        },
      });
    }

    const pool = require('../config/database').default;
    const result = await pool.query(
      `SELECT id, platform, platform_user_id, platform_username, is_active, created_at, updated_at
       FROM connected_accounts
       WHERE user_id = $1
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json({
      accounts: result.rows,
    });
  } catch (error: any) {
    console.error('[oauth] Failed to get connected accounts:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to retrieve connected accounts',
        retryable: true,
      },
    });
  }
};

/**
 * Disconnect a platform account
 * DELETE /api/oauth/disconnect/:accountId
 */
export const disconnectAccount = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const accountId = req.params.accountId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
          retryable: false,
        },
      });
    }

    const pool = require('../config/database').default;

    // Verify account belongs to user
    const accountResult = await pool.query(
      `SELECT platform FROM connected_accounts WHERE id = $1 AND user_id = $2`,
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found or does not belong to user',
          retryable: false,
        },
      });
    }

    const platform = accountResult.rows[0].platform as Platform;

    // Attempt to revoke token with platform
    try {
      const oauthService = getOAuthService(platform);
      await oauthService.revokeToken(accountId);
    } catch (error) {
      console.error(`[oauth] Failed to revoke token for ${platform}:`, error);
      // Continue with disconnection even if revocation fails
    }

    // Mark account as inactive
    await pool.query(
      `UPDATE connected_accounts SET is_active = false, updated_at = NOW() WHERE id = $1`,
      [accountId]
    );

    // Remove account from polling service
    try {
      const { messagePollingService } = await import('../services/messagePollingService');
      await messagePollingService.removeAccountFromPolling(accountId);
    } catch (error) {
      console.error(`[oauth] Failed to remove account from polling service:`, error);
      // Don't fail the disconnection if polling cleanup fails
    }

    console.log(`[oauth] Account ${accountId} disconnected successfully`);

    res.json({
      success: true,
      message: 'Account disconnected successfully',
    });
  } catch (error: any) {
    console.error('[oauth] Failed to disconnect account:', error);
    res.status(500).json({
      error: {
        code: 'DISCONNECT_FAILED',
        message: 'Failed to disconnect account',
        retryable: true,
      },
    });
  }
};

/**
 * Refresh token for an account
 * POST /api/oauth/refresh/:accountId
 */
export const refreshToken = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;
    const accountId = req.params.accountId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
          retryable: false,
        },
      });
    }

    const pool = require('../config/database').default;

    // Verify account belongs to user
    const accountResult = await pool.query(
      `SELECT platform FROM connected_accounts WHERE id = $1 AND user_id = $2 AND is_active = true`,
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({
        error: {
          code: 'ACCOUNT_NOT_FOUND',
          message: 'Account not found or inactive',
          retryable: false,
        },
      });
    }

    const platform = accountResult.rows[0].platform as Platform;
    const oauthService = getOAuthService(platform);

    // Ensure valid token (will refresh if needed)
    await oauthService.ensureValidToken(accountId);

    res.json({
      success: true,
      message: 'Token refreshed successfully',
    });
  } catch (error: any) {
    console.error('[oauth] Failed to refresh token:', error);
    res.status(500).json({
      error: {
        code: 'REFRESH_FAILED',
        message: error.message || 'Failed to refresh token',
        retryable: true,
      },
    });
  }
};

/**
 * Get rate limit status for connected accounts
 * GET /api/oauth/rate-limits
 */
export const getRateLimitStatus = async (req: Request, res: Response): Promise<void> => {
  try {
    const userId = (req as any).user?.userId;

    if (!userId) {
      return res.status(401).json({
        error: {
          code: 'UNAUTHORIZED',
          message: 'User not authenticated',
          retryable: false,
        },
      });
    }

    const pool = require('../config/database').default;

    // Get all active accounts for user
    const accountsResult = await pool.query(
      `SELECT id, platform FROM connected_accounts WHERE user_id = $1 AND is_active = true`,
      [userId]
    );

    // Get rate limit status for each account
    const rateLimits = await Promise.all(
      accountsResult.rows.map(async (account: any) => {
        const status = await platformRateLimitService.getRateLimitStatus(
          account.id,
          account.platform
        );
        return {
          accountId: account.id,
          platform: account.platform,
          ...status,
        };
      })
    );

    res.json({
      rateLimits,
    });
  } catch (error: any) {
    console.error('[oauth] Failed to get rate limit status:', error);
    res.status(500).json({
      error: {
        code: 'FETCH_FAILED',
        message: 'Failed to retrieve rate limit status',
        retryable: true,
      },
    });
  }
};
