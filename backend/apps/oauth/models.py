"""
OAuth models for connected platform accounts.

Migrated from backend/db/init.sql - connected_accounts table
"""

import uuid
from django.db import models
from apps.authentication.models import User


class ConnectedAccount(models.Model):
    """
    Connected platform account model
    
    Migrated from: connected_accounts table in init.sql
    """
    
    PLATFORM_CHOICES = [
        ('telegram', 'Telegram'),
        ('twitter', 'Twitter'),
        ('linkedin', 'LinkedIn'),
        ('instagram', 'Instagram'),
        ('whatsapp', 'WhatsApp'),
        ('facebook', 'Facebook'),
        ('teams', 'Microsoft Teams'),
        ('discord', 'Discord'),
        ('gmail', 'Gmail'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(
        User, 
        on_delete=models.CASCADE, 
        related_name='connected_accounts'
    )
    platform = models.CharField(max_length=50, choices=PLATFORM_CHOICES)
    platform_user_id = models.CharField(max_length=255)
    platform_username = models.CharField(max_length=255, null=True, blank=True)
    access_token = models.CharField(max_length=2000)  # MySQL compatible, long enough for tokens
    refresh_token = models.CharField(max_length=2000, null=True, blank=True)
    token_expires_at = models.DateTimeField(null=True, blank=True)
    is_active = models.BooleanField(default=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'connected_accounts'
        unique_together = ['user', 'platform', 'platform_user_id']
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['platform']),
        ]
        ordering = ['-created_at']
    
    def __str__(self):
        return f'{self.user.email} - {self.get_platform_display()}'
    
    @property
    def is_token_expired(self):
        """Check if access token is expired"""
        if not self.token_expires_at:
            return False
        from django.utils import timezone
        return timezone.now() >= self.token_expires_at
