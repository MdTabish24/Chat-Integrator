"""
OAuth views (controllers) for platform connections.

Migrated from backend/src/controllers/oauthController.ts
"""

import secrets
import json
from typing import Dict
from django.http import JsonResponse
from django.shortcuts import redirect
from django.core.cache import cache
from django.conf import settings
from django.utils import timezone
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated, AllowAny

from .models import ConnectedAccount
from .services.base import OAuthBaseService
from .services.facebook import facebook_oauth_service
from .services.twitter import twitter_oauth_service
from .services.instagram import instagram_oauth_service
from .services.whatsapp import whatsapp_oauth_service
from .services.linkedin import linkedin_oauth_service
from .services.teams import teams_oauth_service
from .services.telegram import telegram_oauth_service


def get_oauth_service(platform: str) -> OAuthBaseService:
    """
    Get OAuth service for platform
    
    Migrated from: getOAuthService() in oauth/index.ts
    """
    services = {
        'facebook': facebook_oauth_service,
        'twitter': twitter_oauth_service,
        'instagram': instagram_oauth_service,
        'whatsapp': whatsapp_oauth_service,
        'linkedin': linkedin_oauth_service,
        'teams': teams_oauth_service,
        'telegram': telegram_oauth_service,
    }
    
    service = services.get(platform)
    if not service:
        raise ValueError(f'Unsupported platform: {platform}')
    
    return service


