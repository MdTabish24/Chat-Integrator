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

export default router;
