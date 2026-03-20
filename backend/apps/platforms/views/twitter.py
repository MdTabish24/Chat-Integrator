"""
Twitter/X views for cookie-based authentication and DM operations.

These views handle:
- Cookie submission for authentication
- DM fetching with rate limiting
- DM sending with rate limiting

Requirements: 3.1, 3.2, 3.3
"""

import json
import re
from collections import Counter
from django.db.models import Q
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils import timezone
from adrf.views import APIView as AsyncAPIView

from apps.platforms.adapters.twitter_cookie import twitter_cookie_adapter
from apps.oauth.models import ConnectedAccount
from apps.conversations.models import Conversation
from apps.messaging.models import Message
from apps.core.utils.crypto import encrypt


def strip_emojis(text):
    """
    Remove emojis and other non-BMP characters from text.
    MySQL with utf8 charset can't handle 4-byte Unicode characters.
    """
    if not text:
        return text
    # Remove emojis and other characters outside BMP (Basic Multilingual Plane)
    # This regex matches most emoji ranges
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"  # emoticons
        "\U0001F300-\U0001F5FF"  # symbols & pictographs
        "\U0001F680-\U0001F6FF"  # transport & map symbols
        "\U0001F1E0-\U0001F1FF"  # flags (iOS)
        "\U00002702-\U000027B0"  # dingbats
        "\U000024C2-\U0001F251"  # enclosed characters
        "\U0001F900-\U0001F9FF"  # supplemental symbols
        "\U0001FA00-\U0001FA6F"  # chess symbols
        "\U0001FA70-\U0001FAFF"  # symbols and pictographs extended-A
        "\U00002600-\U000026FF"  # misc symbols
        "\U00002700-\U000027BF"  # dingbats
        "\U0001F004-\U0001F0CF"  # playing cards & mahjong
        "]+", 
        flags=re.UNICODE
    )
    return emoji_pattern.sub('', text).strip() or 'User'


