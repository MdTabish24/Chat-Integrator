"""
JWT Authentication middleware.

Migrated from backend/src/middleware/auth.ts
"""

import jwt
from django.conf import settings
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin


class JWTAuthenticationMiddleware(MiddlewareMixin):
    """
    Middleware to authenticate JWT tokens
    
    Migrated from: authenticateToken() in auth.ts
    """
    
    def process_request(self, request):
        """
        Extract and verify JWT token from Authorization header
        Attaches user info to request if token is valid
        """
        # Skip authentication for public endpoints
        public_paths = [
            '/health',
            '/api/auth/register',
            '/api/auth/login',
            '/api/auth/refresh',
            '/api/auth/logout',
            '/api/csrf-token',
            '/api/webhooks/',
            '/admin/',
        ]
        
        if any(request.path.startswith(path) for path in public_paths):
            return None
        
        # Get token from Authorization header
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        
        if not auth_header:
            # Allow request to continue (will be caught by DRF permissions)
            request.user_jwt = None
            return None
        
        # Extract token (Bearer TOKEN format)
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            return JsonResponse({
                'error': {
                    'code': 'INVALID_TOKEN_FORMAT',
                    'message': 'Authorization header must be in format: Bearer <token>',
                    'retryable': False,
                }
            }, status=401)
        
        token = parts[1]
        
        try:
            # Verify token
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            # Attach user info to request
            request.user_jwt = {
                'user_id': payload.get('userId'),
                'email': payload.get('email'),
            }
            
        except jwt.ExpiredSignatureError:
            return JsonResponse({
                'error': {
                    'code': 'TOKEN_EXPIRED',
                    'message': 'Access token has expired',
                    'retryable': False,
                }
            }, status=403)
        
        except jwt.InvalidTokenError:
            return JsonResponse({
                'error': {
                    'code': 'INVALID_TOKEN',
                    'message': 'Invalid access token',
                    'retryable': False,
                }
            }, status=403)
        
        return None


class OptionalJWTAuthenticationMiddleware(MiddlewareMixin):
    """
    Optional authentication middleware - doesn't fail if no token
    
    Migrated from: optionalAuth() in auth.ts
    """
    
    def process_request(self, request):
        """
        Extract and verify JWT token if present, but don't fail if missing
        """
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        
        if not auth_header:
            request.user_jwt = None
            return None
        
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            request.user_jwt = None
            return None
        
        token = parts[1]
        
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            request.user_jwt = {
                'user_id': payload.get('userId'),
                'email': payload.get('email'),
            }
        except (jwt.ExpiredSignatureError, jwt.InvalidTokenError):
            request.user_jwt = None
        
        return None
