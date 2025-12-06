"""
WhatsApp Web views for browser-based authentication and messaging.

These views handle:
- QR code generation for authentication
- Session status checking
- Message fetching via browser scraping
- Message sending with human-like delays

Requirements: 7.1, 7.2, 7.3, 7.4
"""

import asyncio
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils import timezone

from apps.platforms.adapters.whatsapp_web import whatsapp_web_adapter
from apps.oauth.models import ConnectedAccount


class WhatsAppQRCodeView(APIView):
    """
    Start WhatsApp Web session and get QR code for authentication.
    
    POST /api/platforms/whatsapp/qr
    
    Returns:
    {
        "session_id": "string",
        "qr_code": "base64 encoded image",
        "expires_in": 120,
        "status": "pending_qr_scan"
    }
    
    Requirements: 7.1
    """
    permission_classes = [AllowAny]  # JWT checked in middleware
    
    def post(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Start QR session
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                result = loop.run_until_complete(
                    whatsapp_web_adapter.start_qr_session(user_id)
                )
            finally:
                loop.close()
            
            print(f'[whatsapp] QR session started for user {user_id}')
            
            return Response({
                'success': True,
                **result,
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            print(f'[whatsapp] Failed to start QR session: {e}')
            return Response({
                'error': {
                    'code': 'QR_GENERATION_FAILED',
                    'message': str(e) or 'Failed to generate WhatsApp QR code',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WhatsAppRefreshQRView(APIView):
    """
    Get refreshed QR code for an existing session.
    
    GET /api/platforms/whatsapp/qr/:session_id
    
    Returns:
    {
        "qr_code": "base64 encoded image",
        "status": "pending_qr_scan" | "connected" | "timeout"
    }
    
    Requirements: 7.1
    """
    permission_classes = [AllowAny]
    
    def get(self, request, session_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            # Get session status
            session_status = whatsapp_web_adapter.get_session_status(session_id)
            
            # Get QR code if still pending
            qr_code = None
            if session_status.get('status') == 'pending_qr_scan':
                qr_code = whatsapp_web_adapter.get_qr_code(session_id)
            
            return Response({
                'session_id': session_id,
                'qr_code': qr_code,
                'status': session_status.get('status', 'unknown'),
                'message': session_status.get('message', ''),
            })
            
        except Exception as e:
            print(f'[whatsapp] Failed to get QR code: {e}')
            return Response({
                'error': {
                    'code': 'QR_FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch QR code',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WhatsAppSessionStatusView(APIView):
    """
    Get status of a WhatsApp Web session.
    
    GET /api/platforms/whatsapp/status/:session_id
    
    Returns:
    {
        "session_id": "string",
        "status": "pending_qr_scan" | "connected" | "timeout" | "disconnected",
        "authenticated_at": "ISO datetime" (if connected)
    }
    
    Requirements: 7.2
    """
    permission_classes = [AllowAny]
    
    def get(self, request, session_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            session_status = whatsapp_web_adapter.get_session_status(session_id)
            
            return Response(session_status)
            
        except Exception as e:
            print(f'[whatsapp] Failed to get session status: {e}')
            return Response({
                'error': {
                    'code': 'STATUS_FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch session status',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WhatsAppDisconnectView(APIView):
    """
    Disconnect a WhatsApp Web session.
    
    DELETE /api/platforms/whatsapp/disconnect/:account_id
    
    Requirements: 7.5
    """
    permission_classes = [AllowAny]
    
    def delete(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='whatsapp_web'
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'WhatsApp account not found',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Disconnect session
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                success = loop.run_until_complete(
                    whatsapp_web_adapter.disconnect_session(str(account_id))
                )
            finally:
                loop.close()
            
            if success:
                return Response({
                    'success': True,
                    'message': 'WhatsApp session disconnected',
                })
            else:
                return Response({
                    'error': {
                        'code': 'DISCONNECT_FAILED',
                        'message': 'Failed to disconnect WhatsApp session',
                        'retryable': True,
                    }
                }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
        except Exception as e:
            print(f'[whatsapp] Failed to disconnect: {e}')
            return Response({
                'error': {
                    'code': 'DISCONNECT_FAILED',
                    'message': str(e) or 'Failed to disconnect WhatsApp session',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WhatsAppConversationsView(APIView):
    """
    Get WhatsApp conversations.
    
    GET /api/platforms/whatsapp/conversations/:account_id
    
    Requirements: 7.3
    """
    permission_classes = [AllowAny]
    
    def get(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='whatsapp_web',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'WhatsApp account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch conversations
            loop = asyncio.new_event_loop()
            asyncio.set_event_loop(loop)
            try:
                conversations = loop.run_until_complete(
                    whatsapp_web_adapter.get_conversations(str(account_id))
                )
            finally:
                loop.close()
            
            return Response({
                'conversations': conversations,
                'count': len(conversations),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            # Check for session disconnection
            if 'qr' in error_str or 'scan' in error_str or 'disconnected' in error_str:
                return Response({
                    'error': {
                        'code': 'SESSION_DISCONNECTED',
                        'message': 'WhatsApp Web session disconnected. Please scan QR code again.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[whatsapp] Failed to fetch conversations: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch WhatsApp conversations',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WhatsAppMessagesView(APIView):
    """
    Get WhatsApp messages from current conversation.
    
    GET /api/platforms/whatsapp/messages/:account_id
    Query params:
    - since: ISO datetime to fetch messages since (optional)
    
    Requirements: 7.3
    """
    permission_classes = [AllowAny]
    
    def get(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            since_str = request.query_params.get('since')
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='whatsapp_web',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'WhatsApp account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Parse since parameter
            since = None
            if since_str:
                from django.utils.dateparse import parse_datetime
                since = parse_datetime(since_str)
            
            # Fetch messages
            messages = whatsapp_web_adapter.fetch_messages(str(account_id), since)
            
            return Response({
                'messages': messages,
                'count': len(messages),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'qr' in error_str or 'scan' in error_str or 'disconnected' in error_str:
                return Response({
                    'error': {
                        'code': 'SESSION_DISCONNECTED',
                        'message': 'WhatsApp Web session disconnected. Please scan QR code again.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[whatsapp] Failed to fetch messages: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch WhatsApp messages',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class WhatsAppSendMessageView(APIView):
    """
    Send a WhatsApp message.
    
    POST /api/platforms/whatsapp/send/:account_id
    
    Request body:
    {
        "conversation_id": "string",  # Contact name or conversation ID
        "content": "string"           # Message text
    }
    
    Requirements: 7.4
    """
    permission_classes = [AllowAny]
    
    def post(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Validate request body
            conversation_id = request.data.get('conversation_id')
            content = request.data.get('content')
            
            if not conversation_id:
                return Response({
                    'error': {
                        'code': 'MISSING_CONVERSATION_ID',
                        'message': 'conversation_id is required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not content or not content.strip():
                return Response({
                    'error': {
                        'code': 'MISSING_CONTENT',
                        'message': 'Message content is required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='whatsapp_web',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'WhatsApp account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Send message
            sent_message = whatsapp_web_adapter.send_message(
                account_id=str(account_id),
                conversation_id=conversation_id,
                content=content.strip()
            )
            
            return Response({
                'success': True,
                'message': sent_message,
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'qr' in error_str or 'scan' in error_str or 'disconnected' in error_str:
                return Response({
                    'error': {
                        'code': 'SESSION_DISCONNECTED',
                        'message': 'WhatsApp Web session disconnected. Please scan QR code again.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[whatsapp] Failed to send message: {e}')
            return Response({
                'error': {
                    'code': 'SEND_FAILED',
                    'message': str(e) or 'Failed to send WhatsApp message',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
