"""
Django admin configuration for conversations app.
"""

from django.contrib import admin
from .models import Conversation


@admin.register(Conversation)
class ConversationAdmin(admin.ModelAdmin):
    """Admin interface for Conversation model"""
    list_display = (
        'participant_name',
        'account',
        'platform',
        'unread_count',
        'last_message_at',
        'created_at'
    )
    list_filter = ('account__platform', 'last_message_at', 'created_at')
    search_fields = ('participant_name', 'participant_id', 'platform_conversation_id')
    readonly_fields = ('id', 'created_at', 'updated_at')
    ordering = ('-last_message_at',)
    
    fieldsets = (
        ('Conversation Information', {
            'fields': ('id', 'account', 'platform_conversation_id')
        }),
        ('Participant', {
            'fields': ('participant_name', 'participant_id', 'participant_avatar_url')
        }),
        ('Status', {
            'fields': ('unread_count', 'last_message_at')
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
    def platform(self, obj):
        """Display platform name"""
        return obj.account.platform
    platform.short_description = 'Platform'
