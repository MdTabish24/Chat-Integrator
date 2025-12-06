"""
Authentication views (controllers).

Migrated from backend/src/controllers/authController.ts
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny, IsAuthenticated
from .services import auth_service
from .serializers import (
    RegisterSerializer,
    LoginSerializer,
    RefreshTokenSerializer,
    UserResponseSerializer,
    TokenResponseSerializer,
)
from apps.core.exceptions import AppError


class RegisterView(APIView):
    """
    Register a new user
    
    POST /api/auth/register
    Migrated from: register() in authController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        # Validate request data
        serializer = RegisterSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': str(serializer.errors),
                    'retryable': False,
                }
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            email = serializer.validated_data['email']
            password = serializer.validated_data['password']
            
            # Register user
            user = auth_service.register(email, password)
            
            # Generate tokens
            tokens = auth_service.generate_tokens(user.id, user.email)
            
            return Response({
                'user': {
                    'id': str(user.id),
                    'email': user.email,
                    'createdAt': user.created_at.isoformat(),
                },
                'tokens': tokens,
            }, status=status.HTTP_201_CREATED)
        
        except ValueError as e:
            message = str(e)
            status_code = status.HTTP_409_CONFLICT if 'already exists' in message else status.HTTP_500_INTERNAL_SERVER_ERROR
            error_code = 'USER_EXISTS' if 'already exists' in message else 'REGISTRATION_FAILED'
            
            return Response({
                'error': {
                    'code': error_code,
                    'message': message,
                    'retryable': False,
                }
            }, status=status_code)


class LoginView(APIView):
    """
    Login user
    
    POST /api/auth/login
    Migrated from: login() in authController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        # Validate request data
        serializer = LoginSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': str(serializer.errors),
                    'retryable': False,
                }
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            email = serializer.validated_data['email']
            password = serializer.validated_data['password']
            
            # Login user
            user, tokens = auth_service.login(email, password)
            
            return Response({
                'user': {
                    'id': str(user.id),
                    'email': user.email,
                    'createdAt': user.created_at.isoformat(),
                },
                'tokens': tokens,
            }, status=status.HTTP_200_OK)
        
        except ValueError as e:
            return Response({
                'error': {
                    'code': 'AUTHENTICATION_FAILED',
                    'message': str(e),
                    'retryable': False,
                }
            }, status=status.HTTP_401_UNAUTHORIZED)


class RefreshTokenView(APIView):
    """
    Refresh access token
    
    POST /api/auth/refresh
    Migrated from: refresh() in authController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        # Validate request data
        serializer = RefreshTokenSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': str(serializer.errors),
                    'retryable': False,
                }
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            refresh_token = serializer.validated_data['refreshToken']
            
            # Refresh tokens
            tokens = auth_service.refresh_access_token(refresh_token)
            
            return Response({
                'tokens': tokens,
            }, status=status.HTTP_200_OK)
        
        except ValueError as e:
            return Response({
                'error': {
                    'code': 'TOKEN_REFRESH_FAILED',
                    'message': str(e),
                    'retryable': False,
                }
            }, status=status.HTTP_401_UNAUTHORIZED)


class LogoutView(APIView):
    """
    Logout user
    
    POST /api/auth/logout
    Migrated from: logout() in authController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request):
        # Validate request data
        serializer = RefreshTokenSerializer(data=request.data)
        if not serializer.is_valid():
            return Response({
                'error': {
                    'code': 'VALIDATION_ERROR',
                    'message': str(serializer.errors),
                    'retryable': False,
                }
            }, status=status.HTTP_400_BAD_REQUEST)
        
        try:
            refresh_token = serializer.validated_data['refreshToken']
            
            # Logout user
            auth_service.logout(refresh_token)
            
            return Response({
                'message': 'Logged out successfully',
            }, status=status.HTTP_200_OK)
        
        except Exception as e:
            return Response({
                'error': {
                    'code': 'LOGOUT_FAILED',
                    'message': str(e),
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class CurrentUserView(APIView):
    """
    Get current user info
    
    GET /api/auth/me
    Migrated from: getCurrentUser() in authController.ts
    """
    permission_classes = [AllowAny]  # Check JWT in middleware instead
    
    def get(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({
                    'error': {
                        'code': 'UNAUTHORIZED',
                        'message': 'User not authenticated',
                        'retryable': False,
                    }
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            return Response({
                'user': {
                    'id': request.user_jwt['user_id'],
                    'email': request.user_jwt['email'],
                }
            }, status=status.HTTP_200_OK)
        
        except Exception as e:
            return Response({
                'error': {
                    'code': 'USER_INFO_FAILED',
                    'message': str(e),
                    'retryable': True,
                }
            }, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
