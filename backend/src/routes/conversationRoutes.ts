import { Router } from 'express';
import messageController from '../controllers/messageController';
import { authenticateToken } from '../middleware/auth';
import { validate, conversationSchemas } from '../middleware/validation';

const router = Router();

// All conversation routes require authentication
router.use(authenticateToken);

/**
 * @route   GET /api/conversations
 * @desc    Get all conversations for the authenticated user
 * @access  Protected
 */
router.get(
  '/',
  validate(conversationSchemas.getConversations, 'query'),
  (req, res) => messageController.getConversations(req, res)
);

export default router;

