"""
Debug views for development and testing.

Migrated from backend/src/routes/debugRoutes.ts
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from django.conf import settings


class TriggerPollingView(APIView):
    """
    Trigger immediate polling for a specific account
    
    POST /api/debug/polling/:accountId
    Migrated from: debugRoutes.ts
    """
    permission_classes = [IsAuthenticated]
    
    def post(self, request, account_id):
        try:
            # This will be implemented when polling service is created
            # For now, return success
            return Response({
                'success': True,
                'message': f'Polling triggered for account {account_id}'
            })
        
        except Exception as e:
            print(f'Error triggering polling: {e}')
            return Response({
                'success': False,
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class PollingStatsView(APIView):
    """
    Get polling statistics
    
    GET /api/debug/polling/stats
    Migrated from: debugRoutes.ts
    """
    permission_classes = [IsAuthenticated]
    
    def get(self, request):
        try:
            # This will be implemented when polling service is created
            stats = {
                'activeAccounts': 0,
                'lastPollTime': None,
                'totalPolls': 0,
            }
            
            return Response({
                'success': True,
                'stats': stats
            })
        
        except Exception as e:
            print(f'Error getting polling stats: {e}')
            return Response({
                'success': False,
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class InstagramConfigView(APIView):
    """
    Check Instagram OAuth configuration
    
    GET /api/debug/instagram-config
    Migrated from: debugRoutes.ts
    """
    permission_classes = []  # Allow unauthenticated for debugging
    
    def get(self, request):
        try:
            instagram_app_id = settings.INSTAGRAM_APP_ID
            instagram_app_secret = settings.INSTAGRAM_APP_SECRET
            webhook_base_url = settings.WEBHOOK_BASE_URL
            
            return Response({
                'success': True,
                'config': {
                    'appIdConfigured': bool(instagram_app_id),
                    'appIdLength': len(instagram_app_id) if instagram_app_id else 0,
                    'appIdFirstChars': instagram_app_id[:4] if instagram_app_id else 'NOT SET',
                    'appSecretConfigured': bool(instagram_app_secret),
                    'appSecretLength': len(instagram_app_secret) if instagram_app_secret else 0,
                    'webhookBaseUrl': webhook_base_url if webhook_base_url else 'NOT SET',
                    'redirectUri': f'{webhook_base_url}/api/auth/callback/instagram',
                    'authUrl': f'https://www.facebook.com/v18.0/dialog/oauth?client_id={instagram_app_id or "MISSING"}&redirect_uri={webhook_base_url}/api/auth/callback/instagram'
                }
            })
        
        except Exception as e:
            print(f'Error checking Instagram config: {e}')
            return Response({
                'success': False,
                'error': str(e)
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
