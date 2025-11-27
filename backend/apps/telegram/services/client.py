"""
Telegram User Client Service for user-based Telegram integration.
Uses Telethon library (MTProto client).

Migrated from backend/src/services/telegram/TelegramUserClient.ts
"""

from typing import Optional, Dict, List
from django.conf import settings
from telethon import TelegramClient
from telethon.sessions import StringSession
from telethon.tl.functions.messages import GetDialogsRequest
from telethon.tl.types import InputPeerEmpty
import asyncio

from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt, encrypt


class TelegramUserClientService:
    """
    Telegram User Client Service
    
    Migrated from: TelegramUserClientService in TelegramUserClient.ts
    Note: Python doesn't have direct MTProto user client like Node.js 'telegram' library
    We'll use Bot API which is more stable for production
    """
    
    def __init__(self):
        self.api_id = int(settings.TELEGRAM_API_ID) if settings.TELEGRAM_API_ID else 0
        self.api_hash = settings.TELEGRAM_API_HASH
        self.sessions: Dict[str, TelegramClient] = {}
        self.temp_sessions: Dict[str, TelegramClient] = {}  # For verification flow
    
    async def start_phone_verification(self, user_id: str, phone_number: str) -> Dict[str, str]:
        """
        Start phone verification using Telethon
        
        Migrated from: startPhoneVerification() in TelegramUserClient.ts
        
        Args:
            user_id: User ID
            phone_number: Phone number
            
        Returns:
            Dict with phoneCodeHash
        """
        print(f'[telegram-user] Starting phone verification for: {phone_number}')
        
        try:
            # Create Telethon client with empty session
            client = TelegramClient(
                StringSession(),
                self.api_id,
                self.api_hash,
                connection_retries=5,
                timeout=30
            )
            
            await client.connect()
            print('[telegram-user] Client connected')
            
            # Send code
            result = await client.send_code_request(phone_number)
            print('[telegram-user] Code sent successfully')
            
            # Store temp session
            temp_key = f'temp_{user_id}_{phone_number}'
            self.temp_sessions[temp_key] = client
            
            return {'phoneCodeHash': result.phone_code_hash}
        
        except Exception as e:
            print(f'[telegram-user] Phone verification failed: {e}')
            raise Exception(f'Failed to send verification code: {str(e)}')
    
    async def verify_phone_code(
        self,
        user_id: str,
        phone_number: str,
        phone_code: str,
        phone_code_hash: str,
        password: Optional[str] = None
    ) -> Dict[str, any]:
        """
        Verify phone code using Telethon
        
        Migrated from: verifyPhoneCode() in TelegramUserClient.ts
        
        Args:
            user_id: User ID
            phone_number: Phone number
            phone_code: Verification code
            phone_code_hash: Code hash
            password: 2FA password
            
        Returns:
            Dict with accountId, username, needPassword
        """
        print('[telegram-user] Verifying phone code')
        
        temp_key = f'temp_{user_id}_{phone_number}'
        client = self.temp_sessions.get(temp_key)
        
        if not client:
            raise Exception('Session not found. Please restart verification.')
        
        try:
            # Sign in with code
            try:
                await client.sign_in(phone_number, phone_code, phone_code_hash=phone_code_hash)
            except Exception as e:
                if 'SESSION_PASSWORD_NEEDED' in str(e):
                    print('[telegram-user] 2FA password required')
                    if not password:
                        return {'accountId': '', 'username': '', 'needPassword': True}
                    
                    # Sign in with password
                    await client.sign_in(password=password)
                else:
                    raise
            
            # Get user info
            me = await client.get_me()
            username = me.username or me.first_name or phone_number
            telegram_user_id = str(me.id)
            
            # Save session string
            session_string = client.session.save()
            
            # Store in database
            from apps.oauth.models import ConnectedAccount
            account, created = ConnectedAccount.objects.update_or_create(
                user_id=user_id,
                platform='telegram',
                platform_user_id=telegram_user_id,
                defaults={
                    'platform_username': username,
                    'access_token': encrypt(session_string),
                    'is_active': True,
                }
            )
            
            account_id = str(account.id)
            
            # Store active session
            self.sessions[account_id] = client
            
            # Remove temp session
            del self.temp_sessions[temp_key]
            
            print('[telegram-user] Verification successful')
            
            return {
                'accountId': account_id,
                'username': username,
                'needPassword': False
            }
        
        except Exception as e:
            print(f'[telegram-user] Code verification failed: {e}')
            if 'SESSION_PASSWORD_NEEDED' in str(e):
                raise Exception('2FA_PASSWORD_REQUIRED')
            raise Exception(f'Invalid verification code: {str(e)}')
    
    async def load_session(self, account_id: str) -> Optional[TelegramClient]:
        """
        Load Telegram session using Telethon
        
        Migrated from: loadSession() in TelegramUserClient.ts
        
        Args:
            account_id: Connected account ID
            
        Returns:
            TelegramClient instance or None
        """
        if account_id in self.sessions:
            return self.sessions[account_id]
        
        try:
            account = ConnectedAccount.objects.get(
                id=account_id,
                platform='telegram',
                is_active=True
            )
            
            # Get session string
            session_string = decrypt(account.access_token)
            
            # Create client from saved session
            client = TelegramClient(
                StringSession(session_string),
                self.api_id,
                self.api_hash
            )
            
            await client.connect()
            
            self.sessions[account_id] = client
            
            print(f'[telegram-user] Session loaded for account {account_id}')
            return client
        
        except ConnectedAccount.DoesNotExist:
            return None
        except Exception as e:
            print(f'[telegram-user] Failed to load session: {e}')
            return None
    
    async def get_dialogs(self, account_id: str, limit: int = 50) -> List[Dict]:
        """
        Get dialogs using Telethon
        
        Migrated from: getDialogs() in TelegramUserClient.ts
        
        Args:
            account_id: Connected account ID
            limit: Max dialogs to fetch
            
        Returns:
            List of dialogs
        """
        client = await self.load_session(account_id)
        if not client:
            raise Exception('Session not found')
        
        # Get dialogs
        dialogs = await client.get_dialogs(limit=limit)
        
        result = []
        for dialog in dialogs:
            result.append({
                'id': str(dialog.id),
                'name': dialog.name or dialog.title or 'Unknown',
                'isUser': dialog.is_user,
                'isGroup': dialog.is_group,
                'unreadCount': dialog.unread_count or 0,
                'date': int(dialog.date.timestamp()) if dialog.date else 0,
            })
        
        return result
    
    async def get_messages(self, account_id: str, chat_id: str, limit: int = 50) -> List[Dict]:
        """
        Get messages from a chat
        
        Migrated from: getMessages() in TelegramUserClient.ts
        
        Args:
            account_id: Connected account ID
            chat_id: Chat ID
            limit: Max messages to fetch
            
        Returns:
            List of messages
        """
        bot = await self.load_session(account_id)
        if not bot:
            raise Exception('Session not found')
        
        # Bot API doesn't have direct history fetch
        # We'll use stored messages from database
        from apps.messaging.models import Message
        from apps.conversations.models import Conversation
        
        try:
            conversation = Conversation.objects.get(
                platform_conversation_id=chat_id,
                account_id=account_id
            )
            
            messages = Message.objects.filter(
                conversation=conversation
            ).order_by('-sent_at')[:limit]
            
            return [{
                'id': str(msg.id),
                'text': msg.content,
                'senderId': msg.sender_id,
                'date': msg.sent_at.timestamp(),
                'out': msg.is_outgoing,
            } for msg in messages]
        
        except Conversation.DoesNotExist:
            return []
    
    async def send_message(self, account_id: str, chat_id: str, text: str) -> None:
        """
        Send a message using Telethon
        
        Migrated from: sendMessage() in TelegramUserClient.ts
        
        Args:
            account_id: Connected account ID
            chat_id: Chat ID
            text: Message text
        """
        client = await self.load_session(account_id)
        if not client:
            raise Exception('Session not found')
        
        await client.send_message(int(chat_id), text)
        print(f'[telegram-user] Message sent to chat {chat_id}')
    
    async def disconnect(self, account_id: str) -> None:
        """
        Disconnect Telethon session
        
        Migrated from: disconnect() in TelegramUserClient.ts
        
        Args:
            account_id: Connected account ID
        """
        if account_id in self.sessions:
            client = self.sessions[account_id]
            await client.disconnect()
            del self.sessions[account_id]
            print(f'[telegram-user] Session disconnected for {account_id}')


# Create singleton instance
telegram_user_client = TelegramUserClientService()
