"""
LinkedIn views for cookie-based authentication and message operations.

These views handle:
- Cookie submission for authentication
- Message fetching with rate limiting
- Message sending with rate limiting

Requirements: 4.1, 4.2, 4.3
"""

import json
import re
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils import timezone

from apps.platforms.adapters.linkedin_cookie import linkedin_cookie_adapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt


def strip_emojis(text):
    """Remove emojis and other non-BMP characters from text."""
    if not text:
        return text
    emoji_pattern = re.compile(
        "["
        "\U0001F600-\U0001F64F"
        "\U0001F300-\U0001F5FF"
        "\U0001F680-\U0001F6FF"
        "\U0001F1E0-\U0001F1FF"
        "\U00002702-\U000027B0"
        "\U000024C2-\U0001F251"
        "\U0001F900-\U0001F9FF"
        "\U0001FA00-\U0001FA6F"
        "\U0001FA70-\U0001FAFF"
        "\U00002600-\U000026FF"
        "\U00002700-\U000027BF"
        "\U0001F004-\U0001F0CF"
        "]+", 
        flags=re.UNICODE
    )
    return emoji_pattern.sub('', text).strip() or 'User'


class LinkedInCookieSubmitView(APIView):
    """
    Submit LinkedIn cookies for authentication.
    
    POST /api/platforms/linkedin/cookies
    
    Request body:
    {
        "li_at": "string",
        "JSESSIONID": "string",
        "platform_user_id": "string",  # LinkedIn user URN
        "platform_username": "string"  # LinkedIn name
    }
    
    Requirements: 4.1
    """
    permission_classes = [AllowAny]
    authentication_classes = []  # Skip DRF auth
    
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
            li_at = request.data.get('li_at') or cookies.get('li_at')
            jsessionid = request.data.get('JSESSIONID') or cookies.get('JSESSIONID')
            
            # Platform user info is optional - will use defaults
            platform_user_id = request.data.get('platform_user_id') or f'linkedin_user_{user_id[:8]}'
            platform_username = request.data.get('platform_username') or 'LinkedIn User'
            
            if not li_at or not jsessionid:
                return Response({
                    'error': {
                        'code': 'MISSING_COOKIES',
                        'message': 'Both li_at and JSESSIONID cookies are required',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Store cookies securely
            account_id = linkedin_cookie_adapter.store_cookies(
                user_id=user_id,
                platform_user_id=platform_user_id,
                platform_username=platform_username,
                li_at=li_at,
                jsessionid=jsessionid
            )
            
            # Clear old cached messages with "[No content]" so fresh ones can be fetched
            try:
                from apps.messaging.models import Message
                from apps.conversations.models import Conversation
                from apps.core.utils.crypto import encrypt
                
                account = ConnectedAccount.objects.get(id=account_id)
                conversations = Conversation.objects.filter(account=account)
                
                # Delete messages that have "[No content]" as they're stale
                no_content_encrypted = encrypt('[No content]')
                deleted_count = Message.objects.filter(
                    conversation__in=conversations,
                    content=no_content_encrypted
                ).delete()[0]
                
                if deleted_count > 0:
                    print(f'[linkedin] Cleared {deleted_count} stale "[No content]" messages for account {account_id}')
            except Exception as cleanup_err:
                print(f'[linkedin] Failed to clear stale messages: {cleanup_err}')
                # Don't fail the request if cleanup fails
            
            print(f'[linkedin] Cookies stored for user {user_id}, account {account_id}')
            
            return Response({
                'success': True,
                'accountId': account_id,
                'message': 'LinkedIn cookies stored successfully',
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            print(f'[linkedin] Failed to store cookies: {e}')
            return Response({
                'error': {
                    'code': 'STORAGE_FAILED',
                    'message': str(e) or 'Failed to store LinkedIn cookies',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInVerifyCookiesView(APIView):
    """
    Verify that stored LinkedIn cookies are still valid.
    
    GET /api/platforms/linkedin/verify/:accountId
    
    Requirements: 4.1
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
                    platform='linkedin'
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'LinkedIn account not found',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Verify cookies
            is_valid = linkedin_cookie_adapter.verify_cookies(str(account_id))
            
            if is_valid:
                return Response({
                    'valid': True,
                    'message': 'LinkedIn cookies are valid',
                })
            else:
                # Mark account as inactive
                account.is_active = False
                account.save()
                
                return Response({
                    'valid': False,
                    'message': 'LinkedIn cookies have expired. Please re-authenticate.',
                })
                
        except Exception as e:
            print(f'[linkedin] Cookie verification failed: {e}')
            return Response({
                'error': {
                    'code': 'VERIFICATION_FAILED',
                    'message': str(e) or 'Failed to verify LinkedIn cookies',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInConversationsView(APIView):
    """
    Get LinkedIn message conversations.
    
    GET /api/platforms/linkedin/conversations/:accountId
    
    Requirements: 4.2
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
                    platform='linkedin',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'LinkedIn account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Try to fetch conversations from LinkedIn API, fallback to cached
            try:
                conversations = linkedin_cookie_adapter.get_conversations(str(account_id))
                
                # Save conversations to database for caching
                from apps.conversations.models import Conversation
                from apps.conversations.serializers import ConversationSerializer
                
                for conv_data in conversations:
                    platform_conv_id = conv_data.get('platformConversationId', '')
                    if not platform_conv_id:
                        continue
                    
                    Conversation.objects.update_or_create(
                        account=account,
                        platform_conversation_id=platform_conv_id,
                        defaults={
                            'participant_name': conv_data.get('participantName', 'LinkedIn User'),
                            'participant_id': conv_data.get('participantId', ''),
                            'participant_avatar_url': conv_data.get('participantAvatarUrl') or f"https://ui-avatars.com/api/?name={conv_data.get('participantName', 'U')}&background=0077B5&color=fff",
                            'last_message_at': timezone.now(),
                            'unread_count': conv_data.get('unreadCount', 0),
                        }
                    )
                
                print(f'[linkedin] Saved {len(conversations)} conversations to database')
                
            except Exception as fetch_err:
                print(f'[linkedin] LinkedIn API fetch failed: {fetch_err}, returning cached conversations')
                # Return cached conversations from database
                from apps.conversations.models import Conversation
                from apps.conversations.serializers import ConversationSerializer
                cached_convs = Conversation.objects.filter(account=account).order_by('-last_message_at')
                conversations = ConversationSerializer(cached_convs, many=True).data
            
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
                        'message': 'LinkedIn rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,  # 15 minutes
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Check for auth errors
            if 'unauthorized' in error_str or 'expired' in error_str or 'forbidden' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'LinkedIn cookies have expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[linkedin] Failed to fetch conversations: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch LinkedIn conversations',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInMessagesView(APIView):
    """
    Get LinkedIn messages.
    
    GET /api/platforms/linkedin/messages/:accountId
    Query params:
    - since: ISO datetime to fetch messages since (optional)
    
    Requirements: 4.2
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
                    platform='linkedin',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'LinkedIn account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Parse since parameter
            since = None
            if since_str:
                from django.utils.dateparse import parse_datetime
                since = parse_datetime(since_str)
            
            # Fetch messages
            messages = linkedin_cookie_adapter.fetch_messages(str(account_id), since)
            
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
                        'message': 'LinkedIn rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': 900,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'expired' in error_str or 'forbidden' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'LinkedIn cookies have expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[linkedin] Failed to fetch messages: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch LinkedIn messages',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInSendMessageView(APIView):
    """
    Send a LinkedIn message.
    
    POST /api/platforms/linkedin/send/:accountId
    
    Request body:
    {
        "conversation_id": "string",  # LinkedIn conversation ID
        "content": "string"           # Message text
    }
    
    Requirements: 4.3
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
                    platform='linkedin',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'LinkedIn account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Check daily limit
            remaining = linkedin_cookie_adapter.get_daily_remaining(str(account_id))
            if remaining <= 0:
                return Response({
                    'error': {
                        'code': 'DAILY_LIMIT_REACHED',
                        'message': 'Daily message limit (10) reached. Try again tomorrow.',
                        'retryable': False,
                        'dailyLimit': 10,
                        'remaining': 0,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Send message
            sent_message = linkedin_cookie_adapter.send_message(
                account_id=str(account_id),
                conversation_id=conversation_id,
                content=content.strip()
            )
            
            # Get updated remaining count
            new_remaining = linkedin_cookie_adapter.get_daily_remaining(str(account_id))
            
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
                        'message': 'LinkedIn rate limit exceeded. Please try again later.',
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
            
            if 'unauthorized' in error_str or 'expired' in error_str or 'forbidden' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'LinkedIn cookies have expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[linkedin] Failed to send message: {e}')
            return Response({
                'error': {
                    'code': 'SEND_FAILED',
                    'message': str(e) or 'Failed to send LinkedIn message',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInRateLimitStatusView(APIView):
    """
    Get rate limit status for a LinkedIn account.
    
    GET /api/platforms/linkedin/rate-limit/:accountId
    
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
                    platform='linkedin',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'LinkedIn account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get rate limit info
            daily_remaining = linkedin_cookie_adapter.get_daily_remaining(str(account_id))
            
            # Get wait time if rate limited
            wait_time_fetch = linkedin_cookie_adapter.rate_limiter.wait_if_needed(
                str(account_id),
                linkedin_cookie_adapter.rate_limit_config,
                'fetch'
            )
            wait_time_send = linkedin_cookie_adapter.rate_limiter.wait_if_needed(
                str(account_id),
                linkedin_cookie_adapter.rate_limit_config,
                'send'
            )
            
            return Response({
                'dailyLimit': linkedin_cookie_adapter.DAILY_MESSAGE_LIMIT,
                'dailyRemaining': daily_remaining,
                'fetchRateLimited': wait_time_fetch > 0,
                'fetchWaitSeconds': int(wait_time_fetch),
                'sendRateLimited': wait_time_send > 0,
                'sendWaitSeconds': int(wait_time_send),
            })
            
        except Exception as e:
            print(f'[linkedin] Failed to get rate limit status: {e}')
            return Response({
                'error': {
                    'code': 'STATUS_FAILED',
                    'message': str(e) or 'Failed to get rate limit status',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInConversationMessagesView(APIView):
    """
    Get messages for a specific LinkedIn conversation.
    
    GET /api/platforms/linkedin/conversations/:accountId/:conversationId/messages
    """
    permission_classes = [AllowAny]
    
    def get(self, request, account_id, conversation_id):
        print(f'[linkedin-view] ========== LinkedInConversationMessagesView ==========')
        print(f'[linkedin-view] account_id: {account_id}, conversation_id: {conversation_id}')
        
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                print(f'[linkedin-view] ERROR: User not authenticated')
                return Response({
                    'error': {'code': 'UNAUTHORIZED', 'message': 'User not authenticated', 'retryable': False}
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            print(f'[linkedin-view] user_id: {user_id}')
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    platform='linkedin',
                    is_active=True
                )
                print(f'[linkedin-view] Account found: {account.platform_username}')
            except ConnectedAccount.DoesNotExist:
                print(f'[linkedin-view] ERROR: Account not found')
                return Response({
                    'error': {'code': 'ACCOUNT_NOT_FOUND', 'message': 'LinkedIn account not found or inactive', 'retryable': False}
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch messages from LinkedIn API
            try:
                print(f'[linkedin-view] Calling linkedin_cookie_adapter.get_conversation_messages...')
                messages = linkedin_cookie_adapter.get_conversation_messages(str(account_id), conversation_id)
                print(f'[linkedin-view] Got {len(messages)} messages from adapter')
                
                # Also save to database for caching (only if we got actual content)
                from apps.conversations.models import Conversation
                from apps.messaging.models import Message
                from apps.core.utils.crypto import encrypt, decrypt
                from django.utils.dateparse import parse_datetime
                
                try:
                    conversation = Conversation.objects.get(
                        account=account,
                        platform_conversation_id=conversation_id
                    )
                    
                    # First, delete any stale "[No content]" messages for this conversation
                    # This ensures fresh messages replace the placeholders
                    stale_messages = Message.objects.filter(conversation=conversation)
                    for stale_msg in stale_messages:
                        try:
                            decrypted = decrypt(stale_msg.content)
                            if decrypted == '[No content]':
                                stale_msg.delete()
                        except:
                            pass  # Skip if decryption fails
                    
                    for msg_data in messages:
                        content = msg_data.get('content', '')
                        # Only save if we have real content (not placeholder)
                        if content and content not in ['[No content]', '']:
                            sent_at = parse_datetime(msg_data.get('sentAt')) or timezone.now()
                            Message.objects.update_or_create(
                                conversation=conversation,
                                platform_message_id=msg_data.get('platformMessageId', ''),
                                defaults={
                                    'content': encrypt(content),
                                    'sender_id': msg_data.get('senderId', ''),
                                    'sender_name': msg_data.get('senderName', 'Unknown'),
                                    'sent_at': sent_at,
                                    'is_outgoing': msg_data.get('isOutgoing', False),
                                    'is_read': True,
                                }
                            )
                except Conversation.DoesNotExist:
                    pass  # Conversation not in DB yet, skip caching
                
                return Response({
                    'messages': messages,
                    'count': len(messages),
                })
                
            except Exception as fetch_err:
                error_msg = str(fetch_err).lower()
                print(f'[linkedin-view] *** FETCH ERROR ***')
                print(f'[linkedin-view] Error type: {type(fetch_err).__name__}')
                print(f'[linkedin-view] Error message: {fetch_err}')
                import traceback
                print(f'[linkedin-view] Traceback: {traceback.format_exc()}')
                
                # If cookies are expired, return error - don't fallback to cached stale data
                if 'expired' in error_msg or 'invalid' in error_msg or 'unauthorized' in error_msg or '401' in error_msg or '403' in error_msg:
                    return Response({
                        'error': {
                            'code': 'COOKIES_EXPIRED',
                            'message': 'LinkedIn cookies have expired. Please go to Manage Accounts and re-connect LinkedIn with fresh cookies.',
                            'retryable': False,
                        },
                        'messages': [],
                        'count': 0,
                        'cookiesExpired': True,
                    }, status=status.HTTP_401_UNAUTHORIZED)
                
                # For other errors, try cached messages from database
                from apps.conversations.models import Conversation
                from apps.messaging.models import Message
                from apps.messaging.serializers import MessageSerializer
                
                try:
                    conversation = Conversation.objects.get(
                        account=account,
                        platform_conversation_id=conversation_id
                    )
                    cached_msgs = Message.objects.filter(conversation=conversation).order_by('sent_at')
                    messages = MessageSerializer(cached_msgs, many=True).data
                    
                    return Response({
                        'messages': messages,
                        'count': len(messages),
                        'cached': True,
                    })
                except Conversation.DoesNotExist:
                    return Response({
                        'messages': [],
                        'count': 0,
                        'error': str(fetch_err),
                    })
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str:
                return Response({
                    'error': {'code': 'RATE_LIMITED', 'message': 'LinkedIn rate limit exceeded', 'retryable': True, 'retryAfter': 900}
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'expired' in error_str or 'forbidden' in error_str:
                return Response({
                    'error': {'code': 'AUTH_EXPIRED', 'message': 'LinkedIn cookies have expired', 'retryable': False}
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[linkedin] Failed to fetch conversation messages: {e}')
            return Response({
                'error': {'code': 'FETCH_FAILED', 'message': str(e), 'retryable': True}
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class LinkedInDesktopSyncView(APIView):
    """
    Receive LinkedIn message data from the desktop app.
    
    POST /api/platforms/linkedin/sync-from-desktop
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {'code': 'UNAUTHORIZED', 'message': 'User not authenticated', 'retryable': False}
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            conversations_data = request.data.get('conversations', [])
            
            from apps.oauth.models import ConnectedAccount
            from apps.conversations.models import Conversation
            from apps.messaging.models import Message
            from apps.core.utils.crypto import encrypt
            from django.utils import timezone
            
            # Get or create LinkedIn account
            cookies = request.data.get('cookies', {})
            li_at = cookies.get('li_at', '')
            jsessionid = cookies.get('JSESSIONID', '')
            
            try:
                account = ConnectedAccount.objects.get(user_id=user_id, platform='linkedin', is_active=True)
            except ConnectedAccount.DoesNotExist:
                # If cookies provided, create account automatically
                if li_at and jsessionid:
                    platform_user_id = 'desktop_user'
                    platform_username = 'LinkedIn User'
                    
                    # Try to extract user info from conversations
                    for conv in conversations_data:
                        participants = conv.get('participants', [])
                        for p in participants:
                            p_id = str(p.get('id', ''))
                            if p_id:
                                platform_user_id = p_id
                                platform_username = p.get('name', 'LinkedIn User')
                                break
                        if platform_user_id != 'desktop_user':
                            break
                    
                    account_id = linkedin_cookie_adapter.store_cookies(
                        user_id=user_id,
                        platform_user_id=platform_user_id,
                        platform_username=platform_username,
                        li_at=li_at,
                        jsessionid=jsessionid
                    )
                    account = ConnectedAccount.objects.get(id=account_id)
                    print(f'[linkedin-desktop] Auto-created account {account_id} for user {user_id}')
                else:
                    return Response({
                        'error': {'code': 'ACCOUNT_NOT_FOUND', 'message': 'No active LinkedIn account found. Please submit cookies with sync request.', 'retryable': False}
                    }, status=status.HTTP_404_NOT_FOUND)
            
            saved_conversations = 0
            saved_messages = 0
            
            # Get list of valid conversation IDs from sync data
            valid_conv_ids = [conv.get('id') for conv in conversations_data if conv.get('id')]
            
            # Remove old conversations that no longer exist (ghost data cleanup)
            if valid_conv_ids:
                from apps.conversations.models import Conversation
                deleted_count = Conversation.objects.filter(
                    account=account
                ).exclude(
                    platform_conversation_id__in=valid_conv_ids
                ).delete()[0]
                if deleted_count > 0:
                    print(f'[linkedin-desktop] Cleaned up {deleted_count} old conversations')
            
            for conv_data in conversations_data:
                conv_id = conv_data.get('id')
                if not conv_id:
                    continue
                
                participants = conv_data.get('participants', [])
                raw_name = participants[0].get('name', 'LinkedIn User') if participants else 'LinkedIn User'
                participant_name = strip_emojis(raw_name) or 'LinkedIn User'
                participant_id = participants[0].get('id', '') if participants else ''
                participant_avatar = participants[0].get('avatar', '') if participants else ''
                
                # Use provided avatar or generate one
                avatar_url = participant_avatar if participant_avatar else f'https://ui-avatars.com/api/?name={participant_name}&background=0077B5&color=fff'
                
                conversation, _ = Conversation.objects.update_or_create(
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
                
                for msg_data in conv_data.get('messages', []):
                    msg_id = msg_data.get('id')
                    if not msg_id:
                        continue
                    
                    from django.utils.dateparse import parse_datetime
                    sent_at = parse_datetime(msg_data.get('createdAt')) or timezone.now()
                    is_outgoing = msg_data.get('senderId') == str(account.platform_user_id)
                    
                    # Skip empty messages
                    msg_text = msg_data.get('text', '') or '[No content]'
                    
                    _, created = Message.objects.get_or_create(
                        conversation=conversation,
                        platform_message_id=str(msg_id),
                        defaults={
                            'content': encrypt(msg_text),
                            'sender_id': msg_data.get('senderId', ''),
                            'sender_name': participant_name if not is_outgoing else 'You',
                            'sent_at': sent_at,
                            'is_outgoing': is_outgoing,
                            'is_read': True,
                        }
                    )
                    if created:
                        saved_messages += 1
            
            print(f'[linkedin-desktop] Synced {saved_conversations} conversations, {saved_messages} messages')
            return Response({'success': True, 'savedConversations': saved_conversations, 'savedMessages': saved_messages})
            
        except Exception as e:
            print(f'[linkedin-desktop] Sync failed: {e}')
            return Response({'error': {'code': 'SYNC_FAILED', 'message': str(e), 'retryable': True}}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
