"""
Telegram user views (controllers).

Migrated from backend/src/controllers/telegramUserController.ts
"""

from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework import status
from rest_framework.permissions import AllowAny
from adrf.views import APIView as AsyncAPIView
from asgiref.sync import sync_to_async

from .services.client import telegram_user_client
from .services.sync import telegram_message_sync
from apps.conversations.models import Conversation
from apps.messaging.models import Message
from apps.core.utils.crypto import encrypt


class StartPhoneAuthView(AsyncAPIView):
    """
    Start phone authentication
    
    POST /api/telegram/auth/phone
    """
    permission_classes = [AllowAny]
    
    async def post(self, request):
        try:
            print(f'[telegram-auth] Phone auth request received')
            
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                print(f'[telegram-auth] Unauthorized - no JWT')
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            user_id = request.user_jwt['user_id']
            phone_number = request.data.get('phoneNumber')
            
            print(f'[telegram-auth] User {user_id} requesting code for {phone_number}')
            
            if not phone_number:
                return Response({'error': 'Phone number required'}, status=status.HTTP_400_BAD_REQUEST)
            
            result = await telegram_user_client.start_phone_verification(user_id, phone_number)
            
            print(f'[telegram-auth] Code sent successfully for {phone_number}')
            
            return Response({
                'success': True,
                'phoneCodeHash': result['phoneCodeHash']
            })
        
        except Exception as e:
            import traceback
            print(f'[telegram-auth] Phone auth failed: {e}')
            traceback.print_exc()
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class VerifyPhoneCodeView(AsyncAPIView):
    """
    Verify phone code
    
    POST /api/telegram/auth/verify
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
            
            # Trigger initial sync after successful verification
            try:
                await telegram_message_sync.sync_messages(result['accountId'])
            except Exception as sync_error:
                print(f'[telegram-user] Initial sync failed: {sync_error}')
            
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


class GetDialogsView(AsyncAPIView):
    """
    Get dialogs (conversations)
    
    GET /api/telegram/:accountId/dialogs
    """
    permission_classes = [AllowAny]
    
    async def get(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            dialogs = await telegram_user_client.get_dialogs(account_id)
            return Response({'dialogs': dialogs})
        
        except Exception as e:
            print(f'[telegram-user] Get dialogs failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class GetMessagesView(AsyncAPIView):
    """
    Get messages from a chat
    
    GET /api/telegram/:accountId/messages/:chatId
    """
    permission_classes = [AllowAny]
    
    async def get(self, request, account_id, chat_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            messages = await telegram_user_client.get_messages(account_id, chat_id)
            return Response({'messages': messages})
        
        except Exception as e:
            print(f'[telegram-user] Get messages failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SendMessageView(AsyncAPIView):
    """
    Send a message
    
    POST /api/telegram/:accountId/send/:chatId
    """
    permission_classes = [AllowAny]
    
    async def post(self, request, account_id, chat_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            text = request.data.get('text')
            if not text:
                return Response({'error': 'Text required'}, status=status.HTTP_400_BAD_REQUEST)
            
            # Send message via Telegram
            result = await telegram_user_client.send_message(account_id, chat_id, text)
            
            # Save message to database
            @sync_to_async
            def save_message():
                try:
                    conversation = Conversation.objects.get(
                        account_id=account_id,
                        platform_conversation_id=chat_id
                    )
                    
                    from django.utils import timezone
                    from datetime import datetime
                    
                    msg_date = result.get('date', 0)
                    if msg_date:
                        msg_datetime = datetime.fromtimestamp(msg_date, tz=timezone.utc)
                    else:
                        msg_datetime = timezone.now()
                    
                    Message.objects.create(
                        conversation=conversation,
                        platform_message_id=result['id'],
                        content=encrypt(text),
                        sender_id='me',
                        sender_name='Me',
                        sent_at=msg_datetime,
                        is_outgoing=True,
                        is_read=True,
                    )
                    
                    # Update conversation last_message_at
                    conversation.last_message_at = msg_datetime
                    conversation.save()
                    
                except Exception as e:
                    print(f'[telegram-user] Error saving sent message: {e}')
            
            await save_message()
            
            return Response({'success': True, 'message': result})
        
        except Exception as e:
            print(f'[telegram-user] Send message failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class SyncMessagesView(AsyncAPIView):
    """
    Sync messages
    
    POST /api/telegram/:accountId/sync
    """
    permission_classes = [AllowAny]
    
    async def post(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            await telegram_message_sync.sync_messages(account_id)
            return Response({'success': True, 'message': 'Messages synced successfully'})
        
        except Exception as e:
            print(f'[telegram-user] Sync messages failed: {e}')
            error_msg = str(e)
            
            # Check if it's a session/account not found error
            if 'not found' in error_msg.lower() or 'expired' in error_msg.lower():
                return Response({
                    'error': 'Session expired or account not found. Please reconnect your Telegram account.',
                    'needsReconnect': True
                }, status=status.HTTP_401_UNAUTHORIZED)
            
            return Response({'error': error_msg}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)


class ResetAndSyncView(AsyncAPIView):
    """
    Reset and sync - deletes all conversations and re-syncs
    
    POST /api/telegram/:accountId/reset
    """
    permission_classes = [AllowAny]
    
    async def post(self, request, account_id):
        try:
            if not hasattr(request, 'user_jwt') or not request.user_jwt:
                return Response({'error': 'Unauthorized'}, status=status.HTTP_401_UNAUTHORIZED)
            
            @sync_to_async
            def delete_conversations():
                # Delete messages first (cascade should handle this, but being explicit)
                conversations = Conversation.objects.filter(account_id=account_id)
                for conv in conversations:
                    Message.objects.filter(conversation=conv).delete()
                conversations.delete()
            
            await delete_conversations()
            
            # Resync
            await telegram_message_sync.sync_messages(account_id)
            
            return Response({'success': True, 'message': 'Reset and synced successfully'})
        
        except Exception as e:
            print(f'[telegram-user] Reset failed: {e}')
            return Response({'error': str(e)}, status=status.HTTP_500_INTERNAL_SERVER_ERROR)
