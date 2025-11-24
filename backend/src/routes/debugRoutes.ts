import { Router, Request, Response } from 'express';
import { messagePollingService } from '../services/messagePollingService';
import { authenticateToken } from '../middleware/auth';

const router = Router();

/**
 * Trigger immediate polling for a specific account
 * POST /api/debug/polling/:accountId
 */
router.post('/polling/:accountId', authenticateToken, async (req: Request, res: Response) => {
  try {
    const { accountId } = req.params;
    
    await messagePollingService.triggerImmediatePolling(accountId);
    
    res.json({
      success: true,
      message: `Polling triggered for account ${accountId}`
    });
  } catch (error: any) {
    console.error('Error triggering polling:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Get polling statistics
 * GET /api/debug/polling/stats
 */
router.get('/polling/stats', authenticateToken, async (req: Request, res: Response) => {
  try {
    const stats = await messagePollingService.getPollingStats();
    
    res.json({
      success: true,
      stats
    });
  } catch (error: any) {
    console.error('Error getting polling stats:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

/**
 * Check Instagram OAuth configuration
 * GET /api/debug/instagram-config
 */
router.get('/instagram-config', async (req: Request, res: Response) => {
  try {
    const instagramAppId = process.env.INSTAGRAM_APP_ID;
    const instagramAppSecret = process.env.INSTAGRAM_APP_SECRET;
    const webhookBaseUrl = process.env.WEBHOOK_BASE_URL;
    
    res.json({
      success: true,
      config: {
        appIdConfigured: !!instagramAppId,
        appIdLength: instagramAppId?.length || 0,
        appIdFirstChars: instagramAppId?.substring(0, 4) || 'NOT SET',
        appSecretConfigured: !!instagramAppSecret,
        appSecretLength: instagramAppSecret?.length || 0,
        webhookBaseUrl: webhookBaseUrl || 'NOT SET',
        redirectUri: `${webhookBaseUrl}/api/auth/callback/instagram`,
        authUrl: `https://www.facebook.com/v18.0/dialog/oauth?client_id=${instagramAppId || 'MISSING'}&redirect_uri=${webhookBaseUrl}/api/auth/callback/instagram`
      }
    });
  } catch (error: any) {
    console.error('Error checking Instagram config:', error);
    res.status(500).json({
      success: false,
      error: error.message
    });
  }
});

export default router;
