"""
Authentication URL configuration.

Migrated from backend/src/routes/authRoutes.ts
"""

from django.urls import path
from .views import (
    RegisterView,
    LoginView,
    RefreshTokenView,
    LogoutView,
    CurrentUserView,
)

app_name = 'authentication'

urlpatterns = [
    # POST /api/auth/register
    # Register a new user
    path('register', RegisterView.as_view(), name='register'),
    
    # POST /api/auth/login
    # Login user and get tokens
    path('login', LoginView.as_view(), name='login'),
    
    # POST /api/auth/refresh
    # Refresh access token using refresh token
    path('refresh', RefreshTokenView.as_view(), name='refresh'),
    
    # POST /api/auth/logout
    # Logout user and revoke refresh token
    path('logout', LogoutView.as_view(), name='logout'),
    
    # GET /api/auth/me
    # Get current user info (protected)
    path('me', CurrentUserView.as_view(), name='current_user'),
]
