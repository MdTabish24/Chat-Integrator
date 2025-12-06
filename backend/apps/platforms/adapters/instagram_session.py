"""
Instagram adapter using instagrapi for session-based authentication.

This adapter uses instagrapi library for Instagram DM access,
which provides session-based authentication.

Requirements: 5.1, 5.2, 5.3
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


# Instagram session-based rate limit config (conservative to avoid bans)
INSTAGRAM_SESSION_RATE_LIMIT = RateLimitConfig(
    requests_per_window=2,
    window_seconds=60,
    min_delay_ms=30000,  # 30 seconds minimum between requests
    max_delay_ms=60000,  # 60 seconds maximum (random delay)
    daily_limit=20  # Max 20 messages per day
)


class InstagramSessionAdapter(BasePlatformAdapter):
    """
    Instagram adapter using instagrapi library for session-based authentication.
    
    This adapter provides access to Instagram DMs using session credentials,
    bypassing the need for expensive Business API access.
    
    Requirements: 5.1, 5.2, 5.3
    """
    
    # Rate limiting constants
    FETCH_INTERVAL_SECONDS = 30  # 1 request per 30 seconds for fetching
    SEND_INTERVAL_SECONDS = 60  # 1 message per 60 seconds
    DAILY_MESSAGE_LIMIT = 20  # Max 20 messages per day
    RATE_LIMIT_PAUSE_SECONDS = 900  # 15 minutes pause on rate limit
    
    def __init__(self):
        super().__init__('instagram')
        # Override rate limit config for session-based access
        self.rate_limit_config = INSTAGRAM_SESSION_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=INSTAGRAM_SESSION_RATE_LIMIT)
        self._clients: Dict[str, Any] = {}  # Cache instagrapi clients per account

    def _get_client_cache_key(self, account_id: str) -> str:
        """Get cache key for instagrapi client."""
        return f'instagram:client:{account_id}'
    
    def _get_or_create_client(self, account_id: str) -> Any:
        """
        Get or create an instagrapi client for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Authenticated instagrapi Client instance
            
        Requirements: 5.1
        """
        print(f'[instagram] _get_or_create_client called for account: {account_id}')
        
        # Check if we have a cached client
        if account_id in self._clients:
            print(f'[instagram] Using cached client for account: {account_id}')
            return self._clients[account_id]
        
        print(f'[instagram] No cached client, creating new one...')
        
        try:
            print(f'[instagram] Importing instagrapi...')
            from instagrapi import Client
            from instagrapi.exceptions import (
                LoginRequired, ChallengeRequired, 
                TwoFactorRequired, BadPassword,
                PleaseWaitFewMinutes, ClientError
            )
            print(f'[instagram] instagrapi imported successfully')
            
            # Get account and decrypt session
            print(f'[instagram] Fetching account from DB...')
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            print(f'[instagram] Account found: {account.platform_username}')
            
            if not account.access_token:
                print(f'[instagram] ERROR: No access_token stored')
                raise PlatformAPIError(
                    'No session stored for this account',
                    'instagram',
                    status_code=401,
                    retryable=False
                )
            
            # Session is stored as encrypted JSON in access_token field
            print(f'[instagram] Decrypting session data...')
            session_json = decrypt(account.access_token)
            session_data = json.loads(session_json)
            print(f'[instagram] Session data keys: {list(session_data.keys())}')
            print(f'[instagram] Username in session: {session_data.get("username", "NOT_FOUND")}')
            
            # Create instagrapi client
            print(f'[instagram] Creating instagrapi Client...')
            client = Client()
            print(f'[instagram] Client created')
            
            # Check if we have session settings to restore
            if 'settings' in session_data:
                print(f'[instagram] Found saved settings, restoring...')
                try:
                    client.set_settings(session_data['settings'])
                    print(f'[instagram] Settings restored, attempting login...')
                    client.login(
                        session_data.get('username', ''),
                        session_data.get('password', '')
                    )
                    print(f'[instagram] Login with saved settings successful!')
                except Exception as settings_err:
                    print(f'[instagram] Login with settings failed: {settings_err}')
                    print(f'[instagram] Trying fresh login...')
                    # Try fresh login
                    client = Client()
                    client.login(
                        session_data.get('username', ''),
                        session_data.get('password', '')
                    )
            elif 'sessionid' in session_data:
                # Login with session ID
                print(f'[instagram] Using sessionid login...')
                client.login_by_sessionid(session_data['sessionid'])
                print(f'[instagram] Sessionid login successful!')
            else:
                # Login with username/password
                username = session_data.get('username')
                password = session_data.get('password')
                
                print(f'[instagram] Fresh login with username: {username}')
                
                if not username or not password:
                    print(f'[instagram] ERROR: Missing username or password')
                    raise PlatformAPIError(
                        'Missing credentials (username/password or sessionid)',
                        'instagram',
                        status_code=401,
                        retryable=False
                    )
                
                print(f'[instagram] Calling client.login()...')
                client.login(username, password)
                print(f'[instagram] Login successful!')
                
                # Save session settings for future use
                print(f'[instagram] Saving session settings...')
                self._save_session_settings(account_id, client, session_data)
            
            # Cache the client
            self._clients[account_id] = client
            print(f'[instagram] Client cached successfully')
            
            return client
            
        except ConnectedAccount.DoesNotExist:
            print(f'[instagram] ERROR: Account {account_id} not found in DB')
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'instagram',
                status_code=404,
                retryable=False
            )
        except json.JSONDecodeError as e:
            print(f'[instagram] ERROR: Failed to parse session JSON: {e}')
            raise PlatformAPIError(
                'Invalid session format',
                'instagram',
                status_code=400,
                retryable=False
            )
        except ImportError as e:
            print(f'[instagram] ERROR: Import failed: {e}')
            raise PlatformAPIError(
                f'instagrapi import error: {e}',
                'instagram',
                status_code=500,
                retryable=False
            )
        except Exception as e:
            error_str = str(e).lower()
            error_type = type(e).__name__
            print(f'[instagram] ERROR during login:')
            print(f'[instagram]   Type: {error_type}')
            print(f'[instagram]   Message: {e}')
            print(f'[instagram]   Full repr: {repr(e)}')
            
            import traceback
            print(f'[instagram]   Traceback:')
            traceback.print_exc()
            
            if 'challenge' in error_str or 'checkpoint' in error_str:
                print(f'[instagram] Challenge/checkpoint detected!')
                raise PlatformAPIError(
                    f'Instagram requires verification (challenge). Error: {e}',
                    'instagram',
                    status_code=403,
                    retryable=False
                )
            if 'two_factor' in error_str or '2fa' in error_str:
                print(f'[instagram] 2FA required!')
                raise PlatformAPIError(
                    f'Instagram requires 2FA. Please disable 2FA temporarily. Error: {e}',
                    'instagram',
                    status_code=403,
                    retryable=False
                )
            if 'bad_password' in error_str or 'password' in error_str:
                print(f'[instagram] Bad password!')
                raise PlatformAPIError(
                    f'Invalid Instagram password. Error: {e}',
                    'instagram',
                    status_code=401,
                    retryable=False
                )
            if 'please wait' in error_str or 'few minutes' in error_str:
                print(f'[instagram] Rate limited - please wait!')
                raise PlatformAPIError(
                    f'Instagram rate limit. Please wait a few minutes. Error: {e}',
                    'instagram',
                    status_code=429,
                    retryable=True
                )
            
            raise PlatformAPIError(
                f'Instagram auth failed [{error_type}]: {e}',
                'instagram',
                retryable=False,
                original_error=e
            )
    
    def _save_session_settings(self, account_id: str, client: Any, original_data: dict) -> None:
        """Save session settings after successful login."""
        try:
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Get current settings from client
            settings = client.get_settings()
            
            # Update session data with settings
            session_data = {
                'username': original_data.get('username'),
                'password': original_data.get('password'),
                'settings': settings,
            }
            
            # Encrypt and save
            account.access_token = encrypt(json.dumps(session_data))
            account.save()
            
        except Exception as e:
            print(f'[instagram] Failed to save session settings: {e}')
    
    def _invalidate_client(self, account_id: str) -> None:
        """Remove cached client for account."""
        if account_id in self._clients:
            del self._clients[account_id]

    def store_session(
        self,
        user_id: str,
        platform_user_id: str,
        platform_username: str,
        username: str,
        password: str,
        sessionid: Optional[str] = None
    ) -> str:
        """
        Store Instagram session credentials securely for an account.
        
        Args:
            user_id: The user's ID
            platform_user_id: Instagram user ID (pk)
            platform_username: Instagram username
            username: Instagram login username
            password: Instagram login password
            sessionid: Optional session ID for session-based auth
            
        Returns:
            The connected account ID
            
        Requirements: 5.1
        """
        # Encrypt session data as JSON
        session_data = {
            'username': username,
            'password': password,
        }
        if sessionid:
            session_data['sessionid'] = sessionid
            
        encrypted_session = encrypt(json.dumps(session_data))
        
        # Create or update connected account
        account, created = ConnectedAccount.objects.update_or_create(
            user_id=user_id,
            platform='instagram',
            platform_user_id=platform_user_id,
            defaults={
                'platform_username': platform_username,
                'access_token': encrypted_session,
                'refresh_token': None,
                'token_expires_at': None,
                'is_active': True,
            }
        )
        
        # Invalidate any cached client
        self._invalidate_client(str(account.id))
        
        return str(account.id)
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get decrypted session for the account.
        
        Note: For session-based auth, this returns the decrypted session JSON.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Decrypted session JSON string
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'instagram',
                status_code=404,
                retryable=False
            )
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Session-based auth doesn't support token refresh.
        If session expires, user must re-authenticate.
        """
        # No-op for session-based auth
        pass
    
    def _handle_error(self, e: Exception, account_id: str):
        """Handle Instagram API errors."""
        error_str = str(e).lower()
        
        # Check for rate limit
        if 'rate limit' in error_str or '429' in error_str or 'too many' in error_str:
            self.rate_limiter.pause_requests(
                account_id,
                self.RATE_LIMIT_PAUSE_SECONDS,
                'fetch'
            )
            raise RateLimitError(
                'Instagram rate limit exceeded',
                'instagram',
                self.RATE_LIMIT_PAUSE_SECONDS
            )
        
        # Check for auth errors
        if 'login_required' in error_str or 'unauthorized' in error_str or '401' in error_str:
            self._invalidate_client(account_id)
            raise PlatformAPIError(
                'Instagram session expired or invalid',
                'instagram',
                status_code=401,
                retryable=False
            )
        
        # Check for challenge/verification required
        if 'challenge' in error_str or 'checkpoint' in error_str:
            self._invalidate_client(account_id)
            raise PlatformAPIError(
                'Instagram requires verification. Please complete verification in browser and re-login.',
                'instagram',
                status_code=403,
                retryable=False
            )
        
        # Check for forbidden
        if 'forbidden' in error_str or '403' in error_str:
            raise PlatformAPIError(
                'Instagram access forbidden. Account may be restricted.',
                'instagram',
                status_code=403,
                retryable=False
            )
        
        raise PlatformAPIError(
            f'Failed to access Instagram: {e}',
            'instagram',
            retryable=True,
            original_error=e
        )

    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get Instagram DM conversations (inbox threads).
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversation dictionaries
            
        Requirements: 5.2
        """
        def _fetch():
            return self._fetch_conversations(account_id)
        
        return self.execute_with_retry(_fetch, account_id, 'fetch')
    
    def _fetch_conversations(self, account_id: str) -> List[Dict]:
        """
        Fetch DM inbox threads using instagrapi.
        
        Requirements: 5.2
        """
        print(f'[instagram] _fetch_conversations called for account: {account_id}')
        
        print(f'[instagram] Getting/creating client...')
        client = self._get_or_create_client(account_id)
        print(f'[instagram] Client obtained successfully')
        
        account = ConnectedAccount.objects.get(id=account_id)
        print(f'[instagram] Account: {account.platform_username}')
        
        try:
            # Apply human-like delay before request
            print(f'[instagram] Applying human-like delay...')
            self.apply_human_delay(account_id)
            
            # Get direct inbox threads
            print(f'[instagram] Calling client.direct_threads(amount=20)...')
            threads = client.direct_threads(amount=20)
            print(f'[instagram] Got {len(threads) if threads else 0} threads')
            
            conversations = []
            for thread in threads:
                # Get the other participant(s)
                other_users = [u for u in thread.users if str(u.pk) != str(account.platform_user_id)]
                
                if other_users:
                    other_user = other_users[0]
                    participant_name = other_user.full_name or other_user.username
                    participant_id = str(other_user.pk)
                    participant_avatar = str(other_user.profile_pic_url) if other_user.profile_pic_url else None
                else:
                    # Group chat or self-chat
                    participant_name = thread.thread_title or 'Group Chat'
                    participant_id = ''
                    participant_avatar = None
                
                # Get last message time
                last_message_at = None
                if thread.messages:
                    last_msg = thread.messages[0]
                    last_message_at = last_msg.timestamp.isoformat() if last_msg.timestamp else None
                
                conv_data = {
                    'id': '',
                    'accountId': account_id,
                    'platformConversationId': thread.id,
                    'participantName': participant_name,
                    'participantId': participant_id,
                    'participantAvatarUrl': participant_avatar,
                    'lastMessageAt': last_message_at,
                    'unreadCount': 0,  # instagrapi doesn't provide unread count directly
                    'isGroup': len(thread.users) > 2,
                    'createdAt': datetime.now().isoformat(),
                    'updatedAt': datetime.now().isoformat(),
                }
                conversations.append(conv_data)
            
            return conversations
            
        except Exception as e:
            self._handle_error(e, account_id)

    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch DM messages from all inbox threads.
        
        Args:
            account_id: The connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 5.2
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
        Fetch messages from all DM threads.
        
        Requirements: 5.2
        """
        client = self._get_or_create_client(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Get inbox threads
            threads = client.direct_threads(amount=20)
            
            all_messages = []
            for thread in threads:
                # Apply small delay between thread fetches
                time.sleep(self.rate_limiter.get_random_delay(1000, 3000))
                
                try:
                    # Get messages for this thread
                    messages = client.direct_messages(thread.id, amount=20)
                    
                    for msg in messages:
                        # Filter by date if since is provided
                        if since and msg.timestamp and msg.timestamp < since:
                            continue
                        
                        # Determine if outgoing
                        is_outgoing = str(msg.user_id) == str(account.platform_user_id)
                        
                        # Get sender info
                        sender_name = str(msg.user_id)
                        for user in thread.users:
                            if str(user.pk) == str(msg.user_id):
                                sender_name = user.full_name or user.username
                                break
                        
                        # Get message content
                        content = ''
                        message_type = 'text'
                        media_url = None
                        
                        if msg.text:
                            content = msg.text
                            message_type = 'text'
                        elif msg.media:
                            # Handle media messages
                            if hasattr(msg.media, 'video_url') and msg.media.video_url:
                                message_type = 'video'
                                media_url = str(msg.media.video_url)
                                content = '[Video]'
                            elif hasattr(msg.media, 'thumbnail_url') and msg.media.thumbnail_url:
                                message_type = 'image'
                                media_url = str(msg.media.thumbnail_url)
                                content = '[Photo]'
                            else:
                                content = '[Media]'
                        elif msg.voice_media:
                            message_type = 'audio'
                            content = '[Voice Message]'
                            if hasattr(msg.voice_media, 'media') and msg.voice_media.media:
                                media_url = str(msg.voice_media.media.audio.audio_src)
                        elif msg.reel_share:
                            message_type = 'reel'
                            content = '[Reel Share]'
                        elif msg.story_share:
                            message_type = 'story'
                            content = '[Story Share]'
                        elif msg.link:
                            message_type = 'link'
                            content = msg.link.text or '[Link]'
                        else:
                            content = '[Message]'
                        
                        message_data = {
                            'id': '',
                            'conversationId': thread.id,
                            'platformMessageId': msg.id,
                            'senderId': str(msg.user_id),
                            'senderName': sender_name,
                            'content': content,
                            'messageType': message_type,
                            'mediaUrl': media_url,
                            'isOutgoing': is_outgoing,
                            'isRead': False,
                            'sentAt': msg.timestamp.isoformat() if msg.timestamp else datetime.now().isoformat(),
                            'createdAt': datetime.now().isoformat(),
                        }
                        
                        all_messages.append(message_data)
                        
                except Exception as thread_error:
                    print(f'[instagram] Failed to fetch messages for thread {thread.id}: {thread_error}')
                    continue
            
            return all_messages
            
        except Exception as e:
            self._handle_error(e, account_id)

    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send an Instagram DM.
        
        Args:
            account_id: The connected account ID
            conversation_id: The thread ID
            content: The message text to send
            
        Returns:
            The sent message dictionary
            
        Requirements: 5.3
        """
        # Check daily limit before attempting to send
        remaining = self.rate_limiter.get_daily_remaining(account_id)
        if remaining is not None and remaining <= 0:
            raise RateLimitError(
                f'Daily message limit ({self.DAILY_MESSAGE_LIMIT}) reached',
                'instagram',
                self._get_seconds_until_midnight()
            )
        
        def _send():
            return self._send_dm(account_id, conversation_id, content)
        
        return self.execute_with_retry(_send, account_id, 'send')
    
    def _get_seconds_until_midnight(self) -> int:
        """Calculate seconds until midnight for daily limit reset."""
        now = datetime.now()
        midnight = (now + timedelta(days=1)).replace(
            hour=0, minute=0, second=0, microsecond=0
        )
        return int((midnight - now).total_seconds())
    
    def _send_dm(
        self,
        account_id: str,
        conversation_id: str,
        content: str
    ) -> Dict:
        """
        Send a DM using instagrapi.
        
        Requirements: 5.3
        """
        client = self._get_or_create_client(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay (60 seconds between messages)
            self.apply_human_delay(account_id)
            
            # Send the message to the thread
            result = client.direct_send(content, thread_ids=[conversation_id])
            
            # Extract message ID from result
            message_id = str(int(time.time() * 1000))
            if result and hasattr(result, 'id'):
                message_id = result.id
            
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
        # instagrapi doesn't have a direct mark_as_read method for individual messages
        print(f'[instagram] mark_as_read called for {message_id} (not directly supported)')
    
    def verify_session(self, account_id: str) -> bool:
        """
        Verify that the stored session is still valid.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            True if session is valid, False otherwise
        """
        try:
            client = self._get_or_create_client(account_id)
            # Try to get user info to verify session
            user_info = client.account_info()
            return user_info is not None
        except Exception as e:
            print(f'[instagram] Session verification failed: {e}')
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
instagram_session_adapter = InstagramSessionAdapter()
