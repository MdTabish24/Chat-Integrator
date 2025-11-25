"""
Django admin configuration for OAuth app.
"""

from django.contrib import admin
from .models import ConnectedAccount


@admin.register(ConnectedAccount)
class ConnectedAccountAdmin(admin.ModelAdmin):
    """Admin interface for ConnectedAccount model"""
    list_display = (
        'user', 
        'platform', 
        'platform_username', 
        'is_active', 
        'is_token_expired',
        'created_at'
    )
    list_filter = ('platform', 'is_active', 'created_at')
    search_fields = ('user__email', 'platform_username', 'platform_user_id')
    readonly_fields = ('id', 'created_at', 'updated_at')
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Account Information', {
            'fields': ('id', 'user', 'platform', 'platform_user_id', 'platform_username')
        }),
        ('Tokens', {
            'fields': ('access_token', 'refresh_token', 'token_expires_at')
        }),
        ('Status', {
            'fields': ('is_active',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at')
        }),
    )
    
    def is_token_expired(self, obj):
        """Display if token is expired"""
        return obj.is_token_expired
    is_token_expired.boolean = True
    is_token_expired.short_description = 'Token Expired'
