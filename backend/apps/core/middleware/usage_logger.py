"""
API usage logging middleware.

Migrated from backend/src/middleware/apiUsageLogger.ts
"""

from django.utils.deprecation import MiddlewareMixin
from django.db import connection
import logging

logger = logging.getLogger(__name__)


class APIUsageLoggerMiddleware(MiddlewareMixin):
    """
    Middleware to log API requests to api_usage_logs table
    Logs after the response is sent to avoid blocking the request
    
    Migrated from: apiUsageLogger() in apiUsageLogger.ts
    """
    
    def process_response(self, request, response):
        """
        Log API usage after response is sent
        Only logs for authenticated users with successful requests
        """
        # Only log for authenticated users
        if not hasattr(request, 'user_jwt') or not request.user_jwt:
            return response
        
        user_id = request.user_jwt.get('user_id')
        if not user_id:
            return response
        
        # Only log successful requests (2xx status codes)
        if not (200 <= response.status_code < 300):
            return response
        
        # Get endpoint information
        endpoint = f'{request.method} {request.path}'
        
        # Log to database asynchronously (in practice, use Celery for this)
        try:
            with connection.cursor() as cursor:
                # MySQL compatible - use INSERT IGNORE instead of ON CONFLICT
                cursor.execute(
                    """
                    INSERT IGNORE INTO api_usage_logs (user_id, endpoint, request_count, timestamp)
                    VALUES (%s, %s, %s, NOW())
                    """,
                    [user_id, endpoint, 1]
                )
        except Exception as e:
            # Log error but don't fail the request
            logger.error(f'Failed to log API usage: {e}')
        
        return response
