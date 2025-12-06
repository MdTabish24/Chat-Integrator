"""
Twitter/X adapter using twikit for cookie-based authentication.

This adapter uses browser cookies (auth_token, ct0) instead of OAuth
to access Twitter DMs, which are not available on the free API tier.

Requirements: 3.1, 3.2, 3.3, 3.4
"""

import json
import time
import asyncio
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from django.utils import timezone
from django.core.cache import cache
from asgiref.sync import sync_to_async

from .base import BasePlatformAdapter, PlatformAPIError, RateLimitError
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt, decrypt
from apps.core.services.rate_limiter import (
    RateLimiter,
    RateLimitConfig,
    PLATFORM_RATE_LIMITS,
)


# Twitter cookie-based rate limit config (fast UX, minimal delay)
TWITTER_COOKIE_RATE_LIMIT = RateLimitConfig(
    requests_per_window=10,
    window_seconds=60,
    min_delay_ms=1000,  # 1 second minimum between requests
    max_delay_ms=3000,  # 3 seconds maximum (random delay)
    daily_limit=100  # Max 100 DMs per day
)


class TwitterCookieAdapter(BasePlatformAdapter):
    """
    Twitter/X adapter using twikit library for cookie-based authentication.
    
    This adapter provides access to Twitter DMs using browser session cookies,
    bypassing the need for expensive API access.
    
    Requirements: 3.1, 3.2, 3.3, 3.4
    """
    
    # Rate limiting constants
    FETCH_INTERVAL_SECONDS = 3  # 1 request per 3 seconds for fetching
    SEND_INTERVAL_SECONDS = 3  # 1 message per 3 seconds
    DAILY_MESSAGE_LIMIT = 100  # Max 100 messages per day
    RATE_LIMIT_PAUSE_SECONDS = 120  # 2 minutes pause on rate limit
    
    def __init__(self):
        super().__init__('twitter')
        # Override rate limit config for cookie-based access
        self.rate_limit_config = TWITTER_COOKIE_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=TWITTER_COOKIE_RATE_LIMIT)
        self._clients: Dict[str, Any] = {}  # Cache twikit clients per account
    
    def _get_client_cache_key(self, account_id: str) -> str:
        """Get cache key for twikit client."""
        return f'twitter:client:{account_id}'
    
    async def _get_or_create_client(self, account_id: str) -> Any:
        """
        Get or create a twikit client for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Authenticated twikit Client instance
            
        Requirements: 3.1
        """
        # Check if we have a cached client
        if account_id in self._clients:
            return self._clients[account_id]
        
        try:
            from twikit import Client
            
            # Get account and decrypt cookies (use sync_to_async for ORM call in async context)
            account = await sync_to_async(ConnectedAccount.objects.get)(id=account_id, is_active=True)
            
            if not account.access_token:
                raise PlatformAPIError(
                    'No cookies stored for this account',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            # Cookies are stored as encrypted JSON in access_token field
            cookies_json = decrypt(account.access_token)
            cookies = json.loads(cookies_json)
            
            # Validate required cookies
            auth_token = cookies.get('auth_token')
            ct0 = cookies.get('ct0')
            
            if not auth_token or not ct0:
                raise PlatformAPIError(
                    'Missing required cookies (auth_token, ct0)',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            # Create twikit client
            try:
                client = Client('en-US')  # Try positional first (older API)
            except TypeError:
                client = Client(language='en-US')  # Try keyword (newer API)
            
            # Set cookies for authentication
            client.set_cookies({
                'auth_token': auth_token,
                'ct0': ct0,
            })
            
            # Cache the client
            self._clients[account_id] = client
            
            return client
            
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'twitter',
                status_code=404,
                retryable=False
            )
        except json.JSONDecodeError:
            raise PlatformAPIError(
                'Invalid cookie format',
                'twitter',
                status_code=400,
                retryable=False
            )
        except ImportError:
            raise PlatformAPIError(
                'twikit library not installed',
                'twitter',
                status_code=500,
                retryable=False
            )
    
    def _invalidate_client(self, account_id: str) -> None:
        """Remove cached client for account."""
        if account_id in self._clients:
            del self._clients[account_id]
    
    async def login_with_credentials(
        self,
        user_id: str,
        username: str,
        password: str,
        email: Optional[str] = None
    ) -> Dict[str, str]:
        """
        Login to Twitter using username/password and store session cookies.
        
        Args:
            user_id: The user's ID
            username: Twitter username (without @)
            password: Twitter password
            email: Email for verification if needed
            
        Returns:
            Dict with accountId and username
            
        Requirements: 3.1
        """
        try:
            from twikit import Client
            
            print(f'[twitter] Attempting login for @{username}')
            
            # Create twikit client
            # Note: twikit 2.4+ uses different constructor
            try:
                client = Client('en-US')  # Try positional first (older API)
            except TypeError:
                client = Client(language='en-US')  # Try keyword (newer API)
            
            # Login with credentials
            await client.login(
                auth_info_1=username,
                auth_info_2=email,  # Used if Twitter asks for email verification
                password=password
            )
            
            # Get user info - use user() method
            user = await client.user()
            platform_user_id = str(user.id)
            platform_username = getattr(user, 'screen_name', None) or getattr(user, 'username', None) or username
            
            print(f'[twitter] Login successful for @{platform_username} (ID: {platform_user_id})')
            
            # Get cookies from the client session
            cookies = client.get_cookies()
            auth_token = cookies.get('auth_token', '')
            ct0 = cookies.get('ct0', '')
            
            if not auth_token or not ct0:
                raise PlatformAPIError(
                    'Failed to get session cookies after login',
                    'twitter',
                    status_code=500,
                    retryable=True
                )
            
            # Store the cookies
            account_id = self.store_cookies(
                user_id=user_id,
                platform_user_id=platform_user_id,
                platform_username=platform_username,
                auth_token=auth_token,
                ct0=ct0
            )
            
            # Cache the client
            self._clients[account_id] = client
            
            return {
                'accountId': account_id,
                'username': platform_username,
            }
            
        except Exception as e:
            error_str = str(e).lower()
            original_error = str(e)
            print(f'[twitter] Login failed: {e}')
            print(f'[twitter] Error type: {type(e).__name__}')
            import traceback
            traceback.print_exc()
            
            # Check for specific twikit errors
            if 'bad_guest_token' in error_str or 'guest token' in error_str:
                raise PlatformAPIError(
                    'Twitter is blocking automated requests. Please try again later.',
                    'twitter',
                    status_code=429,
                    retryable=True
                )
            
            if 'incorrect' in error_str or 'wrong' in error_str:
                raise PlatformAPIError(
                    'Invalid username or password',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            # Only show locked/suspended if it's clearly about the account
            if ('account' in error_str and 'locked' in error_str) or ('account' in error_str and 'suspended' in error_str):
                raise PlatformAPIError(
                    'Account is locked or suspended',
                    'twitter',
                    status_code=403,
                    retryable=False
                )
            
            if 'verification' in error_str or 'challenge' in error_str:
                raise PlatformAPIError(
                    'Twitter requires additional verification. Please try logging in on twitter.com first.',
                    'twitter',
                    status_code=403,
                    retryable=False
                )
            
            if 'arkose' in error_str or 'captcha' in error_str or 'funcaptcha' in error_str:
                raise PlatformAPIError(
                    'Twitter requires CAPTCHA verification. This usually happens with automated logins. Please try the cookie method instead.',
                    'twitter',
                    status_code=403,
                    retryable=False
                )
            
            # Show the actual error for debugging
            raise PlatformAPIError(
                f'Twitter login failed: {original_error}',
                'twitter',
                status_code=500,
                retryable=True,
                original_error=e
            )
    
    def store_cookies(
        self,
        user_id: str,
        platform_user_id: str,
        platform_username: str,
        auth_token: str,
        ct0: str
    ) -> str:
        """
        Store Twitter cookies securely for an account.
        
        Args:
            user_id: The user's ID
            platform_user_id: Twitter user ID
            platform_username: Twitter username
            auth_token: Twitter auth_token cookie
            ct0: Twitter ct0 cookie
            
        Returns:
            The connected account ID
            
        Requirements: 3.1
        """
        # Encrypt cookies as JSON
        cookies = {
            'auth_token': auth_token,
            'ct0': ct0,
        }
        encrypted_cookies = encrypt(json.dumps(cookies))
        
        # Create or update connected account
        account, created = ConnectedAccount.objects.update_or_create(
            user_id=user_id,
            platform='twitter',
            platform_user_id=platform_user_id,
            defaults={
                'platform_username': platform_username,
                'access_token': encrypted_cookies,
                'refresh_token': None,  # No refresh token for cookie auth
                'token_expires_at': None,  # Cookies don't have standard expiry
                'is_active': True,
            }
        )
        
        # Invalidate any cached client
        self._invalidate_client(str(account.id))
        
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
                'twitter',
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
        Get Twitter DM conversations.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversation dictionaries
            
        Requirements: 3.2
        """
        return asyncio.get_event_loop().run_until_complete(
            self._get_conversations_async(account_id)
        )
    
    async def _get_conversations_async(self, account_id: str) -> List[Dict]:
        """
        Async implementation of get_conversations.
        
        Requirements: 3.2
        """
        def _fetch():
            return asyncio.get_event_loop().run_until_complete(
                self._fetch_conversations(account_id)
            )
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    async def _fetch_conversations(self, account_id: str) -> List[Dict]:
        """
        Fetch DM conversations using twikit.
        
        Requirements: 3.2
        """
        client = await self._get_or_create_client(account_id)
        
        try:
            # Apply human-like delay before request
            self.apply_human_delay(account_id)
            
            # Get DM inbox
            inbox = await client.get_dm_inbox()
            
            conversations = []
            for conversation in inbox:
                # Get the other participant
                participants = conversation.participants
                other_user = None
                for p in participants:
                    if p.id != conversation.owner_id:
                        other_user = p
                        break
                
                conv_data = {
                    'id': '',
                    'accountId': account_id,
                    'platformConversationId': conversation.id,
                    'participantName': other_user.name if other_user else 'Unknown',
                    'participantId': other_user.id if other_user else '',
                    'participantAvatarUrl': other_user.profile_image_url if other_user else None,
                    'lastMessageAt': conversation.last_message.created_at.isoformat() if conversation.last_message else None,
                    'unreadCount': 0,  # twikit doesn't provide unread count directly
                    'createdAt': datetime.now().isoformat(),
                    'updatedAt': datetime.now().isoformat(),
                }
                conversations.append(conv_data)
            
            return conversations
            
        except Exception as e:
            error_str = str(e).lower()
            
            # Check for rate limit
            if 'rate limit' in error_str or '429' in error_str:
                self.rate_limiter.pause_requests(
                    account_id,
                    self.RATE_LIMIT_PAUSE_SECONDS,
                    'fetch'
                )
                raise RateLimitError(
                    'Twitter rate limit exceeded',
                    'twitter',
                    self.RATE_LIMIT_PAUSE_SECONDS
                )
            
            # Check for auth errors
            if 'unauthorized' in error_str or '401' in error_str:
                self._invalidate_client(account_id)
                raise PlatformAPIError(
                    'Twitter cookies expired or invalid',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            raise PlatformAPIError(
                f'Failed to fetch Twitter conversations: {e}',
                'twitter',
                retryable=True,
                original_error=e
            )
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch DM messages from all conversations.
        
        Args:
            account_id: The connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 3.2
        """
        return asyncio.get_event_loop().run_until_complete(
            self._fetch_messages_async(account_id, since)
        )
    
    async def _fetch_messages_async(
        self,
        account_id: str,
        since: Optional[datetime] = None
    ) -> List[Dict]:
        """Async implementation of fetch_messages."""
        def _fetch():
            return asyncio.get_event_loop().run_until_complete(
                self._fetch_all_messages(account_id, since)
            )
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    async def _fetch_all_messages(
        self,
        account_id: str,
        since: Optional[datetime] = None
    ) -> List[Dict]:
        """
        Fetch messages from all DM conversations.
        
        Requirements: 3.2
        """
        client = await self._get_or_create_client(account_id)
        account = await sync_to_async(ConnectedAccount.objects.get)(id=account_id)
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Get DM inbox
            inbox = await client.get_dm_inbox()
            
            all_messages = []
            for conversation in inbox:
                # Get messages from this conversation
                messages = await conversation.get_messages()
                
                for msg in messages:
                    # Filter by date if since is provided
                    if since and msg.created_at < since:
                        continue
                    
                    is_outgoing = str(msg.sender_id) == str(account.platform_user_id)
                    
                    message_data = {
                        'id': '',
                        'conversationId': '',
                        'platformMessageId': msg.id,
                        'senderId': str(msg.sender_id),
                        'senderName': msg.sender.name if msg.sender else str(msg.sender_id),
                        'content': msg.text or '',
                        'messageType': 'text',
                        'mediaUrl': None,
                        'isOutgoing': is_outgoing,
                        'isRead': False,
                        'sentAt': msg.created_at.isoformat(),
                        'createdAt': datetime.now().isoformat(),
                    }
                    
                    # Handle media attachments
                    if hasattr(msg, 'attachment') and msg.attachment:
                        if hasattr(msg.attachment, 'photo'):
                            message_data['messageType'] = 'image'
                            message_data['mediaUrl'] = msg.attachment.photo.url
                        elif hasattr(msg.attachment, 'video'):
                            message_data['messageType'] = 'video'
                            message_data['mediaUrl'] = msg.attachment.video.url
                    
                    all_messages.append(message_data)
            
            return all_messages
            
        except Exception as e:
            error_str = str(e).lower()
            
            if 'rate limit' in error_str or '429' in error_str:
                self.rate_limiter.pause_requests(
                    account_id,
                    self.RATE_LIMIT_PAUSE_SECONDS,
                    'fetch'
                )
                raise RateLimitError(
                    'Twitter rate limit exceeded',
                    'twitter',
                    self.RATE_LIMIT_PAUSE_SECONDS
                )
            
            if 'unauthorized' in error_str or '401' in error_str:
                self._invalidate_client(account_id)
                raise PlatformAPIError(
                    'Twitter cookies expired or invalid',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            raise PlatformAPIError(
                f'Failed to fetch Twitter messages: {e}',
                'twitter',
                retryable=True,
                original_error=e
            )


    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a DM message.
        
        Args:
            account_id: The connected account ID
            conversation_id: The conversation/DM thread ID
            content: The message text to send
            
        Returns:
            The sent message dictionary
            
        Requirements: 3.3, 3.4
        """
        return asyncio.get_event_loop().run_until_complete(
            self._send_message_async(account_id, conversation_id, content)
        )
    
    async def _send_message_async(
        self,
        account_id: str,
        conversation_id: str,
        content: str
    ) -> Dict:
        """Async implementation of send_message."""
        # Check daily limit before attempting to send
        remaining = self.rate_limiter.get_daily_remaining(account_id)
        if remaining is not None and remaining <= 0:
            raise RateLimitError(
                f'Daily message limit ({self.DAILY_MESSAGE_LIMIT}) reached',
                'twitter',
                self._get_seconds_until_midnight()
            )
        
        def _send():
            return asyncio.get_event_loop().run_until_complete(
                self._send_dm(account_id, conversation_id, content)
            )
        
        return self.execute_with_retry(_send, account_id, 'send')
    
    def _get_seconds_until_midnight(self) -> int:
        """Calculate seconds until midnight for daily limit reset."""
        now = datetime.now()
        midnight = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return int((midnight - now).total_seconds())
    
    async def _send_dm(
        self,
        account_id: str,
        conversation_id: str,
        content: str
    ) -> Dict:
        """
        Send a DM using twikit.
        
        Requirements: 3.3, 3.4
        """
        client = await self._get_or_create_client(account_id)
        account = await sync_to_async(ConnectedAccount.objects.get)(id=account_id)
        
        try:
            # Apply human-like delay (60 seconds between messages)
            self.apply_human_delay(account_id)
            
            # conversation_id is actually the recipient's user ID (passed from views.py)
            # twikit's send_dm expects user_id as first argument
            recipient_user_id = conversation_id
            
            # Send the message using twikit
            # Note: twikit send_dm(user_id, text) - user_id is the recipient
            message = await client.send_dm(recipient_user_id, content)
            
            # Get message ID safely (twikit response can vary)
            msg_id = ''
            if message:
                msg_id = getattr(message, 'id', '') or getattr(message, 'message_id', '') or str(int(time.time() * 1000))
            else:
                msg_id = str(int(time.time() * 1000))
            
            print(f'[twitter] DM sent successfully, message_id: {msg_id}')
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': str(msg_id),
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
            error_str = str(e).lower()
            
            if 'rate limit' in error_str or '429' in error_str:
                self.rate_limiter.pause_requests(
                    account_id,
                    self.RATE_LIMIT_PAUSE_SECONDS,
                    'send'
                )
                raise RateLimitError(
                    'Twitter rate limit exceeded',
                    'twitter',
                    self.RATE_LIMIT_PAUSE_SECONDS
                )
            
            if 'unauthorized' in error_str or '401' in error_str:
                self._invalidate_client(account_id)
                raise PlatformAPIError(
                    'Twitter cookies expired or invalid',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            # 404 errors often mean cookies are invalid/expired
            if '404' in error_str or 'not found' in error_str or 'does not exist' in error_str:
                self._invalidate_client(account_id)
                raise PlatformAPIError(
                    'Twitter cookies may be expired. Please refresh your cookies from browser.',
                    'twitter',
                    status_code=401,
                    retryable=False
                )
            
            raise PlatformAPIError(
                f'Failed to send Twitter DM: {e}',
                'twitter',
                retryable=True,
                original_error=e
            )
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark a DM as read.
        
        Args:
            account_id: The connected account ID
            message_id: The message ID to mark as read
        """
        # twikit doesn't have a direct mark_as_read method
        # This is a no-op for now
        print(f'[twitter] mark_as_read called for {message_id} (not supported by twikit)')
    
    async def verify_cookies(self, account_id: str) -> bool:
        """
        Verify that the stored cookies are still valid.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            True if cookies are valid, False otherwise
        """
        try:
            client = await self._get_or_create_client(account_id)
            # Try to get user info to verify cookies
            user = await client.user()
            return user is not None
        except Exception as e:
            print(f'[twitter] Cookie verification failed: {e}')
            self._invalidate_client(account_id)
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
twitter_cookie_adapter = TwitterCookieAdapter()
