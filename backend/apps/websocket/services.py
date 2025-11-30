"""
WebSocket service for emitting events to clients.

Migrated from backend/src/services/websocketService.ts
"""

import asyncio
from channels.layers import get_channel_layer
from asgiref.sync import async_to_sync
from typing import Dict, Optional


class WebSocketService:
    """
    WebSocket service for real-time updates
    
    Migrated from: WebSocketService in websocketService.ts
    """
    
    def __init__(self):
        self.channel_layer = get_channel_layer()
    
    def _get_user_room(self, user_id: str) -> str:
        """Get the room name for a user"""
        return f'user_{user_id}'
    
    def _is_async_context(self) -> bool:
        """Check if we're in an async context"""
        try:
            asyncio.get_running_loop()
            return True
        except RuntimeError:
            return False
    
    async def _async_group_send(self, room: str, message: Dict) -> None:
        """Async version of group_send"""
        if self.channel_layer:
            await self.channel_layer.group_send(room, message)
    
    def emit_new_message(self, user_id: str, message: Dict, conversation: Optional[Dict] = None) -> None:
        """
        Emit a new message event to a user (sync version)
        
        Migrated from: emitNewMessage() in websocketService.ts
        """
        if not self.channel_layer:
            print('[websocket] Channel layer not configured')
            return
        
        # Check if we're in async context - if so, schedule the coroutine
        if self._is_async_context():
            asyncio.create_task(self.emit_new_message_async(user_id, message, conversation))
            return
        
        async_to_sync(self.channel_layer.group_send)(
            self._get_user_room(user_id),
            {
                'type': 'new_message',
                'data': {
                    'message': message,
                    'conversation': conversation,
                    'timestamp': message.get('createdAt')
                }
            }
        )
        
        print(f'[websocket] Emitted new message event to user {user_id}')
    
    async def emit_new_message_async(self, user_id: str, message: Dict, conversation: Optional[Dict] = None) -> None:
        """
        Emit a new message event to a user (async version)
        """
        if not self.channel_layer:
            print('[websocket] Channel layer not configured')
            return
        
        await self.channel_layer.group_send(
            self._get_user_room(user_id),
            {
                'type': 'new_message',
                'data': {
                    'message': message,
                    'conversation': conversation,
                    'timestamp': message.get('createdAt')
                }
            }
        )
        
        print(f'[websocket] Emitted new message event to user {user_id}')
    
    def emit_message_status_update(
        self,
        user_id: str,
        message_id: str,
        status: str,
        conversation_id: str
    ) -> None:
        """
        Emit a message status update event
        
        Migrated from: emitMessageStatusUpdate() in websocketService.ts
        """
        if not self.channel_layer:
            return
        
        async_to_sync(self.channel_layer.group_send)(
            self._get_user_room(user_id),
            {
                'type': 'message_status_update',
                'data': {
                    'messageId': message_id,
                    'conversationId': conversation_id,
                    'status': status,
                    'timestamp': None
                }
            }
        )
        
        print(f'[websocket] Emitted status update to user {user_id}: {message_id} -> {status}')
    
    def emit_unread_count_update(
        self,
        user_id: str,
        unread_counts: Dict[str, int],
        total_unread: int
    ) -> None:
        """
        Emit unread count update event
        
        Migrated from: emitUnreadCountUpdate() in websocketService.ts
        """
        if not self.channel_layer:
            return
        
        async_to_sync(self.channel_layer.group_send)(
            self._get_user_room(user_id),
            {
                'type': 'unread_count_update',
                'data': {
                    'unreadCounts': unread_counts,
                    'totalUnread': total_unread,
                    'timestamp': None
                }
            }
        )
        
        print(f'[websocket] Emitted unread count to user {user_id}: {total_unread} total')
    
    def emit_conversation_update(self, user_id: str, conversation: Dict) -> None:
        """
        Emit conversation update event
        
        Migrated from: emitConversationUpdate() in websocketService.ts
        """
        if not self.channel_layer:
            return
        
        async_to_sync(self.channel_layer.group_send)(
            self._get_user_room(user_id),
            {
                'type': 'conversation_update',
                'data': {
                    'conversation': conversation,
                    'timestamp': None
                }
            }
        )
        
        print(f'[websocket] Emitted conversation update to user {user_id}')
    
    def emit_error(self, user_id: str, error: str, code: Optional[str] = None) -> None:
        """
        Emit error event
        
        Migrated from: emitError() in websocketService.ts
        """
        if not self.channel_layer:
            return
        
        async_to_sync(self.channel_layer.group_send)(
            self._get_user_room(user_id),
            {
                'type': 'error_message',
                'data': {
                    'error': error,
                    'code': code,
                    'timestamp': None
                }
            }
        )
        
        print(f'[websocket] Emitted error to user {user_id}: {error}')
    
    def get_stats(self) -> Dict:
        """
        Get WebSocket statistics
        
        Migrated from: getStats() in websocketService.ts
        """
        # In Channels, we don't track connections the same way
        # This is a simplified version
        return {
            'total_connections': 0,  # Would need Redis to track
            'authenticated_users': 0,  # Would need Redis to track
        }


# Create singleton instance
websocket_service = WebSocketService()
