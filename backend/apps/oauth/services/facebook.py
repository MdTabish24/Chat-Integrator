"""
Facebook Pages OAuth Service.
Uses Facebook Graph API for page messaging.

Migrated from backend/src/services/oauth/FacebookOAuthService.ts
"""

from typing import Dict, List, Optional
from django.conf import settings
import requests

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class FacebookOAuthService(OAuthBaseService):
    """
    Facebook Pages OAuth Service
    
    Migrated from: FacebookOAuthService in FacebookOAuthService.ts
    """
    
    def __init__(self):
        config = OAuthConfig(
            client_id=settings.FACEBOOK_APP_ID,
            client_secret=settings.FACEBOOK_APP_SECRET,
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/auth/callback/facebook",
            authorization_url='https://www.facebook.com/v18.0/dialog/oauth',
            token_url='https://graph.facebook.com/v18.0/oauth/access_token',
            scopes=[
                'pages_show_list',
                'pages_messaging',
                'pages_manage_metadata',
                'pages_read_engagement',
            ]
        )
        
        super().__init__('facebook', config)
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for short-lived user access token,
        then exchange for long-lived token (60 days)
        
        Migrated from: exchangeCodeForToken() in FacebookOAuthService.ts
        
        Args:
            code: Authorization code
            additional_params: Not used for Facebook
            
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
            
            print(f'[facebook] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def exchange_for_long_lived_token(self, short_lived_token: str) -> OAuthTokens:
        """
        Exchange short-lived token for long-lived token (60 days)
        
        Migrated from: exchangeForLongLivedToken() in FacebookOAuthService.ts
        
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
            print(f'[facebook] Long-lived token exchange failed: {e}')
            raise Exception('Failed to exchange for long-lived token')
    
    def get_page_access_token(self, user_access_token: str, page_id: str) -> str:
        """
        Get page access token from user access token
        
        Migrated from: getPageAccessToken() in FacebookOAuthService.ts
        
        Args:
            user_access_token: User access token
            page_id: Facebook page ID
            
        Returns:
            Page access token
        """
        try:
            response = requests.get(
                f'https://graph.facebook.com/v18.0/{page_id}',
                params={
                    'fields': 'access_token',
                    'access_token': user_access_token,
                },
                timeout=10
            )
            response.raise_for_status()
            
            return response.json()['access_token']
        
        except requests.RequestException as e:
            print(f'[facebook] Failed to get page access token: {e}')
            raise Exception('Failed to retrieve page access token')
    
    def refresh_access_token(
        self, 
        access_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh long-lived token (extends expiry by 60 days)
        
        Migrated from: refreshAccessToken() in FacebookOAuthService.ts
        
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
            print(f'[facebook] Token refresh failed: {e}')
            raise Exception(f'Failed to refresh token: {e}')
    
    def get_user_pages(self, access_token: str) -> List[Dict]:
        """
        Get Facebook user's pages
        
        Migrated from: getUserPages() in FacebookOAuthService.ts
        
        Args:
            access_token: User access token
            
        Returns:
            List of pages
        """
        try:
            response = requests.get(
                'https://graph.facebook.com/v18.0/me/accounts',
                params={
                    'access_token': access_token,
                    'fields': 'id,name,access_token,category',
                },
                timeout=10
            )
            response.raise_for_status()
            
            return response.json().get('data', [])
        
        except requests.RequestException as e:
            print(f'[facebook] Failed to get user pages: {e}')
            raise Exception('Failed to retrieve Facebook pages')
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get Facebook page information
        
        Migrated from: getUserInfo() in FacebookOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' (page ID) and 'username' (page name)
        """
        try:
            # Get user's pages
            pages = self.get_user_pages(access_token)
            
            if not pages:
                raise Exception('No Facebook pages found. Please create a page first.')
            
            # Use the first page (or let user select in a real implementation)
            page = pages[0]
            
            return {
                'userId': page['id'],
                'username': page['name']
            }
        
        except Exception as e:
            print(f'[facebook] Failed to get user info: {e}')
            raise Exception('Failed to retrieve Facebook page information')
    
    def get_page_info(self, page_id: str, access_token: str) -> Dict:
        """
        Get specific page information
        
        Migrated from: getPageInfo() in FacebookOAuthService.ts
        
        Args:
            page_id: Page ID
            access_token: Access token
            
        Returns:
            Page details
        """
        try:
            response = requests.get(
                f'https://graph.facebook.com/v18.0/{page_id}',
                params={
                    'fields': 'id,name,category,picture',
                    'access_token': access_token,
                },
                timeout=10
            )
            response.raise_for_status()
            
            return response.json()
        
        except requests.RequestException as e:
            print(f'[facebook] Failed to get page info: {e}')
            raise Exception('Failed to retrieve page information')
    
    def subscribe_page_to_webhooks(self, page_id: str, page_access_token: str) -> bool:
        """
        Subscribe page to webhooks
        
        Migrated from: subscribePageToWebhooks() in FacebookOAuthService.ts
        
        Args:
            page_id: Page ID
            page_access_token: Page access token
            
        Returns:
            True if successful
        """
        try:
            response = requests.post(
                f'https://graph.facebook.com/v18.0/{page_id}/subscribed_apps',
                params={
                    'subscribed_fields': 'messages,messaging_postbacks,messaging_optins,message_deliveries,message_reads',
                    'access_token': page_access_token,
                },
                timeout=10
            )
            response.raise_for_status()
            
            print('[facebook] Page subscribed to webhooks successfully')
            return response.json().get('success') is True
        
        except requests.RequestException as e:
            print(f'[facebook] Webhook subscription failed: {e}')
            return False
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke Facebook OAuth token
        
        Migrated from: revokeToken() in FacebookOAuthService.ts
        
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
            
            print('[facebook] Token revoked successfully')
        
        except Exception as e:
            print(f'[facebook] Token revocation failed: {e}')
            # Don't throw error - mark as inactive anyway
    
    def validate_token(self, access_token: str) -> bool:
        """
        Validate Facebook access token
        
        Migrated from: validateToken() in FacebookOAuthService.ts
        
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
    
    def debug_token(self, access_token: str) -> Dict:
        """
        Debug access token (useful for troubleshooting)
        
        Migrated from: debugToken() in FacebookOAuthService.ts
        
        Args:
            access_token: Access token to debug
            
        Returns:
            Token debug information
        """
        try:
            app_token = f"{self.config.client_id}|{self.config.client_secret}"
            response = requests.get(
                'https://graph.facebook.com/v18.0/debug_token',
                params={
                    'input_token': access_token,
                    'access_token': app_token,
                },
                timeout=10
            )
            response.raise_for_status()
            
            return response.json()['data']
        
        except requests.RequestException as e:
            print(f'[facebook] Token debug failed: {e}')
            raise Exception('Failed to debug token')


# Create singleton instance
facebook_oauth_service = FacebookOAuthService()
