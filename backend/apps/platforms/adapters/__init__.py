"""
Platform adapters for Chat Orbitor.

This module provides adapters for various messaging platforms.
"""

from .base import BasePlatformAdapter, PlatformAPIError, RateLimitError
from .factory import AdapterFactory, get_adapter
from .telegram import telegram_adapter
from .twitter import twitter_adapter
from .twitter_cookie import twitter_cookie_adapter
from .linkedin import linkedin_adapter
from .linkedin_cookie import linkedin_cookie_adapter
from .instagram import instagram_adapter
from .whatsapp import whatsapp_adapter
from .facebook import facebook_adapter
from .teams import teams_adapter
from .discord import discord_adapter

__all__ = [
    'BasePlatformAdapter',
    'PlatformAPIError',
    'RateLimitError',
    'AdapterFactory',
    'get_adapter',
    'telegram_adapter',
    'twitter_adapter',
    'twitter_cookie_adapter',
    'linkedin_adapter',
    'linkedin_cookie_adapter',
    'instagram_adapter',
    'whatsapp_adapter',
    'facebook_adapter',
    'teams_adapter',
    'discord_adapter',
]
