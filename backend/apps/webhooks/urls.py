"""
Webhook URL configuration.

Migrated from backend/src/routes/webhookRoutes.ts
"""

from django.urls import path
from .views import (
    TelegramWebhookView,
    TwitterWebhookView,
    FacebookWebhookView,
    InstagramWebhookView,
    WhatsAppWebhookView,
    LinkedInWebhookView,
    TeamsWebhookView,
)

app_name = 'webhooks'

urlpatterns = [
    # POST /api/webhooks/telegram
    # Telegram webhook
    path('telegram', TelegramWebhookView.as_view(), name='telegram'),
    
    # GET /api/webhooks/twitter (CRC challenge)
    # POST /api/webhooks/twitter
    # Twitter/X webhook
    path('twitter', TwitterWebhookView.as_view(), name='twitter'),
    
    # POST /api/webhooks/linkedin
    # LinkedIn webhook
    path('linkedin', LinkedInWebhookView.as_view(), name='linkedin'),
    
    # GET /api/webhooks/instagram (verification)
    # POST /api/webhooks/instagram
    # Instagram webhook
    path('instagram', InstagramWebhookView.as_view(), name='instagram'),
    
    # GET /api/webhooks/whatsapp (verification)
    # POST /api/webhooks/whatsapp
    # WhatsApp webhook
    path('whatsapp', WhatsAppWebhookView.as_view(), name='whatsapp'),
    
    # GET /api/webhooks/facebook (verification)
    # POST /api/webhooks/facebook
    # Facebook Pages webhook
    path('facebook', FacebookWebhookView.as_view(), name='facebook'),
    
    # POST /api/webhooks/teams
    # Microsoft Teams webhook
    path('teams', TeamsWebhookView.as_view(), name='teams'),
]
