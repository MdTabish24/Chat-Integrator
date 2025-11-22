import { Router } from 'express';
import {
  initiateConnection,
  handleCallback,
  getConnectedAccounts,
  disconnectAccount,
  refreshToken,
  getRateLimitStatus,
} from '../controllers/oauthController';
import { authenticateToken } from '../middleware/auth';
import { validate, oauthSchemas } from '../middleware/validation';

const router = Router();

/**
 * OAuth Routes
 */

// Initiate OAuth connection (requires authentication)
router.get(
  '/connect/:platform',
  authenticateToken,
  validate(oauthSchemas.platform, 'params'),
  initiateConnection
);

// OAuth callback (no auth required - state verification used instead)
router.get(
  '/callback/:platform',
  validate(oauthSchemas.platform, 'params'),
  handleCallback
);

// Get connected accounts (requires authentication)
router.get('/accounts', authenticateToken, getConnectedAccounts);

// Disconnect account (requires authentication)
router.delete(
  '/disconnect/:accountId',
  authenticateToken,
  validate(oauthSchemas.accountId, 'params'),
  disconnectAccount
);

// Refresh token (requires authentication)
router.post(
  '/refresh/:accountId',
  authenticateToken,
  validate(oauthSchemas.accountId, 'params'),
  refreshToken
);

// Get rate limit status for all connected accounts (requires authentication)
router.get('/rate-limits', authenticateToken, getRateLimitStatus);

export default router;
