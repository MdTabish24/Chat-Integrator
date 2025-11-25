"""
WhatsApp Business OAuth Service.
Uses WhatsApp Cloud API with system user tokens.

Migrated from backend/src/services/oauth/WhatsAppOAuthService.ts
"""

from typing import Dict, Optional
from django.conf import settings
import requests

from .base import OAuthBaseService, OAuthConfig, OAuthTokens


class WhatsAppOAuthService(OAuthBaseService):
    """
    WhatsApp Business OAuth Service
    
    Migrated from: WhatsAppOAuthService in WhatsAppOAuthService.ts
    """
    
    def __init__(self):
        config = OAuthConfig(
            client_id=settings.FACEBOOK_APP_ID,  # WhatsApp uses Facebook App
            client_secret=settings.FACEBOOK_APP_SECRET,
            redirect_uri=f"{settings.WEBHOOK_BASE_URL}/api/auth/callback/whatsapp",
            authorization_url='https://www.facebook.com/v18.0/dialog/oauth',
            token_url='https://graph.facebook.com/v18.0/oauth/access_token',
            scopes=['whatsapp_business_messaging', 'whatsapp_business_management']
        )
        
        super().__init__('whatsapp', config)
        self.phone_number_id = settings.WHATSAPP_PHONE_NUMBER_ID
        self.system_user_token = settings.WHATSAPP_ACCESS_TOKEN
    
    def generate_authorization_url(
        self, 
        state: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> str:
        """
        Generate WhatsApp authorization URL
        
        Migrated from: generateAuthorizationUrl() in WhatsAppOAuthService.ts
        
        Args:
            state: State parameter for CSRF protection
            additional_params: Not used
            
        Returns:
            Authorization URL
        """
        from urllib.parse import urlencode
        
        params = {
            'client_id': self.config.client_id,
            'redirect_uri': self.config.redirect_uri,
            'response_type': 'code',
            'scope': ','.join(self.config.scopes),
            'state': state,
            'config_id': getattr(settings, 'WHATSAPP_CONFIG_ID', ''),  # WhatsApp embedded signup config
        }
        
        return f"{self.config.authorization_url}?{urlencode(params)}"
    
    def exchange_code_for_token(
        self, 
        code: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Exchange authorization code for access token
        
        Migrated from: exchangeCodeForToken() in WhatsAppOAuthService.ts
        
        Args:
            code: Authorization code
            additional_params: Not used
            
        Returns:
            OAuth tokens
        """
        try:
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
            data = response.json()
            
            # For WhatsApp, we typically use system user tokens that don't expire
            # But we'll store the user access token if provided
            return OAuthTokens(
                access_token=data.get('access_token', self.system_user_token),
                refresh_token=None,  # System user tokens don't have refresh tokens
                expires_in=None,  # System user tokens don't expire
                token_type='bearer'
            )
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error', {}).get('message', str(e))
                except:
                    pass
            
            print(f'[whatsapp] Token exchange failed: {error_msg}')
            raise Exception(f'Failed to exchange authorization code: {error_msg}')
    
    def refresh_access_token(
        self, 
        refresh_token: str, 
        additional_params: Optional[Dict[str, str]] = None
    ) -> OAuthTokens:
        """
        Refresh access token.
        WhatsApp system user tokens don't expire, so this returns the existing token.
        
        Migrated from: refreshAccessToken() in WhatsAppOAuthService.ts
        
        Args:
            refresh_token: Not used for WhatsApp
            additional_params: Not used
            
        Returns:
            OAuth tokens
        """
        # System user tokens don't expire
        return OAuthTokens(
            access_token=self.system_user_token,
            refresh_token=None,
            expires_in=None,
            token_type='bearer'
        )
    
    def get_user_info(self, access_token: str) -> Dict[str, str]:
        """
        Get WhatsApp Business account information
        
        Migrated from: getUserInfo() in WhatsAppOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Dict with 'userId' and 'username' (phone number)
        """
        try:
            # Get phone number details
            response = requests.get(
                f'https://graph.facebook.com/v18.0/{self.phone_number_id}',
                params={'access_token': access_token},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            return {
                'userId': data['id'],
                'username': data.get('display_phone_number') or data.get('verified_name') or 'WhatsApp Business'
            }
        
        except requests.RequestException as e:
            print(f'[whatsapp] Failed to get user info: {e}')
            raise Exception('Failed to retrieve WhatsApp Business account information')
    
    def verify_webhook(self, mode: str, token: str, challenge: str) -> Optional[str]:
        """
        Verify webhook for WhatsApp
        
        Migrated from: verifyWebhook() in WhatsAppOAuthService.ts
        
        Args:
            mode: Verification mode
            token: Verification token
            challenge: Challenge string
            
        Returns:
            Challenge if verification succeeds, None otherwise
        """
        verify_token = getattr(settings, 'WHATSAPP_VERIFY_TOKEN', 'whatsapp_verify_token')
        
        if mode == 'subscribe' and token == verify_token:
            print('[whatsapp] Webhook verified successfully')
            return challenge
        
        print('[whatsapp] Webhook verification failed')
        return None
    
    def get_business_profile(self, access_token: str) -> Dict:
        """
        Get WhatsApp Business profile
        
        Migrated from: getBusinessProfile() in WhatsAppOAuthService.ts
        
        Args:
            access_token: Access token
            
        Returns:
            Business profile information
        """
        try:
            response = requests.get(
                f'https://graph.facebook.com/v18.0/{self.phone_number_id}/whatsapp_business_profile',
                params={'access_token': access_token},
                timeout=10
            )
            response.raise_for_status()
            data = response.json()
            
            return data.get('data', [{}])[0]
        
        except requests.RequestException as e:
            print(f'[whatsapp] Failed to get business profile: {e}')
            raise Exception('Failed to retrieve WhatsApp Business profile')
    
    def register_webhook(self, access_token: str, webhook_url: str) -> bool:
        """
        Register webhook for WhatsApp phone number
        
        Migrated from: registerWebhook() in WhatsAppOAuthService.ts
        
        Args:
            access_token: Access token
            webhook_url: Webhook URL
            
        Returns:
            True if successful
        """
        try:
            response = requests.post(
                f'https://graph.facebook.com/v18.0/{self.phone_number_id}/subscribed_apps',
                params={'access_token': access_token},
                timeout=10
            )
            response.raise_for_status()
            
            print('[whatsapp] Webhook registered successfully')
            return response.json().get('success') is True
        
        except requests.RequestException as e:
            print(f'[whatsapp] Webhook registration failed: {e}')
            return False
    
    def revoke_token(self, account_id: str) -> None:
        """
        Revoke WhatsApp OAuth token
        
        Migrated from: revokeToken() in WhatsAppOAuthService.ts
        
        Args:
            account_id: Connected account ID
        """
        print('[whatsapp] System user tokens cannot be revoked programmatically')
        # System user tokens are managed at the app level
        # Actual revocation happens when user removes app permissions
    
    def validate_token(self, access_token: str) -> bool:
        """
        Validate WhatsApp access token
        
        Migrated from: validateToken() in WhatsAppOAuthService.ts
        
        Args:
            access_token: Access token to validate
            
        Returns:
            True if token is valid
        """
        try:
            response = requests.get(
                f'https://graph.facebook.com/v18.0/{self.phone_number_id}',
                params={'access_token': access_token},
                timeout=10
            )
            response.raise_for_status()
            return 'id' in response.json()
        
        except:
            return False


# Create singleton instance
whatsapp_oauth_service = WhatsAppOAuthService()
