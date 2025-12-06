"""
Twitter/X OAuth Service.
Implements OAuth 2.0 with PKCE (Proof Key for Code Exchange).

Migrated from backend/src/services/oauth/TwitterOAuthService.ts
"""

import hashlib
import base64
import secrets
from typing import Dict, Optional
from django.conf import settings
from django.core.cache import cache
import requests

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class TwitterOAuthService(OAuthBaseService):
    """
    Twitter/X OAuth Service with PKCE support
    
    Migrated from: TwitterOAuthService in TwitterOAuthService.ts
    """
    
    def __init__(self):
        config = OAuthConfig(
            client_id=settings.TWITTER_CLIENT_ID,
            client_secret=settings.TWITTER_CLIENT_SECRET,
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/oauth/callback/twitter",
            authorization_url='https://twitter.com/i/oauth2/authorize',
            token_url='https://api.twitter.com/2/oauth2/token',
            scopes=[
                'tweet.read',
                'users.read',
                'dm.read',
                'dm.write',
                'offline.access'
            ]
        )
        
        super().__init__('twitter', config)
    
    def _generate_code_verifier(self) -> str:
        """
        Generate code verifier for PKCE
        
        Migrated from: generateCodeVerifier() in TwitterOAuthService.ts
        
        Returns:
            Base64 URL-encoded random string
        """
        # Generate 32 random bytes
        random_bytes = secrets.token_bytes(32)
        # Base64 URL-encode (no padding)
        return base64.urlsafe_b64encode(random_bytes).decode('utf-8').rstrip('=')
    
    def _generate_code_challenge(self, verifier: str) -> str:
        """
        Generate code challenge from verifier
        
        Migrated from: generateCodeChallenge() in TwitterOAuthService.ts
        
        Args:
            verifier: Code verifier
            
        Returns:
            SHA256 hash of verifier, base64 URL-encoded
        """
        # SHA256 hash
        digest = hashlib.sha256(verifier.encode('utf-8')).digest()
        # Base64 URL-encode (no padding)
        return base64.urlsafe_b64encode(digest).decode('utf-8').rstrip('=')
    
    def generate_authorization_url(
        self, 
        state: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Generate Twitter OAuth 2.0 authorization URL with PKCE
        
        Migrated from: generateAuthorizationUrl() in TwitterOAuthService.ts
        
        Args:
            state: State parameter for CSRF protection
            additional_params: Not used for Twitter
            
        Returns:
            Authorization URL
        """
        # Generate PKCE parameters
        code_verifier = self._generate_code_verifier()
        code_challenge = self._generate_code_challenge(code_verifier)
        
        # Store code verifier in Redis with 10 minute expiry
        redis_key = f'twitter:code_verifier:{state}'
        try:
            cache.set(redis_key, code_verifier, timeout=600)  # 10 minutes
        except Exception as e:
            print(f'[twitter] Failed to store code verifier in cache: {e}')
        
        # Build authorization URL
        params = {
            'client_id': self.config.client_id,
            'redirect_uri': self.config.redirect_uri,
            'response_type': 'code',
            'scope': ' '.join(self.config.scopes),
            'state': state,
            'code_challenge': code_challenge,
            'code_challenge_method': 'S256',
        }
        
        from urllib.parse import urlencode
        return f"{self.config.authorization_url}?{urlencode(params)}"
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for access token with PKCE
        
        Migrated from: exchangeCodeForToken() in TwitterOAuthService.ts
        
        Args:
            code: Authorization code
            additional_params: Must contain 'state' to retrieve code verifier
            
        Returns:
            OAuth tokens
        """
        if not additional_params or 'state' not in additional_params:
            raise Exception('State parameter is required for Twitter OAuth')
        
        state = additional_params['state']
        
        # Retrieve code verifier from cache
        redis_key = f'twitter:code_verifier:{state}'
        code_verifier = cache.get(redis_key)
        
        if not code_verifier:
            print(f'[twitter] Code verifier not found in cache for state: {state}')
            raise Exception('Code verifier not found. Authorization may have expired.')
        
        try:
            # Create Basic Auth header
            credentials = base64.b64encode(
                f"{self.config.client_id}:{self.config.client_secret}".encode()
            ).decode()
            
            response = requests.post(
                self.config.token_url,
                data={
                    'code': code,
                    'grant_type': 'authorization_code',
                    'client_id': self.config.client_id,
                    'redirect_uri': self.config.redirect_uri,
                    'code_verifier': code_verifier,
                },
                headers={
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': f'Basic {credentials}',
                },
                timeout=10
            )
            response.raise_for_status()
            
            # Clean up code verifier from cache
            cache.delete(redis_key)
            
            return self.parse_token_response(response.json())
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error_description', str(e))
                except:
                    pass
            
            print(f'[twitter] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh Twitter access token
        
        Migrated from: refreshAccessToken() in TwitterOAuthService.ts
        
        Args:
            refresh_token: Refresh token
            additional_params: Not used
            
        Returns:
            New OAuth tokens
        """
        credentials = base64.b64encode(
            f"{self.config.client_id}:{self.config.client_secret}".encode()
        ).decode()
        
        max_retries = 3
        
        for retry in range(max_retries):
            try:
                response = requests.post(
                    self.config.token_url,
                    data={
                        'refresh_token': refresh_token,
                        'grant_type': 'refresh_token',
                        'client_id': self.config.client_id,
                    },
                    headers={
                        'Content-Type': 'application/x-www-form-urlencoded',
                        'Authorization': f'Basic {credentials}',
                    },
                    timeout=10
                )
                response.raise_for_status()
                
                return self.parse_token_response(response.json())
            
            except requests.RequestException as e:
                print(f'[twitter] Token refresh attempt {retry + 1}/{max_retries} failed: {e}')
                
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
                import time
                time.sleep(2 ** retry)
        
        raise Exception('Token refresh failed')
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get Twitter user information
        
        Migrated from: getUserInfo() in TwitterOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username'
        """
        try:
            response = requests.get(
                'https://api.twitter.com/2/users/me',
                headers={
                    'Authorization': f'Bearer {access_token}',
                },
                timeout=10
            )
            response.raise_for_status()
            
            user_data = response.json()['data']
            return {
                'userId': user_data['id'],
                'username': user_data['username']
            }
        
        except requests.RequestException as e:
            print(f'[twitter] Failed to get user info: {e}')
            raise Exception('Failed to retrieve Twitter user information')
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke Twitter OAuth token
        
        Migrated from: revokeToken() in TwitterOAuthService.ts
        
        Args:
            account_id: Connected account ID
        """
        try:
            tokens = self.get_stored_tokens(account_id)
            credentials = base64.b64encode(
                f"{self.config.client_id}:{self.config.client_secret}".encode()
            ).decode()
            
            requests.post(
                'https://api.twitter.com/2/oauth2/revoke',
                data={
                    'token': tokens.access_token,
                    'token_type_hint': 'access_token',
                    'client_id': self.config.client_id,
                },
                headers={
                    'Content-Type': 'application/x-www-form-urlencoded',
                    'Authorization': f'Basic {credentials}',
                },
                timeout=10
            )
            
            print('[twitter] Token revoked successfully')
        
        except Exception as e:
            print(f'[twitter] Token revocation failed: {e}')
            # Don't throw error - mark as inactive anyway


# Create singleton instance
twitter_oauth_service = TwitterOAuthService()
