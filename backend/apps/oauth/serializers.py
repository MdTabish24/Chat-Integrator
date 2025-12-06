"""
OAuth serializers for request/response validation.
"""

from rest_framework import serializers


class ConnectedAccountSerializer(serializers.Serializer):
    """Serializer for connected account response"""
    id = serializers.UUIDField()
    platform = serializers.CharField()
    platform_user_id = serializers.CharField()
    platform_username = serializers.CharField()
    is_active = serializers.BooleanField()
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()


class InitiateConnectionResponseSerializer(serializers.Serializer):
    """Serializer for initiate connection response"""
    authorizationUrl = serializers.URLField()
    state = serializers.CharField()


class ConnectedAccountsResponseSerializer(serializers.Serializer):
    """Serializer for connected accounts list response"""
    accounts = ConnectedAccountSerializer(many=True)


class DisconnectAccountResponseSerializer(serializers.Serializer):
    """Serializer for disconnect account response"""
    success = serializers.BooleanField()
    message = serializers.CharField()


class RefreshTokenResponseSerializer(serializers.Serializer):
    """Serializer for refresh token response"""
    success = serializers.BooleanField()
    message = serializers.CharField()
