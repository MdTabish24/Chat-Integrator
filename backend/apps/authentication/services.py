"""
Authentication service.

Migrated from backend/src/services/authService.ts
"""

import jwt
from datetime import datetime, timedelta
from django.conf import settings
from django.utils import timezone
from .models import User, RefreshToken


class AuthService:
    """
    Authentication service for user registration, login, and token management
    
    Migrated from: AuthService class in authService.ts
    """
    
    def register(self, email: str, password: str) -> User:
        """
        Register a new user
        
        Migrated from: register() in authService.ts
        
        Args:
            email: User's email address
            password: User's password (plain text)
            
        Returns:
            User instance
            
        Raises:
            ValueError: If validation fails or user already exists
        """
        # Validate input
        if not email or not password:
            raise ValueError('Email and password are required')
        
        if len(password) < 8:
            raise ValueError('Password must be at least 8 characters long')
        
        # Check if user already exists
        if User.objects.filter(email=email.lower()).exists():
            raise ValueError('User with this email already exists')
        
        # Create user
        user = User(email=email.lower())
        user.set_password(password)
        user.save()
        
        return user
    
    def login(self, email: str, password: str) -> tuple[User, dict]:
        """
        Login user and generate tokens
        
        Migrated from: login() in authService.ts
        
        Args:
            email: User's email address
            password: User's password (plain text)
            
        Returns:
            Tuple of (User instance, tokens dict)
            
        Raises:
            ValueError: If credentials are invalid
        """
        # Validate input
        if not email or not password:
            raise ValueError('Email and password are required')
        
        # Find user
        try:
            user = User.objects.get(email=email.lower())
        except User.DoesNotExist:
            raise ValueError('Invalid email or password')
        
        # Verify password
        if not user.check_password(password):
            raise ValueError('Invalid email or password')
        
        # Generate tokens
        tokens = self.generate_tokens(user.id, user.email)
        
        return user, tokens
    
    def generate_tokens(self, user_id: str, email: str) -> dict:
        """
        Generate access and refresh tokens
        
        Migrated from: generateTokens() in authService.ts
        
        Args:
            user_id: User's UUID
            email: User's email
            
        Returns:
            Dict with accessToken and refreshToken
        """
        payload = {
            'userId': str(user_id),
            'email': email
        }
        
        # Generate access token
        access_token = jwt.encode(
            {
                **payload,
                'exp': datetime.utcnow() + settings.JWT_ACCESS_TOKEN_LIFETIME,
                'iat': datetime.utcnow(),
            },
            settings.JWT_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM
        )
        
        # Generate refresh token
        refresh_token_str = jwt.encode(
            {
                **payload,
                'exp': datetime.utcnow() + settings.JWT_REFRESH_TOKEN_LIFETIME,
                'iat': datetime.utcnow(),
            },
            settings.JWT_REFRESH_SECRET_KEY,
            algorithm=settings.JWT_ALGORITHM
        )
        
        # Store refresh token in database
        expires_at = timezone.now() + settings.JWT_REFRESH_TOKEN_LIFETIME
        RefreshToken.objects.create(
            user_id=user_id,
            token=refresh_token_str,
            expires_at=expires_at
        )
        
        return {
            'accessToken': access_token,
            'refreshToken': refresh_token_str
        }
    
    def refresh_access_token(self, refresh_token: str) -> dict:
        """
        Refresh access token using refresh token
        
        Migrated from: refreshAccessToken() in authService.ts
        
        Args:
            refresh_token: The refresh token string
            
        Returns:
            Dict with new accessToken and refreshToken
            
        Raises:
            ValueError: If token is invalid, expired, or revoked
        """
        try:
            # Verify refresh token
            decoded = jwt.decode(
                refresh_token,
                settings.JWT_REFRESH_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
        except jwt.ExpiredSignatureError:
            raise ValueError('Refresh token has expired')
        except jwt.InvalidTokenError:
            raise ValueError('Invalid refresh token')
        
        # Check if refresh token exists and is not revoked
        try:
            token_record = RefreshToken.objects.get(token=refresh_token)
        except RefreshToken.DoesNotExist:
            raise ValueError('Invalid refresh token')
        
        # Check if token is revoked
        if token_record.is_revoked:
            raise ValueError('Refresh token has been revoked')
        
        # Check if token is expired
        if token_record.is_expired:
            raise ValueError('Refresh token has expired')
        
        # Generate new tokens
        new_tokens = self.generate_tokens(
            token_record.user.id,
            token_record.user.email
        )
        
        # Revoke old refresh token
        token_record.revoked_at = timezone.now()
        token_record.save()
        
        return new_tokens
    
    def logout(self, refresh_token: str) -> None:
        """
        Logout user by revoking refresh token
        
        Migrated from: logout() in authService.ts
        
        Args:
            refresh_token: The refresh token to revoke
        """
        RefreshToken.objects.filter(token=refresh_token).update(
            revoked_at=timezone.now()
        )
    
    def verify_access_token(self, token: str) -> dict:
        """
        Verify access token
        
        Migrated from: verifyAccessToken() in authService.ts
        
        Args:
            token: The access token to verify
            
        Returns:
            Dict with userId and email
            
        Raises:
            ValueError: If token is invalid or expired
        """
        try:
            payload = jwt.decode(
                token,
                settings.JWT_SECRET_KEY,
                algorithms=[settings.JWT_ALGORITHM]
            )
            return {
                'userId': payload['userId'],
                'email': payload['email']
            }
        except jwt.ExpiredSignatureError:
            raise ValueError('Access token has expired')
        except jwt.InvalidTokenError:
            raise ValueError('Invalid access token')
    
    def revoke_all_user_tokens(self, user_id: str) -> None:
        """
        Revoke all refresh tokens for a user
        
        Migrated from: revokeAllUserTokens() in authService.ts
        
        Args:
            user_id: The user's UUID
        """
        RefreshToken.objects.filter(
            user_id=user_id,
            revoked_at__isnull=True
        ).update(revoked_at=timezone.now())


# Create singleton instance
auth_service = AuthService()
