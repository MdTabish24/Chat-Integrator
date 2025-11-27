"""
Telegram user views (controllers).

Migrated from backend/src/controllers/telegramUserController.ts
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from adrf.views import APIView as AsyncAPIView

from .services.client import telegram_user_client
from .services.sync import telegram_message_sync
from apps.conversations.models import Conversation


class StartPhoneAuthView(AsyncAPIView):
    """
    Start phone authentication
    
    POST /api/telegram/auth/phone
    Migrated from: startPhoneAuth() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    async def post(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            phone_number = request.data.get('phoneNumber')
            
            if not phone_number:
                return Response({'error': 'Phone number required'}, status=status.HTTP_400_BAD_REQUEST)
            
            result = await telegram_user_client.start_phone_verification(user_id, phone_number)
            
            return Response({
                'success': True,
                'phoneCodeHash': result['phoneCodeHash']
            })
        
        except Exception as e:
            print(f'[telegram-user] Phone auth failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class VerifyPhoneCodeView(AsyncAPIView):
    """
    Verify phone code
    
    POST /api/telegram/auth/verify
    Migrated from: verifyPhoneCode() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    async def post(self, request):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            phone_number = request.data.get('phoneNumber')
            phone_code = request.data.get('phoneCode')
            phone_code_hash = request.data.get('phoneCodeHash')
            password = request.data.get('password')
            
            result = await telegram_user_client.verify_phone_code(
                user_id, phone_number, phone_code, phone_code_hash, password
            )
            
            if result.get('needPassword'):
                return Response({'success': False, 'needPassword': True})
            
            return Response({
                'success': True,
                'accountId': result['accountId'],
                'username': result['username']
            })
        
        except Exception as e:
            print(f'[telegram-user] Code verification failed: {e}')
            if str(e) == '2FA_PASSWORD_REQUIRED':
                return Response({'success': False, 'needPassword': True})
            return Response({'error': str(e)}, status=status.HTTP_400_BAD_REQUEST)


class GetDialogsView(APIView):
    """
    Get dialogs (conversations)
    
    GET /api/telegram/:accountId/dialogs
    Migrated from: getDialogs() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    def get(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            dialogs = async_to_sync(telegram_user_client.get_dialogs)(account_id)
            return Response({'dialogs': dialogs})
        
        except Exception as e:
            print(f'[telegram-user] Get dialogs failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GetMessagesView(APIView):
    """
    Get messages from a chat
    
    GET /api/telegram/:accountId/messages/:chatId
    Migrated from: getMessages() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    def get(self, request, account_id, chat_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            messages = async_to_sync(telegram_user_client.get_messages)(account_id, chat_id)
            return Response({'messages': messages})
        
        except Exception as e:
            print(f'[telegram-user] Get messages failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SendMessageView(APIView):
    """
    Send a message
    
    POST /api/telegram/:accountId/send/:chatId
    Migrated from: sendMessage() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request, account_id, chat_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            text = request.data.get('text')
            if not text:
                return Response({'error': 'Text required'}, status=status.HTTP_400_BAD_REQUEST)
            
            async_to_sync(telegram_user_client.send_message)(account_id, chat_id, text)
            return Response({'success': True})
        
        except Exception as e:
            print(f'[telegram-user] Send message failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SyncMessagesView(APIView):
    """
    Sync messages
    
    POST /api/telegram/:accountId/sync
    Migrated from: syncMessages() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            async_to_sync(telegram_message_sync.sync_messages)(account_id)
            return Response({'success': True, 'message': 'Messages synced successfully'})
        
        except Exception as e:
            print(f'[telegram-user] Sync messages failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ResetAndSyncView(APIView):
    """
    Reset and sync
    
    POST /api/telegram/:accountId/reset
    Migrated from: resetAndSync() in telegramUserController.ts
    """
    permission_classes = [AllowAny]
    
    def post(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            # Delete all conversations for this account
            Conversation.objects.filter(account_id=account_id).delete()
            
            # Resync
            async_to_sync(telegram_message_sync.sync_messages)(account_id)
            
            return Response({'success': True, 'message': 'Reset and synced successfully'})
        
        except Exception as e:
            print(f'[telegram-user] Reset failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
