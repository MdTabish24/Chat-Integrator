"""
DRF JWT Authentication class.

Integrates JWT authentication with Django Rest Framework.
"""

from rest_framework.authentication import BaseAuthentication
from rest_framework.exceptions import AuthenticationFailed
import jwt
from django.conf import settings


class JWTAuthentication(BaseAuthentication):
    """
    JWT Authentication for Django Rest Framework
    
    This class integrates with DRF's permission system.
    """
    
    def authenticate(self, request):
        """
        Authenticate the request using JWT token
        
        Returns:
            Tuple of (user_info, None) if authenticated
            None if no authentication attempted
            
        Raises:
            AuthenticationFailed if authentication fails
        """
        # Get token from Authorization header
        auth_header = request.META.get('HTTP_AUTHORIZATION', '')
        
        if not auth_header:
            return None  # No authentication attempted
        
        # Extract token (Bearer TOKEN format)
        parts = auth_header.split()
        if len(parts) != 2 or parts[0].lower() != 'bearer':
            raise AuthenticationFailed('Authorization header must be in format: Bearer <token>')
        
        token = parts[1]
        
        try:
            # Verify token
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            
            # Create a user-like object with the JWT payload
            user_info = {
                'user_id': payload.get('userId'),
                'email': payload.get('email'),
                'is_authenticated': True,
            }
            
            return (user_info, None)
        
        except jwt.ExpiredSignatureError:
            raise AuthenticationFailed('Access token has expired')
        
        except jwt.InvalidTokenError:
            raise AuthenticationFailed('Invalid access token')
    
    def authenticate_header(self, request):
        """
        Return the authentication header to use for 401 responses
        """
        return 'Bearer realm="api"'
