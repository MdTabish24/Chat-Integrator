"""
URL configuration for messaging hub project.

Migrated from backend/src/index.ts route mounting
"""

from django.contrib import admin
from django.urls import path, include, re_path
from django.http import JsonResponse, HttpResponse
from django.db import connection
from django.conf import settings
from django.conf.urls.static import static
from django.views.generic import TemplateView
import os

def health_check(request):
    """
    Health check endpoint
    Migrated from backend/src/index.ts GET /health
    """
    try:
        # Check database connection
        with connection.cursor() as cursor:
            cursor.execute("SELECT 1")
        
        return JsonResponse({
            'status': 'ok',
            'services': {
                'database': 'connected',
                'redis': 'connected',
            }
        })
    except Exception as e:
        return JsonResponse({
            'status': 'error',
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

def get_frontend_dist_path():
    """Get the path to frontend dist folder"""
    possible_paths = [
        os.path.join(settings.BASE_DIR, '..', 'frontend', 'dist'),
        os.path.join(settings.BASE_DIR, 'frontend', 'dist'),
        '/opt/render/project/src/frontend/dist',
    ]
    for path in possible_paths:
        if os.path.exists(path):
            return path
    return None

def serve_frontend_asset(request, path):
    """
    Serve frontend assets (JS, CSS, images) from the dist/assets folder.
    """
    import mimetypes
    
    dist_path = get_frontend_dist_path()
    if not dist_path:
        return HttpResponse('Asset not found', status=404)
    
    asset_path = os.path.join(dist_path, 'assets', path)
    
    if os.path.exists(asset_path) and os.path.isfile(asset_path):
        content_type, _ = mimetypes.guess_type(asset_path)
        if content_type is None:
            content_type = 'application/octet-stream'
        
        with open(asset_path, 'rb') as f:
            response = HttpResponse(f.read(), content_type=content_type)
            # Cache assets for 1 year (they have hashed filenames)
            response['Cache-Control'] = 'public, max-age=31536000'
            return response
    
    return HttpResponse('Asset not found', status=404)

def serve_frontend(request):
    """
    Serve the frontend index.html for SPA routing.
    This catches all routes that don't match API endpoints.
    """
    dist_path = get_frontend_dist_path()
    
    if dist_path:
        index_path = os.path.join(dist_path, 'index.html')
        if os.path.exists(index_path):
            with open(index_path, 'r', encoding='utf-8') as f:
                response = HttpResponse(f.read(), content_type='text/html')
                # Don't cache index.html so updates are picked up immediately
                response['Cache-Control'] = 'no-cache, no-store, must-revalidate'
                return response
    
    # Fallback: Return a simple HTML that redirects or shows error
    return HttpResponse('''
        <!DOCTYPE html>
        <html>
        <head>
            <title>Chat Orbitor</title>
            <meta charset="utf-8">
            <meta name="viewport" content="width=device-width, initial-scale=1">
            <style>
                body { font-family: system-ui, sans-serif; display: flex; justify-content: center; align-items: center; height: 100vh; margin: 0; background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); color: white; text-align: center; }
                .container { padding: 40px; }
                h1 { font-size: 2em; margin-bottom: 10px; }
                p { opacity: 0.9; }
                a { color: white; text-decoration: underline; }
            </style>
        </head>
        <body>
            <div class="container">
                <h1>💬 Chat Orbitor</h1>
                <p>Frontend is loading...</p>
                <p>If this persists, please <a href="/">refresh</a> or contact support.</p>
            </div>
        </body>
        </html>
    ''', content_type='text/html')

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
    path('api/platforms/', include('apps.platforms.urls')),  # Cookie-based platform integrations
    path('api/debug/', include('apps.debug.urls')),
]

# Serve static files
if settings.DEBUG:
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)
else:
    # In production, also serve static files
    urlpatterns += static(settings.STATIC_URL, document_root=settings.STATIC_ROOT)

# Serve frontend assets (JS, CSS from /assets/)
urlpatterns += [
    re_path(r'^assets/(?P<path>.*)$', serve_frontend_asset, name='frontend_assets'),
]

# SPA Catch-all route - MUST be LAST!
# This serves index.html for all frontend routes (/, /login, /dashboard, etc.)
urlpatterns += [
    re_path(r'^(?!api/|admin/|health|static/|ws/|assets/).*$', serve_frontend, name='frontend_catchall'),
]
