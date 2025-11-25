"""
LinkedIn Messaging API adapter.

Migrated from backend/src/adapters/LinkedInAdapter.ts
"""

from typing import List, Dict, Optional
from datetime import datetime
import requests

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt


class LinkedInAdapter(BasePlatformAdapter):
    """
    LinkedIn Messaging API adapter
    
    Migrated from: LinkedInAdapter in LinkedInAdapter.ts
    """
    
    BASE_URL = 'https://api.linkedin.com/v2'
    
    def __init__(self):
        super().__init__('linkedin')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account
        
        Migrated from: getAccessToken() in LinkedInAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            return decrypt(account.access_token)
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        LinkedIn tokens expire in 60 days
        
        Migrated from: refreshTokenIfNeeded() in LinkedInAdapter.ts
        """
        # LinkedIn tokens are long-lived (60 days)
        # Refresh logic would be similar to Twitter
        # For now, assume the token is valid
        pass
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch messages from LinkedIn Business Pages.
        Note: Works ONLY for Business Pages where user is admin.
        
        Migrated from: fetchMessages() in LinkedInAdapter.ts
        """
        def _fetch():
            token = self.get_access_token(account_id)
            
            try:
                # Step 1: Get organizations (Business Pages) user manages
                orgs_response = requests.get(
                    f'{self.BASE_URL}/organizationalEntityAcls',
                    params={
                        'q': 'roleAssignee',
                        'role': 'ADMINISTRATOR',
                        'projection': '(elements*(organizationalTarget~(localizedName,id)))'
                    },
                    headers={
                        'Authorization': f'Bearer {token}',
                        'LinkedIn-Version': '202311',
                    },
                    timeout=self.timeout
                )
                orgs_response.raise_for_status()
                
                organizations = orgs_response.json().get('elements', [])
                
                if not organizations:
                    print('[linkedin] No Business Pages found. User must be admin of a Company Page.')
                    return []
                
                print(f'[linkedin] Found {len(organizations)} Business Page(s)')
                
                all_messages = []
                
                # Step 2: Fetch messages for each Business Page
                for org in organizations:
                    org_data = org.get('organizationalTarget~', {})
                    org_id = org_data.get('id')
                    org_name = org_data.get('localizedName')
                    
                    if not org_id:
                        continue
                    
                    print(f'[linkedin] Fetching messages for page: {org_name}')
                    
                    # Get conversations for this organization
                    conversations_url = f'{self.BASE_URL}/socialActions'
                    conversations_response = requests.get(
                        conversations_url,
                        params={
                            'q': 'actor',
                            'actor': f'urn:li:organization:{org_id}',
                            'count': 50
                        },
                        headers={
                            'Authorization': f'Bearer {token}',
                            'LinkedIn-Version': '202311',
                        },
                        timeout=self.timeout
                    )
                    conversations_response.raise_for_status()
                    
                    conversations = conversations_response.json().get('elements', [])
                    
                    # Process each conversation
                    for conv in conversations:
                        if 'commentary' in conv:
                            message = {
                                'id': '',
                                'conversationId': org_id,
                                'platformMessageId': conv.get('id') or conv.get('$URN'),
                                'senderId': conv.get('actor', 'unknown'),
                                'senderName': org_name or 'LinkedIn User',
                                'content': conv['commentary'],
                                'messageType': 'text',
                                'isOutgoing': False,
                                'isRead': False,
                                'sentAt': datetime.fromtimestamp(conv.get('created', {}).get('time', 0) / 1000).isoformat(),
                                'createdAt': datetime.now().isoformat(),
                            }
                            
                            # Filter by date if provided
                            if not since or datetime.fromisoformat(message['sentAt']) >= since:
                                all_messages.append(message)
                
                print(f'[linkedin] Fetched {len(all_messages)} messages from Business Pages')
                return all_messages
            
            except requests.HTTPError as e:
                if e.response and e.response.status_code == 403:
                    print('[linkedin] Access denied. Make sure you are admin of a Business Page.')
                    return []
                raise
        
        return self.execute_with_retry(_fetch, account_id)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a message (not supported - requires Business Page)
        
        Migrated from: sendMessage() in LinkedInAdapter.ts
        """
        raise Exception('LinkedIn messaging requires Business Page access. Personal account messaging is not supported.')
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark message as read (not supported)
        
        Migrated from: markAsRead() in LinkedInAdapter.ts
        """
        print('[linkedin] markAsRead not supported for personal accounts')
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get all conversations (placeholder - requires Business Page)
        
        Migrated from: getConversations() in LinkedInAdapter.ts
        """
        print('[linkedin] LinkedIn messaging requires Business Page access')
        print('[linkedin] Personal account messaging is not supported by LinkedIn API')
        # Return empty array
        return []


# Create singleton instance
linkedin_adapter = LinkedInAdapter()
