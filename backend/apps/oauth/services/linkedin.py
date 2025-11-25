"""
LinkedIn OAuth Service.
Implements OAuth 2.0 for LinkedIn API.

Migrated from backend/src/services/oauth/LinkedInOAuthService.ts
"""

from typing import Dict, Optional
from django.conf import settings
import requests

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class LinkedInOAuthService(OAuthBaseService):
    """
    LinkedIn OAuth Service
    
    Migrated from: LinkedInOAuthService in LinkedInOAuthService.ts
    """
    
    def __init__(self):
        config = OAuthConfig(
            client_id=settings.LINKEDIN_CLIENT_ID,
            client_secret=settings.LINKEDIN_CLIENT_SECRET,
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/oauth/callback/linkedin",
            authorization_url='https://www.linkedin.com/oauth/v2/authorization',
            token_url='https://www.linkedin.com/oauth/v2/accessToken',
            scopes=[
                'profile',
                'openid',
                'w_member_social',           # Post on behalf of user
                'r_organization_social',     # Read organization posts
                'w_organization_social',     # Post on behalf of organization
                'rw_organization_admin',     # Manage organization (includes messaging)
            ]
        )
        
        super().__init__('linkedin', config)
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for access token
        
        Migrated from: exchangeCodeForToken() in LinkedInOAuthService.ts
        
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
                    'grant_type': 'authorization_code',
                    'code': code,
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
                    'redirect_uri': self.config.redirect_uri,
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
            
            print(f'[linkedin] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh LinkedIn access token.
        Note: LinkedIn tokens expire after 60 days and require re-authorization.
        
        Migrated from: refreshAccessToken() in LinkedInOAuthService.ts
        
        Args:
            refresh_token: Refresh token
            additional_params: Not used
            
        Returns:
            New OAuth tokens
        """
        try:
            response = requests.post(
                self.config.token_url,
                data={
                    'grant_type': 'refresh_token',
                    'refresh_token': refresh_token,
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
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
            
            print(f'[linkedin] Token refresh failed: {error_msg}')
            raise Exception(f'Failed to refresh token: {error_msg}')
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get LinkedIn user information using OpenID Connect
        
        Migrated from: getUserInfo() in LinkedInOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username'
        """
        try:
            # Use OpenID Connect userinfo endpoint
            response = requests.get(
                'https://api.linkedin.com/v2/userinfo',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            profile_data = response.json()
            
            user_id = profile_data['sub']  # OpenID Connect subject identifier
            name = profile_data.get('name') or profile_data.get('given_name') or 'LinkedIn User'
            
            return {
                'userId': user_id,
                'username': name
            }
        
        except requests.RequestException as e:
            print(f'[linkedin] Failed to get user info: {e}')
            raise Exception('Failed to retrieve LinkedIn user information')
    
    def get_user_email(self, access_token: str) -> str:
        """
        Get LinkedIn user email (requires r_emailaddress scope)
        
        Migrated from: getUserEmail() in LinkedInOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            User email
        """
        try:
            response = requests.get(
                'https://api.linkedin.com/v2/emailAddress?q=members&projection=(elements*(handle~))',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            email_data = data.get('elements', [{}])[0].get('handle~', {})
            return email_data.get('emailAddress', '')
        
        except requests.RequestException as e:
            print(f'[linkedin] Failed to get user email: {e}')
            return ''
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke LinkedIn OAuth token.
        Note: LinkedIn doesn't provide a token revocation endpoint.
        
        Migrated from: revokeToken() in LinkedInOAuthService.ts
        
        Args:
            account_id: Connected account ID
        """
        print('[linkedin] LinkedIn does not support programmatic token revocation')
        # Token will expire after 60 days or when user revokes access manually
    
    def validate_token(self, access_token: str) -> bool:
        """
        Validate LinkedIn access token
        
        Migrated from: validateToken() in LinkedInOAuthService.ts
        
        Args:
            access_token: Access token to validate
            
        Returns:
            True if token is valid
        """
        try:
            response = requests.get(
                'https://api.linkedin.com/v2/me',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            return True
        
        except:
            return False


# Create singleton instance
linkedin_oauth_service = LinkedInOAuthService()
