"""
Authentication serializers for request/response validation.

Migrated from Joi validation schemas in backend/src/controllers/authController.ts
"""

from rest_framework import serializers


class RegisterSerializer(serializers.Serializer):
    """
    Serializer for user registration
    
    Migrated from: registerSchema in authController.ts
    """
    email = serializers.EmailField(required=True)
    password = serializers.CharField(required=True, min_length=8, write_only=True)


class LoginSerializer(serializers.Serializer):
    """
    Serializer for user login
    
    Migrated from: loginSchema in authController.ts
    """
    email = serializers.EmailField(required=True)
    password = serializers.CharField(required=True, write_only=True)


class RefreshTokenSerializer(serializers.Serializer):
    """
    Serializer for token refresh
    
    Migrated from: refreshTokenSchema in authController.ts
    """
    refreshToken = serializers.CharField(required=True)


class UserResponseSerializer(serializers.Serializer):
    """
    Serializer for user response data
    """
    id = serializers.UUIDField()
    email = serializers.EmailField()
    createdAt = serializers.DateTimeField(source='created_at')


class TokenResponseSerializer(serializers.Serializer):
    """
    Serializer for token response
    """
    accessToken = serializers.CharField()
    refreshToken = serializers.CharField()


class AuthResponseSerializer(serializers.Serializer):
    """
    Serializer for authentication response (user + tokens)
    """
    user = UserResponseSerializer()
    tokens = TokenResponseSerializer()
