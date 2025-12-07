"""
Discord views for token-based authentication and DM operations.

These views handle:
- Token submission for authentication
- DM syncing to database
- DM fetching with rate limiting
- DM sending with rate limiting

Requirements: 9.1, 9.2, 9.3
"""

from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny

from apps.platforms.adapters.discord import discord_adapter
from apps.oauth.models import ConnectedAccount
from apps.conversations.models import Conversation
from apps.messaging.models import Message
from apps.core.utils.crypto import encrypt


class DiscordTokenSubmitView(APIView):
    """
    Submit Discord token for authentication.
    
    POST /api/platforms/discord/token
    
    Request body:
    {
        "token": "string",           # Discord user/bot token
        "platform_user_id": "string",  # Discord user ID
        "platform_username": "string"  # Discord username
    }
    
    Requirements: 9.1
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
            token = request.data.get('token')
            platform_user_id = request.data.get('platform_user_id')
            platform_username = request.data.get('platform_username')

            if not token:
                return Response({
                    'error': {
                        'code': 'MISSING_TOKEN',
                        'message': 'Discord token is required',
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
            
            # Store token securely
            account_id = discord_adapter.store_token(
                user_id=user_id,
                platform_user_id=platform_user_id,
                platform_username=platform_username,
                token=token
            )
            
            print(f'[discord] Token stored for user {user_id}, account {account_id}')
            
            return Response({
                'success': True,
                'accountId': account_id,
                'message': 'Discord token stored successfully',
            }, status=status.HTTP_201_CREATED)
            
        except Exception as e:
            print(f'[discord] Failed to store token: {e}')
            return Response({
                'error': {
                    'code': 'STORAGE_FAILED',
                    'message': str(e) or 'Failed to store Discord token',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordVerifyTokenView(APIView):
    """
    Verify that stored Discord token is still valid.
    
    GET /api/platforms/discord/verify/:accountId
    
    Requirements: 9.1
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
                    platform='discord'
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Verify token
            is_valid = discord_adapter.verify_token(str(account_id))
            
            if is_valid:
                return Response({
                    'valid': True,
                    'message': 'Discord token is valid',
                })
            else:
                # Mark account as inactive
                account.is_active = False
                account.save()
                
                return Response({
                    'valid': False,
                    'message': 'Discord token is invalid or expired. Please re-authenticate.',
                })
                
        except Exception as e:
            print(f'[discord] Token verification failed: {e}')
            return Response({
                'error': {
                    'code': 'VERIFICATION_FAILED',
                    'message': str(e) or 'Failed to verify Discord token',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordSyncView(APIView):
    """
    Sync Discord DM conversations and messages to database.
    
    POST /api/platforms/discord/sync/:accountId
    
    This fetches conversations and messages from Discord API and saves them
    to the database so they can be displayed in the dashboard.
    
    Requirements: 9.2
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
                    platform='discord',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            print(f'[discord] Starting sync for account {account_id}')
            
            # Fetch conversations from Discord API
            discord_conversations = discord_adapter.get_conversations(str(account_id))
            
            # Fetch ALL messages once (more efficient than fetching per conversation)
            all_messages = discord_adapter.fetch_messages(str(account_id), since=None)
            print(f'[discord] Fetched {len(all_messages)} total messages from Discord API')
            
            # Group messages by conversation ID
            messages_by_conv = {}
            for msg in all_messages:
                conv_id = msg.get('platformConversationId')
                if conv_id:
                    if conv_id not in messages_by_conv:
                        messages_by_conv[conv_id] = []
                    messages_by_conv[conv_id].append(msg)
            
            saved_conversations = 0
            saved_messages = 0
            
            for conv_data in discord_conversations:
                platform_conv_id = conv_data['platformConversationId']
                
                # Create or update conversation in database
                conversation, created = Conversation.objects.update_or_create(
                    account=account,
                    platform_conversation_id=platform_conv_id,
                    defaults={
                        'participant_name': conv_data.get('participantName', 'Unknown'),
                        'participant_id': conv_data.get('participantId', ''),
                        'participant_avatar_url': conv_data.get('participantAvatarUrl'),
                        'last_message_at': timezone.now(),
                        'unread_count': 0,
                    }
                )
                saved_conversations += 1
                
                # Get messages for this conversation from the grouped dict
                conv_messages = messages_by_conv.get(platform_conv_id, [])
                
                for msg_data in conv_messages:
                    # Check if message already exists
                    platform_msg_id = msg_data.get('platformMessageId', '')
                    if not platform_msg_id:
                        continue
                        
                    existing = Message.objects.filter(
                        conversation=conversation,
                        platform_message_id=platform_msg_id
                    ).first()
                    
                    if not existing:
                        # Parse sent_at timestamp
                        sent_at = msg_data.get('sentAt')
                        if isinstance(sent_at, str):
                            from django.utils.dateparse import parse_datetime
                            sent_at = parse_datetime(sent_at) or timezone.now()
                        else:
                            sent_at = timezone.now()
                        
                        # Create new message
                        Message.objects.create(
                            conversation=conversation,
                            platform_message_id=platform_msg_id,
                            sender_id=msg_data.get('senderId', ''),
                            sender_name=msg_data.get('senderName', 'Unknown'),
                            content=encrypt(msg_data.get('content', '')),
                            message_type=msg_data.get('messageType', 'text'),
                            media_url=encrypt(msg_data.get('mediaUrl')) if msg_data.get('mediaUrl') else None,
                            is_outgoing=msg_data.get('isOutgoing', False),
                            is_read=msg_data.get('isRead', False),
                            sent_at=sent_at,
                        )
                        saved_messages += 1
                        
                        # Update conversation last_message_at
                        if sent_at > (conversation.last_message_at or timezone.now() - timezone.timedelta(days=365)):
                            conversation.last_message_at = sent_at
                            conversation.save()
            
            print(f'[discord] Sync completed: {saved_conversations} conversations, {saved_messages} new messages')
            
            return Response({
                'success': True,
                'conversationsCount': saved_conversations,
                'messagesCount': saved_messages,
                'message': f'Synced {saved_conversations} conversations with {saved_messages} new messages',
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str:
                retry_after = getattr(e, 'retry_after', 5)
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Discord rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': retry_after,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'invalid' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Discord token is invalid or expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[discord] Sync failed: {e}')
            import traceback
            traceback.print_exc()
            return Response({
                'error': {
                    'code': 'SYNC_FAILED',
                    'message': str(e) or 'Failed to sync Discord conversations',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordConversationsView(APIView):
    """
    Get Discord DM conversations (also syncs to database).
    
    GET /api/platforms/discord/conversations/:accountId
    
    Requirements: 9.2
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
                    platform='discord',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Fetch conversations from Discord API and sync to database
            print(f'[discord] Fetching and syncing conversations for account {account_id}')
            discord_conversations = discord_adapter.get_conversations(str(account_id))
            
            synced_count = 0
            for conv_data in discord_conversations:
                # Create or update conversation in database
                Conversation.objects.update_or_create(
                    account=account,
                    platform_conversation_id=conv_data['platformConversationId'],
                    defaults={
                        'participant_name': conv_data.get('participantName', 'Unknown'),
                        'participant_id': conv_data.get('participantId', ''),
                        'participant_avatar_url': conv_data.get('participantAvatarUrl'),
                        'last_message_at': timezone.now(),
                        'unread_count': 0,
                    }
                )
                synced_count += 1
            
            print(f'[discord] Synced {synced_count} conversations to database')
            
            return Response({
                'conversations': discord_conversations,
                'count': len(discord_conversations),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            # Check for rate limit
            if 'rate limit' in error_str:
                retry_after = getattr(e, 'retry_after', 5)
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Discord rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': retry_after,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            # Check for auth errors
            if 'unauthorized' in error_str or 'invalid' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Discord token is invalid or expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[discord] Failed to fetch conversations: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Discord conversations',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordMessagesView(APIView):
    """
    Get Discord DM messages (all conversations).
    
    GET /api/platforms/discord/messages/:accountId
    Query params:
    - since: ISO datetime to fetch messages since (optional)
    
    Requirements: 9.2
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
                    platform='discord',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Parse since parameter
            since = None
            if since_str:
                from django.utils.dateparse import parse_datetime
                since = parse_datetime(since_str)
            
            # Fetch messages
            messages = discord_adapter.fetch_messages(str(account_id), since)
            
            return Response({
                'messages': messages,
                'count': len(messages),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str:
                retry_after = getattr(e, 'retry_after', 5)
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Discord rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': retry_after,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'invalid' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Discord token is invalid or expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[discord] Failed to fetch messages: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Discord messages',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordConversationMessagesView(APIView):
    """
    Get Discord DM messages for a specific conversation (channel).
    
    GET /api/platforms/discord/conversations/:accountId/:conversationId/messages
    
    This fetches fresh messages directly from Discord API for a specific DM channel.
    
    Requirements: 9.2
    """
    permission_classes = [AllowAny]
    
    def get(self, request, account_id, conversation_id):
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
                    platform='discord',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            print(f'[discord] Fetching messages for conversation {conversation_id}')
            
            # Fetch all messages and filter for this conversation
            all_messages = discord_adapter.fetch_messages(str(account_id), since=None)
            
            # Filter for this specific conversation
            conv_messages = [
                m for m in all_messages
                if m.get('platformConversationId') == conversation_id
            ]
            
            # Sort by timestamp
            conv_messages.sort(key=lambda m: m.get('sentAt', ''), reverse=False)
            
            print(f'[discord] Found {len(conv_messages)} messages for conversation {conversation_id}')
            
            return Response({
                'messages': conv_messages,
                'count': len(conv_messages),
            })
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str:
                retry_after = getattr(e, 'retry_after', 5)
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': 'Discord rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'retryAfter': retry_after,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'invalid' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Discord token is invalid or expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[discord] Failed to fetch conversation messages: {e}')
            import traceback
            traceback.print_exc()
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': str(e) or 'Failed to fetch Discord messages',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordSendMessageView(APIView):
    """
    Send a Discord DM.
    
    POST /api/platforms/discord/send/:accountId
    
    Request body:
    {
        "conversation_id": "string",  # Discord DM channel ID
        "content": "string"           # Message text
    }
    
    Requirements: 9.3
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
                    platform='discord',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Send message
            sent_message = discord_adapter.send_message(
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
            
            if 'rate limit' in error_str:
                retry_after = getattr(e, 'retry_after', 5)
                return Response({
                    'error': {
                        'code': 'RATE_LIMITED',
                        'message': f'Discord rate limit exceeded. Retry after {retry_after}s.',
                        'retryable': True,
                        'retryAfter': retry_after,
                    }
                }, status=status.HTTP_429_TOO_MANY_REQUESTS)
            
            if 'unauthorized' in error_str or 'invalid' in error_str or 'expired' in error_str:
                return Response({
                    'error': {
                        'code': 'AUTH_EXPIRED',
                        'message': 'Discord token is invalid or expired. Please re-authenticate.',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            print(f'[discord] Failed to send message: {e}')
            return Response({
                'error': {
                    'code': 'SEND_FAILED',
                    'message': str(e) or 'Failed to send Discord message',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DiscordRateLimitStatusView(APIView):
    """
    Get rate limit status for a Discord account.
    
    GET /api/platforms/discord/rate-limit/:accountId
    
    Returns current rate limit status including:
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
                    platform='discord',
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Discord account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            # Get rate limit info
            rate_limit_status = discord_adapter.get_rate_limit_status(str(account_id))
            
            return Response(rate_limit_status)
            
        except Exception as e:
            print(f'[discord] Failed to get rate limit status: {e}')
            return Response({
                'error': {
                    'code': 'STATUS_FAILED',
                    'message': str(e) or 'Failed to get rate limit status',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
