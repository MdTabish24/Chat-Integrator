"""
Instagram views for session-based authentication and DM operations.

These views handle:
- Login/session submission for authentication
- DM fetching with rate limiting
- DM sending with rate limiting

Requirements: 5.1, 5.2, 5.3
"""

import json
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils import timezone

from apps.platforms.adapters.instagram_session import instagram_session_adapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt


class InstagramLoginView(APIView):
    """
    Submit Instagram credentials for authentication.
    
    POST /api/platforms/instagram/login
    
    Request body:
    {
        "username": "string",           # Instagram username
        "password": "string",           # Instagram password
        "platform_user_id": "string",   # Instagram user ID (pk) - optional, will be fetched
        "platform_username": "string",  # Instagram username for display
        "sessionid": "string"           # Optional session ID for session-based auth
    }
    
    Requirements: 5.1
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
            
            # Validate required fields
            username = request.data.get('username')
            password = request.data.get('password')
            platform_username = request.data.get('platform_username', username)
            platform_user_id = request.data.get('platform_user_id')
            sessionid = request.data.get('sessionid')
            
            if not username or not password:
                return Response({
                    'error': {
                        'code': 'MISSING_CREDENTIALS',
                        'message': 'Both username and password are required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # If platform_user_id not provided, we'll need to fetch it after login
            # For now, use username as placeholder
            if not platform_user_id:
                platform_user_id = username
            
            # Store session securely
            account_id = instagram_session_adapter.store_session(
                user_id=user_id,
                platform_user_id=platform_user_id,
                platform_username=platform_username,
                username=username,
                password=password,
                sessionid=sessionid
            )
            
            # Try to verify the session and get actual user ID
            try:
                if instagram_session_adapter.verify_session(account_id):
                    # Update with actual user ID if we can get it
                    client = instagram_session_adapter._get_or_create_client(account_id)
                    user_info = client.account_info()
                    if user_info:
                        account = ConnectedAccount.objects.get(id=account_id)
                        account.platform_user_id = str(user_info.pk)
                        account.platform_username = user_info.username
                        account.save()
            except Exception as verify_error:
                print(f'[instagram] Session verification during login: {verify_error}')
            
            print(f'[instagram] Session stored for user {user_id}, account {account_id}')
            
            return Response({
                'success': True,
                'accountId': account_id,
                'message': 'Instagram session stored successfully',
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            error_str = str(e).lower()
            
            # Check for challenge required
            if 'challenge' in error_str or 'checkpoint' in error_str:
                return Response({
                    'error': {
                        'code': 'CHALLENGE_REQUIRED',
                        'message': 'Instagram requires verification. Please complete verification in browser and try again.',
                        'retryable': False,
                    }
                }, status=status.HTTP_403_FORBIDDEN)
            
            # Check for invalid credentials
            if 'password' in error_str or 'credentials' in error_str or 'login' in error_str:
                return Response({
                    'error': {
                        'code': 'INVALID_CREDENTIALS',
                        'message': 'Invalid Instagram username or password',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[instagram] Failed to store session: {e}')
            return Response({
                'error': {
                    'code': 'LOGIN_FAILED',
                    'message': str(e) or 'Failed to login to Instagram',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramVerifySessionView(APIView):
    """
    Verify that stored Instagram session is still valid.
    
    GET /api/platforms/instagram/verify/:accountId
    
    Requirements: 5.1
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
                    platform='instagram'
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Instagram account not found',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Verify session
            is_valid = instagram_session_adapter.verify_session(str(account_id))
            
            if is_valid:
                return Response({
                    'valid': True,
                    'message': 'Instagram session is valid',
                })
            else:
                # Mark account as inactive
                account.is_active = False
                account.save()
                
                return Response({
                    'valid': False,
                    'message': 'Instagram session has expired. Please re-authenticate.',
                })
                
        except Exception as e:
            print(f'[instagram] Session verification failed: {e}')
            return Response({
                'error': {
                    'code': 'VERIFICATION_FAILED',
                    'message': str(e) or 'Failed to verify Instagram session',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramConversationsView(APIView):
    """
    Get Instagram DM conversations (inbox threads).
    
    GET /api/platforms/instagram/conversations/:accountId
    
    Requirements: 5.2
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
                    platform='instagram',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Instagram account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch conversations
            conversations = instagram_session_adapter.get_conversations(str(account_id))
            
            return Response({
                'conversations': conversations,
                'count': len(conversations),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            # Check for rate limit
            if 'rate limit' in error_str:
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Instagram rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,  # 15 minutes
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Check for auth errors
            if 'login_required' in error_str or 'unauthorized' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Instagram session has expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            # Check for challenge required
            if 'challenge' in error_str or 'checkpoint' in error_str:
                return Response({
                    'error': {
                        'code': 'CHALLENGE_REQUIRED',
                        'message': 'Instagram requires verification. Please complete verification in browser.',
                        'retryable': False,
                    }
                }, status=status.HTTP_403_FORBIDDEN)
            
            print(f'[instagram] Failed to fetch conversations: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Instagram conversations',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramMessagesView(APIView):
    """
    Get Instagram DM messages.
    
    GET /api/platforms/instagram/messages/:accountId
    Query params:
    - since: ISO datetime to fetch messages since (optional)
    
    Requirements: 5.2
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
                    platform='instagram',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Instagram account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Parse since parameter
            since = None
            if since_str:
                from django.utils.dateparse import parse_datetime
                since = parse_datetime(since_str)
            
            # Fetch messages
            messages = instagram_session_adapter.fetch_messages(str(account_id), since)
            
            return Response({
                'messages': messages,
                'count': len(messages),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str:
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Instagram rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'login_required' in error_str or 'unauthorized' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Instagram session has expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            if 'challenge' in error_str or 'checkpoint' in error_str:
                return Response({
                    'error': {
                        'code': 'CHALLENGE_REQUIRED',
                        'message': 'Instagram requires verification. Please complete verification in browser.',
                        'retryable': False,
                    }
                }, status=status.HTTP_403_FORBIDDEN)
            
            print(f'[instagram] Failed to fetch messages: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Instagram messages',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramSendMessageView(APIView):
    """
    Send an Instagram DM.
    
    POST /api/platforms/instagram/send/:accountId
    
    Request body:
    {
        "conversation_id": "string",  # Instagram thread ID
        "content": "string"           # Message text
    }
    
    Requirements: 5.3
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
                    platform='instagram',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Instagram account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check daily limit
            remaining = instagram_session_adapter.get_daily_remaining(str(account_id))
            if remaining <= 0:
                return Response({
                    'error': {
                        'code': 'DAILY_LIMIT_REACHED',
                        'message': 'Daily message limit (20) reached. Try again tomorrow.',
                        'retryable': False,
                        'dailyLimit': 20,
                        'remaining': 0,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Send message
            sent_message = instagram_session_adapter.send_message(
                account_id=str(account_id),
                conversation_id=conversation_id,
                content=content.strip()
            )
            
            # Get updated remaining count
            new_remaining = instagram_session_adapter.get_daily_remaining(str(account_id))
            
            return Response({
                'success': True,
                'message': sent_message,
                'dailyRemaining': new_remaining,
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str:
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Instagram rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'daily' in error_str and 'limit' in error_str:
                return Response({
                    'error': {
                        'code': 'DAILY_LIMIT_REACHED',
                        'message': 'Daily message limit reached. Try again tomorrow.',
                        'retryable': False,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'login_required' in error_str or 'unauthorized' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Instagram session has expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            if 'challenge' in error_str or 'checkpoint' in error_str:
                return Response({
                    'error': {
                        'code': 'CHALLENGE_REQUIRED',
                        'message': 'Instagram requires verification. Please complete verification in browser.',
                        'retryable': False,
                    }
                }, status=status.HTTP_403_FORBIDDEN)
            
            print(f'[instagram] Failed to send message: {e}')
            return Response({
                'error': {
                    'code': 'SEND_FAILED',
                    'message': str(e) or 'Failed to send Instagram message',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramRateLimitStatusView(APIView):
    """
    Get rate limit status for an Instagram account.
    
    GET /api/platforms/instagram/rate-limit/:accountId
    
    Returns current rate limit status including:
    - Daily messages remaining
    - Whether currently rate limited
    - Time until rate limit resets
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
                    platform='instagram',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Instagram account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get rate limit info
            daily_remaining = instagram_session_adapter.get_daily_remaining(str(account_id))
            
            # Get wait time if rate limited
            wait_time_fetch = instagram_session_adapter.rate_limiter.wait_if_needed(
                str(account_id),
                instagram_session_adapter.rate_limit_config,
                'fetch'
            )
            wait_time_send = instagram_session_adapter.rate_limiter.wait_if_needed(
                str(account_id),
                instagram_session_adapter.rate_limit_config,
                'send'
            )
            
            return Response({
                'dailyLimit': instagram_session_adapter.DAILY_MESSAGE_LIMIT,
                'dailyRemaining': daily_remaining,
                'fetchRateLimited': wait_time_fetch > 0,
                'fetchWaitSeconds': int(wait_time_fetch),
                'sendRateLimited': wait_time_send > 0,
                'sendWaitSeconds': int(wait_time_send),
            })
            
        except Exception as e:
            print(f'[instagram] Failed to get rate limit status: {e}')
            return Response({
                'error': {
                    'code': 'STATUS_FAILED',
                    'message': str(e) or 'Failed to get rate limit status',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
