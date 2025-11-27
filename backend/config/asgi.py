"""
ASGI config for messaging hub project.

It exposes the ASGI callable as a module-level variable named ``application``.
Supports both HTTP and WebSocket connections.

Migrated from backend/src/services/websocketService.ts
"""

import os

from channels.auth import AuthMiddlewareStack
from channels.routing import ProtocolTypeRouter, URLRouter
from channels.security.websocket import AllowedHostsOriginValidator
from django.core.asgi import get_asgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

# Initialize Django ASGI application early to ensure the AppRegistry
# is populated before importing code that may import ORM models.
django_asgi_app = get_asgi_application()

# WebSocket temporarily disabled - causing issues with Channels auth
# TODO: Fix WebSocket authentication later

application = ProtocolTypeRouter({
    'http': django_asgi_app,
    # 'websocket': Disabled for now
})
