"""
Authentication background tasks.

Celery tasks for cleanup and maintenance.
"""

from celery import shared_task
from django.utils import timezone
from .models import RefreshToken
import logging

logger = logging.getLogger(__name__)


@shared_task(name='apps.authentication.tasks.cleanup_expired_tokens')
def cleanup_expired_tokens():
    """
    Clean up expired refresh tokens from the database
    Runs daily at 2 AM (configured in celery.py)
    """
    try:
        now = timezone.now()
        deleted_count, _ = RefreshToken.objects.filter(
            expires_at__lt=now
        ).delete()
        
        logger.info(f'Cleaned up {deleted_count} expired refresh tokens')
        return f'Deleted {deleted_count} expired tokens'
    
    except Exception as e:
        logger.error(f'Failed to cleanup expired tokens: {e}')
        raise
