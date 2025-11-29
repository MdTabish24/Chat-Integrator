"""
WebSocket URL routing.

Migrated from WebSocket endpoint setup in backend/src/index.ts
"""

from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'^ws/messages/$', consumers.MessagingConsumer.as_asgi()),
]
