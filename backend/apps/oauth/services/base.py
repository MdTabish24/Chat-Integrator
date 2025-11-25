"""
Base OAuth service providing common OAuth 2.0 flow functionality.

Migrated from backend/src/services/oauth/OAuthBaseService.ts
"""

import time
from abc import ABC, abstractmethod
from typing import Optional, Dict
from dataclasses import dataclass
from datetime import datetime, timedelta
from urllib.parse import urlencode

import requests
from django.db import transaction
from django.utils import timezone

from apps.core.utils.crypto import encrypt, decrypt
from apps.oauth.models import ConnectedAccount


@dataclass
class OAuthConfig:
    """OAuth configuration"""
    client_id: str
    client_secret: str
    redirect_uri: str
    authorization_url: str
    token_url: str
    scopes: list


@dataclass
class OAuthTokens:
    """OAuth tokens"""
    access_token: str
    refresh_token: Optional[str] = None
    expires_in: Optional[int] = None
    token_type: Optional[str] = None


@dataclass
class StoredTokenData:
    """Stored token data"""
    access_token: str
    refresh_token: Optional[str] = None
    expires_at: Optional[datetime] = None


class OAuthBaseService(ABC):
    """
    Base OAuth service providing common OAuth 2.0 flow functionality.
    Platform-specific services should extend this class.
    
    Migrated from: OAuthBaseService in OAuthBaseService.ts
    """
    
    def __init__(self, platform: str, config: OAuthConfig):
        """
        Initialize OAuth service
        
        Args:
            platform: Platform name (telegram, twitter, etc.)
            config: OAuth configuration
        """
        self.platform = platform
        self.config = config
        self.session = requests.Session()
        self.session.headers.update({
            'Content-Type': 'application/json'
        })
        self.session.timeout = 10
    
    def generate_authorization_url(
        self, 
        state: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Generate OAuth 2.0 authorization URL
        
        Migrated from: generateAuthorizationUrl() in OAuthBaseService.ts
        
        Args:
            state: Random state parameter for CSRF protection
            additional_params: Platform-specific additional parameters
            
        Returns:
            Authorization URL
        """
        params = {
            'client_id': self.config.client_id,
            'redirect_uri': self.config.redirect_uri,
            'response_type': 'code',
            'scope': ' '.join(self.config.scopes),
            'state': state,
        }
        
        if additional_params:
            params.update(additional_params)
        
        return f"{self.config.authorization_url}?{urlencode(params)}"
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for access token
        
        Migrated from: exchangeCodeForToken() in OAuthBaseService.ts
        
        Args:
            code: Authorization code from OAuth callback
            additional_params: Platform-specific additional parameters
            
        Returns:
            OAuth tokens
            
        Raises:
            Exception: If token exchange fails
        """
        try:
            data = {
                'client_id': self.config.client_id,
                'client_secret': self.config.client_secret,
                'code': code,
                'redirect_uri': self.config.redirect_uri,
                'grant_type': 'authorization_code',
            }
            
            if additional_params:
                data.update(additional_params)
            
            response = self.session.post(
                self.config.token_url,
                data=data,
                headers={'Content-Type': 'application/x-www-form-urlencoded'}
            )
            response.raise_for_status()
            
            return self.parse_token_response(response.json())
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e.response, 'json'):
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error_description', str(e))
                except:
                    pass
            
            print(f'[{self.platform}] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh an expired access token
        
        Migrated from: refreshAccessToken() in OAuthBaseService.ts
        
        Args:
            refresh_token: The refresh token
            additional_params: Platform-specific additional parameters
            
        Returns:
            New OAuth tokens
            
        Raises:
            Exception: If token refresh fails
        """
        if not refresh_token:
            raise Exception('Refresh token is required')
        
        max_retries = 3
        
        for retry in range(max_retries):
            try:
                data = {
                    'client_id': self.config.client_id,
                    'client_secret': self.config.client_secret,
                    'refresh_token': refresh_token,
                    'grant_type': 'refresh_token',
                }
                
                if additional_params:
                    data.update(additional_params)
                
                response = self.session.post(
                    self.config.token_url,
                    data=data,
                    headers={'Content-Type': 'application/x-www-form-urlencoded'}
                )
                response.raise_for_status()
                
                return self.parse_token_response(response.json())
            
            except requests.RequestException as e:
                print(f'[{self.platform}] Token refresh attempt {retry + 1}/{max_retries} failed: {e}')
                
                if retry >= max_retries - 1:
                    raise Exception(f'Failed to refresh token after {max_retries} attempts: {e}')
                
                # Exponential backoff: 1s, 2s, 4s
                time.sleep(2 ** retry)
        
        raise Exception('Token refresh failed')
    
    @transaction.atomic
    def store_tokens(
        self,
        user_id: str,
        platform_user_id: str,
        platform_username: str,
        tokens: OAuthTokens
    ) -> str:
        """
        Store OAuth tokens securely in the database
        
        Migrated from: storeTokens() in OAuthBaseService.ts
        
        Args:
            user_id: User ID
            platform_user_id: Platform-specific user ID
            platform_username: Platform username
            tokens: OAuth tokens to store
            
        Returns:
            Connected account ID
        """
        # Encrypt tokens before storage
        encrypted_access_token = encrypt(tokens.access_token)
        encrypted_refresh_token = (
            encrypt(tokens.refresh_token) if tokens.refresh_token else None
        )
        
        # Calculate token expiry
        token_expires_at = None
        if tokens.expires_in:
            token_expires_at = timezone.now() + timedelta(seconds=tokens.expires_in)
        
        # Update or create account
        account, created = ConnectedAccount.objects.update_or_create(
            user_id=user_id,
            platform=self.platform,
            platform_user_id=platform_user_id,
            defaults={
                'platform_username': platform_username,
                'access_token': encrypted_access_token,
                'refresh_token': encrypted_refresh_token,
                'token_expires_at': token_expires_at,
                'is_active': True,
            }
        )
        
        action = 'created' if created else 'updated'
        print(f'[{self.platform}] Tokens {action} successfully for account {account.id}')
        
        return str(account.id)
    
    def get_stored_tokens(self, account_id: str) -> StoredTokenData:
        """
        Retrieve and decrypt stored tokens
        
        Migrated from: getStoredTokens() in OAuthBaseService.ts
        
        Args:
            account_id: Connected account ID
            
        Returns:
            Decrypted token data
            
        Raises:
            Exception: If account not found or inactive
        """
        try:
            account = ConnectedAccount.objects.get(
                id=account_id,
                platform=self.platform,
                is_active=True
            )
            
            return StoredTokenData(
                access_token=decrypt(account.access_token),
                refresh_token=decrypt(account.refresh_token) if account.refresh_token else None,
                expires_at=account.token_expires_at
            )
        
        except ConnectedAccount.DoesNotExist:
            raise Exception('Account not found or inactive')
        except Exception as e:
            print(f'[{self.platform}] Failed to retrieve tokens: {e}')
            raise Exception('Failed to retrieve stored tokens')
    
    def ensure_valid_token(self, account_id: str) -> str:
        """
        Check if token is expired and refresh if necessary
        
        Migrated from: ensureValidToken() in OAuthBaseService.ts
        
        Args:
            account_id: Connected account ID
            
        Returns:
            Valid access token
        """
        tokens = self.get_stored_tokens(account_id)
        
        # If no expiry time, assume token is valid
        if not tokens.expires_at:
            return tokens.access_token
        
        # Check if token expires within next 5 minutes
        expiry_buffer = timedelta(minutes=5)
        is_expiring_soon = (
            tokens.expires_at - timezone.now() < expiry_buffer
        )
        
        if is_expiring_soon and tokens.refresh_token:
            print(f'[{self.platform}] Token expiring soon, refreshing...')
            new_tokens = self.refresh_access_token(tokens.refresh_token)
            
            # Get account details for re-storing
            account = ConnectedAccount.objects.get(id=account_id)
            self.store_tokens(
                str(account.user_id),
                account.platform_user_id,
                account.platform_username,
                new_tokens
            )
            
            return new_tokens.access_token
        
        return tokens.access_token
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke OAuth token with the platform
        
        Migrated from: revokeToken() in OAuthBaseService.ts
        
        Args:
            account_id: Connected account ID
        """
        # Default implementation - platforms should override if they support revocation
        print(f'[{self.platform}] Token revocation not implemented for this platform')
    
    def parse_token_response(self, data: dict) -> OAuthTokens:
        """
        Parse token response from OAuth provider
        Platform-specific services can override this for custom parsing
        
        Migrated from: parseTokenResponse() in OAuthBaseService.ts
        
        Args:
            data: Response data from token endpoint
            
        Returns:
            Parsed OAuth tokens
        """
        return OAuthTokens(
            access_token=data.get('access_token'),
            refresh_token=data.get('refresh_token'),
            expires_in=data.get('expires_in'),
            token_type=data.get('token_type')
        )
    
    @abstractmethod
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Platform-specific method to get user info after authentication
        Must be implemented by each platform service
        
        Migrated from: getUserInfo() in OAuthBaseService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username' keys
        """
        pass
