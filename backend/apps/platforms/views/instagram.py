"""
Instagram views for session-based authentication and DM operations.

These views handle:
- Login/session submission for authentication
- DM fetching with rate limiting
- DM sending with rate limiting

Requirements: 5.1, 5.2, 5.3
"""

import json
import re
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from django.utils import timezone

from apps.platforms.adapters.instagram_session import instagram_session_adapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt


def strip_emojis(text):
    """
    Remove emojis and other non-BMP characters from text.
    MySQL with utf8 charset can't handle 4-byte Unicode characters.
    """
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
        print(f'[instagram-login] ========== LOGIN REQUEST RECEIVED ==========')
        
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                print(f'[instagram-login] ERROR: No JWT token')
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)

            user_id = request.user_jwt['user_id']
            print(f'[instagram-login] User ID: {user_id}')
            
            # Validate required fields
            username = request.data.get('username')
            password = request.data.get('password')
            platform_username = request.data.get('platform_username', username)
            platform_user_id = request.data.get('platform_user_id')
            sessionid = request.data.get('sessionid')
            
            print(f'[instagram-login] Instagram username: {username}')
            print(f'[instagram-login] Password provided: {"YES" if password else "NO"}')
            print(f'[instagram-login] SessionID provided: {"YES" if sessionid else "NO"}')
            
            if not username or not password:
                print(f'[instagram-login] ERROR: Missing credentials')
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
            print(f'[instagram-login] Storing session...')
            account_id = instagram_session_adapter.store_session(
                user_id=user_id,
                platform_user_id=platform_user_id,
                platform_username=platform_username,
                username=username,
                password=password,
                sessionid=sessionid
            )
            print(f'[instagram-login] Session stored, account_id: {account_id}')
            
            # Try to verify the session and get actual user ID
            print(f'[instagram-login] Attempting to verify session...')
            try:
                if instagram_session_adapter.verify_session(account_id):
                    print(f'[instagram-login] Session verified! Getting client...')
                    # Update with actual user ID if we can get it
                    client = instagram_session_adapter._get_or_create_client(account_id)
                    print(f'[instagram-login] Getting account_info...')
                    user_info = client.account_info()
                    if user_info:
                        print(f'[instagram-login] Got user info: pk={user_info.pk}, username={user_info.username}')
                        account = ConnectedAccount.objects.get(id=account_id)
                        account.platform_user_id = str(user_info.pk)
                        account.platform_username = user_info.username
                        account.save()
                        print(f'[instagram-login] Account updated with real user info')
                else:
                    print(f'[instagram-login] Session verification returned False')
            except Exception as verify_error:
                print(f'[instagram-login] Session verification failed:')
                print(f'[instagram-login]   Type: {type(verify_error).__name__}')
                print(f'[instagram-login]   Error: {verify_error}')
                import traceback
                traceback.print_exc()
            
            print(f'[instagram-login] SUCCESS! Session stored for user {user_id}, account {account_id}')
            
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
    Get Instagram DM conversations (inbox threads) and sync to database.
    
    GET /api/platforms/instagram/conversations/:accountId
    
    This endpoint:
    1. Fetches conversations from Instagram API
    2. Saves them to database for caching
    3. Returns the conversations
    
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
            
            # Fetch conversations from Instagram API
            print(f'[instagram-view] Starting conversation fetch for account: {account_id}')
            print(f'[instagram-view] Account username: {account.platform_username}')
            
            try:
                print(f'[instagram-view] Calling instagram_session_adapter.get_conversations()...')
                conversations = instagram_session_adapter.get_conversations(str(account_id))
                print(f'[instagram-view] SUCCESS! Got {len(conversations) if conversations else 0} conversations')
            except Exception as fetch_error:
                error_str = str(fetch_error).lower()
                error_type = type(fetch_error).__name__
                
                print(f'[instagram-view] ERROR fetching conversations:')
                print(f'[instagram-view]   Type: {error_type}')
                print(f'[instagram-view]   Message: {fetch_error}')
                print(f'[instagram-view]   Full repr: {repr(fetch_error)}')
                
                import traceback
                print(f'[instagram-view]   Traceback:')
                traceback.print_exc()
                
                # Check for challenge/verification required
                if 'challenge' in error_str or 'checkpoint' in error_str:
                    print(f'[instagram-view] Challenge/checkpoint detected')
                    return Response({
                        'error': {
                            'code': 'CHALLENGE_REQUIRED',
                            'message': f'Instagram requires verification. Please complete verification on Instagram app, then reconnect.',
                            'retryable': False,
                        },
                        'conversations': [],
                        'count': 0,
                    }, status=status.HTTP_200_OK)  # Return 200 to not trigger logout
                
                # Check for login required
                if 'login' in error_str or 'unauthorized' in error_str or 'authenticate' in error_str:
                    print(f'[instagram-view] Auth error detected')
                    return Response({
                        'error': {
                            'code': 'AUTH_EXPIRED',
                            'message': f'Instagram session expired. Please disconnect and reconnect your account.',
                            'retryable': False,
                        },
                        'conversations': [],
                        'count': 0,
                    }, status=status.HTTP_200_OK)  # Return 200 to not trigger logout
                
                # Check for 2FA
                if '2fa' in error_str or 'two_factor' in error_str:
                    print(f'[instagram-view] 2FA detected')
                    return Response({
                        'error': {
                            'code': '2FA_REQUIRED',
                            'message': f'Instagram requires 2FA. Please disable 2FA temporarily on Instagram.',
                            'retryable': False,
                        },
                        'conversations': [],
                        'count': 0,
                    }, status=status.HTTP_200_OK)  # Return 200 to not trigger logout
                
                # Check for 572 error (Instagram blocking server login)
                if '572' in str(fetch_error):
                    print(f'[instagram-view] Error 572 - Instagram blocking server login')
                    return Response({
                        'error': {
                            'code': 'INSTAGRAM_BLOCKED',
                            'message': 'Instagram is blocking server-side login. This is a known limitation. Please try again later or use the Desktop App for Instagram.',
                            'retryable': False,
                        },
                        'conversations': [],  # Return empty list instead of error
                        'count': 0,
                    }, status=status.HTTP_200_OK)  # Return 200 to not trigger logout
                
                # Return the actual error for debugging (but as 200 to not trigger auth refresh)
                print(f'[instagram-view] Returning error with 200 status to prevent logout')
                return Response({
                    'error': {
                        'code': 'FETCH_FAILED',
                        'message': f'Instagram error [{error_type}]: {fetch_error}',
                        'retryable': True,
                    },
                    'conversations': [],
                    'count': 0,
                }, status=status.HTTP_200_OK)  # Return 200 to not trigger logout
            
            # Save conversations to database for caching
            from apps.conversations.models import Conversation
            from django.utils.dateparse import parse_datetime
            
            saved_count = 0
            for conv_data in conversations:
                conv_id = conv_data.get('platformConversationId')
                if not conv_id:
                    continue
                
                # Parse last message time
                last_message_at = None
                if conv_data.get('lastMessageAt'):
                    last_message_at = parse_datetime(conv_data['lastMessageAt'])
                if not last_message_at:
                    last_message_at = timezone.now()
                
                # Strip emojis from participant name to avoid MySQL encoding issues
                raw_name = conv_data.get('participantName', 'Instagram User')
                participant_name = strip_emojis(raw_name) or 'Instagram User'
                
                # Create or update conversation in database
                conversation, created = Conversation.objects.update_or_create(
                    account=account,
                    platform_conversation_id=conv_id,
                    defaults={
                        'participant_name': participant_name,
                        'participant_id': conv_data.get('participantId', ''),
                        'participant_avatar_url': conv_data.get('participantAvatarUrl') or f'https://ui-avatars.com/api/?name={participant_name}&background=E1306C&color=fff',
                        'last_message_at': last_message_at,
                        'unread_count': conv_data.get('unreadCount', 0),
                    }
                )
                saved_count += 1
            
            print(f'[instagram] Synced {saved_count} conversations to database')
            
            return Response({
                'conversations': conversations,
                'count': len(conversations),
                'syncedToDb': saved_count,
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
    Queue an Instagram DM for sending via Desktop App.
    
    POST /api/platforms/instagram/send/:accountId
    
    Since Instagram blocks server-side sending, we queue the message
    and the Desktop App (running on user's PC) will send it.
    
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
            from apps.oauth.models import ConnectedAccount
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
            
            # Get the conversation
            from apps.conversations.models import Conversation
            try:
                conversation = Conversation.objects.get(
                    id=conversation_id,
                    account=account
                )
            except Conversation.DoesNotExist:
                # Try by platform_conversation_id
                try:
                    conversation = Conversation.objects.get(
                        platform_conversation_id=conversation_id,
                        account=account
                    )
                except Conversation.DoesNotExist:
                    return Response({
                        'error': {
                            'code': 'CONVERSATION_NOT_FOUND',
                            'message': 'Conversation not found',
                            'retryable': False,
                        }
                    }, status=status.HTTP_404_NOT_FOUND)
            
            # Create pending message for Desktop App to send
            from apps.messaging.models import Message, PendingOutgoingMessage
            import uuid
            
            # Create the pending outgoing message
            pending_msg = PendingOutgoingMessage.objects.create(
                id=uuid.uuid4(),
                user_id=user_id,
                account=account,
                conversation=conversation,
                platform='instagram',
                platform_conversation_id=conversation.platform_conversation_id,
                recipient_id=conversation.participant_id,
                content=content.strip(),
                status='pending'
            )
            
            print(f'[instagram] Queued message {pending_msg.id} for Desktop App to send')
            
            return Response({
                'success': True,
                'message': {
                    'id': str(pending_msg.id),
                    'content': content.strip(),
                    'status': 'pending',
                    'sentVia': 'desktop_app_pending',
                },
                'pendingId': str(pending_msg.id),
                'note': 'Message queued for Desktop App. Make sure Desktop App is running to send Instagram messages.',
            }, status=status.HTTP_202_ACCEPTED)
            
        except Exception as e:
            print(f'[instagram] Failed to queue message: {e}')
            import traceback
            traceback.print_exc()
            return Response({
                'error': {
                    'code': 'QUEUE_FAILED',
                    'message': str(e) or 'Failed to queue message',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramPendingMessagesView(APIView):
    """
    Get pending Instagram messages for Desktop App to send.
    
    GET /api/platforms/instagram/pending
    
    Desktop App polls this endpoint to get messages to send.
    """
    permission_classes = [AllowAny]
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {'code': 'UNAUTHORIZED', 'message': 'User not authenticated', 'retryable': False}
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            from apps.messaging.models import PendingOutgoingMessage
            
            # Get pending messages for this user's Instagram accounts
            pending = PendingOutgoingMessage.objects.filter(
                user_id=user_id,
                platform='instagram',
                status='pending'
            ).order_by('created_at')[:10]  # Max 10 at a time
            
            messages = []
            for msg in pending:
                messages.append({
                    'id': str(msg.id),
                    'accountId': str(msg.account_id),
                    'conversationId': str(msg.conversation_id),
                    'platformConversationId': msg.platform_conversation_id,
                    'recipientId': msg.recipient_id,
                    'content': msg.content,
                    'createdAt': msg.created_at.isoformat(),
                })
            
            return Response({
                'pendingMessages': messages,
                'count': len(messages),
            })
            
        except Exception as e:
            print(f'[instagram] Failed to get pending messages: {e}')
            return Response({
                'error': {'code': 'FETCH_FAILED', 'message': str(e), 'retryable': True}
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramMessageSentView(APIView):
    """
    Mark a pending message as sent (called by Desktop App after sending).
    
    POST /api/platforms/instagram/message-sent
    
    Request body:
    {
        "pending_id": "uuid",
        "success": true/false,
        "platform_message_id": "string",  # If success
        "error": "string"  # If failed
    }
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {'code': 'UNAUTHORIZED', 'message': 'User not authenticated', 'retryable': False}
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            pending_id = request.data.get('pending_id')
            success = request.data.get('success', False)
            platform_message_id = request.data.get('platform_message_id', '')
            error_msg = request.data.get('error', '')
            
            if not pending_id:
                return Response({
                    'error': {'code': 'MISSING_PENDING_ID', 'message': 'pending_id is required', 'retryable': False}
                }, status=status.HTTP_400_BAD_REQUEST)
            
            from apps.messaging.models import PendingOutgoingMessage, Message
            from apps.core.utils.crypto import encrypt
            
            try:
                pending = PendingOutgoingMessage.objects.get(id=pending_id, user_id=user_id)
            except PendingOutgoingMessage.DoesNotExist:
                return Response({
                    'error': {'code': 'NOT_FOUND', 'message': 'Pending message not found', 'retryable': False}
                }, status=status.HTTP_404_NOT_FOUND)
            
            if success:
                # Create the actual message in database
                message = Message.objects.create(
                    conversation=pending.conversation,
                    platform_message_id=platform_message_id or f'desktop_{pending.id}',
                    content=encrypt(pending.content),
                    sender_id=str(pending.account.platform_user_id),
                    sender_name='You',
                    is_outgoing=True,
                    is_read=True,
                    sent_at=timezone.now(),
                )
                
                # Update conversation last message time
                pending.conversation.last_message_at = timezone.now()
                pending.conversation.save()
                
                # Delete the pending message
                pending.delete()
                
                print(f'[instagram] Message {pending_id} sent successfully via Desktop App')
                
                return Response({
                    'success': True,
                    'messageId': str(message.id),
                    'message': 'Message sent successfully',
                })
            else:
                # Mark as failed
                pending.status = 'failed'
                pending.error_message = error_msg
                pending.save()
                
                print(f'[instagram] Message {pending_id} failed: {error_msg}')
                
                return Response({
                    'success': False,
                    'error': error_msg or 'Message sending failed',
                })
            
        except Exception as e:
            print(f'[instagram] Failed to update message status: {e}')
            return Response({
                'error': {'code': 'UPDATE_FAILED', 'message': str(e), 'retryable': True}
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
            
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


class InstagramDesktopSyncView(APIView):
    """
    Receive Instagram DM data from the desktop app.
    
    POST /api/platforms/instagram/sync-from-desktop
    
    Request body:
    {
        "conversations": [...],     # DM conversations from desktop app
        "cookies": {                # Instagram cookies (optional, for auto-creating account)
            "sessionid": "...",
            "csrftoken": "...",
            "ds_user_id": "..."     # Instagram user ID
        }
    }
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
            cookies = request.data.get('cookies', {})
            
            print(f'[instagram-desktop] Sync request from user {user_id}')
            print(f'[instagram-desktop] Conversations count: {len(conversations_data)}')
            print(f'[instagram-desktop] Cookies provided: {bool(cookies)}')
            
            from apps.oauth.models import ConnectedAccount
            from apps.conversations.models import Conversation
            from apps.messaging.models import Message
            from apps.core.utils.crypto import encrypt
            from django.utils import timezone
            
            # Try to find existing account or create new one if cookies provided
            account = None
            try:
                account = ConnectedAccount.objects.get(user_id=user_id, platform='instagram', is_active=True)
                print(f'[instagram-desktop] Found existing account: {account.id}')
            except ConnectedAccount.DoesNotExist:
                # If cookies provided, create new account
                if cookies and cookies.get('sessionid'):
                    print(f'[instagram-desktop] No account found, creating new one from cookies...')
                    
                    # Get user ID from cookies or extract from first conversation
                    platform_user_id = cookies.get('ds_user_id', '')
                    platform_username = 'instagram_user'
                    
                    # Try to get username from conversations
                    if conversations_data and len(conversations_data) > 0:
                        # The user is likely not in participants, but we can use ds_user_id
                        pass
                    
                    # Create encrypted session data (like InstagramLoginView does)
                    session_data = {
                        'sessionid': cookies.get('sessionid', ''),
                        'csrftoken': cookies.get('csrftoken', ''),
                        'ds_user_id': platform_user_id,
                        'from_desktop': True,  # Mark as coming from desktop app
                    }
                    
                    import json
                    encrypted_session = encrypt(json.dumps(session_data))
                    
                    # Create the account
                    account = ConnectedAccount.objects.create(
                        user_id=user_id,
                        platform='instagram',
                        platform_user_id=platform_user_id or f'desktop_{user_id[:8]}',
                        platform_username=platform_username,
                        access_token=encrypted_session,  # Store session data here
                        is_active=True,
                    )
                    print(f'[instagram-desktop] Created new account: {account.id}')
                else:
                    print(f'[instagram-desktop] No account and no cookies - cannot sync')
                    return Response({
                        'error': {'code': 'ACCOUNT_NOT_FOUND', 'message': 'No active Instagram account found. Please login via the desktop app first.', 'retryable': False}
                    }, status=status.HTTP_404_NOT_FOUND)
            
            saved_conversations = 0
            saved_messages = 0
            from django.utils.dateparse import parse_datetime
            
            for conv_data in conversations_data:
                conv_id = conv_data.get('id')
                if not conv_id:
                    continue
                
                participants = conv_data.get('participants', [])
                raw_name = participants[0].get('name', 'Instagram User') if participants else 'Instagram User'
                participant_name = strip_emojis(raw_name) or 'Instagram User'
                participant_id = participants[0].get('id', '') if participants else ''
                
                # Get the ACTUAL last message timestamp from messages
                messages_list = conv_data.get('messages', [])
                last_message_at = None
                
                if messages_list:
                    # Find the most recent message timestamp
                    for msg in messages_list:
                        msg_time = parse_datetime(msg.get('createdAt'))
                        if msg_time:
                            if last_message_at is None or msg_time > last_message_at:
                                last_message_at = msg_time
                
                # Fallback to now if no messages found
                if not last_message_at:
                    last_message_at = timezone.now()
                
                conversation, _ = Conversation.objects.update_or_create(
                    account=account,
                    platform_conversation_id=conv_id,
                    defaults={
                        'participant_name': participant_name,
                        'participant_id': participant_id,
                        'participant_avatar_url': f'https://ui-avatars.com/api/?name={participant_name}&background=E1306C&color=fff',
                        'last_message_at': last_message_at,
                    }
                )
                saved_conversations += 1
                
                for msg_data in messages_list:
                    msg_id = msg_data.get('id')
                    if not msg_id:
                        continue
                    
                    sent_at = parse_datetime(msg_data.get('createdAt')) or timezone.now()
                    is_outgoing = msg_data.get('senderId') == str(account.platform_user_id)
                    
                    _, created = Message.objects.get_or_create(
                        conversation=conversation,
                        platform_message_id=str(msg_id),
                        defaults={
                            'content': encrypt(msg_data.get('text', '')),
                            'sender_id': msg_data.get('senderId', ''),
                            'sender_name': participant_name if not is_outgoing else 'You',
                            'sent_at': sent_at,
                            'is_outgoing': is_outgoing,
                            'is_read': True,
                        }
                    )
                    if created:
                        saved_messages += 1
            
            print(f'[instagram-desktop] Synced {saved_conversations} conversations, {saved_messages} messages')
            return Response({'success': True, 'savedConversations': saved_conversations, 'savedMessages': saved_messages})
            
        except Exception as e:
            print(f'[instagram-desktop] Sync failed: {e}')
            return Response({'error': {'code': 'SYNC_FAILED', 'message': str(e), 'retryable': True}}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
