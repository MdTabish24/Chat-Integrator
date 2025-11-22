import { Router } from 'express';
import { webhookController } from '../controllers/webhookController';

const router = Router();

/**
 * Webhook routes for all platforms
 * These endpoints receive real-time notifications from platform APIs
 */

// Telegram webhook
router.post('/telegram', (req, res) => webhookController.handleTelegramWebhook(req, res));

// Twitter/X webhook
router.post('/twitter', (req, res) => webhookController.handleTwitterWebhook(req, res));
router.get('/twitter', (req, res) => webhookController.handleTwitterWebhook(req, res)); // For CRC challenge

// LinkedIn webhook
router.post('/linkedin', (req, res) => webhookController.handleLinkedInWebhook(req, res));

// Instagram webhook
router.post('/instagram', (req, res) => webhookController.handleInstagramWebhook(req, res));
router.get('/instagram', (req, res) => webhookController.handleInstagramWebhook(req, res)); // For verification

// WhatsApp webhook
router.post('/whatsapp', (req, res) => webhookController.handleWhatsAppWebhook(req, res));
router.get('/whatsapp', (req, res) => webhookController.handleWhatsAppWebhook(req, res)); // For verification

// Facebook Pages webhook
router.post('/facebook', (req, res) => webhookController.handleFacebookWebhook(req, res));
router.get('/facebook', (req, res) => webhookController.handleFacebookWebhook(req, res)); // For verification

// Microsoft Teams webhook
router.post('/teams', (req, res) => webhookController.handleTeamsWebhook(req, res));

export default router;
