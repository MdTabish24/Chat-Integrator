"""
Django admin configuration for messages app.
"""

from django.contrib import admin
from .models import Message


@admin.register(Message)
class MessageAdmin(admin.ModelAdmin):
    """Admin interface for Message model"""
    list_display = (
        'sender_name',
        'conversation',
        'message_type',
        'is_outgoing',
        'is_read',
        'sent_at',
        'content_preview'
    )
    list_filter = (
        'message_type',
        'is_outgoing',
        'is_read',
        'sent_at',
        'conversation__account__platform'
    )
    search_fields = ('sender_name', 'sender_id', 'content', 'platform_message_id')
    readonly_fields = ('id', 'created_at')
    ordering = ('-sent_at',)
    
    fieldsets = (
        ('Message Information', {
            'fields': ('id', 'conversation', 'platform_message_id')
        }),
        ('Sender', {
            'fields': ('sender_id', 'sender_name')
        }),
        ('Content', {
            'fields': ('content', 'message_type', 'media_url')
        }),
        ('Status', {
            'fields': ('is_outgoing', 'is_read', 'sent_at', 'delivered_at')
        }),
        ('Timestamps', {
            'fields': ('created_at',)
        }),
    )
    
    def content_preview(self, obj):
        """Display content preview"""
        return obj.content[:50] + '...' if len(obj.content) > 50 else obj.content
    content_preview.short_description = 'Content Preview'
