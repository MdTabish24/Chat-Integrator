"""
Facebook Messenger adapter using fbchat for cookie-based authentication.

This adapter uses browser cookies (c_user, xs) instead of OAuth
to access Facebook Messenger, which is not available on the free API tier.

Requirements: 6.1, 6.2, 6.3
"""

import json
import time
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from django.utils import timezone
from django.core.cache import cache

from .base import BasePlatformAdapter, PlatformAPIError, RateLimitError
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt, decrypt
from apps.core.services.rate_limiter import (
    RateLimiter,
    RateLimitConfig,
)


# Facebook cookie-based rate limit config (conservative to avoid bans)
FACEBOOK_COOKIE_RATE_LIMIT = RateLimitConfig(
    requests_per_window=2,
    window_seconds=60,
    min_delay_ms=30000,  # 30 seconds minimum between requests
    max_delay_ms=60000,  # 60 seconds maximum (random delay)
    daily_limit=30  # Max 30 messages per day
)


class FacebookCookieAdapter(BasePlatformAdapter):
    """
    Facebook Messenger adapter using fbchat library for cookie-based authentication.
    
    This adapter provides access to Facebook Messenger using browser session cookies,
    bypassing the need for expensive API access.
    
    Requirements: 6.1, 6.2, 6.3
    """
    
    # Rate limiting constants
    FETCH_INTERVAL_SECONDS = 30  # 1 request per 30 seconds for fetching
    SEND_INTERVAL_SECONDS = 60  # 1 message per 60 seconds
    DAILY_MESSAGE_LIMIT = 30  # Max 30 messages per day
    RATE_LIMIT_PAUSE_SECONDS = 900  # 15 minutes pause on rate limit
    
    def __init__(self):
        super().__init__('facebook_cookie')
        # Override rate limit config for cookie-based access
        self.rate_limit_config = FACEBOOK_COOKIE_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=FACEBOOK_COOKIE_RATE_LIMIT)
        self._sessions: Dict[str, Any] = {}  # Cache fbchat sessions per account

    def _get_session_cache_key(self, account_id: str) -> str:
        """Get cache key for fbchat session."""
        return f'facebook:session:{account_id}'
    
    def _get_or_create_session(self, account_id: str) -> Any:
        """
        Get or create a session for the account.
        
        NOTE: fbchat is disabled because it doesn't work with E2EE chats.
        Facebook messages are synced via Desktop App browser automation instead.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            None - fbchat is disabled
        """
        # fbchat is disabled - E2EE chats don't work with it
        # Messages are synced via Desktop App browser automation
        raise PlatformAPIError(
            'Facebook messages are synced via Desktop App. Please use the Desktop App to sync Facebook messages.',
            'facebook',
            status_code=501,  # Not Implemented
            retryable=False
        )
    
    def _invalidate_session(self, account_id: str) -> None:
        """Remove cached session for account."""
        if account_id in self._sessions:
            del self._sessions[account_id]
    
    def store_cookies(
        self,
        user_id: str,
        platform_user_id: str,
        platform_username: str,
        c_user: str,
        xs: str
    ) -> str:
        """
        Store Facebook cookies securely for an account.
        
        Args:
            user_id: The user's ID
            platform_user_id: Facebook user ID
            platform_username: Facebook username/name
            c_user: Facebook c_user cookie
            xs: Facebook xs cookie
            
        Returns:
            The connected account ID
            
        Requirements: 6.1
        """
        # Encrypt cookies as JSON
        cookies = {
            'c_user': c_user,
            'xs': xs,
        }
        encrypted_cookies = encrypt(json.dumps(cookies))
        
        # Create or update connected account
        account, created = ConnectedAccount.objects.update_or_create(
            user_id=user_id,
            platform='facebook_cookie',
            platform_user_id=platform_user_id,
            defaults={
                'platform_username': platform_username,
                'access_token': encrypted_cookies,
                'refresh_token': None,  # No refresh token for cookie auth
                'token_expires_at': None,  # Cookies don't have standard expiry
                'is_active': True,
            }
        )
        
        # Invalidate any cached session
        self._invalidate_session(str(account.id))
        
        return str(account.id)
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get decrypted cookies for the account.
        
        Note: For cookie-based auth, this returns the decrypted cookie JSON.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Decrypted cookie JSON string
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'facebook',
                status_code=404,
                retryable=False
            )
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Cookie-based auth doesn't support token refresh.
        If cookies expire, user must re-authenticate.
        """
        # No-op for cookie-based auth
        pass


    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get Facebook Messenger conversations.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversation dictionaries
            
        Requirements: 6.2
        """
        def _fetch():
            return self._fetch_conversations(account_id)
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    def _fetch_conversations(self, account_id: str) -> List[Dict]:
        """
        Fetch message threads using fbchat.
        
        Requirements: 6.2
        """
        session = self._get_or_create_session(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            from fbchat import Client
            
            # Apply human-like delay before request
            self.apply_human_delay(account_id)
            
            # Create client from session
            client = Client(session=session)
            
            # Get threads (conversations)
            threads = client.fetch_threads(limit=20)
            
            conversations = []
            for thread in threads:
                # Get thread info
                thread_id = thread.id
                
                # Determine participant info based on thread type
                participant_name = 'Unknown'
                participant_id = ''
                participant_avatar = None
                
                if hasattr(thread, 'name') and thread.name:
                    participant_name = thread.name
                elif hasattr(thread, 'nickname') and thread.nickname:
                    participant_name = thread.nickname
                
                if hasattr(thread, 'id'):
                    participant_id = str(thread.id)
                
                if hasattr(thread, 'photo') and thread.photo:
                    participant_avatar = thread.photo
                
                # Get last message time
                last_message_at = None
                if hasattr(thread, 'last_message_timestamp'):
                    last_message_at = datetime.fromtimestamp(
                        thread.last_message_timestamp / 1000
                    ).isoformat()
                
                conv_data = {
                    'id': '',
                    'accountId': account_id,
                    'platformConversationId': thread_id,
                    'participantName': participant_name,
                    'participantId': participant_id,
                    'participantAvatarUrl': participant_avatar,
                    'lastMessageAt': last_message_at,
                    'unreadCount': getattr(thread, 'unread_count', 0) or 0,
                    'createdAt': datetime.now().isoformat(),
                    'updatedAt': datetime.now().isoformat(),
                }
                conversations.append(conv_data)
            
            return conversations
            
        except Exception as e:
            self._handle_error(e, account_id)
    
    def _handle_error(self, e: Exception, account_id: str):
        """Handle Facebook API errors."""
        error_str = str(e).lower()
        
        # Check for rate limit
        if 'rate limit' in error_str or '429' in error_str or 'too many' in error_str:
            self.rate_limiter.pause_requests(
                account_id,
                self.RATE_LIMIT_PAUSE_SECONDS,
                'fetch'
            )
            raise RateLimitError(
                'Facebook rate limit exceeded',
                'facebook',
                self.RATE_LIMIT_PAUSE_SECONDS
            )
        
        # Check for auth errors
        if 'unauthorized' in error_str or '401' in error_str or 'forbidden' in error_str or '403' in error_str:
            self._invalidate_session(account_id)
            raise PlatformAPIError(
                'Facebook cookies expired or invalid',
                'facebook',
                status_code=401,
                retryable=False
            )
        
        # Check for session expired
        if 'session' in error_str and ('expired' in error_str or 'invalid' in error_str):
            self._invalidate_session(account_id)
            raise PlatformAPIError(
                'Facebook session expired. Please refresh cookies.',
                'facebook',
                status_code=401,
                retryable=False
            )
        
        # Check for checkpoint/verification required
        if 'checkpoint' in error_str or 'verification' in error_str:
            self._invalidate_session(account_id)
            raise PlatformAPIError(
                'Facebook requires verification. Please complete verification in browser and update cookies.',
                'facebook',
                status_code=403,
                retryable=False
            )
        
        raise PlatformAPIError(
            f'Failed to fetch Facebook data: {e}',
            'facebook',
            retryable=True,
            original_error=e
        )


    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from Facebook Messenger conversations.
        
        Args:
            account_id: The connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 6.2
        """
        def _fetch():
            return self._fetch_all_messages(account_id, since)
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    def _fetch_all_messages(
        self,
        account_id: str,
        since: Optional[datetime] = None
    ) -> List[Dict]:
        """
        Fetch messages from all conversations.
        
        Requirements: 6.2
        """
        session = self._get_or_create_session(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            from fbchat import Client
            
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Create client from session
            client = Client(session=session)
            
            # Get threads first
            threads = client.fetch_threads(limit=20)
            
            all_messages = []
            for thread in threads:
                thread_id = thread.id
                
                if not thread_id:
                    continue
                
                # Apply delay between thread fetches
                time.sleep(self.rate_limiter.get_random_delay(1000, 3000))
                
                # Get messages for this thread
                try:
                    messages = client.fetch_messages(thread_id=thread_id, limit=20)
                    
                    for msg in messages:
                        # Get message timestamp
                        msg_timestamp = getattr(msg, 'timestamp', None)
                        if msg_timestamp:
                            msg_datetime = datetime.fromtimestamp(msg_timestamp / 1000)
                        else:
                            msg_datetime = datetime.now()
                        
                        # Filter by date if since is provided
                        if since and msg_datetime < since:
                            continue
                        
                        # Get sender info
                        sender_id = str(getattr(msg, 'author', ''))
                        sender_name = sender_id  # Will be resolved later if needed
                        
                        # Check if outgoing
                        is_outgoing = sender_id == str(account.platform_user_id)
                        
                        # Get message content
                        content = getattr(msg, 'text', '') or ''
                        
                        message_data = {
                            'id': '',
                            'conversationId': thread_id,
                            'platformMessageId': str(getattr(msg, 'id', '')),
                            'senderId': sender_id,
                            'senderName': sender_name,
                            'content': content,
                            'messageType': 'text',
                            'mediaUrl': None,
                            'isOutgoing': is_outgoing,
                            'isRead': False,
                            'sentAt': msg_datetime.isoformat(),
                            'createdAt': datetime.now().isoformat(),
                        }
                        
                        # Handle attachments
                        attachments = getattr(msg, 'attachments', [])
                        if attachments:
                            for attachment in attachments:
                                att_type = type(attachment).__name__.lower()
                                if 'image' in att_type or 'photo' in att_type:
                                    message_data['messageType'] = 'image'
                                    if hasattr(attachment, 'url'):
                                        message_data['mediaUrl'] = attachment.url
                                elif 'video' in att_type:
                                    message_data['messageType'] = 'video'
                                    if hasattr(attachment, 'url'):
                                        message_data['mediaUrl'] = attachment.url
                                elif 'audio' in att_type:
                                    message_data['messageType'] = 'audio'
                                    if hasattr(attachment, 'url'):
                                        message_data['mediaUrl'] = attachment.url
                                elif 'file' in att_type:
                                    message_data['messageType'] = 'file'
                                    if hasattr(attachment, 'url'):
                                        message_data['mediaUrl'] = attachment.url
                        
                        # Handle stickers
                        sticker = getattr(msg, 'sticker', None)
                        if sticker:
                            message_data['messageType'] = 'sticker'
                            if hasattr(sticker, 'url'):
                                message_data['mediaUrl'] = sticker.url
                            if not content:
                                message_data['content'] = '[Sticker]'
                        
                        all_messages.append(message_data)
                        
                except Exception as thread_error:
                    print(f'[facebook] Failed to fetch messages for thread {thread_id}: {thread_error}')
                    continue
            
            return all_messages
            
        except Exception as e:
            self._handle_error(e, account_id)


    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a Facebook Messenger message.
        
        Args:
            account_id: The connected account ID
            conversation_id: The thread ID
            content: The message text to send
            
        Returns:
            The sent message dictionary
            
        Requirements: 6.3
        """
        # Check daily limit before attempting to send
        remaining = self.rate_limiter.get_daily_remaining(account_id)
        if remaining is not None and remaining <= 0:
            raise RateLimitError(
                f'Daily message limit ({self.DAILY_MESSAGE_LIMIT}) reached',
                'facebook',
                self._get_seconds_until_midnight()
            )
        
        def _send():
            return self._send_message(account_id, conversation_id, content)
        
        return self.execute_with_retry(_send, account_id, 'send')
    
    def _get_seconds_until_midnight(self) -> int:
        """Calculate seconds until midnight for daily limit reset."""
        now = datetime.now()
        midnight = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return int((midnight - now).total_seconds())
    
    def _send_message(
        self,
        account_id: str,
        conversation_id: str,
        content: str
    ) -> Dict:
        """
        Send a message using fbchat.
        
        Requirements: 6.3
        """
        session = self._get_or_create_session(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            from fbchat import Client, Message
            
            # Apply human-like delay (60 seconds between messages)
            self.apply_human_delay(account_id)
            
            # Create client from session
            client = Client(session=session)
            
            # Send the message
            message = Message(text=content)
            message_id = client.send(message, thread_id=conversation_id)
            
            return {
                'id': '',
                'conversationId': conversation_id,
                'platformMessageId': str(message_id) if message_id else str(int(time.time() * 1000)),
                'senderId': str(account.platform_user_id),
                'senderName': account.platform_username or str(account.platform_user_id),
                'content': content,
                'messageType': 'text',
                'mediaUrl': None,
                'isOutgoing': True,
                'isRead': False,
                'sentAt': datetime.now().isoformat(),
                'deliveredAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
            }
            
        except Exception as e:
            self._handle_error(e, account_id)
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark a message as read.
        
        Args:
            account_id: The connected account ID
            message_id: The message ID to mark as read
        """
        # fbchat has mark_as_read functionality but we'll skip for now
        # to avoid unnecessary API calls
        print(f'[facebook] mark_as_read called for {message_id} (skipped to reduce API calls)')
    
    def verify_cookies(self, account_id: str) -> bool:
        """
        Verify that the stored cookies are still valid.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            True if cookies are valid, False otherwise
        """
        try:
            session = self._get_or_create_session(account_id)
            # Try to get user info to verify session
            from fbchat import Client
            client = Client(session=session)
            # Attempt to fetch threads as a validation
            threads = client.fetch_threads(limit=1)
            return True
        except Exception as e:
            print(f'[facebook] Cookie verification failed: {e}')
            self._invalidate_session(account_id)
            return False
    
    def get_daily_remaining(self, account_id: str) -> int:
        """
        Get remaining daily message count.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Number of messages remaining today
        """
        remaining = self.rate_limiter.get_daily_remaining(account_id)
        return remaining if remaining is not None else self.DAILY_MESSAGE_LIMIT


# Create singleton instance
facebook_cookie_adapter = FacebookCookieAdapter()
