"""
URL configuration for messaging hub project.

Migrated from backend/src/index.ts route mounting
"""

from django.contrib import admin
from django.urls import path, include
from django.http import JsonResponse
from django.db import connection
from apps.websocket.services import websocket_service

def health_check(request):
    """
    Health check endpoint
    Migrated from backend/src/index.ts GET /health
    """
    try:
        # Check database connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        
        # Get WebSocket stats
        ws_stats = websocket_service.get_stats()
        
        return JsonResponse({
            'status': 'ok',
            'timestamp': request.build_absolute_uri(),
            'services': {
                'database': 'connected',
                'redis': 'connected',
                'websocket': {
                    'status': 'active',
                    'connections': ws_stats['total_connections'],
                    'authenticatedUsers': ws_stats['authenticated_users']
                }
            }
        })
    except Exception as e:
        return JsonResponse({
            'status': 'error',
            'timestamp': request.build_absolute_uri(),
            'error': 'Service unavailable',
            'details': str(e)
        }, status=503)

def csrf_token_view(request):
    """
    CSRF token endpoint
    Migrated from backend/src/index.ts GET /api/csrf-token
    """
    from django.middleware.csrf import get_token
    return JsonResponse({
        'csrfToken': get_token(request)
    })

urlpatterns = [
    path('admin/', admin.site.urls),
    
    # Health check
    path('health', health_check, name='health_check'),
    
    # CSRF token
    path('api/csrf-token', csrf_token_view, name='csrf_token'),
    
    # API routes (migrated from backend/src/routes/)
    path('api/auth/', include('apps.authentication.urls')),
    path('api/oauth/', include('apps.oauth.urls')),
    path('api/messages/', include('apps.messaging.urls')),
    path('api/conversations/', include('apps.conversations.urls')),
    path('api/webhooks/', include('apps.webhooks.urls')),
    path('api/telegram/', include('apps.telegram.urls')),
    path('api/debug/', include('apps.debug.urls')),
]
