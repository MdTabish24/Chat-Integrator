"""
LinkedIn adapter using linkedin-api for cookie-based authentication.

This adapter uses browser cookies (li_at, JSESSIONID) instead of OAuth
to access LinkedIn messages, which are not available on the free API tier.

Requirements: 4.1, 4.2, 4.3
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
    PLATFORM_RATE_LIMITS,
)


# LinkedIn cookie-based rate limit config (conservative to avoid bans)
LINKEDIN_COOKIE_RATE_LIMIT = RateLimitConfig(
    requests_per_window=2,
    window_seconds=60,
    min_delay_ms=30000,  # 30 seconds minimum between requests
    max_delay_ms=60000,  # 60 seconds maximum (random delay)
    daily_limit=10  # Max 10 messages per day
)


class LinkedInCookieAdapter(BasePlatformAdapter):
    """
    LinkedIn adapter using linkedin-api library for cookie-based authentication.
    
    This adapter provides access to LinkedIn messages using browser session cookies,
    bypassing the need for expensive API access.
    
    Requirements: 4.1, 4.2, 4.3
    """
    
    # Rate limiting constants
    FETCH_INTERVAL_SECONDS = 30  # 1 request per 30 seconds for fetching
    SEND_INTERVAL_SECONDS = 120  # 1 message per 2 minutes
    DAILY_MESSAGE_LIMIT = 10  # Max 10 messages per day
    RATE_LIMIT_PAUSE_SECONDS = 900  # 15 minutes pause on rate limit
    
    def __init__(self):
        super().__init__('linkedin')
        # Override rate limit config for cookie-based access
        self.rate_limit_config = LINKEDIN_COOKIE_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=LINKEDIN_COOKIE_RATE_LIMIT)
        self._clients: Dict[str, Any] = {}  # Cache linkedin-api clients per account

    def _get_client_cache_key(self, account_id: str) -> str:
        """Get cache key for linkedin-api client."""
        return f'linkedin:client:{account_id}'
    
    def _get_or_create_client(self, account_id: str) -> Any:
        """
        Get or create a linkedin-api client for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Authenticated linkedin-api Linkedin instance
            
        Requirements: 4.1
        """
        # Check if we have a cached client
        if account_id in self._clients:
            return self._clients[account_id]
        
        try:
            from linkedin_api import Linkedin
            
            # Get account and decrypt cookies
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            
            if not account.access_token:
                raise PlatformAPIError(
                    'No cookies stored for this account',
                    'linkedin',
                    status_code=401,
                    retryable=False
                )
            
            # Cookies are stored as encrypted JSON in access_token field
            cookies_json = decrypt(account.access_token)
            cookies = json.loads(cookies_json)
            
            # Validate required cookies
            li_at = cookies.get('li_at')
            jsessionid = cookies.get('JSESSIONID')
            
            if not li_at or not jsessionid:
                raise PlatformAPIError(
                    'Missing required cookies (li_at, JSESSIONID)',
                    'linkedin',
                    status_code=401,
                    retryable=False
                )
            
            # Create linkedin-api client with cookies
            # The linkedin-api library accepts cookies for authentication
            client = Linkedin(
                cookies={
                    'li_at': li_at,
                    'JSESSIONID': jsessionid,
                }
            )
            
            # Cache the client
            self._clients[account_id] = client
            
            return client
            
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'linkedin',
                status_code=404,
                retryable=False
            )
        except json.JSONDecodeError:
            raise PlatformAPIError(
                'Invalid cookie format',
                'linkedin',
                status_code=400,
                retryable=False
            )
        except ImportError:
            raise PlatformAPIError(
                'linkedin-api library not installed. Install with: pip install linkedin-api',
                'linkedin',
                status_code=500,
                retryable=False
            )
    
    def _invalidate_client(self, account_id: str) -> None:
        """Remove cached client for account."""
        if account_id in self._clients:
            del self._clients[account_id]
    
    def store_cookies(
        self,
        user_id: str,
        platform_user_id: str,
        platform_username: str,
        li_at: str,
        jsessionid: str
    ) -> str:
        """
        Store LinkedIn cookies securely for an account.
        
        Args:
            user_id: The user's ID
            platform_user_id: LinkedIn user ID (URN)
            platform_username: LinkedIn username/name
            li_at: LinkedIn li_at cookie
            jsessionid: LinkedIn JSESSIONID cookie
            
        Returns:
            The connected account ID
            
        Requirements: 4.1
        """
        # Encrypt cookies as JSON
        cookies = {
            'li_at': li_at,
            'JSESSIONID': jsessionid,
        }
        encrypted_cookies = encrypt(json.dumps(cookies))
        
        # Create or update connected account
        account, created = ConnectedAccount.objects.update_or_create(
            user_id=user_id,
            platform='linkedin',
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
                'linkedin',
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
        Get LinkedIn message conversations.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversation dictionaries
            
        Requirements: 4.2
        """
        def _fetch():
            return self._fetch_conversations(account_id)
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    def _fetch_conversations(self, account_id: str) -> List[Dict]:
        """
        Fetch message conversations using linkedin-api.
        
        Requirements: 4.2
        """
        client = self._get_or_create_client(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay before request
            self.apply_human_delay(account_id)
            
            # Get conversations from LinkedIn
            conversations_data = client.get_conversations()
            
            conversations = []
            for conv in conversations_data.get('elements', []):
                # Extract conversation details
                conv_id = conv.get('entityUrn', '').split(':')[-1]
                
                # Get participant info
                participants = conv.get('participants', [])
                other_participant = None
                for p in participants:
                    member = p.get('com.linkedin.voyager.messaging.MessagingMember', {})
                    mini_profile = member.get('miniProfile', {})
                    member_urn = mini_profile.get('entityUrn', '')
                    
                    # Skip if this is the current user
                    if member_urn and account.platform_user_id not in member_urn:
                        other_participant = mini_profile
                        break
                
                participant_name = 'Unknown'
                participant_id = ''
                participant_avatar = None
                
                if other_participant:
                    first_name = other_participant.get('firstName', '')
                    last_name = other_participant.get('lastName', '')
                    participant_name = f"{first_name} {last_name}".strip() or 'Unknown'
                    participant_id = other_participant.get('entityUrn', '').split(':')[-1]
                    
                    # Get profile picture
                    picture = other_participant.get('picture', {})
                    if picture:
                        artifacts = picture.get('com.linkedin.common.VectorImage', {}).get('artifacts', [])
                        if artifacts:
                            participant_avatar = artifacts[-1].get('fileIdentifyingUrlPathSegment')
                
                # Get last activity time
                last_activity = conv.get('lastActivityAt', 0)
                last_message_at = datetime.fromtimestamp(last_activity / 1000).isoformat() if last_activity else None
                
                conv_data = {
                    'id': '',
                    'accountId': account_id,
                    'platformConversationId': conv_id,
                    'participantName': participant_name,
                    'participantId': participant_id,
                    'participantAvatarUrl': participant_avatar,
                    'lastMessageAt': last_message_at,
                    'unreadCount': conv.get('unreadCount', 0),
                    'createdAt': datetime.now().isoformat(),
                    'updatedAt': datetime.now().isoformat(),
                }
                conversations.append(conv_data)
            
            return conversations
            
        except Exception as e:
            self._handle_error(e, account_id)
    
    def _handle_error(self, e: Exception, account_id: str):
        """Handle LinkedIn API errors."""
        error_str = str(e).lower()
        
        # Check for rate limit
        if 'rate limit' in error_str or '429' in error_str or 'too many' in error_str:
            self.rate_limiter.pause_requests(
                account_id,
                self.RATE_LIMIT_PAUSE_SECONDS,
                'fetch'
            )
            raise RateLimitError(
                'LinkedIn rate limit exceeded',
                'linkedin',
                self.RATE_LIMIT_PAUSE_SECONDS
            )
        
        # Check for auth errors
        if 'unauthorized' in error_str or '401' in error_str or 'forbidden' in error_str or '403' in error_str:
            self._invalidate_client(account_id)
            raise PlatformAPIError(
                'LinkedIn cookies expired or invalid',
                'linkedin',
                status_code=401,
                retryable=False
            )
        
        # Check for challenge/verification required
        if 'challenge' in error_str or 'verification' in error_str:
            self._invalidate_client(account_id)
            raise PlatformAPIError(
                'LinkedIn requires verification. Please complete verification in browser and update cookies.',
                'linkedin',
                status_code=403,
                retryable=False
            )
        
        raise PlatformAPIError(
            f'Failed to fetch LinkedIn data: {e}',
            'linkedin',
            retryable=True,
            original_error=e
        )

    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from LinkedIn conversations.
        
        Args:
            account_id: The connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 4.2
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
        
        Requirements: 4.2
        """
        client = self._get_or_create_client(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Get conversations first
            conversations_data = client.get_conversations()
            
            all_messages = []
            for conv in conversations_data.get('elements', []):
                conv_id = conv.get('entityUrn', '').split(':')[-1]
                
                if not conv_id:
                    continue
                
                # Apply delay between conversation fetches
                time.sleep(self.rate_limiter.get_random_delay(1000, 3000))
                
                # Get messages for this conversation
                try:
                    messages_data = client.get_conversation(conv_id)
                    
                    for msg in messages_data.get('elements', []):
                        # Get message timestamp
                        created_at = msg.get('createdAt', 0)
                        msg_datetime = datetime.fromtimestamp(created_at / 1000) if created_at else datetime.now()
                        
                        # Filter by date if since is provided
                        if since and msg_datetime < since:
                            continue
                        
                        # Get sender info
                        sender = msg.get('from', {})
                        sender_member = sender.get('com.linkedin.voyager.messaging.MessagingMember', {})
                        sender_profile = sender_member.get('miniProfile', {})
                        sender_urn = sender_profile.get('entityUrn', '')
                        sender_id = sender_urn.split(':')[-1] if sender_urn else ''
                        
                        sender_first = sender_profile.get('firstName', '')
                        sender_last = sender_profile.get('lastName', '')
                        sender_name = f"{sender_first} {sender_last}".strip() or 'Unknown'
                        
                        # Check if outgoing
                        is_outgoing = account.platform_user_id in sender_urn if sender_urn else False
                        
                        # Get message content
                        body = msg.get('body', {})
                        content = body.get('text', '') if isinstance(body, dict) else str(body)
                        
                        message_data = {
                            'id': '',
                            'conversationId': conv_id,
                            'platformMessageId': msg.get('entityUrn', '').split(':')[-1],
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
                        attachments = msg.get('attachments', [])
                        if attachments:
                            for attachment in attachments:
                                media_type = attachment.get('mediaType', '')
                                if 'image' in media_type:
                                    message_data['messageType'] = 'image'
                                elif 'video' in media_type:
                                    message_data['messageType'] = 'video'
                                
                                # Get attachment URL if available
                                reference = attachment.get('reference', {})
                                if reference:
                                    message_data['mediaUrl'] = reference.get('string')
                        
                        all_messages.append(message_data)
                        
                except Exception as conv_error:
                    print(f'[linkedin] Failed to fetch messages for conversation {conv_id}: {conv_error}')
                    continue
            
            return all_messages
            
        except Exception as e:
            self._handle_error(e, account_id)

    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a LinkedIn message.
        
        Args:
            account_id: The connected account ID
            conversation_id: The conversation ID
            content: The message text to send
            
        Returns:
            The sent message dictionary
            
        Requirements: 4.3
        """
        # Check daily limit before attempting to send
        remaining = self.rate_limiter.get_daily_remaining(account_id)
        if remaining is not None and remaining <= 0:
            raise RateLimitError(
                f'Daily message limit ({self.DAILY_MESSAGE_LIMIT}) reached',
                'linkedin',
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
        Send a message using linkedin-api.
        
        Requirements: 4.3
        """
        client = self._get_or_create_client(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay (2 minutes between messages)
            self.apply_human_delay(account_id)
            
            # Send the message
            # linkedin-api uses send_message(conversation_id, message_body)
            result = client.send_message(
                conversation_id=conversation_id,
                message_body=content
            )
            
            # Generate message ID from result or timestamp
            message_id = str(int(time.time() * 1000))
            
            return {
                'id': '',
                'conversationId': conversation_id,
                'platformMessageId': message_id,
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
        # linkedin-api doesn't have a direct mark_as_read method
        print(f'[linkedin] mark_as_read called for {message_id} (not directly supported)')
    
    def verify_cookies(self, account_id: str) -> bool:
        """
        Verify that the stored cookies are still valid.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            True if cookies are valid, False otherwise
        """
        try:
            client = self._get_or_create_client(account_id)
            # Try to get profile to verify cookies
            profile = client.get_profile()
            return profile is not None
        except Exception as e:
            print(f'[linkedin] Cookie verification failed: {e}')
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
linkedin_cookie_adapter = LinkedInCookieAdapter()
