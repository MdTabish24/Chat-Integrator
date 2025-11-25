"""
Microsoft Teams adapter using Microsoft Graph API.

Migrated from backend/src/adapters/TeamsAdapter.ts
"""

from typing import List, Dict, Optional
from datetime import datetime, timedelta
import requests
from django.conf import settings
from django.utils import timezone

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt, encrypt


class TeamsAdapter(BasePlatformAdapter):
    """
    Microsoft Teams adapter
    
    Migrated from: TeamsAdapter in TeamsAdapter.ts
    """
    
    BASE_URL = 'https://graph.microsoft.com/v1.0'
    TOKEN_URL = 'https://login.microsoftonline.com/consumers/oauth2/v2.0/token'
    
    def __init__(self):
        super().__init__('teams')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account
        
        Migrated from: getAccessToken() in TeamsAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            
            # Check if token needs refresh
            self.refresh_token_if_needed(account_id)
            
            # Fetch again after potential refresh
            account.refresh_from_db()
            return decrypt(account.access_token)
        
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Refresh token if expired (Teams tokens expire in 1 hour)
        
        Migrated from: refreshTokenIfNeeded() in TeamsAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Check if token expires within the next 5 minutes
            if not account.token_expires_at:
                return
            
            now = timezone.now()
            five_minutes_from_now = now + timedelta(minutes=5)
            
            if account.token_expires_at > five_minutes_from_now:
                return  # Token is still valid
            
            # Refresh the token
            if not account.refresh_token:
                raise Exception(f'No refresh token available for account {account_id}')
            
            client_id = settings.MICROSOFT_CLIENT_ID
            client_secret = settings.MICROSOFT_CLIENT_SECRET
            
            if not client_id or not client_secret:
                raise Exception('Microsoft Teams OAuth credentials not configured')
            
            refresh_token = decrypt(account.refresh_token)
            
            response = requests.post(
                self.TOKEN_URL,
                data={
                    'grant_type': 'refresh_token',
                    'refresh_token': refresh_token,
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'scope': 'Chat.Read Chat.ReadWrite ChatMessage.Send offline_access',
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            # Update account
            account.access_token = encrypt(data['access_token'])
            account.refresh_token = encrypt(data['refresh_token'])
            account.token_expires_at = now + timedelta(seconds=data['expires_in'])
            account.save()
            
            print(f'[teams] Token refreshed for account {account_id}')
        
        except Exception as e:
            print(f'Failed to refresh Teams token: {e}')
            raise Exception('Failed to refresh Microsoft Teams access token')
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from Teams chats
        
        Migrated from: fetchMessages() in TeamsAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Get all chats for the user
            chats_url = f'{self.BASE_URL}/me/chats'
            
            try:
                chats_response = requests.get(
                    chats_url,
                    headers={'Authorization': f'Bearer {token}'},
                    timeout=self.timeout
                )
                chats_response.raise_for_status()
            except requests.HTTPError as e:
                # Personal Microsoft accounts don't support /me/chats endpoint
                if e.response and e.response.status_code == 403:
                    print('[teams] Personal Microsoft accounts do not support Teams chat API.')
                    return []
                raise
            
            chats = chats_response.json().get('value', [])
            all_messages = []
            
            # Fetch messages for each chat
            for chat in chats:
                messages_url = f'{self.BASE_URL}/chats/{chat["id"]}/messages'
                params = {
                    '$top': 50,
                    '$orderby': 'createdDateTime desc',
                }
                
                if since:
                    params['$filter'] = f'createdDateTime gt {since.isoformat()}'
                
                messages_response = requests.get(
                    messages_url,
                    headers={'Authorization': f'Bearer {token}'},
                    params=params,
                    timeout=self.timeout
                )
                messages_response.raise_for_status()
                
                teams_messages = messages_response.json().get('value', [])
                
                for msg in teams_messages:
                    if msg.get('messageType') == 'message':
                        sender_id = msg.get('from', {}).get('user', {}).get('id', 'unknown')
                        is_outgoing = sender_id == account.platform_user_id
                        
                        all_messages.append({
                            'id': '',
                            'conversationId': chat['id'],
                            'platformMessageId': msg['id'],
                            'senderId': sender_id,
                            'senderName': msg.get('from', {}).get('user', {}).get('displayName', sender_id),
                            'content': self._extract_text_content(msg.get('body', {}).get('content', '')),
                            'messageType': self._get_message_type(msg),
                            'mediaUrl': self._get_media_url(msg),
                            'isOutgoing': is_outgoing,
                            'isRead': False,
                            'sentAt': msg['createdDateTime'],
                            'createdAt': datetime.now().isoformat(),
                        })
            
            return all_messages
        
        return self.execute_with_retry(_fetch, account_id)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a message to a Teams chat
        
        Migrated from: sendMessage() in TeamsAdapter.ts
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            url = f'{self.BASE_URL}/chats/{conversation_id}/messages'
            response = requests.post(
                url,
                json={
                    'body': {
                        'contentType': 'text',
                        'content': content,
                    },
                },
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            message = response.json()
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': message['id'],
                'senderId': account.platform_user_id,
                'senderName': account.platform_username or account.platform_user_id,
                'content': content,
                'messageType': 'text',
                'isOutgoing': True,
                'isRead': False,
                'sentAt': message['createdDateTime'],
                'deliveredAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
            }
        
        return self.execute_with_retry(_send, account_id)
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark message as read (not directly supported)
        
        Migrated from: markAsRead() in TeamsAdapter.ts
        """
        # Microsoft Graph API doesn't have direct endpoint
        # Read status managed automatically by Teams client
        pass
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get all conversations (chats)
        
        Migrated from: getConversations() in TeamsAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            url = f'{self.BASE_URL}/me/chats'
            
            try:
                response = requests.get(
                    url,
                    headers={'Authorization': f'Bearer {token}'},
                    params={'$expand': 'members'},
                    timeout=self.timeout
                )
                response.raise_for_status()
            except requests.HTTPError as e:
                if e.response and e.response.status_code == 403:
                    print('[teams] Personal accounts do not support Teams chat API.')
                    return []
                raise
            
            teams_chats = response.json().get('value', [])
            conversations = []
            
            for chat in teams_chats:
                # For one-on-one chats, find other participant
                participant_name = chat.get('topic', 'Chat')
                participant_id = chat['id']
                
                if chat.get('chatType') == 'oneOnOne':
                    # Get chat members
                    try:
                        members_url = f'{self.BASE_URL}/chats/{chat["id"]}/members'
                        members_response = requests.get(
                            members_url,
                            headers={'Authorization': f'Bearer {token}'},
                            timeout=self.timeout
                        )
                        members_response.raise_for_status()
                        
                        members = members_response.json().get('value', [])
                        other_member = next(
                            (m for m in members if m.get('userId') != account.platform_user_id),
                            None
                        )
                        
                        if other_member:
                            participant_id = other_member['userId']
                            participant_name = other_member.get('displayName', participant_id)
                    
                    except Exception as e:
                        print(f'Failed to fetch Teams chat members: {e}')
                
                conversations.append({
                    'id': '',
                    'accountId': account_id,
                    'platformConversationId': chat['id'],
                    'participantName': participant_name,
                    'participantId': participant_id,
                    'participantAvatarUrl': None,
                    'lastMessageAt': chat['lastUpdatedDateTime'],
                    'unreadCount': 0,
                    'createdAt': datetime.now().isoformat(),
                    'updatedAt': datetime.now().isoformat(),
                })
            
            return conversations
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _extract_text_content(self, html_content: str) -> str:
        """
        Extract plain text from HTML content
        
        Migrated from: extractTextContent() in TeamsAdapter.ts
        """
        # Simple HTML tag removal
        import re
        text = re.sub(r'<[^>]*>', '', html_content)
        text = text.replace('&nbsp;', ' ')
        text = text.replace('&amp;', '&')
        text = text.replace('&lt;', '<')
        text = text.replace('&gt;', '>')
        text = text.replace('&quot;', '"')
        return text.strip()
    
    def _get_message_type(self, message: Dict) -> str:
        """Determine message type"""
        attachments = message.get('attachments', [])
        if not attachments:
            return 'text'
        
        attachment = attachments[0]
        content_type = attachment.get('contentType', '')
        
        if 'image' in content_type:
            return 'image'
        if 'video' in content_type:
            return 'video'
        
        return 'file'
    
    def _get_media_url(self, message: Dict) -> Optional[str]:
        """Get media URL from message"""
        attachments = message.get('attachments', [])
        if not attachments:
            return None
        
        return attachments[0].get('contentUrl')


# Create singleton instance
teams_adapter = TeamsAdapter()
