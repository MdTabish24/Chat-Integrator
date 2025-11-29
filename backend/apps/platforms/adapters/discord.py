"""
Discord adapter using discord.py for token-based authentication.

This adapter uses a Discord user/bot token to access DMs.
Discord has built-in rate limiting that we respect via retry-after headers.

Requirements: 9.1, 9.2, 9.3, 9.4
"""

import json
import asyncio
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from django.utils import timezone

from .base import BasePlatformAdapter, PlatformAPIError, RateLimitError
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt, decrypt
from apps.core.services.rate_limiter import (
    RateLimiter,
    RateLimitConfig,
    PLATFORM_RATE_LIMITS,
)


# Discord rate limit config (respects Discord's built-in limits)
DISCORD_RATE_LIMIT = RateLimitConfig(
    requests_per_window=5,
    window_seconds=5,
    min_delay_ms=1000,
    max_delay_ms=2000,
    daily_limit=None  # Discord has built-in rate limiting
)


class DiscordAdapter(BasePlatformAdapter):
    """
    Discord adapter using discord.py library for token-based authentication.
    
    This adapter provides access to Discord DMs using a user or bot token.
    Discord has built-in rate limiting that we respect via retry-after headers.
    
    Requirements: 9.1, 9.2, 9.3, 9.4
    """
    
    # Rate limiting constants (Discord's built-in limits)
    MESSAGES_PER_5_SECONDS = 5  # 5 messages per 5 seconds
    DEFAULT_RETRY_AFTER = 5  # Default retry-after in seconds
    
    def __init__(self):
        super().__init__('discord')
        # Override rate limit config for Discord
        self.rate_limit_config = DISCORD_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=DISCORD_RATE_LIMIT)
        self._clients: Dict[str, Any] = {}  # Cache discord clients per account

    def _get_client_cache_key(self, account_id: str) -> str:
        """Get cache key for discord client."""
        return f'discord:client:{account_id}'
    
    async def _get_or_create_client(self, account_id: str) -> Any:
        """
        Get or create a discord.py client for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Authenticated discord Client instance
            
        Requirements: 9.1
        """
        # Check if we have a cached client
        if account_id in self._clients:
            client = self._clients[account_id]
            if client.is_ready():
                return client
            # Client not ready, remove from cache
            del self._clients[account_id]
        
        try:
            import discord
            
            # Get account and decrypt token
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            
            if not account.access_token:
                raise PlatformAPIError(
                    'No token stored for this account',
                    'discord',
                    status_code=401,
                    retryable=False
                )
            
            # Token is stored encrypted in access_token field
            token = decrypt(account.access_token)
            
            if not token:
                raise PlatformAPIError(
                    'Invalid or empty token',
                    'discord',
                    status_code=401,
                    retryable=False
                )
            
            # Create discord client with minimal intents for DMs
            intents = discord.Intents.default()
            intents.dm_messages = True
            intents.message_content = True
            
            client = discord.Client(intents=intents)
            
            # Store token for later use
            client._token = token
            
            # Cache the client
            self._clients[account_id] = client
            
            return client
            
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'discord',
                status_code=404,
                retryable=False
            )
        except ImportError:
            raise PlatformAPIError(
                'discord.py library not installed',
                'discord',
                status_code=500,
                retryable=False
            )
    
    def _invalidate_client(self, account_id: str) -> None:
        """Remove cached client for account."""
        if account_id in self._clients:
            client = self._clients[account_id]
            # Close the client if it's running
            if hasattr(client, 'close'):
                try:
                    asyncio.get_event_loop().run_until_complete(client.close())
                except Exception:
                    pass
            del self._clients[account_id]
    
    def store_token(
        self,
        user_id: str,
        platform_user_id: str,
        platform_username: str,
        token: str
    ) -> str:
        """
        Store Discord token securely for an account.
        
        Args:
            user_id: The user's ID
            platform_user_id: Discord user ID
            platform_username: Discord username
            token: Discord user/bot token
            
        Returns:
            The connected account ID
            
        Requirements: 9.1
        """
        # Encrypt token
        encrypted_token = encrypt(token)
        
        # Create or update connected account
        account, created = ConnectedAccount.objects.update_or_create(
            user_id=user_id,
            platform='discord',
            platform_user_id=platform_user_id,
            defaults={
                'platform_username': platform_username,
                'access_token': encrypted_token,
                'refresh_token': None,  # No refresh token for Discord tokens
                'token_expires_at': None,  # Tokens don't expire unless revoked
                'is_active': True,
            }
        )
        
        # Invalidate any cached client
        self._invalidate_client(str(account.id))
        
        return str(account.id)
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get decrypted token for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Decrypted token string
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'discord',
                status_code=404,
                retryable=False
            )
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Discord tokens don't support refresh.
        If token is invalid, user must re-authenticate.
        """
        # No-op for Discord tokens
        pass

    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get Discord DM conversations.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversation dictionaries
            
        Requirements: 9.2
        """
        return asyncio.get_event_loop().run_until_complete(
            self._get_conversations_async(account_id)
        )
    
    async def _get_conversations_async(self, account_id: str) -> List[Dict]:
        """
        Async implementation of get_conversations.
        
        Requirements: 9.2
        """
        def _fetch():
            return asyncio.get_event_loop().run_until_complete(
                self._fetch_conversations(account_id)
            )
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    async def _fetch_conversations(self, account_id: str) -> List[Dict]:
        """
        Fetch DM conversations using discord.py.
        
        Requirements: 9.2
        """
        import discord
        
        account = ConnectedAccount.objects.get(id=account_id)
        token = decrypt(account.access_token)
        
        conversations = []
        
        try:
            # Apply human-like delay before request
            self.apply_human_delay(account_id)
            
            # Use HTTP client directly for fetching DM channels
            # This avoids the need to run a full bot connection
            async with discord.http.HTTPClient() as http:
                http.token = token
                
                # Get DM channels
                channels = await http.get_private_channels()
                
                for channel in channels:
                    if channel.get('type') == 1:  # DM channel type
                        recipients = channel.get('recipients', [])
                        recipient = recipients[0] if recipients else {}
                        
                        conv_data = {
                            'id': '',
                            'accountId': account_id,
                            'platformConversationId': channel.get('id'),
                            'participantName': recipient.get('username', 'Unknown'),
                            'participantId': recipient.get('id', ''),
                            'participantAvatarUrl': self._get_avatar_url(recipient),
                            'lastMessageAt': channel.get('last_message_id'),
                            'unreadCount': 0,
                            'createdAt': datetime.now().isoformat(),
                            'updatedAt': datetime.now().isoformat(),
                        }
                        conversations.append(conv_data)
            
            return conversations
            
        except discord.HTTPException as e:
            return self._handle_discord_error(e, account_id)
        except Exception as e:
            raise PlatformAPIError(
                f'Failed to fetch Discord conversations: {e}',
                'discord',
                retryable=True,
                original_error=e
            )
    
    def _get_avatar_url(self, user: Dict) -> Optional[str]:
        """Get Discord avatar URL for a user."""
        user_id = user.get('id')
        avatar = user.get('avatar')
        if user_id and avatar:
            return f'https://cdn.discordapp.com/avatars/{user_id}/{avatar}.png'
        return None
    
    def _handle_discord_error(self, error: Any, account_id: str) -> None:
        """Handle Discord API errors with proper rate limit handling."""
        import discord
        
        if isinstance(error, discord.HTTPException):
            # Check for rate limit (429)
            if error.status == 429:
                retry_after = getattr(error, 'retry_after', self.DEFAULT_RETRY_AFTER)
                self.rate_limiter.pause_requests(
                    account_id,
                    int(retry_after),
                    'fetch'
                )
                raise RateLimitError(
                    'Discord rate limit exceeded',
                    'discord',
                    int(retry_after)
                )
            
            # Check for auth errors (401, 403)
            if error.status in (401, 403):
                self._invalidate_client(account_id)
                raise PlatformAPIError(
                    'Discord token invalid or expired',
                    'discord',
                    status_code=error.status,
                    retryable=False
                )
        
        raise PlatformAPIError(
            f'Discord API error: {error}',
            'discord',
            retryable=True,
            original_error=error
        )

    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch DM messages from all conversations.
        
        Args:
            account_id: The connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 9.2
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
        
        Requirements: 9.2
        """
        import discord
        
        account = ConnectedAccount.objects.get(id=account_id)
        token = decrypt(account.access_token)
        
        all_messages = []
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            async with discord.http.HTTPClient() as http:
                http.token = token
                
                # Get DM channels first
                channels = await http.get_private_channels()
                
                for channel in channels:
                    if channel.get('type') != 1:  # Skip non-DM channels
                        continue
                    
                    channel_id = channel.get('id')
                    recipients = channel.get('recipients', [])
                    recipient = recipients[0] if recipients else {}
                    
                    # Fetch messages from this channel
                    # Limit to 50 messages per channel
                    params = {'limit': 50}
                    if since:
                        # Convert datetime to Discord snowflake ID (approximate)
                        since_snowflake = self._datetime_to_snowflake(since)
                        params['after'] = since_snowflake
                    
                    messages = await http.get_messages(channel_id, **params)
                    
                    for msg in messages:
                        author = msg.get('author', {})
                        is_outgoing = str(author.get('id')) == str(account.platform_user_id)
                        
                        # Parse timestamp
                        timestamp = msg.get('timestamp')
                        sent_at = timestamp if timestamp else datetime.now().isoformat()
                        
                        message_data = {
                            'id': '',
                            'conversationId': '',
                            'platformMessageId': msg.get('id'),
                            'senderId': str(author.get('id', '')),
                            'senderName': author.get('username', 'Unknown'),
                            'content': msg.get('content', ''),
                            'messageType': 'text',
                            'mediaUrl': None,
                            'isOutgoing': is_outgoing,
                            'isRead': False,
                            'sentAt': sent_at,
                            'createdAt': datetime.now().isoformat(),
                        }
                        
                        # Handle attachments
                        attachments = msg.get('attachments', [])
                        if attachments:
                            attachment = attachments[0]
                            content_type = attachment.get('content_type', '')
                            if content_type.startswith('image/'):
                                message_data['messageType'] = 'image'
                            elif content_type.startswith('video/'):
                                message_data['messageType'] = 'video'
                            else:
                                message_data['messageType'] = 'file'
                            message_data['mediaUrl'] = attachment.get('url')
                        
                        all_messages.append(message_data)
            
            return all_messages
            
        except Exception as e:
            import discord
            if isinstance(e, discord.HTTPException):
                return self._handle_discord_error(e, account_id)
            raise PlatformAPIError(
                f'Failed to fetch Discord messages: {e}',
                'discord',
                retryable=True,
                original_error=e
            )
    
    def _datetime_to_snowflake(self, dt: datetime) -> str:
        """Convert datetime to Discord snowflake ID (approximate)."""
        # Discord epoch: 2015-01-01 00:00:00 UTC
        discord_epoch = datetime(2015, 1, 1, tzinfo=timezone.utc)
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        
        # Calculate milliseconds since Discord epoch
        ms = int((dt - discord_epoch).total_seconds() * 1000)
        
        # Snowflake = (ms << 22) | (worker_id << 17) | (process_id << 12) | increment
        # We only care about the timestamp part for filtering
        snowflake = ms << 22
        return str(snowflake)

    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a DM message.
        
        Args:
            account_id: The connected account ID
            conversation_id: The DM channel ID
            content: The message text to send
            
        Returns:
            The sent message dictionary
            
        Requirements: 9.3, 9.4
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
        def _send():
            return asyncio.get_event_loop().run_until_complete(
                self._send_dm(account_id, conversation_id, content)
            )
        
        return self.execute_with_retry(_send, account_id, 'send')
    
    async def _send_dm(
        self,
        account_id: str,
        conversation_id: str,
        content: str
    ) -> Dict:
        """
        Send a DM using discord.py HTTP client.
        
        Requirements: 9.3, 9.4
        """
        import discord
        
        account = ConnectedAccount.objects.get(id=account_id)
        token = decrypt(account.access_token)
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            async with discord.http.HTTPClient() as http:
                http.token = token
                
                # Send message to channel
                message = await http.send_message(
                    conversation_id,
                    content=content
                )
                
                return {
                    'id': '',
                    'conversationId': '',
                    'platformMessageId': message.get('id'),
                    'senderId': str(account.platform_user_id),
                    'senderName': account.platform_username or str(account.platform_user_id),
                    'content': content,
                    'messageType': 'text',
                    'mediaUrl': None,
                    'isOutgoing': True,
                    'isRead': False,
                    'sentAt': message.get('timestamp', datetime.now().isoformat()),
                    'deliveredAt': datetime.now().isoformat(),
                    'createdAt': datetime.now().isoformat(),
                }
            
        except Exception as e:
            import discord
            if isinstance(e, discord.HTTPException):
                # Handle rate limit with retry-after
                if e.status == 429:
                    retry_after = getattr(e, 'retry_after', self.DEFAULT_RETRY_AFTER)
                    self.rate_limiter.pause_requests(
                        account_id,
                        int(retry_after),
                        'send'
                    )
                    raise RateLimitError(
                        f'Discord rate limit exceeded. Retry after {retry_after}s',
                        'discord',
                        int(retry_after)
                    )
                
                if e.status in (401, 403):
                    self._invalidate_client(account_id)
                    raise PlatformAPIError(
                        'Discord token invalid or expired',
                        'discord',
                        status_code=e.status,
                        retryable=False
                    )
            
            raise PlatformAPIError(
                f'Failed to send Discord DM: {e}',
                'discord',
                retryable=True,
                original_error=e
            )
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark a DM as read.
        
        Note: Discord doesn't have a direct API for marking messages as read
        in the same way other platforms do. This is a no-op.
        
        Args:
            account_id: The connected account ID
            message_id: The message ID to mark as read
        """
        # Discord doesn't support marking messages as read via API
        print(f'[discord] mark_as_read called for {message_id} (not supported by Discord API)')
    
    async def verify_token(self, account_id: str) -> bool:
        """
        Verify that the stored token is still valid.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            True if token is valid, False otherwise
        """
        import discord
        
        try:
            account = ConnectedAccount.objects.get(id=account_id)
            token = decrypt(account.access_token)
            
            async with discord.http.HTTPClient() as http:
                http.token = token
                # Try to get current user info to verify token
                user = await http.get_me()
                return user is not None
                
        except Exception as e:
            print(f'[discord] Token verification failed: {e}')
            self._invalidate_client(account_id)
            return False
    
    def get_rate_limit_status(self, account_id: str) -> Dict:
        """
        Get current rate limit status for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Dict with rate limit information
        """
        wait_time_fetch = self.rate_limiter.wait_if_needed(
            account_id,
            self.rate_limit_config,
            'fetch'
        )
        wait_time_send = self.rate_limiter.wait_if_needed(
            account_id,
            self.rate_limit_config,
            'send'
        )
        
        return {
            'fetchRateLimited': wait_time_fetch > 0,
            'fetchWaitSeconds': int(wait_time_fetch),
            'sendRateLimited': wait_time_send > 0,
            'sendWaitSeconds': int(wait_time_send),
            'messagesPerWindow': self.MESSAGES_PER_5_SECONDS,
            'windowSeconds': 5,
        }


# Create singleton instance
discord_adapter = DiscordAdapter()
