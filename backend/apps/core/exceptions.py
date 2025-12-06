"""
Custom exceptions and error handlers.

Migrated from backend/src/middleware/errorHandler.ts
"""

from rest_framework.views import exception_handler
from rest_framework.response import Response
from rest_framework import status
from django.http import JsonResponse
import logging

logger = logging.getLogger(__name__)


class AppError(Exception):
    """
    Custom application error class
    
    Migrated from: AppError class in errorHandler.ts
    """
    def __init__(
        self, 
        message: str, 
        status_code: int = 500,
        code: str = 'INTERNAL_ERROR',
        retryable: bool = False,
        details: dict = None
    ):
        self.message = message
        self.status_code = status_code
        self.code = code
        self.retryable = retryable
        self.details = details or {}
        super().__init__(self.message)


def custom_exception_handler(exc, context):
    """
    Custom exception handler for DRF
    
    Migrated from: errorHandler() in errorHandler.ts
    
    Args:
        exc: The exception instance
        context: The context in which the exception occurred
        
    Returns:
        Response object with error details
    """
    # Call REST framework's default exception handler first
    response = exception_handler(exc, context)
    
    # Handle AppError instances
    if isinstance(exc, AppError):
        return Response({
            'error': {
                'code': exc.code,
                'message': exc.message,
                'details': exc.details,
                'retryable': exc.retryable,
            }
        }, status=exc.status_code)
    
    # Handle DRF exceptions
    if response is not None:
        error_code = 'VALIDATION_ERROR'
        retryable = False
        
        # Determine error code based on status
        if response.status_code == 401:
            error_code = 'UNAUTHORIZED'
        elif response.status_code == 403:
            error_code = 'FORBIDDEN'
        elif response.status_code == 404:
            error_code = 'NOT_FOUND'
        elif response.status_code == 429:
            error_code = 'RATE_LIMIT_EXCEEDED'
            retryable = True
        elif response.status_code >= 500:
            error_code = 'INTERNAL_ERROR'
            retryable = True
        
        # Format error response
        error_message = response.data
        if isinstance(error_message, dict):
            if 'detail' in error_message:
                error_message = error_message['detail']
            else:
                error_message = str(error_message)
        
        return Response({
            'error': {
                'code': error_code,
                'message': error_message,
                'retryable': retryable,
            }
        }, status=response.status_code)
    
    # Handle unexpected exceptions
    logger.error(f'Unexpected error: {exc}', exc_info=True)
    return Response({
        'error': {
            'code': 'INTERNAL_ERROR',
            'message': 'An unexpected error occurred',
            'retryable': False,
        }
    }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ErrorHandlerMiddleware:
    """
    Middleware to catch and format all errors
    
    Migrated from: errorHandler middleware in errorHandler.ts
    """
    def __init__(self, get_response):
        self.get_response = get_response
    
    def __call__(self, request):
        response = self.get_response(request)
        return response
    
    def process_exception(self, request, exception):
        """Handle exceptions that occur during request processing"""
        if isinstance(exception, AppError):
            return JsonResponse({
                'error': {
                    'code': exception.code,
                    'message': exception.message,
                    'details': exception.details,
                    'retryable': exception.retryable,
                }
            }, status=exception.status_code)
        
        # Log unexpected errors
        logger.error(f'Unexpected error: {exception}', exc_info=True)
        return JsonResponse({
            'error': {
                'code': 'INTERNAL_ERROR',
                'message': 'An unexpected error occurred',
                'retryable': False,
            }
        }, status=500)
