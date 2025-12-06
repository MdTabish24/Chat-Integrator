"""
Telegram OAuth Service.
Note: Telegram uses Bot API with a different authentication flow.
Users authenticate via Telegram Login Widget or direct bot interaction.

Migrated from backend/src/services/oauth/TelegramOAuthService.ts
"""

import hashlib
import hmac
import time
from typing import Dict, Optional
from urllib.parse import urlencode
from django.conf import settings
import requests

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class TelegramOAuthService(OAuthBaseService):
    """
    Telegram OAuth Service
    
    Migrated from: TelegramOAuthService in TelegramOAuthService.ts
    """
    
    def __init__(self):
        bot_token = settings.TELEGRAM_BOT_TOKEN
        bot_id = bot_token.split(':')[0] if bot_token else ''
        redirect_uri = f"{settings.WEBHOOK_BASE_URL}/api/auth/callback/telegram"
        
        # Telegram doesn't use traditional OAuth, but we maintain the interface
        config = OAuthConfig(
            client_id=bot_id,  # Bot ID is the first part of the token
            client_secret=bot_token,
            redirect_uri=redirect_uri,
            authorization_url='https://oauth.telegram.org/auth',
            token_url='',  # Not used for Telegram
            scopes=[]  # Telegram doesn't use scopes
        )
        
        super().__init__('telegram', config)
        self.bot_token = bot_token
    
    def generate_authorization_url(
        self, 
        state: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Generate Telegram Login Widget URL
        
        Migrated from: generateAuthorizationUrl() in TelegramOAuthService.ts
        
        Args:
            state: State parameter for CSRF protection
            additional_params: Not used
            
        Returns:
            Authorization URL for Telegram Login Widget
        """
        bot_username = getattr(settings, 'TELEGRAM_BOT_USERNAME', 'your_bot')
        frontend_url = getattr(settings, 'FRONTEND_URL', 'https://chatintegrator.onrender.com')
        
        params = {
            'state': state,
            'bot': bot_username,
            'redirect': self.config.redirect_uri
        }
        
        # Return URL that will render Telegram Login Widget
        # Frontend will handle the widget rendering
        return f"{frontend_url}/auth/telegram?{urlencode(params)}"
    
    def validate_telegram_auth(self, auth_data: Dict[str, str]) -> bool:
        """
        Validate Telegram Login Widget data
        
        Migrated from: validateTelegramAuth() in TelegramOAuthService.ts
        
        Args:
            auth_data: Data received from Telegram Login Widget
            
        Returns:
            True if data is valid
        """
        hash_value = auth_data.get('hash')
        if not hash_value:
            return False
        
        # Create data check string (without hash)
        data_copy = {k: v for k, v in auth_data.items() if k != 'hash'}
        data_check_string = '\n'.join(
            f"{key}={value}" 
            for key, value in sorted(data_copy.items())
        )
        
        # Create secret key from bot token
        secret_key = hashlib.sha256(self.bot_token.encode()).digest()
        
        # Calculate hash
        calculated_hash = hmac.new(
            secret_key,
            data_check_string.encode(),
            hashlib.sha256
        ).hexdigest()
        
        # Check if hash matches and auth is not too old (1 day)
        auth_date = int(auth_data.get('auth_date', '0'))
        current_time = int(time.time())
        is_recent = current_time - auth_date < 86400  # 24 hours
        
        return calculated_hash == hash_value and is_recent
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for token.
        For Telegram, we use the bot token directly.
        
        Migrated from: exchangeCodeForToken() in TelegramOAuthService.ts
        
        Args:
            code: Not used for Telegram
            additional_params: Should contain Telegram auth data
            
        Returns:
            OAuth tokens
        """
        if not additional_params or not self.validate_telegram_auth(additional_params):
            raise Exception('Invalid Telegram authentication data')
        
        # For Telegram, the "token" is the bot token, which doesn't expire
        return OAuthTokens(
            access_token=self.bot_token,
            refresh_token=None,
            expires_in=None,  # Bot tokens don't expire
            token_type='bot'
        )
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh access token.
        Telegram bot tokens don't expire, so this is a no-op.
        
        Migrated from: refreshAccessToken() in TelegramOAuthService.ts
        
        Args:
            refresh_token: Not used
            additional_params: Not used
            
        Returns:
            OAuth tokens
        """
        # Telegram bot tokens don't expire
        return OAuthTokens(
            access_token=self.bot_token,
            refresh_token=None,
            expires_in=None,
            token_type='bot'
        )
    
    def get_user_info(self, access_token: str, auth_data: Optional[Dict[str, str]] = None) -> Dict[str, str]:
        """
        Get Telegram user info.
        
        Migrated from: getUserInfo() in TelegramOAuthService.ts
        
        Args:
            access_token: Bot token (not used, we use stored user data)
            auth_data: Telegram auth data containing user info
            
        Returns:
            Dict with 'userId' and 'username'
        """
        if not auth_data:
            raise Exception('Telegram auth data is required')
        
        return {
            'userId': auth_data['id'],
            'username': auth_data.get('username') or auth_data.get('first_name') or 'Telegram User'
        }
    
    def validate_bot_token(self) -> bool:
        """
        Validate bot token by calling getMe endpoint
        
        Migrated from: validateBotToken() in TelegramOAuthService.ts
        
        Returns:
            True if token is valid
        """
        try:
            response = requests.get(
                f'https://api.telegram.org/bot{self.bot_token}/getMe',
                timeout=10
            )
            response.raise_for_status()
            return response.json().get('ok') is True
        
        except:
            return False
    
    def get_bot_info(self) -> Dict:
        """
        Get bot information
        
        Migrated from: getBotInfo() in TelegramOAuthService.ts
        
        Returns:
            Bot details
        """
        try:
            response = requests.get(
                f'https://api.telegram.org/bot{self.bot_token}/getMe',
                timeout=10
            )
            response.raise_for_status()
            
            return response.json()['result']
        
        except requests.RequestException as e:
            print(f'[telegram] Failed to get bot info: {e}')
            raise Exception('Failed to retrieve bot information')
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke token - not applicable for Telegram bot tokens
        
        Migrated from: revokeToken() in TelegramOAuthService.ts
        
        Args:
            account_id: Connected account ID
        """
        print('[telegram] Bot tokens cannot be revoked programmatically')
        # Mark account as inactive in database
        # The actual revocation happens when user blocks the bot


# Create singleton instance
telegram_oauth_service = TelegramOAuthService()
