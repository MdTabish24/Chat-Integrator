"""
Factory class to create platform-specific adapters.

Migrated from backend/src/adapters/AdapterFactory.ts
"""

from typing import Dict
from .base import BasePlatformAdapter
from .telegram import telegram_adapter
from .twitter import twitter_adapter
from .linkedin import linkedin_adapter
from .instagram import instagram_adapter
from .whatsapp import whatsapp_adapter
from .facebook import facebook_adapter
from .teams import teams_adapter


class AdapterFactory:
    """
    Factory class to create platform-specific adapters
    Uses singleton pattern to reuse adapter instances
    
    Migrated from: AdapterFactory in AdapterFactory.ts
    """
    
    _adapters: Dict[str, BasePlatformAdapter] = {
        'telegram': telegram_adapter,
        'twitter': twitter_adapter,
        'linkedin': linkedin_adapter,
        'instagram': instagram_adapter,
        'whatsapp': whatsapp_adapter,
        'facebook': facebook_adapter,
        'teams': teams_adapter,
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
