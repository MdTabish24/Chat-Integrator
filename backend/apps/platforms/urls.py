"""
Platform-specific URL configuration.

Routes for cookie-based and session-based platform integrations.
"""

from django.urls import path
from .views.twitter import (
    TwitterLoginView,
    TwitterCookieSubmitView,
    TwitterVerifyCookiesView,
    TwitterConversationsView,
    TwitterMessagesView,
    TwitterSendMessageView,
    TwitterRateLimitStatusView,
    TwitterDesktopSyncView,
)
from .views.linkedin import (
    LinkedInCookieSubmitView,
    LinkedInVerifyCookiesView,
    LinkedInConversationsView,
    LinkedInMessagesView,
    LinkedInConversationMessagesView,
    LinkedInSendMessageView,
    LinkedInRateLimitStatusView,
    LinkedInDesktopSyncView,
)
from .views.instagram import (
    InstagramLoginView,
    InstagramVerifySessionView,
    InstagramConversationsView,
    InstagramMessagesView,
    InstagramSendMessageView,
    InstagramRateLimitStatusView,
    InstagramDesktopSyncView,
    InstagramPendingMessagesView,
    InstagramMessageSentView,
)
from .views.facebook import (
    FacebookCookieSubmitView,
    FacebookVerifyCookiesView,
    FacebookConversationsView,
    FacebookMessagesView,
    FacebookSendMessageView,
    FacebookRateLimitStatusView,
    FacebookDesktopSyncView,
)
from .views.whatsapp import (
    WhatsAppQRCodeView,
    WhatsAppRefreshQRView,
    WhatsAppSessionStatusView,
    WhatsAppDisconnectView,
    WhatsAppConversationsView,
    WhatsAppMessagesView,
    WhatsAppSendMessageView,
    WhatsAppSyncFromDesktopView,
    WhatsAppPendingMessagesView,
    WhatsAppMessageSentView,
)
from .views.discord import (
    DiscordTokenSubmitView,
    DiscordVerifyTokenView,
    DiscordSyncView,
    DiscordConversationsView,
    DiscordConversationMessagesView,
    DiscordMessagesView,
    DiscordSendMessageView,
    DiscordRateLimitStatusView,
)
from .views.gmail import (
    GmailThreadsView,
    GmailEmailsView,
    GmailReplyView,
    GmailMarkReadView,
)

app_name = 'platforms'

