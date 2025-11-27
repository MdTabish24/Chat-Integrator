"""
Authentication models.

Migrated from backend/db/init.sql
Tables: users, refresh_tokens
"""

import uuid
from django.db import models
from django.contrib.auth.hashers import make_password, check_password


class User(models.Model):
    """
    User model
    
    Migrated from: users table in init.sql
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    email = models.EmailField(unique=True, max_length=255)
    password_hash = models.CharField(max_length=255)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'users'
        ordering = ['-created_at']
    
    def __str__(self):
        return self.email
    
    def set_password(self, raw_password):
        """Hash and set password using bcrypt"""
        import bcrypt
        self.password_hash = bcrypt.hashpw(
            raw_password.encode('utf-8'), 
            bcrypt.gensalt()
        ).decode('utf-8')
    
    def check_password(self, raw_password):
        """Verify password using bcrypt"""
        import bcrypt
        return bcrypt.checkpw(
            raw_password.encode('utf-8'),
            self.password_hash.encode('utf-8')
        )


class RefreshToken(models.Model):
    """
    Refresh token model
    
    Migrated from: refresh_tokens table in init.sql
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user = models.ForeignKey(User, on_delete=models.CASCADE, related_name='refresh_tokens')
    token = models.CharField(max_length=500)  # Changed from TextField for MySQL index compatibility
    expires_at = models.DateTimeField()
    created_at = models.DateTimeField(auto_now_add=True)
    revoked_at = models.DateTimeField(null=True, blank=True)
    
    class Meta:
        db_table = 'refresh_tokens'
        indexes = [
            models.Index(fields=['user']),
            models.Index(fields=['token']),
        ]
        ordering = ['-created_at']
    
    def __str__(self):
        return f'RefreshToken for {self.user.email}'
    
    @property
    def is_expired(self):
        """Check if token is expired"""
        from django.utils import timezone
        return timezone.now() > self.expires_at
    
    @property
    def is_revoked(self):
        """Check if token is revoked"""
        return self.revoked_at is not None
    
    @property
    def is_valid(self):
        """Check if token is valid (not expired and not revoked)"""
        return not self.is_expired and not self.is_revoked
