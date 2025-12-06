"""
Message URL configuration.

Migrated from backend/src/routes/messageRoutes.ts
"""

from django.urls import path
from .views import (
    MessagesListView,
    ConversationMessagesView,
    SendMessageView,
    MarkMessageReadView,
    MarkConversationReadView,
    UnreadCountView,
)

app_name = 'messaging'

urlpatterns = [
    # GET /api/messages
    # Get all messages for authenticated user
    path('', MessagesListView.as_view(), name='list'),
    
    # GET /api/messages/unread/count
    # Get unread count
    path('unread/count', UnreadCountView.as_view(), name='unread_count'),
    
    # GET /api/messages/:conversationId
    # Get messages for a specific conversation
    path('<uuid:conversation_id>', ConversationMessagesView.as_view(), name='conversation_messages'),
    
    # POST /api/messages/:conversationId/send
    # Send a message in a conversation
    path('<uuid:conversation_id>/send', SendMessageView.as_view(), name='send'),
    
    # PATCH /api/messages/:messageId/read
    # Mark a message as read
    path('<uuid:message_id>/read', MarkMessageReadView.as_view(), name='mark_read'),
    
    # PATCH /api/messages/conversation/:conversationId/read
    # Mark all messages in a conversation as read
    path('conversation/<uuid:conversation_id>/read', MarkConversationReadView.as_view(), name='mark_conversation_read'),
]