urlpatterns = [
    # Twitter/X endpoints
    # POST /api/platforms/twitter/login - Login with username/password (recommended)
    path('twitter/login', TwitterLoginView.as_view(), name='twitter-login'),
    
    # POST /api/platforms/twitter/cookies - Submit cookies for authentication (advanced)
    path('twitter/cookies', TwitterCookieSubmitView.as_view(), name='twitter-cookies'),
    
    # GET /api/platforms/twitter/verify/<account_id> - Verify cookies are valid
    path('twitter/verify/<uuid:account_id>', TwitterVerifyCookiesView.as_view(), name='twitter-verify'),
    
    # GET /api/platforms/twitter/conversations/<account_id> - Get DM conversations
    path('twitter/conversations/<uuid:account_id>', TwitterConversationsView.as_view(), name='twitter-conversations'),
    
    # GET /api/platforms/twitter/messages/<account_id> - Get DM messages
    path('twitter/messages/<uuid:account_id>', TwitterMessagesView.as_view(), name='twitter-messages'),
    
    # POST /api/platforms/twitter/send/<account_id> - Send a DM
    path('twitter/send/<uuid:account_id>', TwitterSendMessageView.as_view(), name='twitter-send'),
    
    # GET /api/platforms/twitter/rate-limit/<account_id> - Get rate limit status
    path('twitter/rate-limit/<uuid:account_id>', TwitterRateLimitStatusView.as_view(), name='twitter-rate-limit'),
    
    # POST /api/platforms/twitter/sync-from-desktop - Receive data from desktop app
    path('twitter/sync-from-desktop', TwitterDesktopSyncView.as_view(), name='twitter-desktop-sync'),
    
    # LinkedIn cookie-based endpoints
    # POST /api/platforms/linkedin/cookies - Submit cookies for authentication
    path('linkedin/cookies', LinkedInCookieSubmitView.as_view(), name='linkedin-cookies'),
    
    # GET /api/platforms/linkedin/verify/<account_id> - Verify cookies are valid
    path('linkedin/verify/<uuid:account_id>', LinkedInVerifyCookiesView.as_view(), name='linkedin-verify'),
    
    # GET /api/platforms/linkedin/conversations/<account_id> - Get message conversations
    path('linkedin/conversations/<uuid:account_id>', LinkedInConversationsView.as_view(), name='linkedin-conversations'),
    
    # GET /api/platforms/linkedin/messages/<account_id> - Get messages
    path('linkedin/messages/<uuid:account_id>', LinkedInMessagesView.as_view(), name='linkedin-messages'),
    
    # GET /api/platforms/linkedin/conversations/<account_id>/<conversation_id>/messages - Get messages for specific conversation
    path('linkedin/conversations/<uuid:account_id>/<str:conversation_id>/messages', LinkedInConversationMessagesView.as_view(), name='linkedin-conversation-messages'),
    
    # POST /api/platforms/linkedin/send/<account_id> - Send a message
    path('linkedin/send/<uuid:account_id>', LinkedInSendMessageView.as_view(), name='linkedin-send'),
    
    # GET /api/platforms/linkedin/rate-limit/<account_id> - Get rate limit status
    path('linkedin/rate-limit/<uuid:account_id>', LinkedInRateLimitStatusView.as_view(), name='linkedin-rate-limit'),
    
    # POST /api/platforms/linkedin/sync-from-desktop - Receive data from desktop app
    path('linkedin/sync-from-desktop', LinkedInDesktopSyncView.as_view(), name='linkedin-desktop-sync'),
    
    # Instagram session-based endpoints
    # POST /api/platforms/instagram/login - Submit credentials for authentication
    path('instagram/login', InstagramLoginView.as_view(), name='instagram-login'),
    
    # GET /api/platforms/instagram/verify/<account_id> - Verify session is valid
    path('instagram/verify/<uuid:account_id>', InstagramVerifySessionView.as_view(), name='instagram-verify'),
    
    # GET /api/platforms/instagram/conversations/<account_id> - Get DM conversations
    path('instagram/conversations/<uuid:account_id>', InstagramConversationsView.as_view(), name='instagram-conversations'),
    
    # GET /api/platforms/instagram/messages/<account_id> - Get DM messages
    path('instagram/messages/<uuid:account_id>', InstagramMessagesView.as_view(), name='instagram-messages'),
    
    # POST /api/platforms/instagram/send/<account_id> - Send a DM
    path('instagram/send/<uuid:account_id>', InstagramSendMessageView.as_view(), name='instagram-send'),
    
    # GET /api/platforms/instagram/rate-limit/<account_id> - Get rate limit status
    path('instagram/rate-limit/<uuid:account_id>', InstagramRateLimitStatusView.as_view(), name='instagram-rate-limit'),
    
    # POST /api/platforms/instagram/sync-from-desktop - Receive data from desktop app
    path('instagram/sync-from-desktop', InstagramDesktopSyncView.as_view(), name='instagram-desktop-sync'),
    
    # GET /api/platforms/instagram/pending - Get pending messages for Desktop App to send
    path('instagram/pending', InstagramPendingMessagesView.as_view(), name='instagram-pending'),
    
    # POST /api/platforms/instagram/message-sent - Report message sent status from Desktop App
    path('instagram/message-sent', InstagramMessageSentView.as_view(), name='instagram-message-sent'),
    
    # Facebook Messenger cookie-based endpoints
    # POST /api/platforms/facebook/cookies - Submit cookies for authentication
    path('facebook/cookies', FacebookCookieSubmitView.as_view(), name='facebook-cookies'),
    
    # GET /api/platforms/facebook/verify/<account_id> - Verify cookies are valid
    path('facebook/verify/<uuid:account_id>', FacebookVerifyCookiesView.as_view(), name='facebook-verify'),
    
    # GET /api/platforms/facebook/conversations/<account_id> - Get message conversations
    path('facebook/conversations/<uuid:account_id>', FacebookConversationsView.as_view(), name='facebook-conversations'),
    
    # GET /api/platforms/facebook/messages/<account_id> - Get messages
    path('facebook/messages/<uuid:account_id>', FacebookMessagesView.as_view(), name='facebook-messages'),
    
    # POST /api/platforms/facebook/send/<account_id> - Send a message
    path('facebook/send/<uuid:account_id>', FacebookSendMessageView.as_view(), name='facebook-send'),
    
    # GET /api/platforms/facebook/rate-limit/<account_id> - Get rate limit status
    path('facebook/rate-limit/<uuid:account_id>', FacebookRateLimitStatusView.as_view(), name='facebook-rate-limit'),
    
    # POST /api/platforms/facebook/sync-from-desktop - Receive data from desktop app
    path('facebook/sync-from-desktop', FacebookDesktopSyncView.as_view(), name='facebook-desktop-sync'),
    
    # WhatsApp Web browser-based endpoints
    # POST /api/platforms/whatsapp/qr - Start QR code session for authentication
    path('whatsapp/qr', WhatsAppQRCodeView.as_view(), name='whatsapp-qr'),
    
    # GET /api/platforms/whatsapp/qr/<session_id> - Get/refresh QR code
    path('whatsapp/qr/<str:session_id>', WhatsAppRefreshQRView.as_view(), name='whatsapp-qr-refresh'),
    
    # GET /api/platforms/whatsapp/status/<session_id> - Get session status
    path('whatsapp/status/<str:session_id>', WhatsAppSessionStatusView.as_view(), name='whatsapp-status'),
    
    # DELETE /api/platforms/whatsapp/disconnect/<account_id> - Disconnect session
    path('whatsapp/disconnect/<uuid:account_id>', WhatsAppDisconnectView.as_view(), name='whatsapp-disconnect'),
    
    # GET /api/platforms/whatsapp/conversations/<account_id> - Get conversations
    path('whatsapp/conversations/<uuid:account_id>', WhatsAppConversationsView.as_view(), name='whatsapp-conversations'),
    
    # GET /api/platforms/whatsapp/messages/<account_id> - Get messages
    path('whatsapp/messages/<uuid:account_id>', WhatsAppMessagesView.as_view(), name='whatsapp-messages'),
    
    # POST /api/platforms/whatsapp/send/<account_id> - Send a message
    path('whatsapp/send/<uuid:account_id>', WhatsAppSendMessageView.as_view(), name='whatsapp-send'),
    
    # POST /api/platforms/whatsapp/sync-from-desktop - Receive data from desktop app (whatsapp-web.js)
    path('whatsapp/sync-from-desktop', WhatsAppSyncFromDesktopView.as_view(), name='whatsapp-desktop-sync'),
    
    # GET /api/platforms/whatsapp/pending - Get pending messages for Desktop App to send
    path('whatsapp/pending', WhatsAppPendingMessagesView.as_view(), name='whatsapp-pending'),
    
    # POST /api/platforms/whatsapp/message-sent - Report message sent status from Desktop App
    path('whatsapp/message-sent', WhatsAppMessageSentView.as_view(), name='whatsapp-message-sent'),
    
    # Discord token-based endpoints
    # POST /api/platforms/discord/token - Submit token for authentication
    path('discord/token', DiscordTokenSubmitView.as_view(), name='discord-token'),
    
    # GET /api/platforms/discord/verify/<account_id> - Verify token is valid
    path('discord/verify/<uuid:account_id>', DiscordVerifyTokenView.as_view(), name='discord-verify'),
    
    # POST /api/platforms/discord/sync/<account_id> - Sync conversations and messages to database
    path('discord/sync/<uuid:account_id>', DiscordSyncView.as_view(), name='discord-sync'),
    
    # GET /api/platforms/discord/conversations/<account_id> - Get DM conversations
    path('discord/conversations/<uuid:account_id>', DiscordConversationsView.as_view(), name='discord-conversations'),
    
    # GET /api/platforms/discord/conversations/<account_id>/<conversation_id>/messages - Get messages for specific conversation
    path('discord/conversations/<uuid:account_id>/<str:conversation_id>/messages', DiscordConversationMessagesView.as_view(), name='discord-conversation-messages'),
    
    # GET /api/platforms/discord/messages/<account_id> - Get DM messages (all conversations)
    path('discord/messages/<uuid:account_id>', DiscordMessagesView.as_view(), name='discord-messages'),
    
    # POST /api/platforms/discord/send/<account_id> - Send a DM
    path('discord/send/<uuid:account_id>', DiscordSendMessageView.as_view(), name='discord-send'),
    
    # GET /api/platforms/discord/rate-limit/<account_id> - Get rate limit status
    path('discord/rate-limit/<uuid:account_id>', DiscordRateLimitStatusView.as_view(), name='discord-rate-limit'),
    
    # Gmail OAuth-based endpoints
    # Note: OAuth flow is handled by /api/oauth/connect/gmail and /api/oauth/callback/gmail
    
    # GET /api/platforms/gmail/threads/<account_id> - Get email threads (conversations)
    path('gmail/threads/<uuid:account_id>', GmailThreadsView.as_view(), name='gmail-threads'),
    
    # GET /api/platforms/gmail/emails/<account_id> - Get unread Primary emails
    path('gmail/emails/<uuid:account_id>', GmailEmailsView.as_view(), name='gmail-emails'),
    
    # POST /api/platforms/gmail/reply/<account_id> - Reply to an email thread (no compose)
    path('gmail/reply/<uuid:account_id>', GmailReplyView.as_view(), name='gmail-reply'),
    
    # POST /api/platforms/gmail/read/<account_id> - Mark email as read
    path('gmail/read/<uuid:account_id>', GmailMarkReadView.as_view(), name='gmail-read'),
]
