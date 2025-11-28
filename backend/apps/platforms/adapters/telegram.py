"""
Telegram Bot API adapter.

Migrated from backend/src/adapters/TelegramAdapter.ts
"""

from typing import List, Dict, Optional
from datetime import datetime
import requests

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt


class TelegramAdapter(BasePlatformAdapter):
    """
    Telegram Bot API adapter
    
    Migrated from: TelegramAdapter in TelegramAdapter.ts
    """
    
    BASE_URL = 'https://api.telegram.org'
    
    def __init__(self):
        super().__init__('telegram')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token (bot token) for the account
        
        Migrated from: getAccessToken() in TelegramAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Telegram bot tokens don't expire
        
        Migrated from: refreshTokenIfNeeded() in TelegramAdapter.ts
        """
        # No-op for Telegram
        pass
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages using getUpdates method
        
        Migrated from: fetchMessages() in TelegramAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            url = f'{self.BASE_URL}/bot{token}/getUpdates'
            
            params = {
                'timeout': 30,
                'allowed_updates': ['message'],
            }
            
            response = requests.get(url, params=params, timeout=self.timeout)
            response.raise_for_status()
            data = response.json()
            
            if not data.get('ok'):
                raise Exception(f"Telegram API error: {data.get('description')}")
            
            updates = data.get('result', [])
            messages = []
            
            for update in updates:
                if 'message' in update:
                    msg = self._convert_telegram_message(update['message'], account_id)
                    
                    # Filter by date if since is provided
                    if not since or datetime.fromisoformat(msg['sentAt']) >= since:
                        messages.append(msg)
            
            return messages
        
        return self.execute_with_retry(_fetch, account_id)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send message using Telethon (user client)
        This adapter is not used anymore - use telegram_user_client directly
        """
        raise Exception('Use telegram_user_client.send_message() instead of adapter')
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark message as read (not supported by Telegram Bot API)
        
        Migrated from: markAsRead() in TelegramAdapter.ts
        """
        # Telegram Bot API doesn't support marking messages as read
        # This is a no-op
        pass
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get conversations (chats) for the account
        
        Migrated from: getConversations() in TelegramAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            
            # Telegram Bot API doesn't have a direct method to list all chats
            # We need to get updates and extract unique chats from messages
            url = f'{self.BASE_URL}/bot{token}/getUpdates'
            
            response = requests.get(
                url,
                params={
                    'timeout': 0,
                    'allowed_updates': ['message'],
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()
            
            if not data.get('ok'):
                raise Exception(f"Telegram API error: {data.get('description')}")
            
            updates = data.get('result', [])
            conversations_map = {}
            
            for update in updates:
                if 'message' in update:
                    chat = update['message']['chat']
                    chat_id = str(chat['id'])
                    
                    if chat_id not in conversations_map:
                        conversations_map[chat_id] = {
                            'id': '',
                            'accountId': account_id,
                            'platformConversationId': chat_id,
                            'participantName': self._get_chat_name(chat),
                            'participantId': chat_id,
                            'participantAvatarUrl': None,
                            'lastMessageAt': datetime.fromtimestamp(update['message']['date']).isoformat(),
                            'unreadCount': 0,
                            'createdAt': datetime.now().isoformat(),
                            'updatedAt': datetime.now().isoformat(),
                        }
                    else:
                        # Update last message time if this message is newer
                        existing = conversations_map[chat_id]
                        message_date = datetime.fromtimestamp(update['message']['date']).isoformat()
                        if message_date > existing['lastMessageAt']:
                            existing['lastMessageAt'] = message_date
            
            return list(conversations_map.values())
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _convert_telegram_message(self, telegram_msg: Dict, account_id: str, is_outgoing: bool = False) -> Dict:
        """
        Convert Telegram message to our Message format
        
        Migrated from: convertTelegramMessage() in TelegramAdapter.ts
        """
        content = telegram_msg.get('text', '')
        message_type = 'text'
        media_url = None
        
        # Handle media messages
        if 'photo' in telegram_msg and telegram_msg['photo']:
            message_type = 'image'
            # Get the largest photo
            largest_photo = telegram_msg['photo'][-1]
            media_url = largest_photo['file_id']
            content = content or '[Photo]'
        
        elif 'video' in telegram_msg:
            message_type = 'video'
            media_url = telegram_msg['video']['file_id']
            content = content or '[Video]'
        
        elif 'document' in telegram_msg:
            message_type = 'file'
            media_url = telegram_msg['document']['file_id']
            file_name = telegram_msg['document'].get('file_name', 'document')
            content = content or f'[File: {file_name}]'
        
        sender = telegram_msg['from']
        
        return {
            'id': '',
            'conversationId': '',
            'platformMessageId': str(telegram_msg['message_id']),
            'senderId': str(sender['id']),
            'senderName': self._get_user_name(sender),
            'content': content,
            'messageType': message_type,
            'mediaUrl': media_url,
            'isOutgoing': is_outgoing,
            'isRead': False,
            'sentAt': datetime.fromtimestamp(telegram_msg['date']).isoformat(),
            'createdAt': datetime.now().isoformat(),
        }
    
    def _get_user_name(self, user: Dict) -> str:
        """
        Get user's display name
        
        Migrated from: getUserName() in TelegramAdapter.ts
        """
        if user.get('username'):
            return f"@{user['username']}"
        
        parts = [user.get('first_name', '')]
        if user.get('last_name'):
            parts.append(user['last_name'])
        
        return ' '.join(filter(None, parts)) or 'Unknown'
    
    def _get_chat_name(self, chat: Dict) -> str:
        """
        Get chat's display name
        
        Migrated from: getChatName() in TelegramAdapter.ts
        """
        if chat.get('title'):
            return chat['title']
        if chat.get('username'):
            return f"@{chat['username']}"
        
        parts = []
        if chat.get('first_name'):
            parts.append(chat['first_name'])
        if chat.get('last_name'):
            parts.append(chat['last_name'])
        
        return ' '.join(parts) or 'Unknown'


# Create singleton instance
telegram_adapter = TelegramAdapter()
