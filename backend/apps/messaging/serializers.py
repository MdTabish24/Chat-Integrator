"""
Message serializers for request/response validation.
"""

from rest_framework import serializers
from .models import Message
from apps.core.utils.crypto import decrypt, is_encrypted


class MessageSerializer(serializers.ModelSerializer):
    """Serializer for Message model"""
    
    class Meta:
        model = Message
        fields = [
            'id',
            'conversation_id',
            'platform_message_id',
            'sender_id',
            'sender_name',
            'content',
            'message_type',
            'media_url',
            'is_outgoing',
            'is_read',
            'sent_at',
            'delivered_at',
            'created_at',
        ]
        read_only_fields = ['id', 'created_at']
    
    def to_representation(self, instance):
        """Decrypt content before sending to frontend"""
        data = super().to_representation(instance)
        
        # Convert UUID fields to strings for JSON serialization
        if data.get('id'):
            data['id'] = str(data['id'])
        if data.get('conversation_id'):
            data['conversation_id'] = str(data['conversation_id'])
        
        # Decrypt content if it's encrypted (base64 encoded AES-256-GCM)
        if data.get('content') and is_encrypted(data['content']):
            try:
                data['content'] = decrypt(data['content'])
            except Exception as e:
                print(f'[serializer] Failed to decrypt content: {e}')
                # Keep original content if decryption fails
        
        # Decrypt media_url if it's encrypted
        if data.get('media_url') and is_encrypted(str(data['media_url'])):
            try:
                data['media_url'] = decrypt(data['media_url'])
            except Exception as e:
                print(f'[serializer] Failed to decrypt media_url: {e}')
        
        return data


class SendMessageSerializer(serializers.Serializer):
    """Serializer for sending a message"""
    content = serializers.CharField(required=True)
    message_type = serializers.ChoiceField(
        choices=['text', 'image', 'video', 'file'],
        default='text'
    )
    media_url = serializers.URLField(required=False, allow_null=True)


class MarkAsReadSerializer(serializers.Serializer):
    """Serializer for marking messages as read"""
    message_ids = serializers.ListField(
        child=serializers.UUIDField(),
        required=True
    )
