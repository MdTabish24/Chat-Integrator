"""
Twitter/X API v2 adapter for Direct Messages and Mentions.

Migrated from backend/src/adapters/TwitterAdapter.ts
"""

from typing import List, Dict, Optional
from datetime import datetime, timedelta
import requests
from django.conf import settings
from django.utils import timezone

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt, encrypt


class TwitterAdapter(BasePlatformAdapter):
    """
    Twitter/X API v2 adapter
    
    Migrated from: TwitterAdapter in TwitterAdapter.ts
    """
    
    BASE_URL = 'https://api.twitter.com/2'
    TOKEN_URL = 'https://api.twitter.com/2/oauth2/token'
    
    def __init__(self):
        super().__init__('twitter')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account
        
        Migrated from: getAccessToken() in TwitterAdapter.ts
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
        Refresh token if it's expired or about to expire
        Twitter tokens expire in 2 hours
        
        Migrated from: refreshTokenIfNeeded() in TwitterAdapter.ts
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Check if token expires within the next 5 minutes
            if not account.token_expires_at:
                return  # No expiry set, assume valid
            
            now = timezone.now()
            five_minutes_from_now = now + timedelta(minutes=5)
            
            if account.token_expires_at > five_minutes_from_now:
                return  # Token is still valid
            
            # Refresh the token
            if not account.refresh_token:
                raise Exception(f'No refresh token available for account {account_id}')
            
            client_id = settings.TWITTER_CLIENT_ID
            client_secret = settings.TWITTER_CLIENT_SECRET
            
            if not client_id or not client_secret:
                raise Exception('Twitter OAuth credentials not configured')
            
            refresh_token = decrypt(account.refresh_token)
            
            response = requests.post(
                self.TOKEN_URL,
                data={
                    'grant_type': 'refresh_token',
                    'refresh_token': refresh_token,
                    'client_id': client_id,
                },
                auth=(client_id, client_secret),
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=10
            )
            response.raise_for_status()
            
            data = response.json()
            new_access_token = encrypt(data['access_token'])
            new_refresh_token = encrypt(data['refresh_token'])
            new_expires_at = now + timedelta(seconds=data['expires_in'])
            
            # Update account
            account.access_token = new_access_token
            account.refresh_token = new_refresh_token
            account.token_expires_at = new_expires_at
            account.save()
            
            print(f'[twitter] Token refreshed for account {account_id}')
        
        except Exception as e:
            print(f'Failed to refresh Twitter token: {e}')
            raise Exception('Failed to refresh Twitter access token')
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch mentions (free tier compatible)
        
        Migrated from: fetchMessages() in TwitterAdapter.ts
        """
        def _fetch():
            print(f'[twitter] Fetching mentions for account {account_id}')
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            url = f'{self.BASE_URL}/users/{account.platform_user_id}/mentions'
            params = {
                'tweet.fields': 'id,text,created_at,author_id,conversation_id',
                'user.fields': 'id,name,username,profile_image_url',
                'expansions': 'author_id',
                'max_results': 100,
            }
            
            if since:
                params['start_time'] = since.isoformat()
            
            response = requests.get(
                url,
                headers={'Authorization': f'Bearer {token}'},
                params=params,
                timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()
            
            mentions = data.get('data', [])
            print(f'[twitter] Found {len(mentions)} mentions')
            
            # Build user lookup map
            users = {}
            if 'includes' in data and 'users' in data['includes']:
                for user in data['includes']['users']:
                    users[user['id']] = user
            
            messages = []
            for mention in mentions:
                author = users.get(mention['author_id'])
                is_outgoing = mention['author_id'] == account.platform_user_id
                
                messages.append({
                    'id': '',
                    'conversationId': '',
                    'platformMessageId': mention['id'],
                    'senderId': mention['author_id'],
                    'senderName': f"@{author['username']}" if author else mention['author_id'],
                    'content': mention['text'],
                    'messageType': 'text',
                    'isOutgoing': is_outgoing,
                    'isRead': False,
                    'sentAt': mention['created_at'],
                    'createdAt': datetime.now().isoformat(),
                })
            
            print(f'[twitter] Converted {len(messages)} mentions to messages')
            return messages
        
        return self.execute_with_retry(_fetch, account_id)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a reply tweet (free tier compatible)
        
        Migrated from: sendMessage() in TwitterAdapter.ts
        """
        def _send():
            print(f'[twitter] Sending reply to conversation {conversation_id}')
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            url = f'{self.BASE_URL}/tweets'
            response = requests.post(
                url,
                json={
                    'text': content,
                    'reply': {'in_reply_to_tweet_id': conversation_id}
                },
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            tweet = response.json()['data']
            print(f'[twitter] Reply sent successfully: {tweet["id"]}')
            
            return {
                'id': '',
                'conversationId': '',
                'platformMessageId': tweet['id'],
                'senderId': account.platform_user_id,
                'senderName': account.platform_username or account.platform_user_id,
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
        Mark message as read (not supported for mentions)
        
        Migrated from: markAsRead() in TwitterAdapter.ts
        """
        # Mentions don't have a "read" status in Twitter API
        print(f'[twitter] markAsRead called for {message_id} (no-op for mentions)')
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get conversations (using Mentions instead of DMs for free tier)
        
        Migrated from: getConversations() in TwitterAdapter.ts
        """
        def _fetch():
            print(f'[twitter] Fetching mentions for account {account_id}')
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            print(f'[twitter] Account details: {account.platform_username} ({account.platform_user_id})')
            
            mentions_url = f'{self.BASE_URL}/users/{account.platform_user_id}/mentions'
            print(f'[twitter] Calling API: {mentions_url}')
            
            response = requests.get(
                mentions_url,
                headers={'Authorization': f'Bearer {token}'},
                params={
                    'tweet.fields': 'id,text,created_at,author_id,conversation_id',
                    'user.fields': 'id,name,username,profile_image_url',
                    'expansions': 'author_id',
                    'max_results': 100,
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            data = response.json()
            
            print(f'[twitter] API Response status: {response.status_code}')
            
            mentions = data.get('data', [])
            print(f'[twitter] Found {len(mentions)} mentions')
            
            # Build user lookup
            users = {}
            if 'includes' in data and 'users' in data['includes']:
                for user in data['includes']['users']:
                    users[user['id']] = user
                print(f'[twitter] Found {len(users)} users in response')
            
            # Group by conversation
            conversations_map = {}
            
            for mention in mentions:
                conversation_id = mention.get('conversation_id') or mention['id']
                author_id = mention['author_id']
                
                if conversation_id not in conversations_map:
                    author = users.get(author_id)
                    conversations_map[conversation_id] = {
                        'id': '',
                        'accountId': account_id,
                        'platformConversationId': conversation_id,
                        'participantName': f"@{author['username']}" if author else author_id,
                        'participantId': author_id,
                        'participantAvatarUrl': author.get('profile_image_url') if author else None,
                        'lastMessageAt': mention['created_at'],
                        'unreadCount': 0,
                        'createdAt': datetime.now().isoformat(),
                        'updatedAt': datetime.now().isoformat(),
                    }
                else:
                    # Update last message time if newer
                    existing = conversations_map[conversation_id]
                    message_date = mention['created_at']
                    if message_date > existing['lastMessageAt']:
                        existing['lastMessageAt'] = message_date
            
            conversations = list(conversations_map.values())
            print(f'[twitter] Extracted {len(conversations)} unique conversations')
            
            return conversations
        
        return self.execute_with_retry(_fetch, account_id)


# Create singleton instance
twitter_adapter = TwitterAdapter()
