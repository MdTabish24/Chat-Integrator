import { Router } from 'express';
import messageController from '../controllers/messageController';
import { authenticateToken } from '../middleware/auth';
import { validate, messageSchemas } from '../middleware/validation';
import { sanitizeMessageInput } from '../middleware/xssSanitizer';

const router = Router();

// All message routes require authentication
router.use(authenticateToken);

/**
 * @route   GET /api/messages
 * @desc    Get all messages for the authenticated user
 * @access  Protected
 */
router.get(
  '/',
  validate(messageSchemas.getMessages, 'query'),
  (req, res) => messageController.getMessages(req, res)
);

/**
 * @route   GET /api/messages/unread/count
 * @desc    Get unread message count
 * @access  Protected
 */
router.get('/unread/count', (req, res) => messageController.getUnreadCount(req, res));

/**
 * @route   POST /api/messages/sync
 * @desc    Sync messages from all connected platforms
 * @access  Protected
 */
router.post('/sync', (req, res) => messageController.syncMessages(req, res));

/**
 * @route   POST /api/messages/poll/:accountId
 * @desc    Manually trigger polling for an account
 * @access  Protected
 */
router.post('/poll/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user?.userId;

    // Verify account belongs to user
    const pool = require('../config/database').default;
    const accountResult = await pool.query(
      'SELECT * FROM connected_accounts WHERE id = $1 AND user_id = $2 AND is_active = true',
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found or inactive' });
    }

    const account = accountResult.rows[0];

    // Manually trigger polling
    const { messageAggregatorService } = await import('../services/messageAggregatorService');
    console.log(`[manual-poll] Triggering manual poll for account ${accountId} (${account.platform})`);
    
    const messages = await messageAggregatorService.fetchMessagesForAccount(accountId);

    console.log(`[manual-poll] Fetched ${messages.length} messages`);

    res.json({
      success: true,
      account: {
        id: account.id,
        platform: account.platform,
        username: account.platform_username,
      },
      messageCount: messages.length,
    });
  } catch (error: any) {
    console.error('[manual-poll] Failed:', error);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || error.stack,
    });
  }
});

/**
 * @route   GET /api/messages/debug/twitter/:accountId
 * @desc    Debug endpoint to test Twitter API directly
 * @access  Protected
 */
router.get('/debug/twitter/:accountId', async (req, res) => {
  try {
    const { accountId } = req.params;
    const userId = (req as any).user?.userId;

    // Verify account belongs to user
    const pool = require('../config/database').default;
    const accountResult = await pool.query(
      'SELECT * FROM connected_accounts WHERE id = $1 AND user_id = $2',
      [accountId, userId]
    );

    if (accountResult.rows.length === 0) {
      return res.status(404).json({ error: 'Account not found' });
    }

    const account = accountResult.rows[0];

    // Get Twitter adapter and fetch conversations
    const { AdapterFactory } = await import('../adapters');
    const adapter = AdapterFactory.getAdapter('twitter');
    
    console.log(`[debug] Fetching Twitter conversations for account ${accountId}`);
    const conversations = await adapter.getConversations(accountId);
    
    console.log(`[debug] Found ${conversations.length} Twitter conversations`);

    res.json({
      success: true,
      account: {
        id: account.id,
        platform: account.platform,
        username: account.platform_username,
      },
      conversationsCount: conversations.length,
      conversations: conversations.slice(0, 5), // First 5 for preview
    });
  } catch (error: any) {
    console.error('[debug] Twitter API test failed:', error);
    res.status(500).json({
      error: error.message,
      details: error.response?.data || error.stack,
    });
  }
});

/**
 * @route   GET /api/messages/:conversationId
 * @desc    Get messages for a specific conversation
 * @access  Protected
 */
router.get(
  '/:conversationId',
  validate(messageSchemas.conversationId, 'params'),
  validate(messageSchemas.getMessages, 'query'),
  (req, res) => messageController.getConversationMessages(req, res)
);

/**
 * @route   POST /api/messages/:conversationId/send
 * @desc    Send a message in a conversation
 * @access  Protected
 */
router.post(
  '/:conversationId/send',
  validate(messageSchemas.conversationId, 'params'),
  validate(messageSchemas.sendMessage, 'body'),
  sanitizeMessageInput,
  (req, res) => messageController.sendMessage(req, res)
);

/**
 * @route   PATCH /api/messages/:messageId/read
 * @desc    Mark a specific message as read
 * @access  Protected
 */
router.patch(
  '/:messageId/read',
  validate(messageSchemas.messageId, 'params'),
  (req, res) => messageController.markAsRead(req, res)
);

/**
 * @route   PATCH /api/messages/conversation/:conversationId/read
 * @desc    Mark all messages in a conversation as read
 * @access  Protected
 */
router.patch(
  '/conversation/:conversationId/read',
  validate(messageSchemas.conversationId, 'params'),
  (req, res) => messageController.markConversationAsRead(req, res)
);

export default router;

