"""
Factory class to create platform-specific adapters.

Migrated from backend/src/adapters/AdapterFactory.ts
"""

from typing import Dict
from .base import BasePlatformAdapter
from .telegram import telegram_adapter
from .twitter import twitter_adapter
from .twitter_cookie import twitter_cookie_adapter
from .linkedin import linkedin_adapter
from .linkedin_cookie import linkedin_cookie_adapter
from .instagram import instagram_adapter
from .instagram_session import instagram_session_adapter
from .whatsapp import whatsapp_adapter
from .whatsapp_web import whatsapp_web_adapter
from .facebook import facebook_adapter
from .facebook_cookie import facebook_cookie_adapter
from .teams import teams_adapter
from .discord import discord_adapter
from .gmail import gmail_adapter


class AdapterFactory:
    """
    Factory class to create platform-specific adapters
    Uses singleton pattern to reuse adapter instances
    
    Migrated from: AdapterFactory in AdapterFactory.ts
    """
    
    _adapters: Dict[str, BasePlatformAdapter] = {
        'telegram': telegram_adapter,
        'twitter': twitter_adapter,
        'twitter_cookie': twitter_cookie_adapter,  # Cookie-based Twitter adapter for DMs
        'linkedin': linkedin_adapter,
        'linkedin_cookie': linkedin_cookie_adapter,  # Cookie-based LinkedIn adapter for messages
        'instagram': instagram_adapter,
        'instagram_session': instagram_session_adapter,  # Session-based Instagram adapter for DMs
        'whatsapp': whatsapp_adapter,
        'whatsapp_web': whatsapp_web_adapter,  # Browser-based WhatsApp Web adapter
        'facebook': facebook_adapter,
        'facebook_cookie': facebook_cookie_adapter,  # Cookie-based Facebook adapter for Messenger
        'teams': teams_adapter,
        'discord': discord_adapter,  # Token-based Discord adapter for DMs
        'gmail': gmail_adapter,  # OAuth-based Gmail adapter for emails
    }
    
    @classmethod
    def get_adapter(cls, platform: str) -> BasePlatformAdapter:
        """
        Get an adapter instance for the specified platform
        
        Migrated from: getAdapter() in AdapterFactory.ts
        
        Args:
            platform: Platform name
            
        Returns:
            Platform adapter instance
            
        Raises:
            ValueError: If platform is not supported
        """
        adapter = cls._adapters.get(platform)
        
        if not adapter:
            raise ValueError(f'Unsupported platform: {platform}')
        
        return adapter
    
    @classmethod
    def clear_cache(cls) -> None:
        """
        Clear all cached adapter instances.
        Useful for testing or when configuration changes.
        
        Migrated from: clearCache() in AdapterFactory.ts
        """
        # Since we use module-level singletons, this is a no-op
        # In Python, we don't need to clear cache as imports are cached by interpreter
        pass


# Helper function for easy access
def get_adapter(platform: str) -> BasePlatformAdapter:
    """Get adapter for platform"""
    return AdapterFactory.get_adapter(platform)
