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

