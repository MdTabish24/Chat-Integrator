import { Router } from 'express';
import { authenticateToken } from '../middleware/auth';
import * as telegramUserController from '../controllers/telegramUserController';

const router = Router();

router.post('/auth/phone', authenticateToken, telegramUserController.startPhoneAuth);
router.post('/auth/verify', authenticateToken, telegramUserController.verifyPhoneCode);
router.get('/:accountId/dialogs', authenticateToken, telegramUserController.getDialogs);
router.get('/:accountId/messages/:chatId', authenticateToken, telegramUserController.getMessages);
router.post('/:accountId/send/:chatId', authenticateToken, telegramUserController.sendMessage);
router.post('/:accountId/sync', authenticateToken, telegramUserController.syncMessages);
router.post('/:accountId/reset', authenticateToken, telegramUserController.resetAndSync);

export default router;
