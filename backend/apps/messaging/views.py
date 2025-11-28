"""
Message views (controllers) for message operations.

Migrated from backend/src/controllers/messageController.ts
"""

from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from .models import Message
from apps.conversations.models import Conversation
from apps.oauth.models import ConnectedAccount
from .serializers import MessageSerializer, SendMessageSerializer, MarkAsReadSerializer


class MessagesListView(APIView):
    """
    Get all messages for the authenticated user
    
    GET /api/messages
    Migrated from: getMessages() in messageController.ts
    """
    permission_classes = [AllowAny]  # Check JWT in middleware
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            since = request.query_params.get('since')
            
            # Get all conversations for user's connected accounts
            user_accounts = ConnectedAccount.objects.filter(user_id=user_id, is_active=True)
            conversations = Conversation.objects.filter(account__in=user_accounts)
            
            # Get messages
            messages_query = Message.objects.filter(conversation__in=conversations)
            
            if since:
                from django.utils.dateparse import parse_datetime
                since_date = parse_datetime(since)
                if since_date:
                    messages_query = messages_query.filter(sent_at__gte=since_date)
            
            messages = messages_query[:100]  # Limit to 100
            serializer = MessageSerializer(messages, many=True)
            
            return Response({
                'messages': serializer.data,
                'count': len(serializer.data)
            })
        
        except Exception as e:
            print(f'Error fetching messages: {e}')
            return Response({
                'error': 'Failed to fetch messages',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ConversationMessagesView(APIView):
    """
    Get messages for a specific conversation
    
    GET /api/messages/:conversationId
    Migrated from: getConversationMessages() in messageController.ts
    """
    permission_classes = [AllowAny]
    
    def get(self, request, conversation_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            limit = int(request.query_params.get('limit', 50))
            offset = int(request.query_params.get('offset', 0))
            
            # Verify user has access to this conversation
            if not self._verify_conversation_access(user_id, conversation_id):
                return Response(
                    {'error': 'Access denied to this conversation'},
                    status=status.HTTP_403_FORBIDDEN
                )
            
            # Get messages
            messages = Message.objects.filter(
                conversation_id=conversation_id
            ).order_by('-sent_at')[offset:offset + limit]
            
            total_count = Message.objects.filter(conversation_id=conversation_id).count()
            
            serializer = MessageSerializer(messages, many=True)
            
            return Response({
                'messages': serializer.data,
                'count': len(serializer.data),
                'total': total_count,
                'limit': limit,
                'offset': offset
            })
        
        except Exception as e:
            print(f'Error fetching conversation messages: {e}')
            return Response({
                'error': 'Failed to fetch conversation messages',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
    
    def _verify_conversation_access(self, user_id, conversation_id):
        """Verify user has access to conversation"""
        return Conversation.objects.filter(
            id=conversation_id,
            account__user_id=user_id
        ).exists()


class SendMessageView(APIView):
    """
    Send a message in a conversation
    
    POST /api/messages/:conversationId/send
    Migrated from: sendMessage() in messageController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request, conversation_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Validate request
            serializer = SendMessageSerializer(data=request.data)
            if not serializer.is_valid():
                return Response({'error': serializer.errors}, status=status.HTTP_400_BAD_REQUEST)
            
            content = serializer.validated_data['content']
            
            # Verify user has access
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
            
            # Send message through platform adapter
            from apps.platforms.adapters.factory import get_adapter
            from apps.core.utils.crypto import encrypt
            from django.utils import timezone
            
            adapter = get_adapter(conversation.account.platform)
            
            # Send via platform
            sent_msg = adapter.send_message(
                account_id=str(conversation.account.id),
                conversation_id=conversation.platform_conversation_id,
                content=content
            )
            
            # Create message object with encrypted content
            message = Message.objects.create(
                conversation=conversation,
                platform_message_id=sent_msg.get('platformMessageId', str(timezone.now().timestamp())),
                sender_id=sent_msg.get('senderId', 'me'),
                sender_name=sent_msg.get('senderName', 'You'),
                content=encrypt(content),
                message_type=sent_msg.get('messageType', 'text'),
                media_url=encrypt(sent_msg.get('mediaUrl')) if sent_msg.get('mediaUrl') else None,
                is_outgoing=True,
                is_read=True,
                sent_at=timezone.now()
            )
            
            # Update conversation
            conversation.last_message_at = message.sent_at
            conversation.save()
            
            serializer = MessageSerializer(message)
            
            # Emit WebSocket event for real-time update
            from apps.websocket.services import websocket_service
            from apps.conversations.serializers import ConversationSerializer
            
            websocket_service.emit_new_message(
                user_id=user_id,
                message=serializer.data,
                conversation=ConversationSerializer(conversation).data
            )
            
            return Response({
                'message': serializer.data,
                'success': True
            }, status=status.HTTP_201_CREATED)
        
        except Exception as e:
            print(f'Error sending message: {e}')
            return Response({
                'error': 'Failed to send message',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MarkMessageReadView(APIView):
    """
    Mark a message as read
    
    PATCH /api/messages/:messageId/read
    Migrated from: markAsRead() in messageController.ts
    """
    permission_classes = [AllowAny]
    
    def patch(self, request, message_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Get message
            try:
                message = Message.objects.select_related('conversation__account').get(
                    id=message_id,
                    conversation__account__user_id=user_id
                )
            except Message.DoesNotExist:
                return Response(
                    {'error': 'Message not found or access denied'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Mark as read
            message.is_read = True
            message.save()
            
            # Update conversation unread count
            conversation = message.conversation
            conversation.unread_count = max(0, conversation.unread_count - 1)
            conversation.save()
            
            return Response({
                'success': True,
                'message': 'Message marked as read'
            })
        
        except Exception as e:
            print(f'Error marking message as read: {e}')
            return Response({
                'error': 'Failed to mark message as read',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class MarkConversationReadView(APIView):
    """
    Mark all messages in a conversation as read
    
    PATCH /api/messages/conversation/:conversationId/read
    Migrated from: markConversationAsRead() in messageController.ts
    """
    permission_classes = [AllowAny]
    
    def patch(self, request, conversation_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Verify access
            try:
                conversation = Conversation.objects.get(
                    id=conversation_id,
                    account__user_id=user_id
                )
            except Conversation.DoesNotExist:
                return Response(
                    {'error': 'Conversation not found or access denied'},
                    status=status.HTTP_404_NOT_FOUND
                )
            
            # Mark all messages as read
            Message.objects.filter(
                conversation=conversation,
                is_read=False,
                is_outgoing=False
            ).update(is_read=True)
            
            # Reset unread count
            conversation.unread_count = 0
            conversation.save()
            
            return Response({
                'success': True,
                'message': 'All messages marked as read'
            })
        
        except Exception as e:
            print(f'Error marking conversation as read: {e}')
            return Response({
                'error': 'Failed to mark conversation as read',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class UnreadCountView(APIView):
    """
    Get unread count for the authenticated user
    
    GET /api/messages/unread/count
    Migrated from: getUnreadCount() in messageController.ts
    """
    permission_classes = [AllowAny]
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Get total unread count
            user_accounts = ConnectedAccount.objects.filter(user_id=user_id, is_active=True)
            conversations = Conversation.objects.filter(account__in=user_accounts)
            
            total_unread = sum(conv.unread_count for conv in conversations)
            
            # Get unread by platform
            by_platform = {}
            for account in user_accounts:
                platform = account.platform
                platform_conversations = conversations.filter(account=account)
                platform_unread = sum(conv.unread_count for conv in platform_conversations)
                if platform_unread > 0:
                    by_platform[platform] = platform_unread
            
            return Response({
                'total': total_unread,
                'byPlatform': by_platform
            })
        
        except Exception as e:
            print(f'Error fetching unread count: {e}')
            return Response({
                'error': 'Failed to fetch unread count',
                'message': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