class InitiateConnectionView(APIView):
    """
    Initiate OAuth connection for a platform
    
    GET /api/oauth/connect/:platform
    Migrated from: initiateConnection() in oauthController.ts
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request, platform):
        try:
            # Get user ID from JWT middleware
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Validate platform
            valid_platforms = [
                'telegram', 'twitter', 'linkedin', 'instagram',
                'whatsapp', 'facebook', 'teams'
            ]
            
            if platform not in valid_platforms:
                return Response({
                    'error': {
                        'code': 'INVALID_PLATFORM',
                        'message': f'Invalid platform: {platform}',
                        'retryable': False,
                    }
                }, status=status.HTTP_400_BAD_REQUEST)
            
            # Generate state parameter for CSRF protection
            state = secrets.token_hex(32)
            
            # Store state in cache with 10 minute expiry
            state_data = json.dumps({
                'userId': user_id,
                'platform': platform,
                'timestamp': int(timezone.now().timestamp())
            })
            cache.set(f'oauth:state:{state}', state_data, timeout=600)  # 10 minutes
            
            # Get OAuth service and generate authorization URL
            oauth_service = get_oauth_service(platform)
            auth_url = oauth_service.generate_authorization_url(state)
            
            return Response({
                'authorizationUrl': auth_url,
                'state': state,
            })
        
        except Exception as e:
            print(f'[oauth] Failed to initiate connection: {e}')
            return Response({
                'error': {
                    'code': 'CONNECTION_FAILED',
                    'message': str(e) or 'Failed to initiate OAuth connection',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class OAuthCallbackView(APIView):
    """
    Handle OAuth callback
    
    GET/POST /api/oauth/callback/:platform
    Migrated from: handleCallback() in oauthController.ts
    """
    permission_classes = [AllowAny]
    
    def get(self, request, platform):
        return self._handle_callback(request, platform, request.GET)
    
    def post(self, request, platform):
        return self._handle_callback(request, platform, request.data)
    
    def _handle_callback(self, request, platform, data):
        try:
            # For Telegram, data comes in POST body
            is_telegram = platform == 'telegram'
            code = data.get('code')
            state = data.get('state')
            error = data.get('error')
            error_description = data.get('error_description')
            
            # Check for OAuth errors
            if error:
                print(f'[oauth] {platform} authorization error: {error_description or error}')
                frontend_url = settings.FRONTEND_URL if hasattr(settings, 'FRONTEND_URL') else settings.WEBHOOK_BASE_URL
                return redirect(
                    f'{frontend_url}/connect?error={error}&platform={platform}'
                )
            
            if not code or not state:
                return JsonResponse({
                    'error': {
                        'code': 'INVALID_CALLBACK',
                        'message': 'Missing code or state parameter',
                        'retryable': False,
                    }
                }, status=400)
            
            # Verify state parameter from cache
            state_data_str = cache.get(f'oauth:state:{state}')
            if not state_data_str:
                print(f'[oauth] State not found in cache: {state}')
                return JsonResponse({
                    'error': {
                        'code': 'INVALID_STATE',
                        'message': 'Invalid or expired state parameter',
                        'retryable': False,
                    }
                }, status=400)
            
            state_data = json.loads(state_data_str)
            if state_data['platform'] != platform:
                print(f"[oauth] Platform mismatch: expected {platform}, got {state_data['platform']}")
                return JsonResponse({
                    'error': {
                        'code': 'INVALID_STATE',
                        'message': 'Invalid or expired state parameter',
                        'retryable': False,
                    }
                }, status=400)
            
            # Clean up state from cache
            cache.delete(f'oauth:state:{state}')
            
            user_id = state_data['userId']
            
            # Get OAuth service
            oauth_service = get_oauth_service(platform)
            
            # For Telegram, validate auth data and get user info directly
            if platform == 'telegram':
                # Telegram sends user data directly
                tokens = oauth_service.exchange_code_for_token('', data)
                user_info = oauth_service.get_user_info(tokens.access_token, data)
            else:
                # Standard OAuth flow
                tokens = oauth_service.exchange_code_for_token(code, {'state': state})
                user_info = oauth_service.get_user_info(tokens.access_token)
            
            # Store tokens securely
            account_id = oauth_service.store_tokens(
                user_id,
                user_info['userId'],
                user_info['username'],
                tokens
            )
            
            print(f'[oauth] {platform} connected successfully for user {user_id}')
            
            # Add account to polling service if needed
            try:
                # This will be implemented in messages app
                pass
            except Exception as e:
                print(f'[oauth] Failed to add account to polling service: {e}')
                # Don't fail the connection if polling setup fails
            
            # Redirect to frontend success page
            frontend_url = settings.FRONTEND_URL if hasattr(settings, 'FRONTEND_URL') else settings.WEBHOOK_BASE_URL
            return redirect(
                f'{frontend_url}/connect?success=true&platform={platform}&accountId={account_id}'
            )
        
        except Exception as e:
            print(f'[oauth] Callback handling failed: {e}')
            frontend_url = settings.FRONTEND_URL if hasattr(settings, 'FRONTEND_URL') else settings.WEBHOOK_BASE_URL
            return redirect(
                f'{frontend_url}/connect?error=callback_failed&platform={platform}&message={str(e)}'
            )


class ConnectedAccountsView(APIView):
    """
    Get connected accounts for current user
    
    GET /api/oauth/accounts
    Migrated from: getConnectedAccounts() in oauthController.ts
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            accounts = ConnectedAccount.objects.filter(
                user_id=user_id
            ).order_by('-created_at').values(
                'id', 'platform', 'platform_user_id', 'platform_username',
                'is_active', 'created_at', 'updated_at'
            )
            
            return Response({
                'accounts': list(accounts),
            })
        
        except Exception as e:
            print(f'[oauth] Failed to get connected accounts: {e}')
            return Response({
                'error': {
                    'code': 'FETCH_FAILED',
                    'message': 'Failed to retrieve connected accounts',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class DisconnectAccountView(APIView):
    """
    Disconnect a platform account
    
    DELETE /api/oauth/disconnect/:accountId
    Migrated from: disconnectAccount() in oauthController.ts
    """
    permission_classes = [IsAuthenticated]
    
    def delete(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Account not found or does not belong to user',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            platform = account.platform
            
            # Attempt to revoke token with platform
            try:
                oauth_service = get_oauth_service(platform)
                oauth_service.revoke_token(account_id)
            except Exception as e:
                print(f'[oauth] Failed to revoke token for {platform}: {e}')
                # Continue with disconnection even if revocation fails
            
            # Mark account as inactive
            account.is_active = False
            account.save()
            
            # Remove account from polling service
            try:
                # This will be implemented in messages app
                pass
            except Exception as e:
                print(f'[oauth] Failed to remove account from polling service: {e}')
                # Don't fail the disconnection if polling cleanup fails
            
            print(f'[oauth] Account {account_id} disconnected successfully')
            
            return Response({
                'success': True,
                'message': 'Account disconnected successfully',
            })
        
        except Exception as e:
            print(f'[oauth] Failed to disconnect account: {e}')
            return Response({
                'error': {
                    'code': 'DISCONNECT_FAILED',
                    'message': 'Failed to disconnect account',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class RefreshTokenView(APIView):
    """
    Refresh token for an account
    
    POST /api/oauth/refresh/:accountId
    Migrated from: refreshToken() in oauthController.ts
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            
            # Verify account belongs to user
            try:
                account = ConnectedAccount.objects.get(
                    id=account_id,
                    user_id=user_id,
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                return Response({
                    'error': {
                        'code': 'ACCOUNT_NOT_FOUND',
                        'message': 'Account not found or inactive',
                        'retryable': False,
                    }
                }, status=status.HTTP_404_NOT_FOUND)
            
            platform = account.platform
            oauth_service = get_oauth_service(platform)
            
            # Ensure valid token (will refresh if needed)
            oauth_service.ensure_valid_token(str(account_id))
            
            return Response({
                'success': True,
                'message': 'Token refreshed successfully',
            })
        
        except Exception as e:
            print(f'[oauth] Failed to refresh token: {e}')
            return Response({
                'error': {
                    'code': 'REFRESH_FAILED',
                    'message': str(e) or 'Failed to refresh token',
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
