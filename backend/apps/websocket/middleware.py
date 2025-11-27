"""
WebSocket authentication middleware.

Migrated from JWT authentication in websocketService.ts
"""

import jwt
from channels.middleware import BaseMiddleware
from channels.db import database_sync_to_async
from django.conf import settings
from urllib.parse import parse_qs


class JWTAuthMiddleware(BaseMiddleware):
    """
    JWT authentication middleware for WebSocket connections
    
    Migrated from: authenticateSocket() in websocketService.ts
    """
    
    async def __call__(self, scope, receive, send):
        # Get token from query string
        query_string = scope.get('query_string', b'').decode()
        query_params = parse_qs(query_string)
        
        token = query_params.get('token', [None])[0]
        
        # Create anonymous user object for Channels
        from channels.auth import AnonymousUser
        
        if token:
            try:
                # Verify JWT token
                payload = jwt.decode(
                    token,
                    settings.JWT_SECRET_KEY,
                    algorithms=[settings.JWT_ALGORITHM]
                )
                
                # Add user info to scope (Channels expects this format)
                scope['user'] = {
                    'user_id': payload.get('userId'),
                    'email': payload.get('email'),
                    'is_authenticated': True,
                }
            
            except jwt.ExpiredSignatureError:
                scope['user'] = AnonymousUser()
            except jwt.InvalidTokenError:
                scope['user'] = AnonymousUser()
        else:
            scope['user'] = AnonymousUser()
        
        return await super().__call__(scope, receive, send)
