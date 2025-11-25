"""
Conversation models.

Migrated from backend/db/init.sql - conversations table
"""

import uuid
from django.db import models
from apps.oauth.models import ConnectedAccount


class Conversation(models.Model):
    """
    Conversation model
    
    Migrated from: conversations table in init.sql
    """
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    account = models.ForeignKey(
        ConnectedAccount,
        on_delete=models.CASCADE,
        related_name='conversations'
    )
    platform_conversation_id = models.CharField(max_length=255)
    participant_name = models.CharField(max_length=255, null=True, blank=True)
    participant_id = models.CharField(max_length=255, null=True, blank=True)
    participant_avatar_url = models.TextField(null=True, blank=True)
    last_message_at = models.DateTimeField(null=True, blank=True)
    unread_count = models.IntegerField(default=0)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'conversations'
        unique_together = ['account', 'platform_conversation_id']
        indexes = [
            models.Index(fields=['account']),
            models.Index(fields=['-last_message_at']),
        ]
        ordering = ['-last_message_at']
    
    def __str__(self):
        return f'{self.participant_name or "Unknown"} - {self.account.platform}'
    
    @property
    def has_unread_messages(self):
        """Check if conversation has unread messages"""
        return self.unread_count > 0
