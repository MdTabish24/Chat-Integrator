"""
Telegram Message Sync Service.

Migrated from backend/src/services/telegram/TelegramMessageSync.ts
"""

import re
import traceback
from typing import Optional
from datetime import datetime, timezone as dt_timezone
from urllib.parse import quote

from django.utils import timezone
from django.db import transaction
from asgiref.sync import sync_to_async

from .client import telegram_user_client
from apps.conversations.models import Conversation
from apps.messaging.models import Message
from apps.core.utils.crypto import encrypt


class TelegramMessageSyncService:
    """
    Telegram Message Sync Service
    
    Migrated from: TelegramMessageSyncService in TelegramMessageSync.ts
    """
    
    async def sync_messages(self, account_id: str) -> None:
        """
        Sync messages for an account - fetches ALL dialogs properly
        
        Args:
            account_id: Connected account ID
        """
        try:
            print(f'[telegram-sync] Starting sync for account {account_id}')
            
            # Get dialogs (conversations) - increased limit to get all
            dialogs = await telegram_user_client.get_dialogs(account_id, limit=100)
            print(f'[telegram-sync] Found {len(dialogs)} dialogs')
            
            synced_count = 0
            error_count = 0
            
            for dialog in dialogs:
                try:
                    await self._sync_single_dialog(account_id, dialog)
                    synced_count += 1
                except Exception as e:
                    error_count += 1
                    print(f'[telegram-sync] Error syncing dialog {dialog.get("id")}: {e}')
                    continue  # Continue with next dialog even if one fails
            
            print(f'[telegram-sync] Sync complete: {synced_count} synced, {error_count} errors')
        
        except Exception as e:
            print(f'[telegram-sync] Sync failed: {e}')
            traceback.print_exc()
            raise
    
    async def _sync_single_dialog(self, account_id: str, dialog: dict) -> None:
        """
        Sync a single dialog (conversation)
        
        Args:
            account_id: Connected account ID
            dialog: Dialog data from Telegram
        """
        dialog_id = str(dialog.get('id', 'unknown'))
        dialog_name = dialog.get('name', 'Unknown Chat')
        dialog_date = dialog.get('date', 0)
        
        # Convert timestamp to datetime
        if dialog_date:
            dialog_datetime = datetime.fromtimestamp(dialog_date, tz=dt_timezone.utc)
        else:
            dialog_datetime = timezone.now()
        
        # Generate avatar URL
        avatar_url = f'https://ui-avatars.com/api/?name={quote(dialog_name)}&background=random&size=128'
        
        # Clean name - remove emojis and special chars for MySQL
        clean_name = self._clean_name(dialog_name)
        
        # Get messages from this conversation
        try:
            messages = await telegram_user_client.get_messages_from_telegram(
                account_id, dialog_id, limit=50
            )
        except Exception as e:
            print(f'[telegram-sync] Error fetching messages for {dialog_id}: {e}')
            messages = []
        
        # Save to database
        await self._save_conversation_and_messages(
            account_id=account_id,
            dialog_id=dialog_id,
            clean_name=clean_name,
            avatar_url=avatar_url,
            dialog_datetime=dialog_datetime,
            messages=messages
        )
    
    def _clean_name(self, name: str) -> str:
        """Remove emojis and problematic characters for MySQL utf8mb4"""
        if not name:
            return 'Unknown'
        # Remove emojis and other 4-byte unicode chars
        clean = re.sub(r'[\U00010000-\U0010ffff]', '', name)
        # Remove other problematic chars
        clean = re.sub(r'[^\x00-\x7F\u0080-\uFFFF]+', '', clean)
        return clean.strip() or 'Unknown'
    
    @sync_to_async
    def _save_conversation_and_messages(
        self,
        account_id: str,
        dialog_id: str,
        clean_name: str,
        avatar_url: str,
        dialog_datetime: datetime,
        messages: list
    ) -> Conversation:
        """Save conversation and messages to database"""
        with transaction.atomic():
            # Create or update conversation
            conversation, created = Conversation.objects.update_or_create(
                account_id=account_id,
                platform_conversation_id=dialog_id,
                defaults={
                    'participant_name': clean_name,
                    'participant_id': dialog_id,
                    'participant_avatar_url': avatar_url,
                    'last_message_at': dialog_datetime,
                }
            )
            
            # Save messages
            for msg in messages:
                if not msg.get('text'):
                    continue
                
                try:
                    # Encrypt content
                    encrypted_content = encrypt(msg['text'])
                    
                    # Get message datetime
                    msg_date = msg.get('date', 0)
                    if msg_date:
                        msg_datetime = datetime.fromtimestamp(msg_date, tz=dt_timezone.utc)
                    else:
                        msg_datetime = timezone.now()
                    
                    # Clean sender name (remove emojis for MySQL compatibility)
                    sender_name = self._clean_name(msg.get('senderName', 'Telegram User'))
                    
                    # Insert message (ignore duplicates)
                    Message.objects.get_or_create(
                        conversation=conversation,
                        platform_message_id=str(msg['id']),
                        defaults={
                            'content': encrypted_content,
                            'sender_id': str(msg.get('senderId', 'unknown')),
                            'sender_name': sender_name,
                            'sent_at': msg_datetime,
                            'is_outgoing': msg.get('out', False),
                            'is_read': True,
                        }
                    )
                except Exception as e:
                    print(f'[telegram-sync] Error saving message {msg.get("id")}: {e}')
                    continue
            
            # Update unread count
            unread_count = Message.objects.filter(
                conversation=conversation,
                is_read=False,
                is_outgoing=False
            ).count()
            
            conversation.unread_count = unread_count
            conversation.save()
            
            return conversation
    
    async def emit_conversation_update(self, account_id: str, conversation: Conversation) -> None:
        """Emit WebSocket notification for conversation update"""
        try:
            from apps.websocket.services import websocket_service
            from apps.conversations.serializers import ConversationSerializer
            from apps.oauth.models import ConnectedAccount
            
            @sync_to_async
            def get_user_and_serialize():
                account = ConnectedAccount.objects.get(id=account_id)
                return account.user_id, ConversationSerializer(conversation).data
            
            user_id, conv_data = await get_user_and_serialize()
            websocket_service.emit_conversation_update(
                user_id=user_id,
                conversation=conv_data
            )
        except Exception as e:
            print(f'[telegram-sync] WebSocket notification failed: {e}')


# Create singleton instance
telegram_message_sync = TelegramMessageSyncService()
