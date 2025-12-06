"""
LinkedIn adapter using linkedin-api for cookie-based authentication.

This adapter uses browser cookies (li_at, JSESSIONID) instead of OAuth
to access LinkedIn messages, which are not available on the free API tier.

Requirements: 4.1, 4.2, 4.3
"""

import json
import time
import re
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


# LinkedIn cookie-based rate limit config (fast UX, minimal delay)
LINKEDIN_COOKIE_RATE_LIMIT = RateLimitConfig(
    requests_per_window=10,
    window_seconds=60,
    min_delay_ms=1000,  # 1 second minimum between requests
    max_delay_ms=3000,  # 3 seconds maximum (random delay)
    daily_limit=100  # Max 100 messages per day
)


class LinkedInCookieAdapter(BasePlatformAdapter):
    """
    LinkedIn adapter using linkedin-api library for cookie-based authentication.
    
    This adapter provides access to LinkedIn messages using browser session cookies,
    bypassing the need for expensive API access.
    
    Requirements: 4.1, 4.2, 4.3
    """
    
    # Rate limiting constants
    FETCH_INTERVAL_SECONDS = 3  # 1 request per 3 seconds for fetching
    SEND_INTERVAL_SECONDS = 3  # 1 message per 3 seconds
    DAILY_MESSAGE_LIMIT = 100  # Max 100 messages per day
    RATE_LIMIT_PAUSE_SECONDS = 120  # 2 minutes pause on rate limit
    
    def __init__(self):
        super().__init__('linkedin')
        # Override rate limit config for cookie-based access
        self.rate_limit_config = LINKEDIN_COOKIE_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=LINKEDIN_COOKIE_RATE_LIMIT)
        self._clients: Dict[str, Any] = {}  # Cache linkedin-api clients per account

    def _get_client_cache_key(self, account_id: str) -> str:
        """Get cache key for linkedin-api client."""
        return f'linkedin:client:{account_id}'
    
    def _extract_message_content(self, msg: Dict, msg_event: Dict) -> str:
        """
        Extract message content from LinkedIn API response.
        Handles multiple response formats that LinkedIn uses.
        
        Args:
            msg: The full message object from API
            msg_event: The MessageEvent content (may be empty dict)
            
        Returns:
            Message text content or fallback string
        """
        content = ''
        
        # Path 1: eventContent.MessageEvent.attributedBody.text (most common)
        if msg_event:
            attr_body = msg_event.get('attributedBody', {})
            if attr_body:
                text = attr_body.get('text', '')
                if text:
                    content = text
            
            # Path 2: eventContent.MessageEvent.body
            if not content:
                body = msg_event.get('body', '')
                if body and isinstance(body, str):
                    content = body
            
            # Path 3: customContent for special messages
            if not content:
                custom_content = msg_event.get('customContent', {})
                if custom_content:
                    # InMail or sponsored message
                    body = custom_content.get('body', '')
                    if body:
                        content = body
        
        # Path 4: Direct eventContent structure (alternative format)
        if not content:
            event_content = msg.get('eventContent', {})
            # Try different nested structures
            for key in event_content:
                if 'MessageEvent' in key or 'message' in key.lower():
                    nested = event_content[key]
                    if isinstance(nested, dict):
                        # Check attributedBody first
                        attr_body = nested.get('attributedBody', {})
                        if attr_body and attr_body.get('text'):
                            content = attr_body.get('text')
                            break
                        # Then body
                        body = nested.get('body', '')
                        if body:
                            content = body
                            break
        
        # Path 5: Root level body field
        if not content:
            body = msg.get('body', {})
            if isinstance(body, dict):
                content = body.get('text', '')
            elif isinstance(body, str):
                content = body
        
        # Path 6: subContent for system messages (connections, shares, etc.)
        if not content:
            sub_content = msg.get('subContent', {})
            if sub_content:
                text = sub_content.get('text', '')
                if text:
                    content = f'[{text}]'
        
        # Path 7: Check for reaction or other event types
        if not content:
            event_content = msg.get('eventContent', {})
            # Reaction event
            if 'com.linkedin.voyager.messaging.event.ReactionEvent' in event_content:
                reaction = event_content['com.linkedin.voyager.messaging.event.ReactionEvent']
                emoji = reaction.get('emoji', '👍')
                content = f'[Reacted with {emoji}]'
            # Participant change
            elif 'com.linkedin.voyager.messaging.event.ParticipantChangeEvent' in event_content:
                content = '[Participant changed]'
            # Read receipt
            elif 'com.linkedin.voyager.messaging.event.ReadReceiptEvent' in event_content:
                content = '[Message read]'
            # Conversation name change
            elif 'com.linkedin.voyager.messaging.event.ConversationNameUpdateEvent' in event_content:
                content = '[Conversation name updated]'
        
        # Path 8: Media attachments - check if there's media but no text
        if not content:
            if msg_event:
                attachments = msg_event.get('attachments', [])
                media_attachments = msg_event.get('mediaAttachments', [])
                if attachments or media_attachments:
                    # Check attachment types
                    for att in (attachments + media_attachments):
                        media_type = att.get('mediaType', '') or att.get('type', '')
                        name = att.get('name', '')
                        if 'image' in media_type.lower():
                            content = f'[Image: {name}]' if name else '[Image]'
                            break
                        elif 'video' in media_type.lower():
                            content = f'[Video: {name}]' if name else '[Video]'
                            break
                        elif 'audio' in media_type.lower():
                            content = f'[Audio: {name}]' if name else '[Audio]'
                            break
                        elif name:
                            content = f'[Attachment: {name}]'
                            break
                    if not content:
                        content = '[Media attachment]'
        
        # Path 9: For voice messages
        if not content:
            if msg_event and msg_event.get('voiceMessage'):
                content = '[Voice message]'
        
        # Final fallback - try to find any text in the message
        if not content:
            # Recursively search for 'text' or 'body' keys
            content = self._find_text_in_dict(msg)
        
        if not content:
            content = '[No content]'
        
        return content
    
    def _find_text_in_dict(self, d: Any, depth: int = 0) -> str:
        """Recursively find text content in a nested dictionary."""
        if depth > 5:  # Prevent infinite recursion
            return ''
        
        if isinstance(d, str):
            return d if len(d) > 0 else ''
        
        if isinstance(d, dict):
            # Priority keys for text content
            for key in ['text', 'body', 'message', 'content']:
                if key in d:
                    val = d[key]
                    if isinstance(val, str) and len(val) > 0:
                        return val
                    elif isinstance(val, dict):
                        result = self._find_text_in_dict(val, depth + 1)
                        if result:
                            return result
            
            # Search other keys
            for key, val in d.items():
                if isinstance(val, (dict, list)):
                    result = self._find_text_in_dict(val, depth + 1)
                    if result:
                        return result
        
        if isinstance(d, list):
            for item in d:
                result = self._find_text_in_dict(item, depth + 1)
                if result:
                    return result
        
        return ''
    
    def _get_cookies(self, account_id: str) -> Dict[str, str]:
        """
        Get decrypted cookies for the account.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            Dict with li_at and JSESSIONID cookies
            
        Requirements: 4.1
        """
        try:
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
            
            return {
                'li_at': li_at,
                'JSESSIONID': jsessionid.replace('"', ''),  # Remove quotes if present
            }
            
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
        Fetch message conversations using direct HTTP requests.
        
        Requirements: 4.2
        """
        import requests
        
        cookies = self._get_cookies(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay before request
            self.apply_human_delay(account_id)
            
            # Direct HTTP request to LinkedIn API with proper headers
            headers = {
                'cookie': f'li_at={cookies["li_at"]}; JSESSIONID="{cookies["JSESSIONID"]}"',
                'csrf-token': cookies['JSESSIONID'],
                'x-restli-protocol-version': '2.0.0',
                'x-li-lang': 'en_US',
                'x-li-track': '{"clientVersion":"1.13.8857","mpVersion":"1.13.8857","osName":"web","timezoneOffset":5.5,"timezone":"Asia/Kolkata","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
                'accept': 'application/vnd.linkedin.normalized+json+2.1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            
            response = requests.get(
                'https://www.linkedin.com/voyager/api/messaging/conversations',
                headers=headers,
                params={'keyVersion': 'LEGACY_INBOX'},
                timeout=30
            )
            
            if response.status_code != 200:
                raise PlatformAPIError(
                    f'LinkedIn API returned {response.status_code}',
                    'linkedin',
                    status_code=response.status_code,
                    retryable=response.status_code >= 500
                )
            
            conversations_data = response.json()
            
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
        Fetch messages from all conversations using direct HTTP requests.
        
        Requirements: 4.2
        """
        import requests
        
        cookies = self._get_cookies(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            headers = {
                'cookie': f'li_at={cookies["li_at"]}; JSESSIONID="{cookies["JSESSIONID"]}"',
                'csrf-token': cookies['JSESSIONID'],
                'x-restli-protocol-version': '2.0.0',
                'x-li-lang': 'en_US',
                'x-li-track': '{"clientVersion":"1.13.8857","mpVersion":"1.13.8857","osName":"web","timezoneOffset":5.5,"timezone":"Asia/Kolkata","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
                'accept': 'application/vnd.linkedin.normalized+json+2.1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            
            # Get conversations first
            response = requests.get(
                'https://www.linkedin.com/voyager/api/messaging/conversations',
                headers=headers,
                params={'keyVersion': 'LEGACY_INBOX'},
                timeout=30
            )
            
            if response.status_code != 200:
                raise PlatformAPIError(
                    f'LinkedIn API returned {response.status_code}',
                    'linkedin',
                    status_code=response.status_code,
                    retryable=response.status_code >= 500
                )
            
            conversations_data = response.json()
            
            all_messages = []
            for conv in conversations_data.get('elements', []):
                conv_id = conv.get('entityUrn', '').split(':')[-1]
                
                if not conv_id:
                    continue
                
                # Apply delay between conversation fetches
                time.sleep(self.rate_limiter.get_random_delay(1000, 2000) / 1000)
                
                # Get messages for this conversation
                try:
                    msg_response = requests.get(
                        f'https://www.linkedin.com/voyager/api/messaging/conversations/{conv_id}/events',
                        headers=headers,
                        params={
                            'keyVersion': 'LEGACY_INBOX',
                            'count': 30,
                        },
                        timeout=30
                    )
                    
                    if msg_response.status_code != 200:
                        print(f'[linkedin] Failed to fetch messages for {conv_id}: {msg_response.status_code}')
                        continue
                    
                    messages_data = msg_response.json()
                    
                    for msg in messages_data.get('elements', []):
                        # Get message timestamp
                        created_at = msg.get('createdAt', 0)
                        msg_datetime = datetime.fromtimestamp(created_at / 1000) if created_at else datetime.now()
                        
                        # Filter by date if since is provided
                        if since and msg_datetime < since:
                            continue
                        
                        # Get sender info from eventContent
                        event_content = msg.get('eventContent', {})
                        msg_event = event_content.get('com.linkedin.voyager.messaging.event.MessageEvent', {})
                        
                        # Get sender from 'from' field
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
                        
                        # Extract message content using the comprehensive extraction method
                        content = self._extract_message_content(msg, msg_event)
                        
                        # Debug logging for troubleshooting
                        if content == '[No content]':
                            print(f'[linkedin] Warning: No content found in message. Keys: {list(msg.keys())}')
                            if event_content:
                                print(f'[linkedin] eventContent keys: {list(event_content.keys())}')
                        
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
                        attachments = msg_event.get('attachments', []) if msg_event else []
                        media_attachments = msg_event.get('mediaAttachments', []) if msg_event else []
                        all_attachments = attachments + media_attachments
                        
                        if all_attachments:
                            for attachment in all_attachments:
                                media_type = (attachment.get('mediaType', '') or attachment.get('type', '')).lower()
                                if 'image' in media_type:
                                    message_data['messageType'] = 'image'
                                elif 'video' in media_type:
                                    message_data['messageType'] = 'video'
                                elif 'audio' in media_type:
                                    message_data['messageType'] = 'audio'
                                
                                # Get attachment URL if available
                                reference = attachment.get('reference', {})
                                if reference:
                                    message_data['mediaUrl'] = reference.get('string') or reference.get('url')
                        
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
        Send a message using direct HTTP request.
        
        Requirements: 4.3
        """
        import requests
        
        cookies = self._get_cookies(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Direct HTTP request to send message
            headers = {
                'cookie': f'li_at={cookies["li_at"]}; JSESSIONID="{cookies["JSESSIONID"]}"',
                'csrf-token': cookies['JSESSIONID'],
                'x-restli-protocol-version': '2.0.0',
                'content-type': 'application/json',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            # LinkedIn message send payload
            payload = {
                'eventCreate': {
                    'value': {
                        'com.linkedin.voyager.messaging.create.MessageCreate': {
                            'body': content,
                            'attachments': [],
                            'attributedBody': {
                                'text': content,
                                'attributes': []
                            },
                            'mediaAttachments': []
                        }
                    }
                }
            }
            
            response = requests.post(
                f'https://www.linkedin.com/voyager/api/messaging/conversations/{conversation_id}/events?action=create',
                headers=headers,
                json=payload,
                timeout=30
            )
            
            if response.status_code not in [200, 201]:
                raise PlatformAPIError(
                    f'LinkedIn API returned {response.status_code}: {response.text[:200]}',
                    'linkedin',
                    status_code=response.status_code,
                    retryable=response.status_code >= 500
                )
            
            # Generate message ID from timestamp
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
        import requests
        
        try:
            cookies = self._get_cookies(account_id)
            
            headers = {
                'cookie': f'li_at={cookies["li_at"]}; JSESSIONID="{cookies["JSESSIONID"]}"',
                'csrf-token': cookies['JSESSIONID'],
                'x-restli-protocol-version': '2.0.0',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36'
            }
            
            # Try to get conversations to verify cookies
            response = requests.get(
                'https://www.linkedin.com/voyager/api/messaging/conversations?keyVersion=LEGACY_INBOX&count=1',
                headers=headers,
                timeout=15
            )
            
            return response.status_code == 200
        except Exception as e:
            print(f'[linkedin] Cookie verification failed: {e}')
            self._invalidate_client(account_id)
            return False
    
    def get_conversation_messages(self, account_id: str, conversation_id: str) -> List[Dict]:
        """
        Fetch messages for a specific conversation.
        
        Args:
            account_id: The connected account ID
            conversation_id: The conversation ID
            
        Returns:
            List of message dictionaries
        """
        import requests
        
        cookies = self._get_cookies(account_id)
        account = ConnectedAccount.objects.get(id=account_id)
        
        try:
            self.apply_human_delay(account_id)
            
            headers = {
                'cookie': f'li_at={cookies["li_at"]}; JSESSIONID="{cookies["JSESSIONID"]}"',
                'csrf-token': cookies['JSESSIONID'],
                'x-restli-protocol-version': '2.0.0',
                'x-li-lang': 'en_US',
                'x-li-track': '{"clientVersion":"1.13.8857","mpVersion":"1.13.8857","osName":"web","timezoneOffset":5.5,"timezone":"Asia/Kolkata","deviceFormFactor":"DESKTOP","mpName":"voyager-web"}',
                'accept': 'application/vnd.linkedin.normalized+json+2.1',
                'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
            }
            
            # Use decorated endpoint to get full message content
            response = requests.get(
                f'https://www.linkedin.com/voyager/api/messaging/conversations/{conversation_id}/events',
                headers=headers,
                params={
                    'keyVersion': 'LEGACY_INBOX',
                    'count': 50,  # Get more messages
                },
                timeout=30
            )
            
            if response.status_code != 200:
                raise PlatformAPIError(
                    f'LinkedIn API returned {response.status_code}',
                    'linkedin',
                    status_code=response.status_code,
                    retryable=response.status_code >= 500
                )
            
            raw_response = response.json()
            messages = []
            
            # Debug: Log full response structure for first call
            print(f'[linkedin] Fetching messages for conversation {conversation_id}')
            print(f'[linkedin] Response keys: {list(raw_response.keys())}')
            
            # Handle different response wrappers
            messages_data = raw_response
            if 'data' in raw_response:
                messages_data = raw_response['data']
            
            # Handle normalized JSON response (LinkedIn may return data in 'included' array)
            elements = messages_data.get('elements', [])
            included = messages_data.get('included', [])
            
            # Build lookup map from included data
            included_map = {}
            for item in included:
                urn = item.get('entityUrn', '') or item.get('$id', '') or item.get('*elements', '')
                if urn:
                    included_map[urn] = item
                # Also map by dashboard entity URN
                dash_urn = item.get('dashEntityUrn', '')
                if dash_urn:
                    included_map[dash_urn] = item
            
            print(f'[linkedin] Found {len(elements)} elements, {len(included)} included items')
            
            # If elements is empty but we have included data, extract events from there
            if not elements and included:
                print(f'[linkedin] Using included array to find messages')
                for item in included:
                    item_type = item.get('$type', '') or ''
                    # Look for message events in included array
                    if 'Event' in item_type or 'Message' in item_type or item.get('eventContent'):
                        elements.append(item)
                print(f'[linkedin] Extracted {len(elements)} message events from included')
            
            # Also check if elements contain references to included items
            resolved_elements = []
            for elem in elements:
                if isinstance(elem, str) and elem in included_map:
                    resolved_elements.append(included_map[elem])
                elif isinstance(elem, dict):
                    # Check if any fields are references
                    resolved = dict(elem)
                    for key, val in elem.items():
                        if isinstance(val, str) and val.startswith('urn:') and val in included_map:
                            resolved[key] = included_map[val]
                    resolved_elements.append(resolved)
                else:
                    resolved_elements.append(elem)
            
            elements = resolved_elements if resolved_elements else elements
            
            if elements:
                first_msg = elements[0] if isinstance(elements[0], dict) else {}
                print(f'[linkedin] Sample message structure keys: {list(first_msg.keys()) if isinstance(first_msg, dict) else "not a dict"}')
                ec = first_msg.get('eventContent', {}) if isinstance(first_msg, dict) else {}
                if ec:
                    print(f'[linkedin] eventContent keys: {list(ec.keys())}')
            
            for msg in elements:
                if not isinstance(msg, dict):
                    continue
                created_at = msg.get('createdAt', 0)
                msg_datetime = datetime.fromtimestamp(created_at / 1000) if created_at else datetime.now()
                
                # Get sender info
                event_content = msg.get('eventContent', {})
                msg_event = event_content.get('com.linkedin.voyager.messaging.event.MessageEvent', {})
                
                sender = msg.get('from', {})
                sender_member = sender.get('com.linkedin.voyager.messaging.MessagingMember', {})
                sender_profile = sender_member.get('miniProfile', {})
                sender_urn = sender_profile.get('entityUrn', '')
                sender_id = sender_urn.split(':')[-1] if sender_urn else ''
                
                sender_first = sender_profile.get('firstName', '')
                sender_last = sender_profile.get('lastName', '')
                sender_name = f"{sender_first} {sender_last}".strip() or 'Unknown'
                
                is_outgoing = account.platform_user_id in sender_urn if sender_urn else False
                
                # Extract message content using the comprehensive extraction method
                content = self._extract_message_content(msg, msg_event)
                
                # Debug logging for messages with no content
                if content == '[No content]':
                    print(f'[linkedin] Warning: No content in message {msg.get("entityUrn", "unknown")}')
                    print(f'[linkedin] Message keys: {list(msg.keys())}')
                    if event_content:
                        print(f'[linkedin] eventContent: {json.dumps(event_content, default=str)[:500]}')
                
                # Determine message type from attachments
                message_type = 'text'
                media_url = None
                
                if msg_event:
                    attachments = msg_event.get('attachments', []) + msg_event.get('mediaAttachments', [])
                    for att in attachments:
                        att_type = (att.get('mediaType', '') or att.get('type', '')).lower()
                        if 'image' in att_type:
                            message_type = 'image'
                        elif 'video' in att_type:
                            message_type = 'video'
                        elif 'audio' in att_type:
                            message_type = 'audio'
                        
                        ref = att.get('reference', {})
                        if ref:
                            media_url = ref.get('string') or ref.get('url')
                
                messages.append({
                    'id': '',
                    'conversationId': conversation_id,
                    'platformMessageId': msg.get('entityUrn', '').split(':')[-1],
                    'senderId': sender_id,
                    'senderName': sender_name,
                    'content': content,
                    'messageType': message_type,
                    'mediaUrl': media_url,
                    'isOutgoing': is_outgoing,
                    'isRead': False,
                    'sentAt': msg_datetime.isoformat(),
                    'createdAt': datetime.now().isoformat(),
                })
            
            print(f'[linkedin] Fetched {len(messages)} messages for conversation {conversation_id}')
            return messages
            
        except Exception as e:
            self._handle_error(e, account_id)
    
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
