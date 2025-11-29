"""
Microsoft Teams adapter using Microsoft Graph API.

Migrated from backend/src/adapters/TeamsAdapter.ts
Updated to properly support work/education accounts (Requirements 8.1, 8.2, 8.3)
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
    Microsoft Teams adapter for work/education accounts
    
    Migrated from: TeamsAdapter in TeamsAdapter.ts
    
    Note: Teams chat API only works with work/school (Azure AD) accounts.
    Personal Microsoft accounts cannot access Teams chat functionality.
    """
    
    BASE_URL = 'https://graph.microsoft.com/v1.0'
    
    def __init__(self):
        super().__init__('teams')
        self.timeout = 30
        
        # Use 'organizations' for work/education accounts (Teams requires this)
        tenant_id = getattr(settings, 'MICROSOFT_TENANT_ID', None)
        if not tenant_id or tenant_id == 'consumers':
            tenant_id = 'organizations'
        
        self.token_url = f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token'
        self.tenant_id = tenant_id
    
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
        
        Requirements: 8.4 - Refresh token automatically when expired
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
                raise Exception(f'No refresh token available for account {account_id}. User needs to re-authenticate.')
            
            client_id = getattr(settings, 'MICROSOFT_CLIENT_ID', '')
            client_secret = getattr(settings, 'MICROSOFT_CLIENT_SECRET', '')
            
            if not client_id or not client_secret:
                raise Exception('Microsoft Teams OAuth credentials not configured')
            
            refresh_token = decrypt(account.refresh_token)
            
            # Use the correct scopes for Teams chat API
            scopes = [
                'offline_access',
                'User.Read',
                'Chat.Read',
                'Chat.ReadWrite',
                'ChatMessage.Read',
                'ChatMessage.Send',
                'Chat.ReadBasic',
            ]
            
            response = requests.post(
                self.token_url,
                data={
                    'grant_type': 'refresh_token',
                    'refresh_token': refresh_token,
                    'client_id': client_id,
                    'client_secret': client_secret,
                    'scope': ' '.join(scopes),
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            # Update account with new tokens
            account.access_token = encrypt(data['access_token'])
            if data.get('refresh_token'):
                account.refresh_token = encrypt(data['refresh_token'])
            account.token_expires_at = now + timedelta(seconds=data.get('expires_in', 3600))
            account.save()
            
            print(f'[teams] Token refreshed for account {account_id}')
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error_description', str(e))
                    error_code = error_data.get('error')
                    if error_code == 'invalid_grant':
                        error_msg = 'Refresh token expired or revoked. User needs to re-authenticate.'
                except:
                    pass
            print(f'[teams] Failed to refresh token: {error_msg}')
            raise Exception(f'Failed to refresh Microsoft Teams access token: {error_msg}')
        except Exception as e:
            print(f'[teams] Failed to refresh token: {e}')
            raise Exception(f'Failed to refresh Microsoft Teams access token: {e}')
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from Teams chats via Microsoft Graph API
        
        Migrated from: fetchMessages() in TeamsAdapter.ts
        
        Requirements: 8.2 - Fetch messages using Microsoft Graph API with proper scopes
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
                    params={'$top': 50},  # Limit number of chats
                    timeout=self.timeout
                )
                chats_response.raise_for_status()
            except requests.HTTPError as e:
                # Personal Microsoft accounts don't support /me/chats endpoint
                if e.response and e.response.status_code == 403:
                    print('[teams] Personal Microsoft accounts do not support Teams chat API. Use a work/school account.')
                    return []
                elif e.response and e.response.status_code == 401:
                    print('[teams] Access token expired or invalid. Token refresh may be needed.')
                    raise
                raise
            
            chats = chats_response.json().get('value', [])
            all_messages = []
            
            # Fetch messages for each chat
            for chat in chats:
                try:
                    messages = self._fetch_chat_messages(token, chat['id'], account.platform_user_id, since)
                    all_messages.extend(messages)
                except Exception as e:
                    print(f'[teams] Failed to fetch messages for chat {chat["id"]}: {e}')
                    # Continue with other chats
            
            return all_messages
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _fetch_chat_messages(
        self, 
        token: str, 
        chat_id: str, 
        user_id: str, 
        since: Optional[datetime] = None
    ) -> List[Dict]:
        """
        Fetch messages for a specific chat
        
        Args:
            token: Access token
            chat_id: Chat ID
            user_id: Current user's platform ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of message dictionaries
            
        Requirements: 8.2 - Implement message history fetching
        """
        messages_url = f'{self.BASE_URL}/chats/{chat_id}/messages'
        params = {
            '$top': 50,
            '$orderby': 'createdDateTime desc',
        }
        
        if since:
            # Format datetime for OData filter
            since_str = since.strftime('%Y-%m-%dT%H:%M:%SZ')
            params['$filter'] = f'createdDateTime gt {since_str}'
        
        messages_response = requests.get(
            messages_url,
            headers={'Authorization': f'Bearer {token}'},
            params=params,
            timeout=self.timeout
        )
        messages_response.raise_for_status()
        
        teams_messages = messages_response.json().get('value', [])
        messages = []
        
        for msg in teams_messages:
            # Only process actual messages (not system messages)
            if msg.get('messageType') == 'message':
                sender_info = msg.get('from', {})
                sender_user = sender_info.get('user', {})
                sender_id = sender_user.get('id', 'unknown')
                sender_name = sender_user.get('displayName', sender_id)
                
                # Check if this is an outgoing message
                is_outgoing = sender_id == user_id
                
                # Extract message content
                body = msg.get('body', {})
                content = self._extract_text_content(body.get('content', ''))
                
                messages.append({
                    'id': '',
                    'conversationId': chat_id,
                    'platformMessageId': msg['id'],
                    'senderId': sender_id,
                    'senderName': sender_name,
                    'content': content,
                    'messageType': self._get_message_type(msg),
                    'mediaUrl': self._get_media_url(msg),
                    'isOutgoing': is_outgoing,
                    'isRead': False,
                    'sentAt': msg.get('createdDateTime'),
                    'createdAt': datetime.now().isoformat(),
                })
        
        return messages
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a message to a Teams chat via Microsoft Graph API
        
        Migrated from: sendMessage() in TeamsAdapter.ts
        
        Requirements: 8.3 - Deliver via Graph API and confirm delivery
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Validate content
            if not content or not content.strip():
                raise Exception('Message content cannot be empty')
            
            url = f'{self.BASE_URL}/chats/{conversation_id}/messages'
            
            try:
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
            except requests.HTTPError as e:
                error_msg = str(e)
                if e.response is not None:
                    try:
                        error_data = e.response.json()
                        error_msg = error_data.get('error', {}).get('message', str(e))
                    except:
                        pass
                    
                    if e.response.status_code == 403:
                        raise Exception('Permission denied. Ensure the app has ChatMessage.Send permission.')
                    elif e.response.status_code == 404:
                        raise Exception('Chat not found. The conversation may have been deleted.')
                
                raise Exception(f'Failed to send message: {error_msg}')
            
            message = response.json()
            
            # Verify message was created (delivery confirmation)
            message_id = message.get('id')
            if not message_id:
                raise Exception('Message sent but no message ID returned. Delivery unconfirmed.')
            
            created_at = message.get('createdDateTime')
            
            print(f'[teams] Message sent successfully to chat {conversation_id}, message ID: {message_id}')
            
            return {
                'id': '',
                'conversationId': conversation_id,
                'platformMessageId': message_id,
                'senderId': account.platform_user_id,
                'senderName': account.platform_username or account.platform_user_id,
                'content': content,
                'messageType': 'text',
                'isOutgoing': True,
                'isRead': False,
                'sentAt': created_at,
                'deliveredAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
                'deliveryConfirmed': True,
            }
        
        return self.execute_with_retry(_send, account_id)
    
    def send_message_with_mentions(
        self, 
        account_id: str, 
        conversation_id: str, 
        content: str,
        mentions: Optional[List[Dict]] = None
    ) -> Dict:
        """
        Send a message with @mentions to a Teams chat
        
        Args:
            account_id: Connected account ID
            conversation_id: Chat ID
            content: Message content (HTML format with mention placeholders)
            mentions: List of mention objects with 'id', 'mentionText', 'userId'
            
        Returns:
            Sent message dictionary
            
        Requirements: 8.3 - Deliver via Graph API
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            url = f'{self.BASE_URL}/chats/{conversation_id}/messages'
            
            body = {
                'body': {
                    'contentType': 'html',
                    'content': content,
                },
            }
            
            if mentions:
                body['mentions'] = [
                    {
                        'id': m['id'],
                        'mentionText': m['mentionText'],
                        'mentioned': {
                            'user': {
                                'id': m['userId'],
                                'displayName': m['mentionText'],
                            }
                        }
                    }
                    for m in mentions
                ]
            
            response = requests.post(
                url,
                json=body,
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
                'conversationId': conversation_id,
                'platformMessageId': message['id'],
                'senderId': account.platform_user_id,
                'senderName': account.platform_username or account.platform_user_id,
                'content': content,
                'messageType': 'text',
                'isOutgoing': True,
                'isRead': False,
                'sentAt': message.get('createdDateTime'),
                'deliveredAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
                'deliveryConfirmed': True,
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
        Get all conversations (chats) via Microsoft Graph API
        
        Migrated from: getConversations() in TeamsAdapter.ts
        
        Requirements: 8.2 - Add chat list retrieval
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            url = f'{self.BASE_URL}/me/chats'
            
            try:
                # Request chats with members expanded for efficiency
                response = requests.get(
                    url,
                    headers={'Authorization': f'Bearer {token}'},
                    params={
                        '$expand': 'members',
                        '$top': 50,
                        '$orderby': 'lastUpdatedDateTime desc',
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
            except requests.HTTPError as e:
                if e.response and e.response.status_code == 403:
                    print('[teams] Personal accounts do not support Teams chat API. Use a work/school account.')
                    return []
                elif e.response and e.response.status_code == 401:
                    print('[teams] Access token expired or invalid.')
                    raise
                raise
            
            teams_chats = response.json().get('value', [])
            conversations = []
            
            for chat in teams_chats:
                conversation = self._process_chat(chat, account, token)
                if conversation:
                    conversations.append(conversation)
            
            return conversations
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _process_chat(self, chat: Dict, account: ConnectedAccount, token: str) -> Optional[Dict]:
        """
        Process a single chat into a conversation dictionary
        
        Args:
            chat: Chat data from Graph API
            account: Connected account
            token: Access token
            
        Returns:
            Conversation dictionary or None
        """
        chat_type = chat.get('chatType', 'unknown')
        participant_name = chat.get('topic', '')
        participant_id = chat['id']
        participant_avatar = None
        
        # Handle different chat types
        if chat_type == 'oneOnOne':
            # For one-on-one chats, find the other participant
            members = chat.get('members', [])
            
            if not members:
                # Members not expanded, fetch them
                try:
                    members = self._fetch_chat_members(token, chat['id'])
                except Exception as e:
                    print(f'[teams] Failed to fetch chat members: {e}')
                    members = []
            
            # Find the other member (not the current user)
            other_member = next(
                (m for m in members if m.get('userId') != account.platform_user_id),
                None
            )
            
            if other_member:
                participant_id = other_member.get('userId', chat['id'])
                participant_name = other_member.get('displayName', 'Unknown User')
            else:
                participant_name = 'Direct Message'
                
        elif chat_type == 'group':
            # For group chats, use the topic or generate a name from members
            if not participant_name:
                members = chat.get('members', [])
                if members:
                    member_names = [m.get('displayName', 'Unknown') for m in members[:3]]
                    participant_name = ', '.join(member_names)
                    if len(members) > 3:
                        participant_name += f' +{len(members) - 3}'
                else:
                    participant_name = 'Group Chat'
                    
        elif chat_type == 'meeting':
            # Meeting chats
            participant_name = chat.get('topic', 'Meeting Chat')
        else:
            participant_name = participant_name or 'Chat'
        
        return {
            'id': '',
            'accountId': str(account.id),
            'platformConversationId': chat['id'],
            'participantName': participant_name,
            'participantId': participant_id,
            'participantAvatarUrl': participant_avatar,
            'chatType': chat_type,
            'lastMessageAt': chat.get('lastUpdatedDateTime'),
            'unreadCount': 0,
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat(),
        }
    
    def _fetch_chat_members(self, token: str, chat_id: str) -> List[Dict]:
        """
        Fetch members for a specific chat
        
        Args:
            token: Access token
            chat_id: Chat ID
            
        Returns:
            List of member dictionaries
        """
        members_url = f'{self.BASE_URL}/chats/{chat_id}/members'
        members_response = requests.get(
            members_url,
            headers={'Authorization': f'Bearer {token}'},
            timeout=self.timeout
        )
        members_response.raise_for_status()
        return members_response.json().get('value', [])
    
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
