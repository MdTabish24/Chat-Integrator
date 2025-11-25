"""
Conversation URL configuration.

Migrated from backend/src/routes/conversationRoutes.ts
"""

from django.urls import path
from .views import ConversationsListView, ConversationDetailView

app_name = 'conversations'

urlpatterns = [
    # GET /api/conversations
    # Get all conversations for authenticated user
    path('', ConversationsListView.as_view(), name='list'),
    
    # GET /api/conversations/:conversationId
    # Get details for a specific conversation
    path('<uuid:conversation_id>', ConversationDetailView.as_view(), name='detail'),
]
