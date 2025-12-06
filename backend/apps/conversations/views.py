"""
Conversation views (controllers).

Migrated from backend/src/controllers/messageController.ts (getConversations)
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from .models import Conversation
from apps.oauth.models import ConnectedAccount
from .serializers import ConversationSerializer, ConversationListSerializer


class ConversationsListView(APIView):
    """
    Get all conversations for the authenticated user
    
    GET /api/conversations
    Migrated from: getConversations() in messageController.ts
    """
    permission_classes = [AllowAny]
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            limit = int(request.query_params.get('limit', 50))
            offset = int(request.query_params.get('offset', 0))
            platform = request.query_params.get('platform')
            
            # Get user's connected accounts
            accounts_query = ConnectedAccount.objects.filter(user_id=user_id, is_active=True)
            
            if platform:
                accounts_query = accounts_query.filter(platform=platform)
            
            # Get conversations
            conversations_query = Conversation.objects.filter(
                account__in=accounts_query
            ).select_related('account').order_by('-last_message_at')
            
            total_count = conversations_query.count()
            conversations = conversations_query[offset:offset + limit]
            
            serializer = ConversationListSerializer(conversations, many=True)
            
            return Response({
                'conversations': serializer.data,
                'count': len(serializer.data),
                'total': total_count,
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
