"""
Gmail views for email operations.

Requirements:
- 10.1: OAuth callback endpoint
- 10.2: Email fetch endpoint (unread Primary only)
- 10.4: Email reply endpoint (no compose)
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from apps.oauth.models import ConnectedAccount
from apps.platforms.adapters.gmail import gmail_adapter


class GmailThreadsView(APIView):
    """
    Get email threads (conversations) for a Gmail account.
    
    GET /api/platforms/gmail/threads/<account_id>
    
    Requirements 10.2: Retrieve only unread emails from Primary category
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
                    platform='gmail',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Gmail account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch threads
            threads = gmail_adapter.get_conversations(str(account_id))
            
            return Response({
                'threads': threads,
                'count': len(threads),
            })
        
        except Exception as e:
            print(f'[gmail] Failed to fetch threads: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch email threads',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GmailEmailsView(APIView):
    """
    Get unread emails from Primary category for a Gmail account.
    
    GET /api/platforms/gmail/emails/<account_id>
    
    Requirements 10.2, 10.3: Retrieve unread Primary emails with sender, subject, preview
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
                    platform='gmail',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Gmail account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch unread Primary emails
            emails = gmail_adapter.fetch_messages(str(account_id))
            
            return Response({
                'emails': emails,
                'count': len(emails),
                'filter': {
                    'category': 'primary',
                    'is_read': False,
                    'excluded': ['spam', 'trash', 'social', 'promotions', 'forums'],
                },
            })
        
        except Exception as e:
            print(f'[gmail] Failed to fetch emails: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch emails',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GmailReplyView(APIView):
    """
    Send a reply to an existing email thread.
    
    POST /api/platforms/gmail/reply/<account_id>
    
    Requirements 10.4: Send reply via Gmail API (no compose new email option)
    
    Note: This endpoint ONLY supports replying to existing threads.
    New email composition is intentionally disabled.
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
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='gmail',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Gmail account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get request data
            thread_id = request.data.get('threadId')
            content = request.data.get('content')
            
            if not thread_id:
                return Response({
                    'error': {
                        'code': 'MISSING_THREAD_ID',
                        'message': 'Thread ID is required. New email composition is not supported.',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not content or not content.strip():
                return Response({
                    'error': {
                        'code': 'MISSING_CONTENT',
                        'message': 'Reply content is required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Send reply
            result = gmail_adapter.send_message(str(account_id), thread_id, content)
            
            return Response({
                'success': True,
                'message': result,
            })
        
        except Exception as e:
            error_msg = str(e)
            print(f'[gmail] Failed to send reply: {error_msg}')
            
            # Check for specific error types
            if 'not found' in error_msg.lower() or 'only replies' in error_msg.lower():
                return Response({
                    'error': {
                        'code': 'THREAD_NOT_FOUND',
                        'message': error_msg,
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            return Response({
                'error': {
                    'code': 'SEND_FAILED',
                    'message': error_msg or 'Failed to send reply',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GmailMarkReadView(APIView):
    """
    Mark an email as read.
    
    POST /api/platforms/gmail/read/<account_id>
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
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='gmail',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Gmail account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get message ID
            message_id = request.data.get('messageId')
            
            if not message_id:
                return Response({
                    'error': {
                        'code': 'MISSING_MESSAGE_ID',
                        'message': 'Message ID is required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Mark as read
            gmail_adapter.mark_as_read(str(account_id), message_id)
            
            return Response({
                'success': True,
                'message': 'Email marked as read',
            })
        
        except Exception as e:
            print(f'[gmail] Failed to mark email as read: {e}')
            return Response({
                'error': {
                    'code': 'MARK_READ_FAILED',
                    'message': str(e) or 'Failed to mark email as read',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
