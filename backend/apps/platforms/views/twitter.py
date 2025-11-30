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
from adrf.views import APIView as AsyncAPIView

from apps.platforms.adapters.twitter_cookie import twitter_cookie_adapter
from apps.oauth.models import ConnectedAccount
from apps.conversations.models import Conversation
from apps.messaging.models import Message
from apps.core.utils.crypto import encrypt


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
            
            # Get user's Twitter account
            try:
                account = ConnectedAccount.objects.get(
                    user_id=user_id,
                    platform='twitter',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'No active Twitter account found. Please connect Twitter first.',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Process and save conversations
            saved_conversations = 0
            saved_messages = 0
            
            for conv_data in conversations_data:
                conv_id = conv_data.get('id')
                if not conv_id:
                    continue
                
                # Get participant info
                participants = conv_data.get('participants', [])
                participant_name = 'Twitter User'
                participant_id = ''
                
                # Find the other participant (not the current user)
                for p in participants:
                    p_id = str(p.get('user_id', p.get('id', '')))
                    if p_id and p_id != str(account.platform_user_id):
                        participant_name = p.get('name', p.get('screen_name', 'Twitter User'))
                        participant_id = p_id
                        break
                
                # Create or update conversation
                conversation, created = Conversation.objects.update_or_create(
                    account=account,
                    platform_conversation_id=conv_id,
                    defaults={
                        'participant_name': participant_name,
                        'participant_id': participant_id,
                        'participant_avatar_url': f'https://ui-avatars.com/api/?name={participant_name}&background=1DA1F2&color=fff',
                        'last_message_at': timezone.now(),
                    }
                )
                saved_conversations += 1
                
                # Save messages
                messages = conv_data.get('messages', [])
                for msg_data in messages:
                    msg_id = msg_data.get('id')
                    if not msg_id:
                        continue
                    
                    text = msg_data.get('text', '')
                    sender_id = str(msg_data.get('senderId', ''))
                    created_at = msg_data.get('createdAt')
                    
                    # Determine if outgoing
                    is_outgoing = sender_id == str(account.platform_user_id)
                    
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
                            'sender_name': participant_name if not is_outgoing else 'You',
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