class TwitterLoginView(AsyncAPIView):
    """
    Login to Twitter using username/password.
    
    POST /api/platforms/twitter/login
    
    Request body:
    {
        "username": "string",  # Twitter username (without @)
        "password": "string",  # Twitter password
        "email": "string"      # Optional: email for verification
    }
    
    Requirements: 3.1
    """
    permission_classes = [AllowAny]
    
    async def post(self, request):
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
            username = request.data.get('username', '').strip().lstrip('@')
            password = request.data.get('password', '')
            email = request.data.get('email', '').strip() or None
            
            if not username:
                return Response({
                    'error': {
                        'code': 'MISSING_USERNAME',
                        'message': 'Twitter username is required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            if not password:
                return Response({
                    'error': {
                        'code': 'MISSING_PASSWORD',
                        'message': 'Twitter password is required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Login using twikit (async)
            result = await twitter_cookie_adapter.login_with_credentials(
                user_id=user_id,
                username=username,
                password=password,
                email=email
            )
            
            print(f'[twitter] Login successful for user {user_id}, account {result["accountId"]}')
            
            return Response({
                'success': True,
                'accountId': result['accountId'],
                'username': result['username'],
                'message': 'Twitter connected successfully',
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            error_str = str(e)
            print(f'[twitter] Login failed: {e}')
            
            # Determine appropriate status code
            status_code = status.HTTP_500_INTERNAL_SERVER_ERROR
            if 'invalid' in error_str.lower() or 'incorrect' in error_str.lower():
                status_code = status.HTTP_401_UNAUTHORIZED
            elif 'locked' in error_str.lower() or 'suspended' in error_str.lower():
                status_code = status.HTTP_403_FORBIDDEN
            elif 'verification' in error_str.lower():
                status_code = status.HTTP_403_FORBIDDEN
            
            return Response({
                'error': {
                    'code': 'LOGIN_FAILED',
                    'message': error_str or 'Failed to login to Twitter',
                    'retryable': status_code == status.HTTP_500_INTERNAL_SERVER_ERROR,
                }
            }, status=status_code)


class TwitterCookieSubmitView(APIView):
    """
    Submit Twitter cookies for authentication (advanced users).
    
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
            
            # Validate required fields - support both direct and nested cookie format
            cookies = request.data.get('cookies', {})
            auth_token = request.data.get('auth_token') or cookies.get('auth_token')
            ct0 = request.data.get('ct0') or cookies.get('ct0')
            
            # Platform user info is optional - will use defaults
            platform_user_id = request.data.get('platform_user_id') or f'twitter_user_{user_id[:8]}'
            platform_username = request.data.get('platform_username') or 'Twitter User'
            
            if not auth_token or not ct0:
                return Response({
                    'error': {
                        'code': 'MISSING_COOKIES',
                        'message': 'Both auth_token and ct0 cookies are required',
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


class TwitterDesktopSyncView(APIView):
    """
    Receive Twitter DM data from the desktop app.
    
    POST /api/platforms/twitter/sync-from-desktop
    
    Request body:
    {
        "conversations": [
            {
                "id": "conversation_id",
                "participants": [...],
                "messages": [
                    {
                        "id": "message_id",
                        "text": "message text",
                        "senderId": "sender_id",
                        "createdAt": "ISO datetime"
                    }
                ]
            }
        ]
    }
    """
    permission_classes = [AllowAny]
    
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
            conversations_data = request.data.get('conversations', [])
            
            if not conversations_data:
                return Response({
                    'error': {
                        'code': 'NO_DATA',
                        'message': 'No conversations data provided',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Get or create user's Twitter account
            # If cookies are provided, create account automatically
            cookies = request.data.get('cookies', {})
            auth_token = cookies.get('auth_token', '')
            ct0 = cookies.get('ct0', '')
            
            try:
                account = ConnectedAccount.objects.get(
                    user_id=user_id,
                    platform='twitter',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                # If cookies provided, create account automatically
                if auth_token and ct0:
                    # Get user info from first conversation participant
                    platform_user_id = 'desktop_user'
                    platform_username = 'Twitter User'
                    
                    # Try to extract user ID from conversations
                    for conv in conversations_data:
                        participants = conv.get('participants', [])
                        for p in participants:
                            # The user's own ID might be in participants
                            p_id = str(p.get('user_id', p.get('id', '')))
                            if p_id:
                                platform_user_id = p_id
                                platform_username = p.get('screen_name', p.get('name', 'Twitter User'))
                                break
                        if platform_user_id != 'desktop_user':
                            break
                    
                    # Create account with cookies
                    account_id = twitter_cookie_adapter.store_cookies(
                        user_id=user_id,
                        platform_user_id=platform_user_id,
                        platform_username=platform_username,
                        auth_token=auth_token,
                        ct0=ct0
                    )
                    account = ConnectedAccount.objects.get(id=account_id)
                    print(f'[twitter-desktop] Auto-created account {account_id} for user {user_id}')
                else:
                    return Response({
                        'error': {
                            'code': 'ACCOUNT_NOT_FOUND',
                            'message': 'No active Twitter account found. Please submit cookies with the sync request.',
                            'retryable': False,
                        }
                    }, status=status.HTTP_404_NOT_FOUND)
            
            # Process and save conversations
            saved_conversations = 0
            saved_messages = 0

            account_user_id = str(account.platform_user_id or '').strip()
            account_username = (account.platform_username or '').strip().lstrip('@').lower()
            account_display_name = ''

            # Infer the logged-in account identity from all participants in this sync batch.
            # In desktop auto-create flows, account.platform_user_id can be wrong, which causes
            # self-selection bugs and repeated participant names in UI.
            participant_counts = Counter()
            payload_account_id_counts = Counter()
            participant_meta = {}
            for conv in conversations_data:
                payload_account_id = str(conv.get('account_user_id', '')).strip()
                if payload_account_id:
                    payload_account_id_counts[payload_account_id] += 1

                seen_participant_ids = set()
                for p in conv.get('participants', []):
                    p_id = str(p.get('user_id', p.get('id', ''))).strip()
                    if not p_id or p_id in seen_participant_ids:
                        continue
                    seen_participant_ids.add(p_id)
                    participant_counts[p_id] += 1
                    if p_id not in participant_meta:
                        participant_meta[p_id] = p

            if participant_counts:
                inferred_user_id, _ = participant_counts.most_common(1)[0]
                payload_inferred_user_id = payload_account_id_counts.most_common(1)[0][0] if payload_account_id_counts else ''
                if payload_inferred_user_id and payload_inferred_user_id in participant_counts:
                    inferred_user_id = payload_inferred_user_id

                should_override_account_id = (
                    not account_user_id or
                    account_user_id == 'desktop_user' or
                    account_user_id not in participant_counts or
                    (payload_inferred_user_id and account_user_id != payload_inferred_user_id)
                )

                if should_override_account_id:
                    inferred_meta = participant_meta.get(inferred_user_id, {})
                    inferred_username = str(
                        inferred_meta.get('screen_name') or inferred_meta.get('name') or ''
                    ).strip().lstrip('@')
                    inferred_display_name = strip_emojis(str(inferred_meta.get('name', '')).strip() or '')

                    account.platform_user_id = inferred_user_id
                    if inferred_username:
                        account.platform_username = inferred_username
                    account.save()

                    account_user_id = inferred_user_id
                    account_username = inferred_username.lower() if inferred_username else account_username
                    if inferred_display_name and inferred_display_name.lower() not in ('user', 'twitter user'):
                        account_display_name = inferred_display_name

                    print(
                        f'[twitter-desktop] Inferred and updated account identity: '
                        f'user_id={account_user_id}, username={account.platform_username}'
                    )

            if not account_display_name and account_user_id:
                existing_meta = participant_meta.get(account_user_id, {})
                existing_display_name = strip_emojis(str(existing_meta.get('name', '')).strip() or '')
                if existing_display_name and existing_display_name.lower() not in ('user', 'twitter user'):
                    account_display_name = existing_display_name

            # Cleanup legacy bad mappings where conversation participant was saved as self.
            # Twitter DMs should point to peer participant, not the logged-in account id.
            if account_user_id:
                stale_filter = Q(account=account, participant_id=account_user_id)
                account_username_exact = (account.platform_username or '').strip()
                if account_username_exact:
                    stale_filter = stale_filter | Q(account=account, participant_name__iexact=account_username_exact)
                if account_display_name:
                    stale_filter = stale_filter | Q(account=account, participant_name__iexact=account_display_name)

                stale_deleted, _ = Conversation.objects.filter(stale_filter).delete()
                if stale_deleted:
                    print(f'[twitter-desktop] Removed {stale_deleted} stale self-mapped conversations')

                def _normalize_name(name: str) -> str:
                    normalized = re.sub(r'[^a-z0-9]+', '', (name or '').lower())
                    # Normalize common first-name variants used by Twitter display names.
                    normalized = normalized.replace('mohammad', 'md')
                    normalized = normalized.replace('muhammad', 'md')
                    normalized = normalized.replace('mohd', 'md')
                    return normalized

                account_name_norms = set()
                account_display_name_exact = (account_display_name or '').strip()
                if account_username_exact:
                    account_name_norms.add(_normalize_name(account_username_exact))
                if account_display_name_exact:
                    account_name_norms.add(_normalize_name(account_display_name_exact))

                account_name_norms = {n for n in account_name_norms if n}
                if account_name_norms:
                    stale_name_ids = []
                    candidate_rows = Conversation.objects.filter(
                        account=account,
                        participant_name__isnull=False,
                    ).exclude(participant_name='')

                    for row in candidate_rows:
                        row_name_norm = _normalize_name(row.participant_name or '')
                        if row_name_norm and row_name_norm in account_name_norms:
                            stale_name_ids.append(row.id)

                    if stale_name_ids:
                        extra_deleted, _ = Conversation.objects.filter(id__in=stale_name_ids).delete()
                        if extra_deleted:
                            print(f'[twitter-desktop] Removed {extra_deleted} stale self-name conversations')
            
            for conv_data in conversations_data:
                conv_id = conv_data.get('id')
                if not conv_id:
                    continue
                
                # Get participant info
                participants = conv_data.get('participants', [])
                messages = conv_data.get('messages', [])
                participant_name = 'Twitter User'
                participant_id = ''
                conv_account_user_id = str(conv_data.get('account_user_id', '')).strip() or account_user_id

                # Find the other participant (not the logged-in Twitter account)
                participant_avatar = ''

                incoming_sender_counts = Counter()
                sender_name_by_id = {}
                for msg in messages:
                    sender_id = str(msg.get('senderId', '')).strip()
                    if not sender_id:
                        continue
                    if conv_account_user_id and sender_id == conv_account_user_id:
                        continue

                    incoming_sender_counts[sender_id] += 1
                    if sender_id not in sender_name_by_id:
                        sender_name_by_id[sender_id] = msg.get('senderName', '')

                def _is_current_account(participant):
                    p_id = str(participant.get('user_id', participant.get('id', ''))).strip()
                    p_screen = str(participant.get('screen_name', '')).strip().lstrip('@').lower()
                    p_name = str(participant.get('name', '')).strip().lower()

                    if conv_account_user_id and p_id and p_id == conv_account_user_id:
                        return True
                    if account_username and p_screen and p_screen == account_username:
                        return True
                    # Some payloads only include display name, so keep this as a fallback match.
                    if account_username and p_name and p_name == account_username:
                        return True
                    if account_display_name and p_name and p_name == account_display_name.lower():
                        return True
                    return False

                selected_participant = None

                # Highest-confidence match: participant whose id appears as incoming sender.
                if incoming_sender_counts and participants:
                    best_sender_id, _ = incoming_sender_counts.most_common(1)[0]
                    for p in participants:
                        p_id = str(p.get('user_id', p.get('id', ''))).strip()
                        if p_id and p_id == best_sender_id:
                            selected_participant = p
                            break

                for p in participants:
                    if selected_participant is not None:
                        break

                    p_id = str(p.get('user_id', p.get('id', ''))).strip()
                    if not p_id:
                        continue
                    if _is_current_account(p):
                        continue

                    selected_participant = p
                    break

                # If participants are incomplete/self-only, infer peer from message sender ids.
                if selected_participant is None:
                    if incoming_sender_counts:
                        inferred_peer_id, _ = incoming_sender_counts.most_common(1)[0]
                        inferred_peer_name = strip_emojis(sender_name_by_id.get(inferred_peer_id, '')) or 'Twitter User'

                        participant_id = inferred_peer_id
                        participant_name = inferred_peer_name

                # Fallback: if all participants looked like self or metadata was incomplete,
                # choose the first participant to avoid blank names.
                if selected_participant is None and not participant_id and participants:
                    for p in participants:
                        p_id = str(p.get('user_id', p.get('id', ''))).strip()
                        if conv_account_user_id and p_id and p_id == conv_account_user_id:
                            continue

                        p_name = strip_emojis(str(p.get('name', p.get('screen_name', ''))).strip() or '').lower()
                        if account_display_name and p_name and p_name == account_display_name.lower():
                            continue

                        selected_participant = p
                        break

                    if selected_participant is None:
                        selected_participant = participants[0]

                if selected_participant is not None:
                    p_id = str(selected_participant.get('user_id', selected_participant.get('id', ''))).strip()
                    raw_name = selected_participant.get('name', selected_participant.get('screen_name', 'Twitter User'))
                    participant_name = strip_emojis(raw_name) or selected_participant.get('screen_name', 'Twitter User')
                    participant_id = p_id
                    participant_avatar = selected_participant.get('profile_image_url', '')

                # Absolute guardrail: never persist self as conversation participant.
                if participant_id and conv_account_user_id and participant_id == conv_account_user_id:
                    if incoming_sender_counts:
                        fallback_peer_id, _ = incoming_sender_counts.most_common(1)[0]
                        participant_id = fallback_peer_id
                        participant_name = strip_emojis(sender_name_by_id.get(fallback_peer_id, '')) or 'Twitter User'
                        participant_avatar = ''
                    else:
                        for p in participants:
                            fallback_peer_id = str(p.get('user_id', p.get('id', ''))).strip()
                            if not fallback_peer_id or fallback_peer_id == participant_id:
                                continue

                            raw_fallback_name = p.get('name', p.get('screen_name', 'Twitter User'))
                            fallback_name = strip_emojis(raw_fallback_name) or p.get('screen_name', 'Twitter User')
                            if account_display_name and fallback_name.lower() == account_display_name.lower():
                                continue

                            participant_id = fallback_peer_id
                            participant_name = fallback_name
                            participant_avatar = p.get('profile_image_url', '')
                            break

                # Name-based guardrail for older/bad payloads where account id could be wrong.
                if account_display_name and participant_name.lower() == account_display_name.lower():
                    for p in participants:
                        fallback_peer_id = str(p.get('user_id', p.get('id', ''))).strip()
                        raw_fallback_name = p.get('name', p.get('screen_name', 'Twitter User'))
                        fallback_name = strip_emojis(raw_fallback_name) or p.get('screen_name', 'Twitter User')
                        if not fallback_peer_id:
                            continue
                        if conv_account_user_id and fallback_peer_id == conv_account_user_id:
                            continue
                        if fallback_name.lower() == account_display_name.lower():
                            continue

                        participant_id = fallback_peer_id
                        participant_name = fallback_name
                        participant_avatar = p.get('profile_image_url', '')
                        break
                
                # Use Twitter profile image or fallback to generated avatar
                avatar_url = participant_avatar if participant_avatar else f'https://ui-avatars.com/api/?name={participant_name}&background=1DA1F2&color=fff'
                
                # Create or update conversation
                conversation, created = Conversation.objects.update_or_create(
                    account=account,
                    platform_conversation_id=conv_id,
                    defaults={
                        'participant_name': participant_name,
                        'participant_id': participant_id,
                        'participant_avatar_url': avatar_url,
                        'last_message_at': timezone.now(),
                    }
                )
                saved_conversations += 1
                
                # Save messages
                for msg_data in messages:
                    msg_id = msg_data.get('id')
                    if not msg_id:
                        continue
                    
                    text = msg_data.get('text', '') or '[No content]'
                    sender_id = str(msg_data.get('senderId', ''))
                    # Strip emojis from sender name too
                    raw_sender = msg_data.get('senderName', participant_name)
                    sender_name = strip_emojis(raw_sender) or 'User'
                    created_at = msg_data.get('createdAt')
                    
                    # Determine if outgoing
                    is_outgoing = sender_id == account_user_id
                    
                    # Parse datetime
                    from django.utils.dateparse import parse_datetime
                    sent_at = parse_datetime(created_at) if created_at else timezone.now()
                    if not sent_at:
                        sent_at = timezone.now()
                    
                    # Create message if not exists
                    msg, msg_created = Message.objects.get_or_create(
                        conversation=conversation,
                        platform_message_id=str(msg_id),
                        defaults={
                            'content': encrypt(text),
                            'sender_id': sender_id,
                            'sender_name': sender_name if not is_outgoing else 'You',
                            'sent_at': sent_at,
                            'is_outgoing': is_outgoing,
                            'is_read': True,
                        }
                    )
                    
                    if msg_created:
                        saved_messages += 1
                
                # Update conversation last message time
                latest_msg = Message.objects.filter(conversation=conversation).order_by('-sent_at').first()
                if latest_msg:
                    conversation.last_message_at = latest_msg.sent_at
                    conversation.save()
            
            print(f'[twitter-desktop] Synced {saved_conversations} conversations, {saved_messages} new messages for user {user_id}')
            
            return Response({
                'success': True,
                'savedConversations': saved_conversations,
                'savedMessages': saved_messages,
                'message': f'Synced {saved_conversations} conversations with {saved_messages} new messages',
            }, status=status.HTTP_200_OK)
            
        except Exception as e:
            print(f'[twitter-desktop] Sync failed: {e}')
            import traceback
            traceback.print_exc()
            return Response({
                'error': {
                    'code': 'SYNC_FAILED',
                    'message': str(e) or 'Failed to sync Twitter data',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
