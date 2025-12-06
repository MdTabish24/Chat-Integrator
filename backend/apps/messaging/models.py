"""
Message models.

Migrated from backend/db/init.sql - messages table
"""

import uuid
from django.db import models
from apps.conversations.models import Conversation
from apps.oauth.models import ConnectedAccount


class Message(models.Model):
    """
    Message model
    
    Migrated from: messages table in init.sql
    """
    
    MESSAGE_TYPE_CHOICES = [
        ('text', 'Text'),
        ('image', 'Image'),
        ('video', 'Video'),
        ('file', 'File'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='messages'
    )
    platform_message_id = models.CharField(max_length=255)
    sender_id = models.CharField(max_length=255)
    sender_name = models.CharField(max_length=255, null=True, blank=True)
    content = models.TextField()  # No index on this, so OK for MySQL
    message_type = models.CharField(
        max_length=50,
        choices=MESSAGE_TYPE_CHOICES,
        default='text'
    )
    media_url = models.CharField(max_length=1000, null=True, blank=True)  # MySQL compatible
    is_outgoing = models.BooleanField(default=False)
    is_read = models.BooleanField(default=False)
    sent_at = models.DateTimeField()
    delivered_at = models.DateTimeField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    
    class Meta:
        db_table = 'messages'
        unique_together = ['conversation', 'platform_message_id']
        indexes = [
            models.Index(fields=['conversation']),
            models.Index(fields=['-sent_at']),
            models.Index(fields=['is_read'], name='idx_messages_is_read'),  # Removed condition for MySQL
        ]
        ordering = ['-sent_at']
    
    def __str__(self):
        return f'{self.sender_name or "Unknown"}: {self.content[:50]}...'
    
    @property
    def is_unread(self):
        """Check if message is unread"""
        return not self.is_read and not self.is_outgoing


class PendingOutgoingMessage(models.Model):
    """
    Pending outgoing messages that need to be sent via Desktop App.
    
    Used for platforms like Instagram that block server-side sending.
    The Desktop App polls for these messages and sends them using
    the user's local IP address.
    """
    
    STATUS_CHOICES = [
        ('pending', 'Pending'),
        ('sending', 'Sending'),
        ('sent', 'Sent'),
        ('failed', 'Failed'),
    ]
    
    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)
    user_id = models.CharField(max_length=36)  # User who owns this message
    account = models.ForeignKey(
        ConnectedAccount,
        on_delete=models.CASCADE,
        related_name='pending_messages'
    )
    conversation = models.ForeignKey(
        Conversation,
        on_delete=models.CASCADE,
        related_name='pending_messages'
    )
    platform = models.CharField(max_length=50)  # e.g., 'instagram'
    platform_conversation_id = models.CharField(max_length=255)  # Thread ID
    recipient_id = models.CharField(max_length=255)  # Recipient user ID
    content = models.TextField()
    status = models.CharField(max_length=20, choices=STATUS_CHOICES, default='pending')
    error_message = models.TextField(null=True, blank=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    
    class Meta:
        db_table = 'pending_outgoing_messages'
        indexes = [
            models.Index(fields=['user_id', 'platform', 'status']),
            models.Index(fields=['created_at']),
        ]
        ordering = ['created_at']
    
    def __str__(self):
        return f'[{self.status}] {self.platform}: {self.content[:50]}...'
