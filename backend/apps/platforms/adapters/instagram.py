"""
Instagram Business API adapter using Facebook Graph API.

Migrated from backend/src/adapters/InstagramAdapter.ts
"""

from typing import List, Dict, Optional
from datetime import datetime
import requests

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt


class InstagramAdapter(BasePlatformAdapter):
    """
    Instagram Business API adapter
    
    Migrated from: InstagramAdapter in InstagramAdapter.ts
    """
    
    BASE_URL = 'https://graph.facebook.com/v18.0'
    
    def __init__(self):
        super().__init__('instagram')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account
        
        Migrated from: getAccessToken() in InstagramAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Instagram tokens are long-lived (60 days), refresh if needed
        
        Migrated from: refreshTokenIfNeeded() in InstagramAdapter.ts
        """
        # Instagram long-lived tokens expire in 60 days
        # Refresh logic would exchange the token for a new long-lived token
        # For now, assume the token is valid
        pass
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from Instagram conversations
        
        Migrated from: fetchMessages() in InstagramAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            ig_account_id = account.platform_user_id
            
            # Fetch conversations
            conversations_url = f'{self.BASE_URL}/{ig_account_id}/conversations'
            conversations_response = requests.get(
                conversations_url,
                params={
                    'access_token': token,
                    'fields': 'id,participants,updated_time',
                },
                timeout=self.timeout
            )
            conversations_response.raise_for_status()
            
            conversations = conversations_response.json().get('data', [])
            all_messages = []
            
            # Fetch messages for each conversation
            for conversation in conversations:
                messages_url = f'{self.BASE_URL}/{conversation["id"]}/messages'
                params = {
                    'access_token': token,
                    'fields': 'id,created_time,from,to,message,attachments',
                }
                
                if since:
                    params['since'] = int(since.timestamp())
                
                messages_response = requests.get(
                    messages_url,
                    params=params,
                    timeout=self.timeout
                )
                messages_response.raise_for_status()
                
                ig_messages = messages_response.json().get('data', [])
                
                for msg in ig_messages:
                    is_outgoing = msg['from']['id'] == ig_account_id
                    
                    all_messages.append({
                        'id': '',
                        'conversationId': '',
                        'platformMessageId': msg['id'],
                        'senderId': msg['from']['id'],
                        'senderName': msg['from'].get('username') or msg['from'].get('name') or msg['from']['id'],
                        'content': msg.get('message') or self._get_attachment_description(msg),
                        'messageType': self._get_message_type(msg),
                        'mediaUrl': self._get_media_url(msg),
                        'isOutgoing': is_outgoing,
                        'isRead': False,
                        'sentAt': msg['created_time'],
                        'createdAt': datetime.now().isoformat(),
                    })
            
            return all_messages
        
        return self.execute_with_retry(_fetch, account_id)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a message to an Instagram conversation
        
        Migrated from: sendMessage() in InstagramAdapter.ts
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            ig_account_id = account.platform_user_id
            
            url = f'{self.BASE_URL}/{ig_account_id}/messages'
            response = requests.post(
                url,
                json={
                    'recipient': {'id': conversation_id},
                    'message': {'text': content},
                },
                params={'access_token': token},
                timeout=self.timeout
            )
            response.raise_for_status()
            
            message_id = response.json().get('message_id') or response.json().get('id')
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': message_id,
                'senderId': ig_account_id,
                'senderName': account.platform_username or ig_account_id,
                'content': content,
                'messageType': 'text',
                'isOutgoing': True,
                'isRead': False,
                'sentAt': datetime.now().isoformat(),
                'deliveredAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
            }
        
        return self.execute_with_retry(_send, account_id)
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark message as read
        Instagram Graph API doesn't have direct endpoint for this
        
        Migrated from: markAsRead() in InstagramAdapter.ts
        """
        # No-op
        pass
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get all conversations
        
        Migrated from: getConversations() in InstagramAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            ig_account_id = account.platform_user_id
            
            url = f'{self.BASE_URL}/{ig_account_id}/conversations'
            response = requests.get(
                url,
                params={
                    'access_token': token,
                    'fields': 'id,participants,updated_time',
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            ig_conversations = response.json().get('data', [])
            conversations = []
            
            for conv in ig_conversations:
                # Find other participant
                other_participant = next(
                    (p for p in conv['participants']['data'] if p['id'] != ig_account_id),
                    None
                )
                
                if other_participant:
                    conversations.append({
                        'id': '',
                        'accountId': account_id,
                        'platformConversationId': conv['id'],
                        'participantName': other_participant.get('username') or other_participant.get('name') or other_participant['id'],
                        'participantId': other_participant['id'],
                        'participantAvatarUrl': None,
                        'lastMessageAt': conv['updated_time'],
                        'unreadCount': 0,
                        'createdAt': datetime.now().isoformat(),
                        'updatedAt': datetime.now().isoformat(),
                    })
            
            return conversations
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _get_attachment_description(self, message: Dict) -> str:
        """Get attachment description for messages without text"""
        attachments = message.get('attachments', {}).get('data', [])
        if not attachments:
            return '[Message]'
        
        attachment = attachments[0]
        mime_type = attachment.get('mime_type', '')
        
        if 'image' in mime_type:
            return '[Photo]'
        if 'video' in mime_type:
            return '[Video]'
        
        return f"[File: {attachment.get('name', 'attachment')}]"
    
    def _get_message_type(self, message: Dict) -> str:
        """Determine message type"""
        attachments = message.get('attachments', {}).get('data', [])
        if not attachments:
            return 'text'
        
        attachment = attachments[0]
        mime_type = attachment.get('mime_type', '')
        
        if 'image' in mime_type:
            return 'image'
        if 'video' in mime_type:
            return 'video'
        
        return 'file'
    
    def _get_media_url(self, message: Dict) -> Optional[str]:
        """Get media URL from message"""
        attachments = message.get('attachments', {}).get('data', [])
        if not attachments:
            return None
        
        attachment = attachments[0]
        
        if 'image_data' in attachment:
            return attachment['image_data'].get('url')
        if 'video_data' in attachment:
            return attachment['video_data'].get('url')
        
        return None


# Create singleton instance
instagram_adapter = InstagramAdapter()
