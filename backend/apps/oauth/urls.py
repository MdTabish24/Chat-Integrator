"""
OAuth URL configuration.

Migrated from backend/src/routes/oauthRoutes.ts
"""

from django.urls import path
from .views import (
    InitiateConnectionView,
    OAuthCallbackView,
    ConnectedAccountsView,
    DisconnectAccountView,
    RefreshTokenView,
)

app_name = 'oauth'

urlpatterns = [
    # GET /api/oauth/connect/:platform
    # Initiate OAuth connection (requires authentication)
    path('connect/<str:platform>', InitiateConnectionView.as_view(), name='connect'),
    
    # GET/POST /api/oauth/callback/:platform
    # OAuth callback (no auth required - state verification used instead)
    path('callback/<str:platform>', OAuthCallbackView.as_view(), name='callback'),
    
    # GET /api/oauth/accounts
    # Get connected accounts (requires authentication)
    path('accounts', ConnectedAccountsView.as_view(), name='accounts'),
    
    # DELETE /api/oauth/disconnect/:accountId
    # Disconnect account (requires authentication)
    path('disconnect/<uuid:account_id>', DisconnectAccountView.as_view(), name='disconnect'),
    
    # POST /api/oauth/refresh/:accountId
    # Refresh token (requires authentication)
    path('refresh/<uuid:account_id>', RefreshTokenView.as_view(), name='refresh'),
]
