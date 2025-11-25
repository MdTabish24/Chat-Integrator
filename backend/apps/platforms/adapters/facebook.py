"""
Facebook Pages Messaging API adapter.

Migrated from backend/src/adapters/FacebookAdapter.ts
"""

from typing import List, Dict, Optional, Any
import requests
from datetime import datetime

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt


class FacebookAdapter(BasePlatformAdapter):
    """
    Facebook Pages Messaging API adapter
    
    Migrated from: FacebookAdapter in FacebookAdapter.ts
    """
    
    BASE_URL = 'https://graph.facebook.com/v18.0'
    
    def __init__(self):
        super().__init__('facebook')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account
        
        Migrated from: getAccessToken() in FacebookAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Facebook page tokens are long-lived (60 days), refresh if needed
        
        Migrated from: refreshTokenIfNeeded() in FacebookAdapter.ts
        """
        # Facebook page access tokens expire in 60 days
        # Refresh logic would exchange the token for a new long-lived token
        # For now, we'll assume the token is valid
        # In production, implement token refresh via Facebook Graph API
        pass
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from Facebook Page conversations
        
        Migrated from: fetchMessages() in FacebookAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            page_id = account.platform_user_id
            
            # Fetch conversations
            conversations_url = f'{self.BASE_URL}/{page_id}/conversations'
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
                
                fb_messages = messages_response.json().get('data', [])
                
                for msg in fb_messages:
                    is_outgoing = msg['from']['id'] == page_id
                    
                    all_messages.append({
                        'id': '',
                        'conversationId': '',
                        'platformMessageId': msg['id'],
                        'senderId': msg['from']['id'],
                        'senderName': msg['from']['name'],
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
        Send a message to a Facebook Page conversation
        
        Migrated from: sendMessage() in FacebookAdapter.ts
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            page_id = account.platform_user_id
            
            # Get recipient from conversation
            conversation_url = f'{self.BASE_URL}/{conversation_id}'
            conversation_response = requests.get(
                conversation_url,
                params={
                    'access_token': token,
                    'fields': 'participants',
                },
                timeout=self.timeout
            )
            conversation_response.raise_for_status()
            
            participants = conversation_response.json()['participants']['data']
            recipient = next((p for p in participants if p['id'] != page_id), None)
            
            if not recipient:
                raise Exception('Could not find recipient in conversation')
            
            # Send message using Send API
            url = f'{self.BASE_URL}/{page_id}/messages'
            response = requests.post(
                url,
                json={
                    'recipient': {'id': recipient['id']},
                    'message': {'text': content},
                },
                params={'access_token': token},
                timeout=self.timeout
            )
            response.raise_for_status()
            
            message_id = response.json()['message_id']
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': message_id,
                'senderId': page_id,
                'senderName': account.platform_username or page_id,
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
        Facebook Messenger API doesn't have direct endpoint for this from page side
        
        Migrated from: markAsRead() in FacebookAdapter.ts
        """
        # No-op - Facebook sends read receipts automatically
        pass
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get all conversations
        
        Migrated from: getConversations() in FacebookAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            page_id = account.platform_user_id
            
            url = f'{self.BASE_URL}/{page_id}/conversations'
            response = requests.get(
                url,
                params={
                    'access_token': token,
                    'fields': 'id,participants,updated_time,unread_count',
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            fb_conversations = response.json().get('data', [])
            conversations = []
            
            for conv in fb_conversations:
                # Find other participant
                other_participant = next(
                    (p for p in conv['participants']['data'] if p['id'] != page_id),
                    None
                )
                
                if other_participant:
                    # Fetch profile picture
                    avatar_url = None
                    try:
                        profile_url = f'{self.BASE_URL}/{other_participant["id"]}/picture'
                        profile_response = requests.get(
                            profile_url,
                            params={
                                'access_token': token,
                                'redirect': 'false',
                                'type': 'normal',
                            },
                            timeout=self.timeout
                        )
                        profile_response.raise_for_status()
                        avatar_url = profile_response.json()['data']['url']
                    except:
                        pass
                    
                    conversations.append({
                        'id': '',
                        'accountId': account_id,
                        'platformConversationId': conv['id'],
                        'participantName': other_participant['name'],
                        'participantId': other_participant['id'],
                        'participantAvatarUrl': avatar_url,
                        'lastMessageAt': conv['updated_time'],
                        'unreadCount': conv.get('unread_count', 0),
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
        if 'file_url' in attachment:
            return attachment['file_url']
        
        return None


# Create singleton instance
facebook_adapter = FacebookAdapter()
