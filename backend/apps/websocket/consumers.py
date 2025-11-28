"""
WebSocket consumers for real-time updates.

Migrated from backend/src/services/websocketService.ts
"""

import json
from channels.generic.websocket import AsyncWebsocketConsumer
from channels.db import database_sync_to_async


class MessagingConsumer(AsyncWebsocketConsumer):
    """
    WebSocket consumer for real-time messaging updates
    
    Migrated from: WebSocketService in websocketService.ts
    """
    
    async def connect(self):
        """
        Handle new WebSocket connection
        
        Migrated from: setupConnectionHandler() in websocketService.ts
        """
        # Get user from scope (set by JWT middleware)
        self.user_id = None
        self.email = None
        
        if 'user' in self.scope and self.scope['user']:
            self.user_id = self.scope['user'].get('user_id')
            self.email = self.scope['user'].get('email')
        
        if not self.user_id:
            # Reject connection if not authenticated
            await self.close(code=4001)
            return
        
        # Join user-specific room (gracefully handle Redis failures)
        self.user_room = f'user_{self.user_id}'
        try:
            if self.channel_layer:
                await self.channel_layer.group_add(
                    self.user_room,
                    self.channel_name
                )
        except Exception as e:
            print(f'[websocket] Redis error (non-fatal): {e}')
        
        await self.accept()
        
        # Send authentication success
        await self.send(text_data=json.dumps({
            'event': 'authenticated',
            'data': {
                'userId': self.user_id,
                'email': self.email
            }
        }))
        
        print(f'[websocket] User {self.user_id} connected: {self.channel_name}')
    
    async def disconnect(self, close_code):
        """
        Handle WebSocket disconnection
        
        Migrated from: handleDisconnect() in websocketService.ts
        """
        if hasattr(self, 'user_room'):
            await self.channel_layer.group_discard(
                self.user_room,
                self.channel_name
            )
        
        print(f'[websocket] User {self.user_id} disconnected: {self.channel_name}')
    
    async def receive(self, text_data):
        """
        Handle incoming WebSocket messages
        """
        try:
            data = json.loads(text_data)
            event_type = data.get('event')
            
            if event_type == 'ping':
                await self.send(text_data=json.dumps({
                    'event': 'pong',
                    'timestamp': data.get('timestamp')
                }))
        
        except Exception as e:
            print(f'[websocket] Error handling message: {e}')
            await self.send(text_data=json.dumps({
                'event': 'error',
                'data': {'message': str(e)}
            }))
    
    # Event handlers for different message types
    
    async def new_message(self, event):
        """
        Send new message event to WebSocket
        
        Migrated from: emitNewMessage() in websocketService.ts
        """
        await self.send(text_data=json.dumps({
            'event': 'new_message',
            'data': event['data']
        }))
    
    async def message_status_update(self, event):
        """
        Send message status update event
        
        Migrated from: emitMessageStatusUpdate() in websocketService.ts
        """
        await self.send(text_data=json.dumps({
            'event': 'message_status_update',
            'data': event['data']
        }))
    
    async def unread_count_update(self, event):
        """
        Send unread count update event
        
        Migrated from: emitUnreadCountUpdate() in websocketService.ts
        """
        await self.send(text_data=json.dumps({
            'event': 'unread_count_update',
            'data': event['data']
        }))
    
    async def conversation_update(self, event):
        """
        Send conversation update event
        
        Migrated from: emitConversationUpdate() in websocketService.ts
        """
        await self.send(text_data=json.dumps({
            'event': 'conversation_update',
            'data': event['data']
        }))
    
    async def error_message(self, event):
        """
        Send error event
        
        Migrated from: emitError() in websocketService.ts
        """
        await self.send(text_data=json.dumps({
            'event': 'error',
            'data': event['data']
        }))
