"""
Telegram URL configuration.

Migrated from backend/src/routes/telegramUserRoutes.ts
"""

from django.urls import path
from .views import (
    StartPhoneAuthView,
    VerifyPhoneCodeView,
    GetDialogsView,
    GetMessagesView,
    SendMessageView,
    SyncMessagesView,
    ResetAndSyncView,
)

app_name = 'telegram'

urlpatterns = [
    # POST /api/telegram/auth/phone
    path('auth/phone', StartPhoneAuthView.as_view(), name='start_phone_auth'),
    
    # POST /api/telegram/auth/verify
    path('auth/verify', VerifyPhoneCodeView.as_view(), name='verify_phone_code'),
    
    # GET /api/telegram/:accountId/dialogs
    path('<uuid:account_id>/dialogs', GetDialogsView.as_view(), name='dialogs'),
    
    # GET /api/telegram/:accountId/messages/:chatId
    path('<uuid:account_id>/messages/<str:chat_id>', GetMessagesView.as_view(), name='messages'),
    
    # POST /api/telegram/:accountId/send/:chatId
    path('<uuid:account_id>/send/<str:chat_id>', SendMessageView.as_view(), name='send'),
    
    # POST /api/telegram/:accountId/sync
    path('<uuid:account_id>/sync', SyncMessagesView.as_view(), name='sync'),
    
    # POST /api/telegram/:accountId/reset
    path('<uuid:account_id>/reset', ResetAndSyncView.as_view(), name='reset'),
]
