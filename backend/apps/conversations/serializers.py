"""
Conversation serializers for request/response validation.
"""

from rest_framework import serializers
from .models import Conversation


class ConversationSerializer(serializers.ModelSerializer):
    """Serializer for Conversation model"""
    platform = serializers.CharField(source='account.platform', read_only=True)
    
    class Meta:
        model = Conversation
        fields = [
            'id',
            'account_id',
            'platform',
            'platform_conversation_id',
            'participant_name',
            'participant_id',
            'participant_avatar_url',
            'last_message_at',
            'unread_count',
            'created_at',
            'updated_at',
        ]
        read_only_fields = ['id', 'created_at', 'updated_at']


class ConversationListSerializer(serializers.ModelSerializer):
    """Lightweight serializer for conversation list"""
    platform = serializers.CharField(source='account.platform', read_only=True)
    has_unread = serializers.BooleanField(source='has_unread_messages', read_only=True)
    
    class Meta:
        model = Conversation
        fields = [
            'id',
            'platform',
            'participant_name',
            'participant_avatar_url',
            'last_message_at',
            'unread_count',
            'has_unread',
        ]
