"""
Twitter/X views for cookie-based authentication and DM operations.

These views handle:
- Cookie submission for authentication
- DM fetching with rate limiting
- DM sending with rate limiting

Requirements: 3.1, 3.2, 3.3
"""

import json
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils import timezone

from apps.platforms.adapters.twitter_cookie import twitter_cookie_adapter
from apps.oauth.models import ConnectedAccount
from apps.conversations.models import Conversation
from apps.messaging.models import Message
from apps.core.utils.crypto import encrypt


class TwitterCookieSubmitView(APIView):
    """
    Submit Twitter cookies for authentication.
    
    POST /api/platforms/twitter/cookies
    
    Request body:
    {
        "auth_token": "string",
        "ct0": "string",
        "platform_user_id": "string",  # Twitter user ID
        "platform_username": "string"  # Twitter username (handle)
    }
    
    Requirements: 3.1
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
            auth_token = request.data.get('auth_token')
            ct0 = request.data.get('ct0')
            platform_user_id = request.data.get('platform_user_id')
            platform_username = request.data.get('platform_username')
            
            if not auth_token or not ct0:
                return Response({
                    'error': {
                        'code': 'MISSING_COOKIES',
                        'message': 'Both auth_token and ct0 cookies are required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not platform_user_id or not platform_username:
                return Response({
                    'error': {
                        'code': 'MISSING_USER_INFO',
                        'message': 'platform_user_id and platform_username are required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Store cookies securely
            account_id = twitter_cookie_adapter.store_cookies(
                user_id=user_id,
                platform_user_id=platform_user_id,
                platform_username=platform_username,
                auth_token=auth_token,
                ct0=ct0
            )
            
            print(f'[twitter] Cookies stored for user {user_id}, account {account_id}')
            
            return Response({
                'success': True,
                'accountId': account_id,
                'message': 'Twitter cookies stored successfully',
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            print(f'[twitter] Failed to store cookies: {e}')
            return Response({
                'error': {
                    'code': 'STORAGE_FAILED',
                    'message': str(e) or 'Failed to store Twitter cookies',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TwitterVerifyCookiesView(APIView):
    """
    Verify that stored Twitter cookies are still valid.
    
    GET /api/platforms/twitter/verify/:accountId
    
    Requirements: 3.1
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
                    platform='twitter'
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Twitter account not found',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Verify cookies
            import asyncio
            is_valid = asyncio.get_event_loop().run_until_complete(
                twitter_cookie_adapter.verify_cookies(str(account_id))
            )
            
            if is_valid:
                return Response({
                    'valid': True,
                    'message': 'Twitter cookies are valid',
                })
            else:
                # Mark account as inactive
                account.is_active = False
                account.save()
                
                return Response({
                    'valid': False,
                    'message': 'Twitter cookies have expired. Please re-authenticate.',
                })
                
        except Exception as e:
            print(f'[twitter] Cookie verification failed: {e}')
            return Response({
                'error': {
                    'code': 'VERIFICATION_FAILED',
                    'message': str(e) or 'Failed to verify Twitter cookies',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TwitterConversationsView(APIView):
    """
    Get Twitter DM conversations.
    
    GET /api/platforms/twitter/conversations/:accountId
    
    Requirements: 3.2
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
                    platform='twitter',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Twitter account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch conversations
            conversations = twitter_cookie_adapter.get_conversations(str(account_id))
            
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
                        'message': 'Twitter rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,  # 15 minutes
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Check for auth errors
            if 'unauthorized' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Twitter cookies have expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[twitter] Failed to fetch conversations: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Twitter conversations',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TwitterMessagesView(APIView):
    """
    Get Twitter DM messages.
    
    GET /api/platforms/twitter/messages/:accountId
    Query params:
    - since: ISO datetime to fetch messages since (optional)
    
    Requirements: 3.2
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
                    platform='twitter',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Twitter account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Parse since parameter
            since = None
            if since_str:
                from django.utils.dateparse import parse_datetime
                since = parse_datetime(since_str)
            
            # Fetch messages
            messages = twitter_cookie_adapter.fetch_messages(str(account_id), since)
            
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
                        'message': 'Twitter rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Twitter cookies have expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[twitter] Failed to fetch messages: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Twitter messages',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)



class TwitterSendMessageView(APIView):
    """
    Send a Twitter DM.
    
    POST /api/platforms/twitter/send/:accountId
    
    Request body:
    {
        "conversation_id": "string",  # Twitter conversation/DM thread ID
        "content": "string"           # Message text
    }
    
    Requirements: 3.3
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
                    platform='twitter',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Twitter account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check daily limit
            remaining = twitter_cookie_adapter.get_daily_remaining(str(account_id))
            if remaining <= 0:
                return Response({
                    'error': {
                        'code': 'DAILY_LIMIT_REACHED',
                        'message': 'Daily message limit (15) reached. Try again tomorrow.',
                        'retryable': False,
                        'dailyLimit': 15,
                        'remaining': 0,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Send message
            sent_message = twitter_cookie_adapter.send_message(
                account_id=str(account_id),
                conversation_id=conversation_id,
                content=content.strip()
            )
            
            # Get updated remaining count
            new_remaining = twitter_cookie_adapter.get_daily_remaining(str(account_id))
            
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
                        'message': 'Twitter rate limit exceeded. Please try again later.',
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
            
            if 'unauthorized' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Twitter cookies have expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[twitter] Failed to send message: {e}')
            return Response({
                'error': {
                    'code': 'SEND_FAILED',
                    'message': str(e) or 'Failed to send Twitter message',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class TwitterRateLimitStatusView(APIView):
    """
    Get rate limit status for a Twitter account.
    
    GET /api/platforms/twitter/rate-limit/:accountId
    
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
                    platform='twitter',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Twitter account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get rate limit info
            daily_remaining = twitter_cookie_adapter.get_daily_remaining(str(account_id))
            
            # Get wait time if rate limited
            wait_time_fetch = twitter_cookie_adapter.rate_limiter.wait_if_needed(
                str(account_id),
                twitter_cookie_adapter.rate_limit_config,
                'fetch'
            )
            wait_time_send = twitter_cookie_adapter.rate_limiter.wait_if_needed(
                str(account_id),
                twitter_cookie_adapter.rate_limit_config,
                'send'
            )
            
            return Response({
                'dailyLimit': twitter_cookie_adapter.DAILY_MESSAGE_LIMIT,
                'dailyRemaining': daily_remaining,
                'fetchRateLimited': wait_time_fetch > 0,
                'fetchWaitSeconds': int(wait_time_fetch),
                'sendRateLimited': wait_time_send > 0,
                'sendWaitSeconds': int(wait_time_send),
            })
            
        except Exception as e:
            print(f'[twitter] Failed to get rate limit status: {e}')
            return Response({
                'error': {
                    'code': 'STATUS_FAILED',
                    'message': str(e) or 'Failed to get rate limit status',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
