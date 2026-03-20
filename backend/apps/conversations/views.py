"""
Conversation views (controllers).

Migrated from backend/src/controllers/messageController.ts (getConversations)
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.db.models import Case, When, IntegerField

from .models import Conversation
from apps.oauth.models import ConnectedAccount
from .serializers import ConversationSerializer, ConversationListSerializer


class ConversationsListView(APIView):
    """
    Get all conversations for the authenticated user
    
    GET /api/conversations
    Migrated from: getConversations() in messageController.ts
    
    Priority sorting:
    1. Unread conversations first (sorted by last_message_at desc)
    2. Then read conversations (sorted by last_message_at desc)
    3. Limited to: all unread + 10 read conversations
    """
    permission_classes = [AllowAny]

    def _normalize_twitter_participants(self, conversations):
        """
        Safety net for stale Twitter rows where participant is accidentally stored as self.
        Prefer latest incoming sender as participant for UI response.
        """
        for conversation in conversations:
            account = getattr(conversation, 'account', None)
            if not account or account.platform != 'twitter':
                continue

            account_user_id = str(account.platform_user_id or '').strip()
            account_username = str(account.platform_username or '').strip().lstrip('@').lower()
            participant_id = str(conversation.participant_id or '').strip()
            participant_name = str(conversation.participant_name or '').strip()
            participant_name_lower = participant_name.lower()

            looks_self_mapped = False
            if account_user_id and participant_id and participant_id == account_user_id:
                looks_self_mapped = True
            if account_username and participant_name_lower in {account_username, f'@{account_username}'}:
                looks_self_mapped = True

            if not looks_self_mapped:
                continue

            latest_incoming = conversation.messages.filter(is_outgoing=False).order_by('-sent_at').first()
            if not latest_incoming:
                continue

            incoming_name = str(latest_incoming.sender_name or '').strip()
            if not incoming_name or incoming_name.lower() == 'you':
                continue

            conversation.participant_name = incoming_name
            incoming_sender_id = str(latest_incoming.sender_id or '').strip()
            if incoming_sender_id and incoming_sender_id != account_user_id:
                conversation.participant_id = incoming_sender_id
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            limit = int(request.query_params.get('limit', 50))
            offset = int(request.query_params.get('offset', 0))
            platform = request.query_params.get('platform')
            max_read_chats = int(request.query_params.get('max_read', 10))  # Max read chats to show
            
            # Get user's connected accounts
            accounts_query = ConnectedAccount.objects.filter(user_id=user_id, is_active=True)
            
            if platform:
                # Handle platform name variations (facebook vs facebook_cookie)
                platform_variations = [platform]
                if platform == 'facebook':
                    platform_variations.append('facebook_cookie')
                elif platform == 'facebook_cookie':
                    platform_variations.append('facebook')
                    
                accounts_query = accounts_query.filter(platform__in=platform_variations)
            
            # Get all conversations for this platform
            all_conversations = Conversation.objects.filter(
                account__in=accounts_query
            ).select_related('account')
            
            # Separate unread and read conversations
            # Unread = unread_count > 0, sorted by last_message_at desc
            unread_conversations = list(
                all_conversations.filter(unread_count__gt=0)
                .order_by('-last_message_at')
            )
            
            # Read = unread_count = 0, sorted by last_message_at desc, limited to max_read_chats
            read_conversations = list(
                all_conversations.filter(unread_count=0)
                .order_by('-last_message_at')[:max_read_chats]
            )
            
            # Combine: unread first, then read
            prioritized_conversations = unread_conversations + read_conversations

            # Runtime safety normalization for stale Twitter participant mappings
            self._normalize_twitter_participants(prioritized_conversations)
            
            # Apply offset and limit for pagination
            total_count = len(prioritized_conversations)
            conversations = prioritized_conversations[offset:offset + limit]
            
            serializer = ConversationListSerializer(conversations, many=True)
            
            return Response({
                'conversations': serializer.data,
                'count': len(serializer.data),
                'total': total_count,
                'unreadCount': len(unread_conversations),
                'readCount': len(read_conversations),
                'limit': limit,
                'offset': offset
            })
        
        except Exception as e:
            print(f'Error fetching conversations: {e}')
            return Response({
                'error': 'Failed to fetch conversations',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ConversationDetailView(APIView):
    """
    Get details for a specific conversation
    
    GET /api/conversations/:conversationId
    """
    permission_classes = [AllowAny]
    
    def get(self, request, conversation_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Get conversation
            try:
                conversation = Conversation.objects.select_related('account').get(
                    id=conversation_id,
                    account__user_id=user_id
                )
            except Conversation.DoesNotExist:
                return Response(
                    {'error': 'Conversation not found or access denied'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            serializer = ConversationSerializer(conversation)
            return Response(serializer.data)
        
        except Exception as e:
            print(f'Error fetching conversation: {e}')
            return Response({
                'error': 'Failed to fetch conversation',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
