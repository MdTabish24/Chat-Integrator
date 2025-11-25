"""
Telegram Message Sync Service.

Migrated from backend/src/services/telegram/TelegramMessageSync.ts
"""

from typing import Optional
from datetime import datetime
from django.utils import timezone
from django.db import transaction

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
        Sync messages for an account
        
        Migrated from: syncMessages() in TelegramMessageSync.ts
        
        Args:
            account_id: Connected account ID
        """
        try:
            print(f'[telegram-sync] Syncing messages for account {account_id}')
            
            # Get dialogs (conversations)
            dialogs = await telegram_user_client.get_dialogs(account_id, 50)
            print(f'[telegram-sync] Found {len(dialogs)} dialogs')
            
            for dialog in dialogs:
                dialog_id = str(dialog.get('id', 'unknown'))
                dialog_name = dialog.get('name', 'Unknown Chat')
                dialog_date = datetime.fromtimestamp(dialog.get('date', 0)) if dialog.get('date') else timezone.now()
                
                # Generate avatar URL using UI Avatars API
                from urllib.parse import quote
                avatar_url = f'https://ui-avatars.com/api/?name={quote(dialog_name)}&background=random&size=128'
                
                # Create or update conversation
                with transaction.atomic():
                    conversation, created = Conversation.objects.update_or_create(
                        account_id=account_id,
                        platform_conversation_id=dialog_id,
                        defaults={
                            'participant_name': dialog_name,
                            'participant_id': dialog_id,
                            'participant_avatar_url': avatar_url,
                            'last_message_at': dialog_date,
                        }
                    )
                    
                    conversation_id = str(conversation.id)
                    
                    # Get messages from this conversation
                    messages = await telegram_user_client.get_messages(account_id, dialog_id, 20)
                    
                    for message in messages:
                        if not message.get('text'):
                            continue
                        
                        # Encrypt content
                        encrypted_content = encrypt(message['text'])
                        
                        # Insert message (ignore duplicates)
                        Message.objects.get_or_create(
                            conversation=conversation,
                            platform_message_id=str(message['id']),
                            defaults={
                                'content': encrypted_content,
                                'sender_id': message.get('senderId', 'unknown'),
                                'sender_name': 'Telegram User',
                                'sent_at': datetime.fromtimestamp(message['date']),
                                'is_outgoing': message.get('out', False),
                                'is_read': True,  # Mark synced messages as read
                            }
                        )
                    
                    # Update unread count
                    unread_count = Message.objects.filter(
                        conversation=conversation,
                        is_read=False,
                        is_outgoing=False
                    ).count()
                    
                    conversation.unread_count = unread_count
                    conversation.save()
            
            print(f'[telegram-sync] Synced {len(dialogs)} conversations for account {account_id}')
        
        except Exception as e:
            print(f'[telegram-sync] Sync failed: {e}')
            raise
    
    async def start_periodic_sync(self, account_id: str) -> None:
        """
        Start periodic sync
        
        Migrated from: startPeriodicSync() in TelegramMessageSync.ts
        
        Args:
            account_id: Connected account ID
        """
        print(f'[telegram-sync] Starting periodic sync for account {account_id}')
        
        # Initial sync
        try:
            await self.sync_messages(account_id)
        except Exception as e:
            print(f'[telegram-sync] Initial sync failed: {e}')
        
        # Note: In Django, periodic tasks should be handled by Celery Beat
        # We'll create a Celery task for this in tasks.py


# Create singleton instance
telegram_message_sync = TelegramMessageSyncService()
