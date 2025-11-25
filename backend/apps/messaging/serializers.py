"""
Message serializers for request/response validation.
"""

from rest_framework import serializers
from .models import Message


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
