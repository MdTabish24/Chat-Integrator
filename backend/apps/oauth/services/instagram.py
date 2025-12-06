"""
Instagram Business OAuth Service.
Uses Facebook Graph API for Instagram Business accounts.

Migrated from backend/src/services/oauth/InstagramOAuthService.ts
"""

from typing import Dict, Optional
from django.conf import settings
import requests

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class InstagramOAuthService(OAuthBaseService):
    """
    Instagram Business OAuth Service
    
    Migrated from: InstagramOAuthService in InstagramOAuthService.ts
    """
    
    def __init__(self):
        config = OAuthConfig(
            client_id=settings.INSTAGRAM_APP_ID,
            client_secret=settings.INSTAGRAM_APP_SECRET,
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/auth/callback/instagram",
            authorization_url='https://www.facebook.com/v18.0/dialog/oauth',
            token_url='https://graph.facebook.com/v18.0/oauth/access_token',
            scopes=[
                'instagram_basic',
                'instagram_manage_messages',
                'pages_show_list',
            ]
        )
        
        super().__init__('instagram', config)
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for short-lived access token,
        then exchange for long-lived token (60 days)
        
        Migrated from: exchangeCodeForToken() in InstagramOAuthService.ts
        
        Args:
            code: Authorization code
            additional_params: Not used
            
        Returns:
            OAuth tokens (long-lived)
        """
        try:
            # Get short-lived token
            response = requests.get(
                self.config.token_url,
                params={
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
                    'code': code,
                    'redirect_uri': self.config.redirect_uri,
                },
                timeout=10
            )
            response.raise_for_status()
            
            short_lived_token = response.json()['access_token']
            
            # Exchange for long-lived token (60 days)
            return self.exchange_for_long_lived_token(short_lived_token)
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error', {}).get('message', str(e))
                except:
                    pass
            
            print(f'[instagram] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def exchange_for_long_lived_token(self, short_lived_token: str) -> OAuthTokens:
        """
        Exchange short-lived token for long-lived token (60 days)
        
        Migrated from: exchangeForLongLivedToken() in InstagramOAuthService.ts
        
        Args:
            short_lived_token: Short-lived access token
            
        Returns:
            Long-lived OAuth tokens
        """
        try:
            response = requests.get(
                'https://graph.facebook.com/v18.0/oauth/access_token',
                params={
                    'grant_type': 'fb_exchange_token',
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
                    'fb_exchange_token': short_lived_token,
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            return OAuthTokens(
                access_token=data['access_token'],
                refresh_token=None,  # Facebook doesn't provide refresh tokens
                expires_in=data.get('expires_in', 5184000),  # 60 days
                token_type=data.get('token_type', 'bearer')
            )
        
        except requests.RequestException as e:
            print(f'[instagram] Long-lived token exchange failed: {e}')
            raise Exception('Failed to exchange for long-lived token')
    
    def refresh_access_token(
        self, 
        access_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh long-lived token (extends expiry by 60 days)
        
        Migrated from: refreshAccessToken() in InstagramOAuthService.ts
        
        Args:
            access_token: Current access token
            additional_params: Not used
            
        Returns:
            Refreshed OAuth tokens
        """
        try:
            response = requests.get(
                'https://graph.facebook.com/v18.0/oauth/access_token',
                params={
                    'grant_type': 'fb_exchange_token',
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
                    'fb_exchange_token': access_token,
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            return OAuthTokens(
                access_token=data['access_token'],
                refresh_token=None,
                expires_in=data.get('expires_in', 5184000),  # 60 days
                token_type=data.get('token_type', 'bearer')
            )
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error', {}).get('message', str(e))
                except:
                    pass
            
            print(f'[instagram] Token refresh failed: {error_msg}')
            raise Exception(f'Failed to refresh token: {error_msg}')
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get Instagram Business account information
        
        Migrated from: getUserInfo() in InstagramOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username'
        """
        try:
            # Get Facebook user info (works with public_profile)
            response = requests.get(
                'https://graph.facebook.com/v18.0/me',
                params={
                    'fields': 'id,name',
                    'access_token': access_token,
                },
                timeout=10
            )
            response.raise_for_status()
            user_data = response.json()
            
            # For Development mode, just return Facebook user info
            # In production with proper permissions, fetch Instagram Business account
            return {
                'userId': user_data['id'],
                'username': user_data.get('name', 'Facebook User')
            }
        
        except requests.RequestException as e:
            print(f'[instagram] Failed to get user info: {e}')
            raise Exception('Failed to retrieve user information')
    
    def get_instagram_account_id(self, access_token: str, page_id: str) -> str:
        """
        Get Instagram Business account ID from page
        
        Migrated from: getInstagramAccountId() in InstagramOAuthService.ts
        
        Args:
            access_token: Access token
            page_id: Facebook page ID
            
        Returns:
            Instagram Business account ID
        """
        try:
            response = requests.get(
                f'https://graph.facebook.com/v18.0/{page_id}',
                params={
                    'fields': 'instagram_business_account',
                    'access_token': access_token,
                },
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            instagram_account = data.get('instagram_business_account', {})
            return instagram_account.get('id', '')
        
        except requests.RequestException as e:
            print(f'[instagram] Failed to get Instagram account ID: {e}')
            raise Exception('Failed to retrieve Instagram Business account ID')
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke Instagram OAuth token
        
        Migrated from: revokeToken() in InstagramOAuthService.ts
        
        Args:
            account_id: Connected account ID
        """
        try:
            tokens = self.get_stored_tokens(account_id)
            
            requests.delete(
                'https://graph.facebook.com/v18.0/me/permissions',
                params={'access_token': tokens.access_token},
                timeout=10
            )
            
            print('[instagram] Token revoked successfully')
        
        except Exception as e:
            print(f'[instagram] Token revocation failed: {e}')
            # Don't throw error - mark as inactive anyway
    
    def validate_token(self, access_token: str) -> bool:
        """
        Validate Instagram access token
        
        Migrated from: validateToken() in InstagramOAuthService.ts
        
        Args:
            access_token: Access token to validate
            
        Returns:
            True if token is valid
        """
        try:
            response = requests.get(
                'https://graph.facebook.com/v18.0/me',
                params={'access_token': access_token},
                timeout=10
            )
            response.raise_for_status()
            return 'id' in response.json()
        
        except:
            return False


# Create singleton instance
instagram_oauth_service = InstagramOAuthService()
