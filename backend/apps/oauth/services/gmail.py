"""
Gmail OAuth Service.
Uses Google OAuth 2.0 with Gmail API for email access.

Requirements: 10.1 - Authenticate via Google OAuth with gmail.readonly, gmail.send, and gmail.modify scopes
"""

from typing import Dict, List, Optional
from django.conf import settings
from datetime import datetime, timedelta
import requests
import time

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class GmailOAuthService(OAuthBaseService):
    """
    Gmail OAuth Service for Google OAuth 2.0 authentication.
    
    Scopes:
    - gmail.readonly: Read emails
    - gmail.send: Send emails (for replies only)
    - gmail.modify: Mark emails as read/unread
    
    Requirements: 10.1 - Authenticate via Google OAuth with gmail.readonly, gmail.send, and gmail.modify scopes
    """
    
    # Gmail API scopes required for email functionality
    # Reference: https://developers.google.com/gmail/api/auth/scopes
    GMAIL_SCOPES = [
        'openid',                                    # Required for user info
        'https://www.googleapis.com/auth/userinfo.email',  # Get user email
        'https://www.googleapis.com/auth/userinfo.profile',  # Get user profile
        'https://www.googleapis.com/auth/gmail.readonly',    # Read emails
        'https://www.googleapis.com/auth/gmail.send',        # Send emails (for replies)
        'https://www.googleapis.com/auth/gmail.modify',      # Mark as read/unread (modify labels)
    ]
    
    def __init__(self):
        config = OAuthConfig(
            client_id=getattr(settings, 'GOOGLE_CLIENT_ID', ''),
            client_secret=getattr(settings, 'GOOGLE_CLIENT_SECRET', ''),
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/oauth/callback/gmail",
            authorization_url='https://accounts.google.com/o/oauth2/v2/auth',
            token_url='https://oauth2.googleapis.com/token',
            scopes=self.GMAIL_SCOPES
        )
        
        super().__init__('gmail', config)
    
    def generate_authorization_url(
        self, 
        state: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Generate Google OAuth 2.0 authorization URL with Gmail-specific parameters.
        
        Args:
            state: Random state parameter for CSRF protection
            additional_params: Platform-specific additional parameters
            
        Returns:
            Authorization URL
            
        Requirements: 10.1 - Authenticate via Google OAuth
        """
        params = {
            'access_type': 'offline',  # Required for refresh tokens
            'prompt': 'consent',       # Force consent to get refresh token
        }
        
        if additional_params:
            params.update(additional_params)
        
        return super().generate_authorization_url(state, params)
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for access token.
        
        Args:
            code: Authorization code
            additional_params: Not used
            
        Returns:
            OAuth tokens
            
        Requirements: 10.1 - Authenticate via Google OAuth
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
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=30
            )
            response.raise_for_status()
            
            tokens = self.parse_token_response(response.json())
            print(f'[gmail] Token exchange successful')
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
            elif error_code == 'invalid_client':
                error_msg = 'Invalid client credentials. Check GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.'
            
            print(f'[gmail] Token exchange failed: {error_code} - {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh Gmail access token with exponential backoff.
        
        Args:
            refresh_token: Refresh token
            additional_params: Not used
            
        Returns:
            New OAuth tokens
            
        Requirements: 10.5 - Refresh token automatically when expired
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
                    },
                    headers={'Content-Type': 'application/x-www-form-urlencoded'},
                    timeout=30
                )
                response.raise_for_status()
                
                tokens = self.parse_token_response(response.json())
                # Google doesn't return refresh_token on refresh, keep the old one
                if not tokens.refresh_token:
                    tokens.refresh_token = refresh_token
                
                print(f'[gmail] Token refresh successful')
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
                
                print(f'[gmail] Token refresh attempt {retry + 1}/{max_retries} failed: {error_code} - {error_msg}')
                
                if not is_retryable or retry >= max_retries - 1:
                    raise Exception(f'Failed to refresh token: {error_msg}')
                
                # Exponential backoff: 1s, 2s, 4s
                backoff_time = 2 ** retry
                print(f'[gmail] Retrying in {backoff_time}s...')
                time.sleep(backoff_time)
        
        raise Exception(f'Token refresh failed after {max_retries} attempts')
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get Google user information.
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username'
        """
        try:
            response = requests.get(
                'https://www.googleapis.com/oauth2/v2/userinfo',
                headers={'Authorization': f'Bearer {access_token}'},
                timeout=10
            )
            response.raise_for_status()
            user_data = response.json()
            
            return {
                'userId': user_data['id'],
                'username': user_data.get('email') or user_data.get('name') or 'Gmail User'
            }
        
        except requests.RequestException as e:
            print(f'[gmail] Failed to get user info: {e}')
            raise Exception('Failed to retrieve Google user information')
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke Google OAuth token.
        
        Args:
            account_id: Connected account ID
        """
        try:
            tokens = self.get_stored_tokens(account_id)
            
            # Google supports token revocation
            response = requests.post(
                'https://oauth2.googleapis.com/revoke',
                params={'token': tokens.access_token},
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=10
            )
            
            if response.status_code == 200:
                print('[gmail] Token revoked successfully')
            else:
                print(f'[gmail] Token revocation returned status {response.status_code}')
        
        except Exception as e:
            print(f'[gmail] Failed to revoke token: {e}')
    
    def validate_token(self, access_token: str) -> bool:
        """
        Validate Google access token.
        
        Args:
            access_token: Access token to validate
            
        Returns:
            True if token is valid
        """
        try:
            response = requests.get(
                'https://www.googleapis.com/oauth2/v1/tokeninfo',
                params={'access_token': access_token},
                timeout=10
            )
            response.raise_for_status()
            return True
        
        except:
            return False


# Create singleton instance
gmail_oauth_service = GmailOAuthService()
