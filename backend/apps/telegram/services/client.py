"""
Telegram User Client Service for user-based Telegram integration.
Uses Telethon library (MTProto client).

Migrated from backend/src/services/telegram/TelegramUserClient.ts
"""

import asyncio
import traceback
from typing import Optional, Dict, List

from django.conf import settings
from telethon import TelegramClient
from telethon.sessions import StringSession
from asgiref.sync import sync_to_async

from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt, encrypt


class TelegramUserClientService:
    """
    Telegram User Client Service using Telethon MTProto
    """
    
    def __init__(self):
        self.api_id = int(settings.TELEGRAM_API_ID) if settings.TELEGRAM_API_ID else 0
        self.api_hash = settings.TELEGRAM_API_HASH
        self.sessions: Dict[str, TelegramClient] = {}
        self.temp_sessions: Dict[str, TelegramClient] = {}
    
    async def start_phone_verification(self, user_id: str, phone_number: str) -> Dict[str, str]:
        """Start phone verification using Telethon"""
        print(f'[telegram-user] Starting phone verification for: {phone_number}')
        
        try:
            client = TelegramClient(
                StringSession(),
                self.api_id,
                self.api_hash,
                connection_retries=10,
                timeout=60,  # Increased timeout for DC migration
                request_retries=3,
            )
            
            print('[telegram-user] Connecting to Telegram...')
            await client.connect()
            print('[telegram-user] Client connected, sending code request...')
            
            # Send code with explicit timeout handling
            try:
                result = await asyncio.wait_for(
                    client.send_code_request(phone_number),
                    timeout=45.0  # 45 second timeout for code request
                )
            except asyncio.TimeoutError:
                print('[telegram-user] Code request timed out, retrying...')
                # Retry once
                result = await asyncio.wait_for(
                    client.send_code_request(phone_number),
                    timeout=45.0
                )
            
            print(f'[telegram-user] Code sent successfully, hash: {result.phone_code_hash[:10]}...')
            
            temp_key = f'temp_{user_id}_{phone_number}'
            self.temp_sessions[temp_key] = client
            
            return {'phoneCodeHash': result.phone_code_hash}
        
        except asyncio.TimeoutError:
            print(f'[telegram-user] Phone verification timed out')
            raise Exception('Request timed out. Please try again.')
        except Exception as e:
            print(f'[telegram-user] Phone verification failed: {e}')
            traceback.print_exc()
            raise Exception(f'Failed to send verification code: {str(e)}')
    
    async def verify_phone_code(
        self,
        user_id: str,
        phone_number: str,
        phone_code: str,
        phone_code_hash: str,
        password: Optional[str] = None
    ) -> Dict[str, any]:
        """Verify phone code using Telethon"""
        print('[telegram-user] Verifying phone code')
        
        temp_key = f'temp_{user_id}_{phone_number}'
        client = self.temp_sessions.get(temp_key)
        
        if not client:
            raise Exception('Session not found. Please restart verification.')
        
        try:
            if password:
                print('[telegram-user] Signing in with 2FA password')
                await client.sign_in(password=password)
            else:
                try:
                    await client.sign_in(phone_number, phone_code, phone_code_hash=phone_code_hash)
                except Exception as e:
                    if 'SESSION_PASSWORD_NEEDED' in str(e) or 'Two-steps verification' in str(e):
                        print('[telegram-user] 2FA password required')
                        return {'accountId': '', 'username': '', 'needPassword': True}
                    else:
                        raise
            
            me = await client.get_me()
            username = me.username or me.first_name or phone_number
            telegram_user_id = str(me.id)
            
            session_string = client.session.save()
            
            @sync_to_async
            def save_account():
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
                return str(account.id)
            
            account_id = await save_account()
            self.sessions[account_id] = client
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
        """Load Telegram session from database"""
        print(f'[telegram-user] Loading session for account {account_id}')
        
        if account_id in self.sessions:
            client = self.sessions[account_id]
            if client.is_connected():
                print(f'[telegram-user] Using cached session for {account_id}')
                return client
            else:
                print(f'[telegram-user] Cached session disconnected, reloading...')
                del self.sessions[account_id]
        
        @sync_to_async
        def get_account():
            return ConnectedAccount.objects.get(
                id=account_id,
                platform='telegram',
                is_active=True
            )
        
        try:
            account = await get_account()
            print(f'[telegram-user] Found account in DB: {account.platform_username}')
            
            session_string = decrypt(account.access_token)
            if not session_string:
                print(f'[telegram-user] Empty session string for account {account_id}')
                return None
            
            print(f'[telegram-user] Creating Telethon client...')
            client = TelegramClient(
                StringSession(session_string),
                self.api_id,
                self.api_hash,
                connection_retries=5,
                timeout=30
            )
            
            await client.connect()
            print(f'[telegram-user] Client connected, checking authorization...')
            
            if not await client.is_user_authorized():
                print(f'[telegram-user] Session expired for account {account_id}')
                # Mark account as inactive
                @sync_to_async
                def mark_inactive():
                    account.is_active = False
                    account.save()
                await mark_inactive()
                return None
            
            self.sessions[account_id] = client
            print(f'[telegram-user] Session loaded successfully for account {account_id}')
            return client
        
        except ConnectedAccount.DoesNotExist:
            print(f'[telegram-user] Account not found in database: {account_id}')
            return None
        except Exception as e:
            print(f'[telegram-user] Failed to load session: {e}')
            traceback.print_exc()
            return None
    
    async def get_dialogs(self, account_id: str, limit: int = 100) -> List[Dict]:
        """Get all dialogs (conversations) from Telegram"""
        try:
            client = await self.load_session(account_id)
            if not client:
                raise Exception('Session not found or expired. Please reconnect your Telegram account.')
            
            dialogs = await client.get_dialogs(limit=limit)
            
            result = []
            for dialog in dialogs:
                try:
                    # Get sender name properly
                    name = dialog.name or dialog.title or 'Unknown'
                    
                    result.append({
                        'id': str(dialog.id),
                        'name': name,
                        'isUser': dialog.is_user,
                        'isGroup': dialog.is_group,
                        'isChannel': dialog.is_channel,
                        'unreadCount': dialog.unread_count or 0,
                        'date': int(dialog.date.timestamp()) if dialog.date else 0,
                    })
                except Exception as e:
                    print(f'[telegram-user] Error processing dialog: {e}')
                    continue
            
            print(f'[telegram-user] Retrieved {len(result)} dialogs')
            return result
        
        except Exception as e:
            print(f'[telegram-user] Error getting dialogs: {e}')
            traceback.print_exc()
            raise
    
    def _clean_string(self, text: str) -> str:
        """Remove emojis and problematic characters for MySQL utf8mb4"""
        import re
        if not text:
            return 'Unknown'
        # Remove emojis and other 4-byte unicode chars
        clean = re.sub(r'[\U00010000-\U0010ffff]', '', text)
        # Remove other problematic chars
        clean = re.sub(r'[^\x00-\x7F\u0080-\uFFFF]+', '', clean)
        return clean.strip() or 'Unknown'
    
    async def get_messages_from_telegram(self, account_id: str, chat_id: str, limit: int = 50) -> List[Dict]:
        """Get messages directly from Telegram API"""
        try:
            client = await self.load_session(account_id)
            if not client:
                raise Exception('Session not found or expired')
            
            # Get entity for the chat
            try:
                entity = await client.get_entity(int(chat_id))
            except ValueError:
                entity = int(chat_id)
            
            # Fetch messages
            messages = await client.get_messages(entity, limit=limit)
            
            result = []
            for msg in messages:
                if not msg.text:
                    continue
                
                try:
                    sender_name = 'Unknown'
                    sender_id = 'unknown'
                    
                    if msg.sender:
                        sender_id = str(msg.sender.id)
                        if hasattr(msg.sender, 'first_name'):
                            sender_name = self._clean_string(msg.sender.first_name)
                        elif hasattr(msg.sender, 'title'):
                            sender_name = self._clean_string(msg.sender.title)
                    
                    result.append({
                        'id': str(msg.id),
                        'text': msg.text,
                        'senderId': sender_id,
                        'senderName': sender_name,
                        'date': int(msg.date.timestamp()) if msg.date else 0,
                        'out': msg.out,
                    })
                except Exception as e:
                    print(f'[telegram-user] Error processing message: {e}')
                    continue
            
            return result
        
        except Exception as e:
            print(f'[telegram-user] Error getting messages: {e}')
            traceback.print_exc()
            return []
    
    async def get_messages(self, account_id: str, chat_id: str, limit: int = 50) -> List[Dict]:
        """Get messages from database (for API response)"""
        from apps.messaging.models import Message
        from apps.conversations.models import Conversation
        from apps.core.utils.crypto import decrypt
        
        @sync_to_async
        def get_messages_from_db():
            try:
                conversation = Conversation.objects.get(
                    platform_conversation_id=chat_id,
                    account_id=account_id
                )
                
                messages = Message.objects.filter(
                    conversation=conversation
                ).order_by('-sent_at')[:limit]
                
                result = []
                for msg in messages:
                    try:
                        decrypted_content = decrypt(msg.content)
                    except:
                        decrypted_content = msg.content
                    
                    result.append({
                        'id': str(msg.id),
                        'text': decrypted_content,
                        'senderId': msg.sender_id,
                        'senderName': msg.sender_name,
                        'date': int(msg.sent_at.timestamp()),
                        'out': msg.is_outgoing,
                    })
                
                return result
            
            except Conversation.DoesNotExist:
                return []
        
        return await get_messages_from_db()
    
    async def send_message(self, account_id: str, chat_id: str, text: str) -> Dict:
        """Send a message via Telegram"""
        print(f'[telegram-user] Sending message to chat {chat_id} for account {account_id}')
        
        try:
            client = await self.load_session(account_id)
            if not client:
                raise Exception('Session not found or expired. Please reconnect your Telegram account.')
            
            chat_id_int = int(chat_id)
            entity = None
            
            # Method 1: Try to get entity directly
            print(f'[telegram-user] Trying to get entity for chat_id: {chat_id_int}')
            try:
                entity = await client.get_entity(chat_id_int)
                print(f'[telegram-user] Got entity directly: {type(entity).__name__}')
            except ValueError:
                print(f'[telegram-user] Entity not in cache, fetching dialogs...')
                # Method 2: Fetch dialogs to populate entity cache
                try:
                    dialogs = await client.get_dialogs(limit=100)
                    # Find the dialog with matching ID
                    for dialog in dialogs:
                        if dialog.id == chat_id_int:
                            entity = dialog.entity
                            print(f'[telegram-user] Found entity in dialogs: {type(entity).__name__}')
                            break
                except Exception as dialog_err:
                    print(f'[telegram-user] Error fetching dialogs: {dialog_err}')
            
            # Method 3: If still no entity, try get_input_entity with PeerUser/PeerChat
            if entity is None:
                print(f'[telegram-user] Trying InputPeerUser...')
                try:
                    from telethon.tl.types import InputPeerUser, InputPeerChat, InputPeerChannel
                    # For users (positive IDs)
                    if chat_id_int > 0:
                        # We need access_hash, try to get it from dialogs
                        dialogs = await client.get_dialogs(limit=100)
                        for dialog in dialogs:
                            if hasattr(dialog.entity, 'id') and dialog.entity.id == chat_id_int:
                                entity = dialog.entity
                                break
                    else:
                        # For groups/channels (negative IDs)
                        entity = chat_id_int
                except Exception as peer_err:
                    print(f'[telegram-user] InputPeer error: {peer_err}')
                    entity = chat_id_int
            
            if entity is None:
                raise Exception(f'Could not find chat with ID {chat_id}. Please sync your conversations first.')
            
            # Send message
            print(f'[telegram-user] Sending message to entity: {type(entity).__name__ if hasattr(entity, "__name__") else type(entity)}')
            msg = await client.send_message(entity, text)
            
            print(f'[telegram-user] Message sent successfully to chat {chat_id}, msg_id: {msg.id}')
            
            return {
                'id': str(msg.id),
                'text': text,
                'date': int(msg.date.timestamp()) if msg.date else 0,
                'out': True,
            }
        
        except Exception as e:
            print(f'[telegram-user] Error sending message to {chat_id}: {e}')
            traceback.print_exc()
            raise Exception(f'Failed to send message: {str(e)}')
    
    async def disconnect(self, account_id: str) -> None:
        """Disconnect Telegram session"""
        if account_id in self.sessions:
            try:
                client = self.sessions[account_id]
                await client.disconnect()
            except:
                pass
            del self.sessions[account_id]
            print(f'[telegram-user] Session disconnected for {account_id}')


# Create singleton instance
telegram_user_client = TelegramUserClientService()
