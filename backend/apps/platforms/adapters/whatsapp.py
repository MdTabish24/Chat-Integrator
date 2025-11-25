"""
WhatsApp Business Cloud API adapter.

Migrated from backend/src/adapters/WhatsAppAdapter.ts
"""

from typing import List, Dict, Optional
from datetime import datetime
import requests

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt


class WhatsAppAdapter(BasePlatformAdapter):
    """
    WhatsApp Business Cloud API adapter
    
    Migrated from: WhatsAppAdapter in WhatsAppAdapter.ts
    """
    
    BASE_URL = 'https://graph.facebook.com/v18.0'
    
    def __init__(self):
        super().__init__('whatsapp')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account
        
        Migrated from: getAccessToken() in WhatsAppAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        WhatsApp system user tokens don't expire
        
        Migrated from: refreshTokenIfNeeded() in WhatsAppAdapter.ts
        """
        # WhatsApp system user tokens are permanent
        # No refresh needed
        pass
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from WhatsApp.
        Note: WhatsApp primarily uses webhooks for incoming messages.
        
        Migrated from: fetchMessages() in WhatsAppAdapter.ts
        """
        def _fetch():
            # WhatsApp Business API doesn't have a direct endpoint to fetch all messages
            # Messages are primarily received via webhooks
            # This is a placeholder
            
            print('[whatsapp] Messages are primarily received via webhooks')
            return []
        
        return self.execute_with_retry(_fetch, account_id)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a message via WhatsApp Business API
        
        Migrated from: sendMessage() in WhatsAppAdapter.ts
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Get phone number ID from account
            phone_number_id = account.platform_user_id
            url = f'{self.BASE_URL}/{phone_number_id}/messages'
            
            # Check if we're within the 24-hour messaging window
            # If not, we need to use a message template
            # For simplicity, we'll send a text message assuming we're within the window
            
            response = requests.post(
                url,
                json={
                    'messaging_product': 'whatsapp',
                    'recipient_type': 'individual',
                    'to': conversation_id,  # conversation_id is the recipient's phone number
                    'type': 'text',
                    'text': {
                        'preview_url': False,
                        'body': content,
                    },
                },
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            message_id = response.json()['messages'][0]['id']
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': message_id,
                'senderId': phone_number_id,
                'senderName': account.platform_username or phone_number_id,
                'content': content,
                'messageType': 'text',
                'isOutgoing': True,
                'isRead': False,
                'sentAt': datetime.now().isoformat(),
                'deliveredAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
            }
        
        return self.execute_with_retry(_send, account_id)
    
    def send_template_message(
        self,
        account_id: str,
        conversation_id: str,
        template_name: str,
        template_params: List[str]
    ) -> Dict:
        """
        Send a template message (required for messages outside 24-hour window)
        
        Migrated from: sendTemplateMessage() in WhatsAppAdapter.ts
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            phone_number_id = account.platform_user_id
            url = f'{self.BASE_URL}/{phone_number_id}/messages'
            
            response = requests.post(
                url,
                json={
                    'messaging_product': 'whatsapp',
                    'recipient_type': 'individual',
                    'to': conversation_id,
                    'type': 'template',
                    'template': {
                        'name': template_name,
                        'language': {'code': 'en'},
                        'components': [{
                            'type': 'body',
                            'parameters': [{'type': 'text', 'text': param} for param in template_params]
                        }]
                    },
                },
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            message_id = response.json()['messages'][0]['id']
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': message_id,
                'senderId': phone_number_id,
                'senderName': account.platform_username or phone_number_id,
                'content': f'[Template: {template_name}]',
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
        
        Migrated from: markAsRead() in WhatsAppAdapter.ts
        """
        def _mark():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            phone_number_id = account.platform_user_id
            url = f'{self.BASE_URL}/{phone_number_id}/messages'
            
            requests.post(
                url,
                json={
                    'messaging_product': 'whatsapp',
                    'status': 'read',
                    'message_id': message_id,
                },
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                timeout=self.timeout
            )
        
        self.execute_with_retry(_mark, account_id)
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get conversations.
        Note: WhatsApp doesn't have a direct API to list conversations.
        
        Migrated from: getConversations() in WhatsAppAdapter.ts
        """
        def _fetch():
            # WhatsApp Business API doesn't provide an endpoint to list conversations
            # Conversations must be tracked based on webhook messages received
            
            print('[whatsapp] Conversations are tracked via webhook messages')
            return []
        
        return self.execute_with_retry(_fetch, account_id)
    
    def download_media(self, account_id: str, media_id: str) -> bytes:
        """
        Download media file
        
        Migrated from: downloadMedia() in WhatsAppAdapter.ts
        """
        def _download():
            token = self.get_access_token(account_id)
            
            # First, get the media URL
            media_info_url = f'{self.BASE_URL}/{media_id}'
            media_info_response = requests.get(
                media_info_url,
                headers={'Authorization': f'Bearer {token}'},
                timeout=self.timeout
            )
            media_info_response.raise_for_status()
            
            media_url = media_info_response.json()['url']
            
            # Download the media
            media_response = requests.get(
                media_url,
                headers={'Authorization': f'Bearer {token}'},
                timeout=self.timeout
            )
            media_response.raise_for_status()
            
            return media_response.content
        
        return self.execute_with_retry(_download, account_id)


# Create singleton instance
whatsapp_adapter = WhatsAppAdapter()
