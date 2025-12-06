"""
Webhook views for handling platform webhooks.

Migrated from backend/src/controllers/webhookController.ts
"""

import hmac
import hashlib
import json
from django.http import HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt
from django.utils.decorators import method_decorator
from django.views import View
from django.conf import settings

from apps.oauth.models import ConnectedAccount


@method_decorator(csrf_exempt, name='dispatch')
class TelegramWebhookView(View):
    """
    Handle Telegram webhook
    
    Migrated from: handleTelegramWebhook() in webhookController.ts
    """
    
    def post(self, request):
        try:
            payload = json.loads(request.body)
            signature = request.headers.get('X-Telegram-Bot-Api-Secret-Token', '')
            secret = getattr(settings, 'TELEGRAM_WEBHOOK_SECRET', '')
            
            # Verify signature
            if signature != secret:
                return JsonResponse({'error': 'Invalid signature'}, status=401)
            
            # Validate payload
            if 'message' not in payload:
                return JsonResponse({'error': 'Invalid payload structure'}, status=400)
            
            # Parse Telegram message
            telegram_message = payload['message']
            chat_id = str(telegram_message['chat']['id'])
            
            # Find connected account
            try:
                account = ConnectedAccount.objects.get(
                    platform='telegram',
                    platform_user_id=chat_id,
                    is_active=True
                )
            except ConnectedAccount.DoesNotExist:
                print(f'[telegram] No connected account found for chat {chat_id}')
                return JsonResponse({'ok': True}, status=200)
            
            # Process message (will be implemented in webhook service)
            # For now, just acknowledge
            
            return JsonResponse({'ok': True}, status=200)
        
        except Exception as e:
            print(f'[telegram-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class TwitterWebhookView(View):
    """
    Handle Twitter/X webhook
    
    Migrated from: handleTwitterWebhook() in webhookController.ts
    """
    
    def get(self, request):
        """Handle CRC challenge"""
        crc_token = request.GET.get('crc_token')
        if crc_token:
            secret = settings.TWITTER_CLIENT_SECRET.encode()
            response_token = hmac.new(
                secret,
                crc_token.encode(),
                hashlib.sha256
            ).digest()
            import base64
            return JsonResponse({
                'response_token': f'sha256={base64.b64encode(response_token).decode()}'
            })
        return JsonResponse({'error': 'Missing crc_token'}, status=400)
    
    def post(self, request):
        try:
            payload = request.body
            signature = request.headers.get('X-Twitter-Webhooks-Signature', '')
            secret = settings.TWITTER_CLIENT_SECRET.encode()
            
            # Verify signature
            expected_signature = 'sha256=' + hmac.new(
                secret,
                payload,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                return JsonResponse({'error': 'Invalid signature'}, status=401)
            
            body = json.loads(payload)
            
            # Process DM events
            if 'direct_message_events' in body:
                # Will be implemented in webhook service
                pass
            
            return JsonResponse({'ok': True}, status=200)
        
        except Exception as e:
            print(f'[twitter-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class FacebookWebhookView(View):
    """
    Handle Facebook Pages webhook
    
    Migrated from: handleFacebookWebhook() in webhookController.ts
    """
    
    def get(self, request):
        """Handle verification challenge"""
        mode = request.GET.get('hub.mode')
        token = request.GET.get('hub.verify_token')
        challenge = request.GET.get('hub.challenge')
        
        verify_token = getattr(settings, 'FACEBOOK_VERIFY_TOKEN', '')
        
        if mode == 'subscribe' and token == verify_token:
            return HttpResponse(challenge, status=200)
        
        return JsonResponse({'error': 'Invalid verify token'}, status=403)
    
    def post(self, request):
        try:
            payload = request.body
            signature = request.headers.get('X-Hub-Signature-256', '')
            app_secret = settings.FACEBOOK_APP_SECRET.encode()
            
            # Verify signature
            expected_signature = 'sha256=' + hmac.new(
                app_secret,
                payload,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                return JsonResponse({'error': 'Invalid signature'}, status=401)
            
            body = json.loads(payload)
            
            # Process Facebook page messages
            if body.get('object') == 'page' and 'entry' in body:
                # Will be implemented in webhook service
                pass
            
            return JsonResponse({'ok': True}, status=200)
        
        except Exception as e:
            print(f'[facebook-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class InstagramWebhookView(View):
    """
    Handle Instagram webhook
    
    Migrated from: handleInstagramWebhook() in webhookController.ts
    """
    
    def get(self, request):
        """Handle verification challenge"""
        mode = request.GET.get('hub.mode')
        token = request.GET.get('hub.verify_token')
        challenge = request.GET.get('hub.challenge')
        
        verify_token = 'instagram_verify_token_123'  # Hardcoded for now
        
        if mode == 'subscribe' and token == verify_token:
            print('[instagram-webhook] Verification successful')
            return HttpResponse(challenge, status=200)
        
        print('[instagram-webhook] Verification failed')
        return JsonResponse({'error': 'Invalid verify token'}, status=403)
    
    def post(self, request):
        try:
            payload = request.body
            signature = request.headers.get('X-Hub-Signature-256', '')
            app_secret = settings.FACEBOOK_APP_SECRET.encode()
            
            # Verify signature
            expected_signature = 'sha256=' + hmac.new(
                app_secret,
                payload,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                return JsonResponse({'error': 'Invalid signature'}, status=401)
            
            body = json.loads(payload)
            
            # Process Instagram messages
            if body.get('object') == 'instagram' and 'entry' in body:
                # Will be implemented in webhook service
                pass
            
            return JsonResponse({'ok': True}, status=200)
        
        except Exception as e:
            print(f'[instagram-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class WhatsAppWebhookView(View):
    """
    Handle WhatsApp webhook
    
    Migrated from: handleWhatsAppWebhook() in webhookController.ts
    """
    
    def get(self, request):
        """Handle verification challenge"""
        mode = request.GET.get('hub.mode')
        token = request.GET.get('hub.verify_token')
        challenge = request.GET.get('hub.challenge')
        
        verify_token = getattr(settings, 'WHATSAPP_VERIFY_TOKEN', '')
        
        if mode == 'subscribe' and token == verify_token:
            return HttpResponse(challenge, status=200)
        
        return JsonResponse({'error': 'Invalid verify token'}, status=403)
    
    def post(self, request):
        try:
            payload = request.body
            signature = request.headers.get('X-Hub-Signature-256', '')
            app_secret = settings.FACEBOOK_APP_SECRET.encode()
            
            # Verify signature
            expected_signature = 'sha256=' + hmac.new(
                app_secret,
                payload,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                return JsonResponse({'error': 'Invalid signature'}, status=401)
            
            body = json.loads(payload)
            
            # Process WhatsApp messages
            if body.get('object') == 'whatsapp_business_account' and 'entry' in body:
                # Will be implemented in webhook service
                pass
            
            return JsonResponse({'ok': True}, status=200)
        
        except Exception as e:
            print(f'[whatsapp-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class LinkedInWebhookView(View):
    """
    Handle LinkedIn webhook
    
    Migrated from: handleLinkedInWebhook() in webhookController.ts
    """
    
    def post(self, request):
        try:
            payload = request.body
            signature = request.headers.get('X-Li-Signature', '')
            secret = settings.LINKEDIN_CLIENT_SECRET.encode()
            
            # Verify signature
            expected_signature = hmac.new(
                secret,
                payload,
                hashlib.sha256
            ).hexdigest()
            
            if not hmac.compare_digest(signature, expected_signature):
                return JsonResponse({'error': 'Invalid signature'}, status=401)
            
            body = json.loads(payload)
            
            # Process LinkedIn message events
            if body.get('eventType') == 'MESSAGE_EVENT':
                # Will be implemented in webhook service
                pass
            
            return JsonResponse({'ok': True}, status=200)
        
        except Exception as e:
            print(f'[linkedin-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)


@method_decorator(csrf_exempt, name='dispatch')
class TeamsWebhookView(View):
    """
    Handle Microsoft Teams webhook
    
    Migrated from: handleTeamsWebhook() in webhookController.ts
    """
    
    def post(self, request):
        try:
            auth_header = request.headers.get('Authorization', '')
            
            if not auth_header.startswith('Bearer '):
                return JsonResponse({'error': 'Missing or invalid authorization header'}, status=401)
            
            # Token verification will be implemented in webhook service
            body = json.loads(request.body)
            
            # Handle validation request
            if 'validationToken' in body:
                return HttpResponse(body['validationToken'], status=200)
            
            # Process Teams notifications
            if 'value' in body and isinstance(body['value'], list):
                # Will be implemented in webhook service
                pass
            
            return JsonResponse({'ok': True}, status=202)
        
        except Exception as e:
            print(f'[teams-webhook] Error: {e}')
            return JsonResponse({'error': 'Internal server error'}, status=500)
