"""
Message serializers for request/response validation.
"""

from rest_framework import serializers
from .models import Message
from apps.core.utils.crypto import decrypt_data


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
        
        # Decrypt content if it's encrypted
        if data.get('content'):
            try:
                data['content'] = decrypt_data(data['content'])
            except Exception:
                # If decryption fails, content might not be encrypted
                pass
        
        # Decrypt media_url if it's encrypted
        if data.get('media_url'):
            try:
                data['media_url'] = decrypt_data(data['media_url'])
            except Exception:
                pass
        
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
