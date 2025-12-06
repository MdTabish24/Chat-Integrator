"""
WhatsApp Web adapter using Playwright for browser automation.

This adapter uses Playwright to automate WhatsApp Web for messaging,
providing QR code authentication and browser-based message handling.

Requirements: 7.1, 7.2, 7.3, 7.4
"""

import json
import time
import asyncio
import base64
import os
import uuid
from typing import List, Dict, Optional, Any
from datetime import datetime, timedelta
from pathlib import Path
from django.conf import settings
from django.core.cache import cache

from .base import BasePlatformAdapter, PlatformAPIError, RateLimitError
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import encrypt, decrypt
from apps.core.services.rate_limiter import (
    RateLimiter,
    RateLimitConfig,
)


# WhatsApp Web rate limit config (conservative for browser automation)
WHATSAPP_WEB_RATE_LIMIT = RateLimitConfig(
    requests_per_window=2,
    window_seconds=60,
    min_delay_ms=30000,  # 30 seconds minimum between requests
    max_delay_ms=60000,  # 60 seconds maximum (random delay)
    daily_limit=None  # No strict daily limit for WhatsApp
)


class WhatsAppWebAdapter(BasePlatformAdapter):
    """
    WhatsApp Web adapter using Playwright for browser automation.
    
    This adapter provides access to WhatsApp messages by automating
    WhatsApp Web in a headless browser, using QR code authentication.
    
    Requirements: 7.1, 7.2, 7.3, 7.4
    """
    
    # WhatsApp Web URL
    WHATSAPP_WEB_URL = 'https://web.whatsapp.com'
    
    # Rate limiting constants
    FETCH_INTERVAL_SECONDS = 30  # 1 refresh per 30 seconds
    SEND_INTERVAL_SECONDS = 5  # Human-like delay between messages
    
    # Session storage directory
    SESSION_DIR = Path(settings.BASE_DIR) / 'whatsapp_sessions'
    
    # QR code cache timeout (2 minutes)
    QR_CODE_TIMEOUT = 120
    
    # Browser timeout settings
    PAGE_TIMEOUT = 60000  # 60 seconds
    NAVIGATION_TIMEOUT = 90000  # 90 seconds for initial load
    
    def __init__(self):
        super().__init__('whatsapp')
        # Override rate limit config for browser-based access
        self.rate_limit_config = WHATSAPP_WEB_RATE_LIMIT
        self.rate_limiter = RateLimiter(config=WHATSAPP_WEB_RATE_LIMIT)
        self._browsers: Dict[str, Any] = {}  # Cache browser instances per account
        self._pages: Dict[str, Any] = {}  # Cache page instances per account
        self._qr_codes: Dict[str, str] = {}  # Cache QR codes per session
        
        # Ensure session directory exists
        self.SESSION_DIR.mkdir(parents=True, exist_ok=True)
    
    def _get_session_path(self, account_id: str) -> Path:
        """Get the session storage path for an account."""
        return self.SESSION_DIR / f'session_{account_id}'
    
    def _get_qr_cache_key(self, session_id: str) -> str:
        """Get cache key for QR code."""
        return f'whatsapp:qr:{session_id}'
    
    def _get_status_cache_key(self, session_id: str) -> str:
        """Get cache key for connection status."""
        return f'whatsapp:status:{session_id}'

    async def _get_playwright(self):
        """Get Playwright instance."""
        try:
            from playwright.async_api import async_playwright
            return async_playwright()
        except ImportError:
            raise PlatformAPIError(
                'Playwright library not installed. Install with: pip install playwright && playwright install chromium',
                'whatsapp',
                status_code=500,
                retryable=False
            )
    
    async def start_qr_session(self, user_id: str) -> Dict[str, Any]:
        """
        Start a new WhatsApp Web session and return QR code for authentication.
        
        This initiates a browser session and captures the QR code displayed
        by WhatsApp Web for the user to scan.
        
        Args:
            user_id: The user's ID
            
        Returns:
            Dictionary with session_id and qr_code (base64 encoded)
            
        Requirements: 7.1
        """
        session_id = str(uuid.uuid4())
        
        try:
            playwright = await self._get_playwright()
            pw = await playwright.start()
            
            # Launch browser with persistent context for session storage
            session_path = self._get_session_path(session_id)
            session_path.mkdir(parents=True, exist_ok=True)
            
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                    '--disable-accelerated-2d-canvas',
                    '--disable-gpu',
                ]
            )
            
            # Create context with persistent storage
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1280, 'height': 800},
                storage_state=None  # Will be saved after authentication
            )
            
            page = await context.new_page()
            page.set_default_timeout(self.PAGE_TIMEOUT)
            
            # Navigate to WhatsApp Web
            print(f'[whatsapp] Navigating to WhatsApp Web for session {session_id}')
            await page.goto(self.WHATSAPP_WEB_URL, timeout=self.NAVIGATION_TIMEOUT)
            
            # Wait for QR code to appear
            qr_code_data = await self._capture_qr_code(page, session_id)
            
            if not qr_code_data:
                await browser.close()
                raise PlatformAPIError(
                    'Failed to capture QR code from WhatsApp Web',
                    'whatsapp',
                    retryable=True
                )
            
            # Store browser and page references
            self._browsers[session_id] = {'browser': browser, 'context': context, 'playwright': pw}
            self._pages[session_id] = page
            
            # Cache session info
            cache.set(
                self._get_status_cache_key(session_id),
                {
                    'user_id': user_id,
                    'status': 'pending_qr_scan',
                    'created_at': datetime.now().isoformat(),
                },
                timeout=self.QR_CODE_TIMEOUT * 2
            )
            
            # Start background task to monitor authentication
            asyncio.create_task(self._monitor_authentication(session_id, user_id))
            
            return {
                'session_id': session_id,
                'qr_code': qr_code_data,
                'expires_in': self.QR_CODE_TIMEOUT,
                'status': 'pending_qr_scan',
            }
            
        except Exception as e:
            print(f'[whatsapp] Failed to start QR session: {e}')
            # Cleanup on error
            await self._cleanup_session(session_id)
            raise PlatformAPIError(
                f'Failed to start WhatsApp Web session: {e}',
                'whatsapp',
                retryable=True,
                original_error=e
            )
    
    async def _capture_qr_code(self, page: Any, session_id: str) -> Optional[str]:
        """
        Capture QR code from WhatsApp Web page.
        
        Args:
            page: Playwright page instance
            session_id: Session identifier
            
        Returns:
            Base64 encoded QR code image, or None if not found
            
        Requirements: 7.1
        """
        try:
            # Wait for QR code canvas to appear
            qr_selector = 'canvas[aria-label="Scan me!"], div[data-ref] canvas'
            
            await page.wait_for_selector(qr_selector, timeout=30000)
            
            # Get the QR code element
            qr_element = await page.query_selector(qr_selector)
            
            if qr_element:
                # Take screenshot of QR code
                qr_screenshot = await qr_element.screenshot()
                qr_base64 = base64.b64encode(qr_screenshot).decode('utf-8')
                
                # Cache the QR code
                cache.set(
                    self._get_qr_cache_key(session_id),
                    qr_base64,
                    timeout=self.QR_CODE_TIMEOUT
                )
                
                return qr_base64
            
            return None
            
        except Exception as e:
            print(f'[whatsapp] Failed to capture QR code: {e}')
            return None

    async def _monitor_authentication(self, session_id: str, user_id: str) -> None:
        """
        Monitor WhatsApp Web for successful authentication after QR scan.
        
        Args:
            session_id: Session identifier
            user_id: User's ID
            
        Requirements: 7.1, 7.2
        """
        try:
            page = self._pages.get(session_id)
            if not page:
                return
            
            # Wait for authentication (main chat list appears)
            # WhatsApp Web shows the chat list after successful login
            chat_list_selector = 'div[aria-label="Chat list"], #pane-side'
            
            try:
                await page.wait_for_selector(chat_list_selector, timeout=120000)  # 2 minutes
                
                # Authentication successful
                print(f'[whatsapp] Authentication successful for session {session_id}')
                
                # Save session state
                browser_data = self._browsers.get(session_id)
                if browser_data and browser_data.get('context'):
                    session_path = self._get_session_path(session_id)
                    storage_state = await browser_data['context'].storage_state()
                    
                    # Store session in database
                    await self._save_session_to_db(
                        user_id=user_id,
                        session_id=session_id,
                        storage_state=storage_state
                    )
                
                # Update status
                cache.set(
                    self._get_status_cache_key(session_id),
                    {
                        'user_id': user_id,
                        'status': 'connected',
                        'authenticated_at': datetime.now().isoformat(),
                    },
                    timeout=86400  # 24 hours
                )
                
            except Exception as timeout_error:
                print(f'[whatsapp] Authentication timeout for session {session_id}: {timeout_error}')
                cache.set(
                    self._get_status_cache_key(session_id),
                    {
                        'user_id': user_id,
                        'status': 'timeout',
                        'error': 'QR code scan timeout',
                    },
                    timeout=300
                )
                await self._cleanup_session(session_id)
                
        except Exception as e:
            print(f'[whatsapp] Error monitoring authentication: {e}')
    
    async def _save_session_to_db(
        self,
        user_id: str,
        session_id: str,
        storage_state: dict
    ) -> str:
        """
        Save WhatsApp Web session to database.
        
        Args:
            user_id: User's ID
            session_id: Session identifier
            storage_state: Playwright storage state
            
        Returns:
            Connected account ID
            
        Requirements: 7.2
        """
        from asgiref.sync import sync_to_async
        
        # Encrypt session data
        session_data = {
            'session_id': session_id,
            'storage_state': storage_state,
            'created_at': datetime.now().isoformat(),
        }
        encrypted_session = encrypt(json.dumps(session_data))
        
        # Create or update connected account
        @sync_to_async
        def save_account():
            account, created = ConnectedAccount.objects.update_or_create(
                user_id=user_id,
                platform='whatsapp_web',
                defaults={
                    'platform_user_id': session_id,
                    'platform_username': 'WhatsApp Web',
                    'access_token': encrypted_session,
                    'refresh_token': None,
                    'token_expires_at': None,
                    'is_active': True,
                }
            )
            return str(account.id)
        
        return await save_account()
    
    async def _cleanup_session(self, session_id: str) -> None:
        """
        Clean up browser resources for a session.
        
        Args:
            session_id: Session identifier
        """
        try:
            # Close page
            if session_id in self._pages:
                try:
                    await self._pages[session_id].close()
                except:
                    pass
                del self._pages[session_id]
            
            # Close browser
            if session_id in self._browsers:
                browser_data = self._browsers[session_id]
                try:
                    if browser_data.get('browser'):
                        await browser_data['browser'].close()
                    if browser_data.get('playwright'):
                        await browser_data['playwright'].stop()
                except:
                    pass
                del self._browsers[session_id]
            
            # Clear QR code cache
            cache.delete(self._get_qr_cache_key(session_id))
            
        except Exception as e:
            print(f'[whatsapp] Error cleaning up session {session_id}: {e}')
    
    def get_qr_code(self, session_id: str) -> Optional[str]:
        """
        Get cached QR code for a session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Base64 encoded QR code, or None if not found/expired
            
        Requirements: 7.1
        """
        return cache.get(self._get_qr_cache_key(session_id))
    
    def get_session_status(self, session_id: str) -> Dict[str, Any]:
        """
        Get current status of a WhatsApp Web session.
        
        Args:
            session_id: Session identifier
            
        Returns:
            Status dictionary
            
        Requirements: 7.2
        """
        status_data = cache.get(self._get_status_cache_key(session_id))
        
        if not status_data:
            return {
                'session_id': session_id,
                'status': 'unknown',
                'message': 'Session not found or expired',
            }
        
        return {
            'session_id': session_id,
            **status_data,
        }

    async def restore_session(self, account_id: str) -> bool:
        """
        Restore a WhatsApp Web session from stored credentials.
        
        Args:
            account_id: Connected account ID
            
        Returns:
            True if session restored successfully
            
        Requirements: 7.2
        """
        try:
            from asgiref.sync import sync_to_async
            
            @sync_to_async
            def get_account():
                return ConnectedAccount.objects.get(id=account_id, is_active=True)
            
            account = await get_account()
            
            if not account.access_token:
                raise PlatformAPIError(
                    'No session stored for this account',
                    'whatsapp',
                    status_code=401,
                    retryable=False
                )
            
            # Decrypt session data
            session_json = decrypt(account.access_token)
            session_data = json.loads(session_json)
            
            session_id = session_data.get('session_id')
            storage_state = session_data.get('storage_state')
            
            if not storage_state:
                raise PlatformAPIError(
                    'Invalid session data',
                    'whatsapp',
                    status_code=400,
                    retryable=False
                )
            
            # Check if already have an active session
            if session_id in self._pages:
                return True
            
            # Launch browser with stored session
            playwright = await self._get_playwright()
            pw = await playwright.start()
            
            browser = await pw.chromium.launch(
                headless=True,
                args=[
                    '--no-sandbox',
                    '--disable-setuid-sandbox',
                    '--disable-dev-shm-usage',
                ]
            )
            
            # Create context with stored session
            context = await browser.new_context(
                user_agent='Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                viewport={'width': 1280, 'height': 800},
                storage_state=storage_state
            )
            
            page = await context.new_page()
            page.set_default_timeout(self.PAGE_TIMEOUT)
            
            # Navigate to WhatsApp Web
            await page.goto(self.WHATSAPP_WEB_URL, timeout=self.NAVIGATION_TIMEOUT)
            
            # Check if session is still valid (chat list appears)
            chat_list_selector = 'div[aria-label="Chat list"], #pane-side'
            
            try:
                await page.wait_for_selector(chat_list_selector, timeout=30000)
                
                # Session is valid
                self._browsers[account_id] = {'browser': browser, 'context': context, 'playwright': pw}
                self._pages[account_id] = page
                
                print(f'[whatsapp] Session restored for account {account_id}')
                return True
                
            except:
                # Session expired, need to re-authenticate
                await browser.close()
                await pw.stop()
                
                # Mark account as needing re-authentication
                @sync_to_async
                def mark_inactive():
                    account.is_active = False
                    account.save()
                
                await mark_inactive()
                
                raise PlatformAPIError(
                    'WhatsApp Web session expired. Please scan QR code again.',
                    'whatsapp',
                    status_code=401,
                    retryable=False
                )
                
        except ConnectedAccount.DoesNotExist:
            raise PlatformAPIError(
                f'Account {account_id} not found or inactive',
                'whatsapp',
                status_code=404,
                retryable=False
            )
        except json.JSONDecodeError:
            raise PlatformAPIError(
                'Invalid session format',
                'whatsapp',
                status_code=400,
                retryable=False
            )
    
    async def disconnect_session(self, account_id: str) -> bool:
        """
        Disconnect and cleanup a WhatsApp Web session.
        
        Args:
            account_id: Connected account ID
            
        Returns:
            True if disconnected successfully
            
        Requirements: 7.5
        """
        try:
            # Cleanup browser resources
            await self._cleanup_session(account_id)
            
            # Clear session from database
            from asgiref.sync import sync_to_async
            
            @sync_to_async
            def clear_account():
                try:
                    account = ConnectedAccount.objects.get(id=account_id)
                    account.access_token = None
                    account.is_active = False
                    account.save()
                    return True
                except ConnectedAccount.DoesNotExist:
                    return False
            
            return await clear_account()
            
        except Exception as e:
            print(f'[whatsapp] Error disconnecting session: {e}')
            return False
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get decrypted session for the account.
        
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
                'whatsapp',
                status_code=404,
                retryable=False
            )
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Browser-based auth doesn't support token refresh.
        If session expires, user must scan QR code again.
        """
        pass

    async def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get WhatsApp conversations by scraping the chat list.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversation dictionaries
            
        Requirements: 7.3
        """
        # Ensure session is active
        if account_id not in self._pages:
            await self.restore_session(account_id)
        
        page = self._pages.get(account_id)
        if not page:
            raise PlatformAPIError(
                'No active WhatsApp Web session',
                'whatsapp',
                status_code=401,
                retryable=False
            )
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Wait for chat list to be visible
            chat_list_selector = 'div[aria-label="Chat list"], #pane-side'
            await page.wait_for_selector(chat_list_selector, timeout=10000)
            
            # Get all chat items
            chat_items = await page.query_selector_all('[data-testid="cell-frame-container"]')
            
            conversations = []
            for i, item in enumerate(chat_items[:50]):  # Limit to 50 conversations
                try:
                    conv_data = await self._parse_conversation_item(item, account_id, i)
                    if conv_data:
                        conversations.append(conv_data)
                except Exception as e:
                    print(f'[whatsapp] Error parsing conversation item: {e}')
                    continue
            
            return conversations
            
        except Exception as e:
            self._handle_error(e, account_id)
    
    async def _parse_conversation_item(self, item: Any, account_id: str, index: int) -> Optional[Dict]:
        """
        Parse a conversation item from the chat list.
        
        Args:
            item: Playwright element handle
            account_id: Account ID
            index: Item index for ID generation
            
        Returns:
            Conversation dictionary or None
        """
        try:
            # Get contact/group name
            name_element = await item.query_selector('[data-testid="cell-frame-title"] span[title]')
            name = await name_element.get_attribute('title') if name_element else f'Chat {index + 1}'
            
            # Get last message preview
            last_msg_element = await item.query_selector('[data-testid="last-msg-status"]')
            last_message = await last_msg_element.inner_text() if last_msg_element else ''
            
            # Get timestamp
            time_element = await item.query_selector('[data-testid="cell-frame-primary-detail"]')
            timestamp = await time_element.inner_text() if time_element else ''
            
            # Get unread count
            unread_element = await item.query_selector('[data-testid="icon-unread-count"]')
            unread_count = 0
            if unread_element:
                unread_text = await unread_element.inner_text()
                try:
                    unread_count = int(unread_text)
                except:
                    unread_count = 1 if unread_text else 0
            
            # Get avatar URL if available
            avatar_element = await item.query_selector('img[data-testid="user-avatar"]')
            avatar_url = await avatar_element.get_attribute('src') if avatar_element else None
            
            # Generate a unique conversation ID based on name (since WhatsApp Web doesn't expose IDs)
            conv_id = f'wa_{hash(name) % 10000000}'
            
            return {
                'id': '',
                'accountId': account_id,
                'platformConversationId': conv_id,
                'participantName': name,
                'participantId': conv_id,
                'participantAvatarUrl': avatar_url,
                'lastMessage': last_message,
                'lastMessageAt': timestamp,
                'unreadCount': unread_count,
                'createdAt': datetime.now().isoformat(),
                'updatedAt': datetime.now().isoformat(),
            }
            
        except Exception as e:
            print(f'[whatsapp] Error parsing conversation: {e}')
            return None
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from WhatsApp Web.
        
        Note: This is a synchronous wrapper for the async implementation.
        
        Args:
            account_id: The connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 7.3
        """
        return asyncio.get_event_loop().run_until_complete(
            self._fetch_messages_async(account_id, since)
        )
    
    async def _fetch_messages_async(
        self,
        account_id: str,
        since: Optional[datetime] = None
    ) -> List[Dict]:
        """
        Async implementation of fetch_messages.
        
        Requirements: 7.3
        """
        # Ensure session is active
        if account_id not in self._pages:
            await self.restore_session(account_id)
        
        page = self._pages.get(account_id)
        if not page:
            raise PlatformAPIError(
                'No active WhatsApp Web session',
                'whatsapp',
                status_code=401,
                retryable=False
            )
        
        try:
            # Apply human-like delay
            self.apply_human_delay(account_id)
            
            # Get messages from currently open conversation
            messages = await self._scrape_current_messages(page, account_id)
            
            return messages
            
        except Exception as e:
            self._handle_error(e, account_id)
    
    async def _scrape_current_messages(self, page: Any, account_id: str) -> List[Dict]:
        """
        Scrape messages from the currently open conversation.
        
        Args:
            page: Playwright page instance
            account_id: Account ID
            
        Returns:
            List of message dictionaries
            
        Requirements: 7.3
        """
        messages = []
        
        try:
            # Wait for message container
            msg_container_selector = '[data-testid="conversation-panel-messages"]'
            await page.wait_for_selector(msg_container_selector, timeout=5000)
            
            # Get all message elements
            msg_elements = await page.query_selector_all('[data-testid="msg-container"]')
            
            for i, msg_el in enumerate(msg_elements[-100:]):  # Last 100 messages
                try:
                    msg_data = await self._parse_message_element(msg_el, account_id, i)
                    if msg_data:
                        messages.append(msg_data)
                except Exception as e:
                    print(f'[whatsapp] Error parsing message: {e}')
                    continue
            
        except Exception as e:
            print(f'[whatsapp] No conversation open or error: {e}')
        
        return messages
    
    async def _parse_message_element(self, element: Any, account_id: str, index: int) -> Optional[Dict]:
        """
        Parse a message element from the conversation.
        
        Args:
            element: Playwright element handle
            account_id: Account ID
            index: Message index
            
        Returns:
            Message dictionary or None
        """
        try:
            # Check if outgoing message
            is_outgoing = await element.evaluate('el => el.classList.contains("message-out")')
            
            # Get message text
            text_element = await element.query_selector('[data-testid="msg-text"], .selectable-text')
            content = await text_element.inner_text() if text_element else ''
            
            # Get timestamp
            time_element = await element.query_selector('[data-testid="msg-meta"] span')
            timestamp = await time_element.inner_text() if time_element else ''
            
            # Check for media
            message_type = 'text'
            media_url = None
            
            img_element = await element.query_selector('img[data-testid="media-url-provider"]')
            if img_element:
                message_type = 'image'
                media_url = await img_element.get_attribute('src')
                if not content:
                    content = '[Photo]'
            
            video_element = await element.query_selector('[data-testid="video-player"]')
            if video_element:
                message_type = 'video'
                if not content:
                    content = '[Video]'
            
            audio_element = await element.query_selector('[data-testid="audio-player"]')
            if audio_element:
                message_type = 'audio'
                if not content:
                    content = '[Voice Message]'
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': f'wa_msg_{index}_{int(time.time())}',
                'senderId': 'me' if is_outgoing else 'other',
                'senderName': 'You' if is_outgoing else 'Contact',
                'content': content,
                'messageType': message_type,
                'mediaUrl': media_url,
                'isOutgoing': is_outgoing,
                'isRead': True,
                'sentAt': timestamp,
                'createdAt': datetime.now().isoformat(),
            }
            
        except Exception as e:
            print(f'[whatsapp] Error parsing message element: {e}')
            return None

    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a WhatsApp message.
        
        Note: This is a synchronous wrapper for the async implementation.
        
        Args:
            account_id: The connected account ID
            conversation_id: The conversation identifier (contact name)
            content: The message text to send
            
        Returns:
            The sent message dictionary
            
        Requirements: 7.4
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
        """
        Async implementation of send_message with human-like delays.
        
        Requirements: 7.4
        """
        # Ensure session is active
        if account_id not in self._pages:
            await self.restore_session(account_id)
        
        page = self._pages.get(account_id)
        if not page:
            raise PlatformAPIError(
                'No active WhatsApp Web session',
                'whatsapp',
                status_code=401,
                retryable=False
            )
        
        try:
            # Apply human-like delay before sending
            self.apply_human_delay(account_id)
            
            # First, search for and open the conversation
            await self._open_conversation(page, conversation_id)
            
            # Wait a bit before typing (human-like)
            await asyncio.sleep(self.rate_limiter.get_random_delay(500, 1500))
            
            # Find the message input
            input_selector = '[data-testid="conversation-compose-box-input"], div[contenteditable="true"][data-tab="10"]'
            await page.wait_for_selector(input_selector, timeout=10000)
            
            input_element = await page.query_selector(input_selector)
            if not input_element:
                raise PlatformAPIError(
                    'Could not find message input',
                    'whatsapp',
                    retryable=True
                )
            
            # Type message with human-like delays
            await self._type_with_human_delay(page, input_element, content)
            
            # Wait a bit before sending (human-like)
            await asyncio.sleep(self.rate_limiter.get_random_delay(300, 800))
            
            # Click send button
            send_button_selector = '[data-testid="send"], button[aria-label="Send"]'
            send_button = await page.query_selector(send_button_selector)
            
            if send_button:
                await send_button.click()
            else:
                # Try pressing Enter as fallback
                await input_element.press('Enter')
            
            # Wait for message to be sent
            await asyncio.sleep(self.rate_limiter.get_random_delay(1000, 2000))
            
            return {
                'id': '',
                'conversationId': conversation_id,
                'platformMessageId': f'wa_sent_{int(time.time())}',
                'senderId': 'me',
                'senderName': 'You',
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
    
    async def _open_conversation(self, page: Any, conversation_id: str) -> None:
        """
        Open a conversation by searching for the contact.
        
        Args:
            page: Playwright page instance
            conversation_id: Conversation identifier (contact name or phone)
            
        Requirements: 7.4
        """
        try:
            # Click on search button
            search_button = await page.query_selector('[data-testid="chat-list-search"]')
            if search_button:
                await search_button.click()
                await asyncio.sleep(self.rate_limiter.get_random_delay(300, 600))
            
            # Find search input
            search_input_selector = '[data-testid="chat-list-search-input"], div[contenteditable="true"][data-tab="3"]'
            search_input = await page.query_selector(search_input_selector)
            
            if search_input:
                # Clear existing text
                await search_input.click()
                await page.keyboard.press('Control+a')
                await page.keyboard.press('Backspace')
                
                # Type search query (contact name from conversation_id)
                # Extract name from conversation_id if it's in our format
                search_term = conversation_id
                if conversation_id.startswith('wa_'):
                    # Try to find by clicking on chat list items
                    pass
                
                await self._type_with_human_delay(page, search_input, search_term)
                
                # Wait for search results
                await asyncio.sleep(self.rate_limiter.get_random_delay(1000, 2000))
                
                # Click on first result
                first_result = await page.query_selector('[data-testid="cell-frame-container"]')
                if first_result:
                    await first_result.click()
                    await asyncio.sleep(self.rate_limiter.get_random_delay(500, 1000))
                    
        except Exception as e:
            print(f'[whatsapp] Error opening conversation: {e}')
    
    async def _type_with_human_delay(self, page: Any, element: Any, text: str) -> None:
        """
        Type text with human-like delays between keystrokes.
        
        Args:
            page: Playwright page instance
            element: Input element
            text: Text to type
            
        Requirements: 7.4
        """
        await element.click()
        
        for char in text:
            await element.type(char, delay=self.rate_limiter.get_random_delay(30, 100) * 1000)
            
            # Occasionally pause longer (simulating thinking)
            if char in '.!?' or (len(text) > 20 and text.index(char) % 15 == 0):
                await asyncio.sleep(self.rate_limiter.get_random_delay(100, 300))
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark a message as read.
        
        Note: WhatsApp Web automatically marks messages as read when viewed.
        
        Args:
            account_id: The connected account ID
            message_id: The message ID to mark as read
        """
        # WhatsApp Web automatically marks messages as read when the conversation is open
        print(f'[whatsapp] mark_as_read called for {message_id} (automatic in WhatsApp Web)')
    
    def _handle_error(self, e: Exception, account_id: str):
        """Handle WhatsApp Web errors."""
        error_str = str(e).lower()
        
        # Check for session disconnection
        if 'qr' in error_str or 'scan' in error_str or 'logged out' in error_str:
            # Session disconnected
            asyncio.get_event_loop().run_until_complete(
                self._cleanup_session(account_id)
            )
            raise PlatformAPIError(
                'WhatsApp Web session disconnected. Please scan QR code again.',
                'whatsapp',
                status_code=401,
                retryable=False
            )
        
        # Check for timeout
        if 'timeout' in error_str:
            raise PlatformAPIError(
                'WhatsApp Web operation timed out. Please try again.',
                'whatsapp',
                retryable=True,
                original_error=e
            )
        
        raise PlatformAPIError(
            f'WhatsApp Web error: {e}',
            'whatsapp',
            retryable=True,
            original_error=e
        )


# Create singleton instance
whatsapp_web_adapter = WhatsAppWebAdapter()
