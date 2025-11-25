"""
Microsoft Teams OAuth Service.
Uses Microsoft Graph API with Azure AD OAuth 2.0.

Migrated from backend/src/services/oauth/MicrosoftTeamsOAuthService.ts
"""

from typing import Dict, List, Optional, Any
from django.conf import settings
from datetime import datetime, timedelta
import requests
import time

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class MicrosoftTeamsOAuthService(OAuthBaseService):
    """
    Microsoft Teams OAuth Service
    
    Migrated from: MicrosoftTeamsOAuthService in MicrosoftTeamsOAuthService.ts
    """
    
    def __init__(self):
        # Use 'consumers' for personal Microsoft accounts, 'common' for both, or specific tenant ID for org accounts
        tenant_id = settings.MICROSOFT_TENANT_ID if hasattr(settings, 'MICROSOFT_TENANT_ID') else 'consumers'
        
        config = OAuthConfig(
            client_id=settings.MICROSOFT_CLIENT_ID,
            client_secret=settings.MICROSOFT_CLIENT_SECRET,
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/oauth/callback/teams",
            authorization_url=f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize',
            token_url=f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token',
            scopes=[
                'offline_access',
                'User.Read',
                'Chat.Read',
                'Chat.ReadWrite',
                'ChatMessage.Send',
            ]
        )
        
        super().__init__('teams', config)
        self.tenant_id = tenant_id
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for access token
        
        Migrated from: exchangeCodeForToken() in MicrosoftTeamsOAuthService.ts
        
        Args:
            code: Authorization code
            additional_params: Not used
            
        Returns:
            OAuth tokens
        """
        try:
            response = requests.post(
                self.config.token_url,
                data={
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
                    'code': code,
                    'redirect_uri': self.config.redirect_uri,
                    'grant_type': 'authorization_code',
                    'scope': ' '.join(self.config.scopes),
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=10
            )
            response.raise_for_status()
            
            return self.parse_token_response(response.json())
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error_description', str(e))
                except:
                    pass
            
            print(f'[teams] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh Microsoft Teams access token
        
        Migrated from: refreshAccessToken() in MicrosoftTeamsOAuthService.ts
        
        Args:
            refresh_token: Refresh token
            additional_params: Not used
            
        Returns:
            New OAuth tokens
        """
        max_retries = 3
        
        for retry in range(max_retries):
            try:
                response = requests.post(
                    self.config.token_url,
                    data={
                        'client_id': self.config.client_id,
                        'client_secret': self.config.client_secret,
                        'refresh_token': refresh_token,
                        'grant_type': 'refresh_token',
                        'scope': ' '.join(self.config.scopes),
                    },
                    headers={'Content-Type': 'application/x-www-form-urlencoded'},
                    timeout=10
                )
                response.raise_for_status()
                
                return self.parse_token_response(response.json())
            
            except requests.RequestException as e:
                print(f'[teams] Token refresh attempt {retry + 1}/{max_retries} failed: {e}')
                
                if retry >= max_retries - 1:
                    error_msg = str(e)
                    if hasattr(e, 'response') and e.response is not None:
                        try:
                            error_data = e.response.json()
                            error_msg = error_data.get('error_description', str(e))
                        except:
                            pass
                    raise Exception(f'Failed to refresh token after {max_retries} attempts: {error_msg}')
                
                # Exponential backoff: 1s, 2s, 4s
                time.sleep(2 ** retry)
        
        raise Exception('Token refresh failed')
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get Microsoft user information
        
        Migrated from: getUserInfo() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username'
        """
        try:
            response = requests.get(
                'https://graph.microsoft.com/v1.0/me',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            user_data = response.json()
            
            return {
                'userId': user_data['id'],
                'username': user_data.get('displayName') or user_data.get('userPrincipalName') or 'Teams User'
            }
        
        except requests.RequestException as e:
            print(f'[teams] Failed to get user info: {e}')
            raise Exception('Failed to retrieve Microsoft Teams user information')
    
    def get_user_chats(self, access_token: str) -> List[Dict]:
        """
        Get user's Teams chats
        
        Migrated from: getUserChats() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            List of chats
        """
        try:
            response = requests.get(
                'https://graph.microsoft.com/v1.0/me/chats',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            
            return response.json().get('value', [])
        
        except requests.RequestException as e:
            print(f'[teams] Failed to get user chats: {e}')
            raise Exception('Failed to retrieve Teams chats')
    
    def get_chat_messages(self, access_token: str, chat_id: str) -> List[Dict]:
        """
        Get chat messages
        
        Migrated from: getChatMessages() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            chat_id: Chat ID
            
        Returns:
            List of messages
        """
        try:
            response = requests.get(
                f'https://graph.microsoft.com/v1.0/me/chats/{chat_id}/messages',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            
            return response.json().get('value', [])
        
        except requests.RequestException as e:
            print(f'[teams] Failed to get chat messages: {e}')
            raise Exception('Failed to retrieve chat messages')
    
    def create_chat_subscription(self, access_token: str, notification_url: str) -> Dict:
        """
        Create a chat subscription for webhooks
        
        Migrated from: createChatSubscription() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            notification_url: Webhook URL
            
        Returns:
            Subscription details
        """
        try:
            expiration_datetime = datetime.utcnow() + timedelta(hours=1)  # 1 hour max
            
            response = requests.post(
                'https://graph.microsoft.com/v1.0/subscriptions',
                json={
                    'changeType': 'created,updated',
                    'notificationUrl': notification_url,
                    'resource': '/me/chats/getAllMessages',
                    'expirationDateTime': expiration_datetime.isoformat() + 'Z',
                    'clientState': getattr(settings, 'TEAMS_CLIENT_STATE', 'teams_webhook_secret'),
                },
                headers={
                    'Authorization': f'Bearer {access_token}',
                    'Content-Type': 'application/json',
                },
                timeout=10
            )
            response.raise_for_status()
            
            print('[teams] Chat subscription created successfully')
            return response.json()
        
        except requests.RequestException as e:
            print(f'[teams] Failed to create subscription: {e}')
            raise Exception('Failed to create Teams chat subscription')
    
    def renew_chat_subscription(self, access_token: str, subscription_id: str) -> Dict:
        """
        Renew a chat subscription
        
        Migrated from: renewChatSubscription() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            subscription_id: Subscription ID
            
        Returns:
            Updated subscription details
        """
        try:
            expiration_datetime = datetime.utcnow() + timedelta(hours=1)
            
            response = requests.patch(
                f'https://graph.microsoft.com/v1.0/subscriptions/{subscription_id}',
                json={
                    'expirationDateTime': expiration_datetime.isoformat() + 'Z',
                },
                headers={
                    'Authorization': f'Bearer {access_token}',
                    'Content-Type': 'application/json',
                },
                timeout=10
            )
            response.raise_for_status()
            
            print('[teams] Chat subscription renewed successfully')
            return response.json()
        
        except requests.RequestException as e:
            print(f'[teams] Failed to renew subscription: {e}')
            raise Exception('Failed to renew Teams chat subscription')
    
    def delete_chat_subscription(self, access_token: str, subscription_id: str) -> None:
        """
        Delete a chat subscription
        
        Migrated from: deleteChatSubscription() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            subscription_id: Subscription ID
        """
        try:
            requests.delete(
                f'https://graph.microsoft.com/v1.0/subscriptions/{subscription_id}',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            
            print('[teams] Chat subscription deleted successfully')
        
        except requests.RequestException as e:
            print(f'[teams] Failed to delete subscription: {e}')
            # Don't throw - subscription may have already expired
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke Microsoft Teams OAuth token.
        Note: Microsoft doesn't provide a direct revocation endpoint.
        
        Migrated from: revokeToken() in MicrosoftTeamsOAuthService.ts
        
        Args:
            account_id: Connected account ID
        """
        print('[teams] Microsoft does not support direct token revocation')
        # Token will expire after 1 hour or when user revokes access manually
        # We should delete any active subscriptions
    
    def validate_token(self, access_token: str) -> bool:
        """
        Validate Microsoft access token
        
        Migrated from: validateToken() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token to validate
            
        Returns:
            True if token is valid
        """
        try:
            response = requests.get(
                'https://graph.microsoft.com/v1.0/me',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            return True
        
        except:
            return False
    
    def get_user_presence(self, access_token: str) -> Optional[Dict]:
        """
        Get user's presence status
        
        Migrated from: getUserPresence() in MicrosoftTeamsOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Presence information or None
        """
        try:
            response = requests.get(
                'https://graph.microsoft.com/v1.0/me/presence',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            
            return response.json()
        
        except requests.RequestException as e:
            print(f'[teams] Failed to get user presence: {e}')
            return None


# Create singleton instance
teams_oauth_service = MicrosoftTeamsOAuthService()
