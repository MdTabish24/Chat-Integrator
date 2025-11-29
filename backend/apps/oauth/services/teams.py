"""
Microsoft Teams OAuth Service.
Uses Microsoft Graph API with Azure AD OAuth 2.0.

Migrated from backend/src/services/oauth/MicrosoftTeamsOAuthService.ts
Updated to properly support work/education accounts (Requirements 8.1)
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
    
    Tenant ID options:
    - 'common': Both personal and work/school accounts
    - 'organizations': Only work/school accounts (Azure AD)
    - 'consumers': Only personal Microsoft accounts
    - Specific tenant ID: Only accounts from that organization
    
    For Teams chat access, work/education accounts require 'organizations' or 'common'
    since personal accounts don't have access to Teams chat APIs.
    """
    
    # Microsoft Graph API scopes required for Teams chat functionality
    # Reference: https://learn.microsoft.com/en-us/graph/permissions-reference
    TEAMS_SCOPES = [
        'offline_access',           # Required for refresh tokens
        'User.Read',                # Read user profile
        'Chat.Read',                # Read user's chats
        'Chat.ReadWrite',           # Read and write user's chats
        'ChatMessage.Read',         # Read chat messages
        'ChatMessage.Send',         # Send chat messages
        'Chat.ReadBasic',           # Read basic chat info
        'ChannelMessage.Read.All',  # Read channel messages (for Teams channels)
    ]
    
    def __init__(self):
        # Use 'organizations' for work/education accounts (Teams requires this)
        # 'common' allows both but Teams chat API only works with work/school accounts
        # Fall back to configured tenant ID or 'organizations' for Teams
        tenant_id = getattr(settings, 'MICROSOFT_TENANT_ID', None)
        if not tenant_id or tenant_id == 'consumers':
            # Teams chat API requires work/school accounts
            tenant_id = 'organizations'
        
        config = OAuthConfig(
            client_id=getattr(settings, 'MICROSOFT_CLIENT_ID', ''),
            client_secret=getattr(settings, 'MICROSOFT_CLIENT_SECRET', ''),
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/oauth/callback/teams",
            authorization_url=f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/authorize',
            token_url=f'https://login.microsoftonline.com/{tenant_id}/oauth2/v2.0/token',
            scopes=self.TEAMS_SCOPES
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
            
        Requirements: 8.1 - Authenticate via Microsoft OAuth for work/education accounts
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
                timeout=30  # Increased timeout for token exchange
            )
            response.raise_for_status()
            
            tokens = self.parse_token_response(response.json())
            print(f'[teams] Token exchange successful')
            return tokens
        
        except requests.RequestException as e:
            error_msg = str(e)
            error_code = None
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error_description', str(e))
                    error_code = error_data.get('error')
                except:
                    pass
            
            # Provide helpful error messages for common issues
            if error_code == 'invalid_grant':
                error_msg = 'Authorization code expired or already used. Please try connecting again.'
            elif error_code == 'unauthorized_client':
                error_msg = 'Application not authorized for Teams. Ensure app is registered for work/school accounts.'
            elif error_code == 'invalid_client':
                error_msg = 'Invalid client credentials. Check MICROSOFT_CLIENT_ID and MICROSOFT_CLIENT_SECRET.'
            
            print(f'[teams] Token exchange failed: {error_code} - {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh Microsoft Teams access token with exponential backoff
        
        Migrated from: refreshAccessToken() in MicrosoftTeamsOAuthService.ts
        
        Args:
            refresh_token: Refresh token
            additional_params: Not used
            
        Returns:
            New OAuth tokens
            
        Requirements: 8.4 - Refresh token automatically when expired
        """
        if not refresh_token:
            raise Exception('Refresh token is required')
        
        max_retries = 3
        last_error = None
        
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
                    timeout=30  # Increased timeout
                )
                response.raise_for_status()
                
                tokens = self.parse_token_response(response.json())
                print(f'[teams] Token refresh successful')
                return tokens
            
            except requests.RequestException as e:
                last_error = e
                error_msg = str(e)
                error_code = None
                is_retryable = True
                
                if hasattr(e, 'response') and e.response is not None:
                    try:
                        error_data = e.response.json()
                        error_msg = error_data.get('error_description', str(e))
                        error_code = error_data.get('error')
                    except:
                        pass
                    
                    # Check for non-retryable errors
                    status_code = e.response.status_code
                    if status_code in [400, 401, 403]:
                        is_retryable = False
                        if error_code == 'invalid_grant':
                            error_msg = 'Refresh token expired or revoked. User needs to re-authenticate.'
                
                print(f'[teams] Token refresh attempt {retry + 1}/{max_retries} failed: {error_code} - {error_msg}')
                
                if not is_retryable or retry >= max_retries - 1:
                    raise Exception(f'Failed to refresh token: {error_msg}')
                
                # Exponential backoff: 1s, 2s, 4s
                backoff_time = 2 ** retry
                print(f'[teams] Retrying in {backoff_time}s...')
                time.sleep(backoff_time)
        
        raise Exception(f'Token refresh failed after {max_retries} attempts')
    
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
