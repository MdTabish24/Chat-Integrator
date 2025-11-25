"""
Django admin configuration for authentication app.
"""

from django.contrib import admin
from .models import User, RefreshToken


@admin.register(User)
class UserAdmin(admin.ModelAdmin):
    """Admin interface for User model"""
    list_display = ('email', 'created_at', 'updated_at')
    search_fields = ('email',)
    readonly_fields = ('id', 'created_at', 'updated_at', 'password_hash')
    ordering = ('-created_at',)
    
    fieldsets = (
        ('User Information', {
            'fields': ('id', 'email')
        }),
        ('Security', {
            'fields': ('password_hash',)
        }),
        ('Timestamps', {
            'fields': ('created_at', 'updated_at')
        }),
    )


@admin.register(RefreshToken)
class RefreshTokenAdmin(admin.ModelAdmin):
    """Admin interface for RefreshToken model"""
    list_display = ('user', 'expires_at', 'is_valid', 'created_at', 'revoked_at')
    search_fields = ('user__email',)
    list_filter = ('revoked_at', 'expires_at')
    readonly_fields = ('id', 'token', 'created_at')
    ordering = ('-created_at',)
    
    fieldsets = (
        ('Token Information', {
            'fields': ('id', 'user', 'token')
        }),
        ('Validity', {
            'fields': ('expires_at', 'revoked_at')
        }),
        ('Timestamps', {
            'fields': ('created_at',)
        }),
    )
    
    def is_valid(self, obj):
        """Display if token is valid"""
        return obj.is_valid
    is_valid.boolean = True
    is_valid.short_description = 'Valid'
