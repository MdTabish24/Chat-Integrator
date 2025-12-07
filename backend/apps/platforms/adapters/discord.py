"""
Discord adapter using direct HTTP API for token-based authentication.

This adapter uses a Discord user/bot token to access DMs via Discord's REST API.
Discord has built-in rate limiting that we respect via retry-after headers.

Requirements: 9.1, 9.2, 9.3, 9.4
"""

import json
import time
import requests
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from django.utils import timezone

from .base import BasePlatformAdapter, PlatformAPIError, RateLimitError
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt, decrypt
from apps.core.services.rate_limiter import (
    RateLimiter,
    RateLimitConfig,
)


# Discord API base URL
DISCORD_API_BASE = 'https://discord.com/api/v10'

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
    Discord adapter using direct HTTP API for token-based authentication.
    
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
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json',
            'User-Agent': 'DiscordBot (https://chatorbitor.com, 1.0)'
        })

    def _get_headers(self, token: str) -> Dict[str, str]:
        """Get headers with authorization for Discord API."""
        return {
            'Authorization': token,  # User tokens don't need 'Bot ' prefix
            'Content-Type': 'application/json',
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
        }
    
    def _make_request(
        self,
        method: str,
        endpoint: str,
        token: str,
        account_id: str,
        data: Optional[Dict] = None,
        params: Optional[Dict] = None
    ) -> Any:
        """
        Make a request to Discord API with rate limit handling.
        
        Args:
            method: HTTP method
            endpoint: API endpoint (without base URL)
            token: Discord token
            account_id: Account ID for rate limiting
            data: Request body data
            params: Query parameters
            
        Returns:
            Response JSON data
        """
        url = f'{DISCORD_API_BASE}{endpoint}'
        headers = self._get_headers(token)
        
        # Apply human-like delay
        self.apply_human_delay(account_id)
        
        try:
            response = self.session.request(
                method=method,
                url=url,
                headers=headers,
                json=data,
                params=params,
                timeout=30
            )
            
            # Handle rate limits
            if response.status_code == 429:
                retry_after = response.json().get('retry_after', self.DEFAULT_RETRY_AFTER)
                self.rate_limiter.pause_requests(account_id, int(retry_after), 'fetch')
                raise RateLimitError(
                    f'Discord rate limit exceeded. Retry after {retry_after}s',
                    'discord',
                    int(retry_after)
                )
            
            # Handle auth errors
            if response.status_code in (401, 403):
                raise PlatformAPIError(
                    'Discord token invalid or expired. Please reconnect.',
                    'discord',
                    status_code=response.status_code,
                    retryable=False
                )
            
            # Handle other errors
            if response.status_code >= 400:
                error_msg = response.text
                try:
                    error_data = response.json()
                    error_msg = error_data.get('message', response.text)
                except:
                    pass
                raise PlatformAPIError(
                    f'Discord API error: {error_msg}',
                    'discord',
                    status_code=response.status_code,
                    retryable=response.status_code >= 500
                )
            
            # Return JSON for successful requests
            if response.status_code == 204:
                return None
            return response.json()
            
        except requests.RequestException as e:
            raise PlatformAPIError(
                f'Discord request failed: {e}',
                'discord',
                retryable=True,
                original_error=e
            )
    
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
        
        print(f'[discord] Token stored for user {user_id}, account {account.id}')
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
        account = ConnectedAccount.objects.get(id=account_id, is_active=True)
        token = decrypt(account.access_token)
        
        # Get DM channels
        channels = self._make_request(
            'GET',
            '/users/@me/channels',
            token,
            account_id
        )
        
        conversations = []
        for channel in channels:
            # Only process DM channels (type 1) and Group DMs (type 3)
            if channel.get('type') not in (1, 3):
                continue
            
            recipients = channel.get('recipients', [])
            
            if channel.get('type') == 1 and recipients:
                # Direct DM
                recipient = recipients[0]
                participant_name = recipient.get('global_name') or recipient.get('username', 'Unknown')
                participant_id = recipient.get('id', '')
                avatar_url = self._get_avatar_url(recipient)
            elif channel.get('type') == 3:
                # Group DM
                participant_name = channel.get('name') or f"Group ({len(recipients)} members)"
                participant_id = channel.get('id', '')
                avatar_url = channel.get('icon')
                if avatar_url:
                    avatar_url = f"https://cdn.discordapp.com/channel-icons/{channel.get('id')}/{avatar_url}.png"
            else:
                continue
            
            conv_data = {
                'id': '',
                'accountId': account_id,
                'platformConversationId': channel.get('id'),
                'participantName': participant_name,
                'participantId': participant_id,
                'participantAvatarUrl': avatar_url,
                'lastMessageAt': None,
                'unreadCount': 0,
                'createdAt': datetime.now().isoformat(),
                'updatedAt': datetime.now().isoformat(),
            }
            conversations.append(conv_data)
        
        print(f'[discord] Found {len(conversations)} DM conversations for account {account_id}')
        return conversations
    
    def _get_avatar_url(self, user: Dict) -> Optional[str]:
        """Get Discord avatar URL for a user."""
        user_id = user.get('id')
        avatar = user.get('avatar')
        if user_id and avatar:
            ext = 'gif' if avatar.startswith('a_') else 'png'
            return f'https://cdn.discordapp.com/avatars/{user_id}/{avatar}.{ext}'
        # Default avatar
        discriminator = user.get('discriminator', '0')
        if discriminator == '0':
            # New username system
            return f'https://cdn.discordapp.com/embed/avatars/{(int(user_id) >> 22) % 6}.png'
        return f'https://cdn.discordapp.com/embed/avatars/{int(discriminator) % 5}.png'

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
        account = ConnectedAccount.objects.get(id=account_id, is_active=True)
        token = decrypt(account.access_token)
        
        # First get all DM channels
        channels = self._make_request(
            'GET',
            '/users/@me/channels',
            token,
            account_id
        )
        
        all_messages = []
        
        for channel in channels:
            # Only process DM channels
            if channel.get('type') not in (1, 3):
                continue
            
            channel_id = channel.get('id')
            recipients = channel.get('recipients', [])
            
            # Fetch messages from this channel
            params = {'limit': 50}
            if since:
                # Convert datetime to Discord snowflake ID (approximate)
                since_snowflake = self._datetime_to_snowflake(since)
                params['after'] = since_snowflake
            
            try:
                messages = self._make_request(
                    'GET',
                    f'/channels/{channel_id}/messages',
                    token,
                    account_id,
                    params=params
                )
            except Exception as e:
                print(f'[discord] Failed to fetch messages from channel {channel_id}: {e}')
                continue
            
            for msg in messages:
                author = msg.get('author', {})
                is_outgoing = str(author.get('id')) == str(account.platform_user_id)
                
                # Parse timestamp
                timestamp = msg.get('timestamp')
                
                message_data = {
                    'id': '',
                    'conversationId': '',
                    'platformMessageId': msg.get('id'),
                    'platformConversationId': channel_id,
                    'senderId': str(author.get('id', '')),
                    'senderName': author.get('global_name') or author.get('username', 'Unknown'),
                    'content': msg.get('content', ''),
                    'messageType': 'text',
                    'mediaUrl': None,
                    'isOutgoing': is_outgoing,
                    'isRead': False,
                    'sentAt': timestamp,
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
                
                # Handle embeds
                embeds = msg.get('embeds', [])
                if embeds and not message_data['content']:
                    embed = embeds[0]
                    message_data['content'] = embed.get('description', '') or embed.get('title', '[Embed]')
                
                all_messages.append(message_data)
        
        print(f'[discord] Fetched {len(all_messages)} messages for account {account_id}')
        return all_messages
    
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
        account = ConnectedAccount.objects.get(id=account_id, is_active=True)
        token = decrypt(account.access_token)
        
        # Send message
        message = self._make_request(
            'POST',
            f'/channels/{conversation_id}/messages',
            token,
            account_id,
            data={'content': content}
        )
        
        print(f'[discord] Sent message to channel {conversation_id}')
        
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
    
    def verify_token(self, account_id: str) -> bool:
        """
        Verify that the stored token is still valid.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            True if token is valid, False otherwise
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id)
            token = decrypt(account.access_token)
            
            # Try to get current user info to verify token
            user = self._make_request('GET', '/users/@me', token, account_id)
            return user is not None and 'id' in user
            
        except Exception as e:
            print(f'[discord] Token verification failed: {e}')
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
