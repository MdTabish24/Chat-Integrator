"""
Gmail adapter using Google Gmail API.

Requirements:
- 10.1: Authenticate via Google OAuth with gmail.readonly and gmail.send scopes
- 10.2: Retrieve only unread emails from Primary category (exclude Spam, Promotions, Social)
- 10.3: Show sender, subject, and preview
- 10.4: Send reply via Gmail API (no compose new email option)
- 10.5: Refresh token automatically when expired
"""

from typing import List, Dict, Optional
from datetime import datetime, timedelta
import base64
import email
from email.mime.text import MIMEText
from email.mime.multipart import MIMEMultipart
import requests
from django.conf import settings
from django.utils import timezone

from .base import BasePlatformAdapter
from apps.oauth.models import ConnectedAccount
from apps.core.utils.crypto import decrypt, encrypt


class GmailAdapter(BasePlatformAdapter):
    """
    Gmail adapter for reading and replying to emails.
    
    Note: This adapter only supports:
    - Reading unread emails from Primary category
    - Replying to existing email threads
    - NO new email composition (by design per Requirements 10.4)
    
    Requirements: 10.1, 10.2, 10.3, 10.4, 10.5
    """
    
    BASE_URL = 'https://gmail.googleapis.com/gmail/v1'
    
    # Gmail category labels
    CATEGORY_PRIMARY = 'CATEGORY_PERSONAL'  # Primary inbox
    CATEGORY_SOCIAL = 'CATEGORY_SOCIAL'
    CATEGORY_PROMOTIONS = 'CATEGORY_PROMOTIONS'
    CATEGORY_UPDATES = 'CATEGORY_UPDATES'
    CATEGORY_FORUMS = 'CATEGORY_FORUMS'
    
    # Labels to exclude
    EXCLUDED_LABELS = ['SPAM', 'TRASH', 'CATEGORY_SOCIAL', 'CATEGORY_PROMOTIONS', 'CATEGORY_FORUMS']
    
    def __init__(self):
        super().__init__('gmail')
        self.timeout = 30
    
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for the account.
        
        Args:
            account_id: Connected account ID
            
        Returns:
            Decrypted access token
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id, is_active=True)
            
            # Check if token needs refresh
            self.refresh_token_if_needed(account_id)
            
            # Fetch again after potential refresh
            account.refresh_from_db()
            return decrypt(account.access_token)
        
        except ConnectedAccount.DoesNotExist:
            raise Exception(f'Account {account_id} not found or inactive')
    
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Refresh token if expired (Google tokens expire in 1 hour).
        
        Requirements: 10.5 - Refresh token automatically when expired
        """
        try:
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Check if token expires within the next 5 minutes
            if not account.token_expires_at:
                return
            
            now = timezone.now()
            five_minutes_from_now = now + timedelta(minutes=5)
            
            if account.token_expires_at > five_minutes_from_now:
                return  # Token is still valid
            
            # Refresh the token
            if not account.refresh_token:
                raise Exception(f'No refresh token available for account {account_id}. User needs to re-authenticate.')
            
            client_id = getattr(settings, 'GOOGLE_CLIENT_ID', '')
            client_secret = getattr(settings, 'GOOGLE_CLIENT_SECRET', '')
            
            if not client_id or not client_secret:
                raise Exception('Google OAuth credentials not configured')
            
            refresh_token = decrypt(account.refresh_token)
            
            response = requests.post(
                'https://oauth2.googleapis.com/token',
                data={
                    'grant_type': 'refresh_token',
                    'refresh_token': refresh_token,
                    'client_id': client_id,
                    'client_secret': client_secret,
                },
                headers={'Content-Type': 'application/x-www-form-urlencoded'},
                timeout=30
            )
            response.raise_for_status()
            data = response.json()
            
            # Update account with new tokens
            account.access_token = encrypt(data['access_token'])
            # Google doesn't return refresh_token on refresh, keep the old one
            account.token_expires_at = now + timedelta(seconds=data.get('expires_in', 3600))
            account.save()
            
            print(f'[gmail] Token refreshed for account {account_id}')
        
        except requests.RequestException as e:
            error_msg = str(e)
            if hasattr(e, 'response') and e.response is not None:
                try:
                    error_data = e.response.json()
                    error_msg = error_data.get('error_description', str(e))
                    error_code = error_data.get('error')
                    if error_code == 'invalid_grant':
                        error_msg = 'Refresh token expired or revoked. User needs to re-authenticate.'
                except:
                    pass
            print(f'[gmail] Failed to refresh token: {error_msg}')
            raise Exception(f'Failed to refresh Gmail access token: {error_msg}')
        except Exception as e:
            print(f'[gmail] Failed to refresh token: {e}')
            raise Exception(f'Failed to refresh Gmail access token: {e}')
    
    def fetch_messages(self, account_id: str, since: Optional[datetime] = None) -> List[Dict]:
        """
        Fetch unread emails from Primary category only.
        
        Requirements:
        - 10.2: Retrieve only unread emails from Primary category
        - 10.3: Show sender, subject, and preview
        
        Args:
            account_id: Connected account ID
            since: Optional datetime to fetch messages since
            
        Returns:
            List of email dictionaries
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Build query for unread Primary emails only
            # Requirements 10.2: exclude Spam, Promotions, Social
            query_parts = [
                'is:unread',
                'category:primary',  # Only Primary category
                '-in:spam',
                '-in:trash',
                '-category:social',
                '-category:promotions',
                '-category:forums',
            ]
            
            if since:
                # Format date for Gmail query
                since_str = since.strftime('%Y/%m/%d')
                query_parts.append(f'after:{since_str}')
            
            query = ' '.join(query_parts)
            
            # List messages matching query
            list_url = f'{self.BASE_URL}/users/me/messages'
            
            try:
                print(f'[gmail] Fetching emails with query: {query}')
                print(f'[gmail] Using token (first 20 chars): {token[:20]}...')
                
                list_response = requests.get(
                    list_url,
                    headers={'Authorization': f'Bearer {token}'},
                    params={
                        'q': query,
                        'maxResults': 50,
                    },
                    timeout=self.timeout
                )
                list_response.raise_for_status()
            except requests.HTTPError as e:
                error_detail = ""
                if e.response is not None:
                    try:
                        error_data = e.response.json()
                        error_detail = str(error_data)
                    except:
                        error_detail = e.response.text
                
                print(f'[gmail] API error {e.response.status_code if e.response else "N/A"}: {error_detail}')
                
                if e.response and e.response.status_code == 401:
                    print('[gmail] Access token expired or invalid. Token refresh may be needed.')
                elif e.response and e.response.status_code == 403:
                    print('[gmail] 403 Forbidden - Check if Gmail API is enabled and scopes are granted.')
                    print('[gmail] User may need to disconnect and reconnect Gmail, granting all permissions.')
                raise Exception(f'gmail API error: {e}')
            
            messages_list = list_response.json().get('messages', [])
            emails = []
            
            # Fetch full details for each message
            for msg_ref in messages_list:
                try:
                    email_data = self._fetch_email_details(token, msg_ref['id'], account.platform_user_id)
                    if email_data:
                        emails.append(email_data)
                except Exception as e:
                    print(f'[gmail] Failed to fetch email {msg_ref["id"]}: {e}')
                    # Continue with other emails
            
            return emails
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _fetch_email_details(self, token: str, message_id: str, user_email: str) -> Optional[Dict]:
        """
        Fetch full details for a single email.
        
        Requirements 10.3: Show sender, subject, and preview
        
        Args:
            token: Access token
            message_id: Gmail message ID
            user_email: Current user's email
            
        Returns:
            Email dictionary or None
        """
        url = f'{self.BASE_URL}/users/me/messages/{message_id}'
        
        response = requests.get(
            url,
            headers={'Authorization': f'Bearer {token}'},
            params={'format': 'full'},
            timeout=self.timeout
        )
        response.raise_for_status()
        
        msg = response.json()
        
        # Check if this email is in Primary category
        # Requirements 10.2: Filter out Spam, Promotions, Social
        labels = msg.get('labelIds', [])
        
        # Skip if in excluded categories
        for excluded in self.EXCLUDED_LABELS:
            if excluded in labels:
                return None
        
        # Extract headers
        headers = {h['name'].lower(): h['value'] for h in msg.get('payload', {}).get('headers', [])}
        
        sender = headers.get('from', 'Unknown Sender')
        subject = headers.get('subject', '(No Subject)')
        date_str = headers.get('date', '')
        thread_id = msg.get('threadId', message_id)
        
        # Extract preview/snippet
        snippet = msg.get('snippet', '')
        
        # Extract full body for display
        body = self._extract_body(msg.get('payload', {}))
        
        # Determine if this is an outgoing email
        is_outgoing = user_email.lower() in sender.lower()
        
        return {
            'id': '',
            'conversationId': thread_id,  # Use thread ID as conversation ID
            'platformMessageId': message_id,
            'senderId': self._extract_email_address(sender),
            'senderName': self._extract_sender_name(sender),
            'content': body or snippet,
            'preview': snippet[:200] if snippet else '',
            'subject': subject,
            'messageType': 'email',
            'isOutgoing': is_outgoing,
            'isRead': 'UNREAD' not in labels,
            'sentAt': date_str,
            'createdAt': datetime.now().isoformat(),
            'category': 'primary',  # All returned emails are Primary
        }
    
    def _extract_body(self, payload: Dict) -> str:
        """
        Extract email body from payload.
        
        Args:
            payload: Gmail message payload
            
        Returns:
            Email body text
        """
        body = ''
        
        # Check for simple body
        if 'body' in payload and payload['body'].get('data'):
            body = base64.urlsafe_b64decode(payload['body']['data']).decode('utf-8', errors='ignore')
        
        # Check for multipart
        elif 'parts' in payload:
            for part in payload['parts']:
                mime_type = part.get('mimeType', '')
                
                # Prefer plain text
                if mime_type == 'text/plain' and part.get('body', {}).get('data'):
                    body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                    break
                
                # Fall back to HTML
                elif mime_type == 'text/html' and part.get('body', {}).get('data') and not body:
                    html_body = base64.urlsafe_b64decode(part['body']['data']).decode('utf-8', errors='ignore')
                    body = self._strip_html(html_body)
                
                # Recurse into nested parts
                elif 'parts' in part:
                    nested_body = self._extract_body(part)
                    if nested_body:
                        body = nested_body
                        break
        
        return body.strip()
    
    def _strip_html(self, html: str) -> str:
        """
        Strip HTML tags from content.
        
        Args:
            html: HTML content
            
        Returns:
            Plain text
        """
        import re
        # Remove HTML tags
        text = re.sub(r'<[^>]*>', '', html)
        # Decode HTML entities
        text = text.replace('&nbsp;', ' ')
        text = text.replace('&amp;', '&')
        text = text.replace('&lt;', '<')
        text = text.replace('&gt;', '>')
        text = text.replace('&quot;', '"')
        text = text.replace('&#39;', "'")
        # Clean up whitespace
        text = re.sub(r'\s+', ' ', text)
        return text.strip()
    
    def _extract_email_address(self, from_header: str) -> str:
        """
        Extract email address from From header.
        
        Args:
            from_header: From header value (e.g., "John Doe <john@example.com>")
            
        Returns:
            Email address
        """
        import re
        match = re.search(r'<([^>]+)>', from_header)
        if match:
            return match.group(1)
        # If no angle brackets, assume the whole thing is an email
        return from_header.strip()
    
    def _extract_sender_name(self, from_header: str) -> str:
        """
        Extract sender name from From header.
        
        Args:
            from_header: From header value (e.g., "John Doe <john@example.com>")
            
        Returns:
            Sender name
        """
        import re
        match = re.match(r'^([^<]+)<', from_header)
        if match:
            return match.group(1).strip().strip('"')
        # If no name, use the email address
        return self._extract_email_address(from_header)
    
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a reply to an existing email thread.
        
        Requirements 10.4: Send reply via Gmail API (no compose new email option)
        
        Note: This method ONLY supports replying to existing threads.
        New email composition is intentionally disabled.
        
        Args:
            account_id: Connected account ID
            conversation_id: Thread ID to reply to
            content: Reply content
            
        Returns:
            Sent message dictionary
        """
        def _send():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Validate content
            if not content or not content.strip():
                raise Exception('Reply content cannot be empty')
            
            # Get the original thread to extract reply-to information
            thread_url = f'{self.BASE_URL}/users/me/threads/{conversation_id}'
            
            try:
                thread_response = requests.get(
                    thread_url,
                    headers={'Authorization': f'Bearer {token}'},
                    params={'format': 'metadata', 'metadataHeaders': ['From', 'To', 'Subject', 'Message-ID', 'References']},
                    timeout=self.timeout
                )
                thread_response.raise_for_status()
            except requests.HTTPError as e:
                if e.response and e.response.status_code == 404:
                    raise Exception('Email thread not found. Cannot compose new emails - only replies are supported.')
                raise
            
            thread = thread_response.json()
            messages = thread.get('messages', [])
            
            if not messages:
                raise Exception('Email thread is empty. Cannot compose new emails - only replies are supported.')
            
            # Get the last message in the thread to reply to
            last_message = messages[-1]
            headers = {h['name'].lower(): h['value'] for h in last_message.get('payload', {}).get('headers', [])}
            
            original_from = headers.get('from', '')
            original_subject = headers.get('subject', '')
            message_id = headers.get('message-id', '')
            references = headers.get('references', '')
            
            # Build reply headers
            reply_to = self._extract_email_address(original_from)
            reply_subject = original_subject if original_subject.lower().startswith('re:') else f'Re: {original_subject}'
            
            # Build References header for threading
            new_references = f'{references} {message_id}'.strip() if references else message_id
            
            # Create the reply message
            message = MIMEText(content)
            message['to'] = reply_to
            message['subject'] = reply_subject
            message['In-Reply-To'] = message_id
            message['References'] = new_references
            
            # Encode the message
            raw_message = base64.urlsafe_b64encode(message.as_bytes()).decode('utf-8')
            
            # Send the reply
            send_url = f'{self.BASE_URL}/users/me/messages/send'
            
            try:
                send_response = requests.post(
                    send_url,
                    headers={
                        'Authorization': f'Bearer {token}',
                        'Content-Type': 'application/json',
                    },
                    json={
                        'raw': raw_message,
                        'threadId': conversation_id,  # Keep in same thread
                    },
                    timeout=self.timeout
                )
                send_response.raise_for_status()
            except requests.HTTPError as e:
                error_msg = str(e)
                if e.response is not None:
                    try:
                        error_data = e.response.json()
                        error_msg = error_data.get('error', {}).get('message', str(e))
                    except:
                        pass
                    
                    if e.response.status_code == 403:
                        raise Exception('Permission denied. Ensure the app has gmail.send permission.')
                
                raise Exception(f'Failed to send reply: {error_msg}')
            
            sent_message = send_response.json()
            
            print(f'[gmail] Reply sent successfully to thread {conversation_id}, message ID: {sent_message.get("id")}')
            
            return {
                'id': '',
                'conversationId': conversation_id,
                'platformMessageId': sent_message.get('id', ''),
                'senderId': account.platform_user_id,
                'senderName': account.platform_username or account.platform_user_id,
                'content': content,
                'subject': reply_subject,
                'messageType': 'email',
                'isOutgoing': True,
                'isRead': True,
                'sentAt': datetime.now().isoformat(),
                'createdAt': datetime.now().isoformat(),
            }
        
        return self.execute_with_retry(_send, account_id)
    
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark an email as read.
        
        Args:
            account_id: Connected account ID
            message_id: Gmail message ID
        """
        def _mark():
            token = self.get_access_token(account_id)
            
            url = f'{self.BASE_URL}/users/me/messages/{message_id}/modify'
            
            response = requests.post(
                url,
                headers={
                    'Authorization': f'Bearer {token}',
                    'Content-Type': 'application/json',
                },
                json={
                    'removeLabelIds': ['UNREAD'],
                },
                timeout=self.timeout
            )
            response.raise_for_status()
            
            print(f'[gmail] Message {message_id} marked as read')
        
        self.execute_with_retry(_mark, account_id)
    
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get email threads (conversations) from Primary category.
        
        Requirements 10.2: Only Primary category emails
        
        Args:
            account_id: Connected account ID
            
        Returns:
            List of thread/conversation dictionaries
        """
        def _fetch():
            token = self.get_access_token(account_id)
            account = ConnectedAccount.objects.get(id=account_id)
            
            # Build query for Primary emails only
            query = 'category:primary -in:spam -in:trash -category:social -category:promotions -category:forums'
            
            # List threads
            url = f'{self.BASE_URL}/users/me/threads'
            
            try:
                response = requests.get(
                    url,
                    headers={'Authorization': f'Bearer {token}'},
                    params={
                        'q': query,
                        'maxResults': 50,
                    },
                    timeout=self.timeout
                )
                response.raise_for_status()
            except requests.HTTPError as e:
                if e.response and e.response.status_code == 401:
                    print('[gmail] Access token expired or invalid.')
                    raise
                raise
            
            threads_list = response.json().get('threads', [])
            conversations = []
            
            # Fetch details for each thread
            for thread_ref in threads_list:
                try:
                    thread_data = self._fetch_thread_details(token, thread_ref['id'], account)
                    if thread_data:
                        conversations.append(thread_data)
                except Exception as e:
                    print(f'[gmail] Failed to fetch thread {thread_ref["id"]}: {e}')
                    # Continue with other threads
            
            return conversations
        
        return self.execute_with_retry(_fetch, account_id)
    
    def _fetch_thread_details(self, token: str, thread_id: str, account: ConnectedAccount) -> Optional[Dict]:
        """
        Fetch details for a single thread.
        
        Args:
            token: Access token
            thread_id: Gmail thread ID
            account: Connected account
            
        Returns:
            Thread/conversation dictionary or None
        """
        url = f'{self.BASE_URL}/users/me/threads/{thread_id}'
        
        response = requests.get(
            url,
            headers={'Authorization': f'Bearer {token}'},
            params={'format': 'metadata', 'metadataHeaders': ['From', 'Subject', 'Date']},
            timeout=self.timeout
        )
        response.raise_for_status()
        
        thread = response.json()
        messages = thread.get('messages', [])
        
        if not messages:
            return None
        
        # Get info from the first message (thread starter)
        first_message = messages[0]
        last_message = messages[-1]
        
        first_headers = {h['name'].lower(): h['value'] for h in first_message.get('payload', {}).get('headers', [])}
        last_headers = {h['name'].lower(): h['value'] for h in last_message.get('payload', {}).get('headers', [])}
        
        sender = first_headers.get('from', 'Unknown')
        subject = first_headers.get('subject', '(No Subject)')
        last_date = last_headers.get('date', '')
        
        # Count unread messages
        unread_count = sum(1 for msg in messages if 'UNREAD' in msg.get('labelIds', []))
        
        return {
            'id': '',
            'accountId': str(account.id),
            'platformConversationId': thread_id,
            'participantName': self._extract_sender_name(sender),
            'participantId': self._extract_email_address(sender),
            'participantAvatarUrl': None,
            'subject': subject,
            'lastMessageAt': last_date,
            'unreadCount': unread_count,
            'messageCount': len(messages),
            'createdAt': datetime.now().isoformat(),
            'updatedAt': datetime.now().isoformat(),
        }


# Create singleton instance
gmail_adapter = GmailAdapter()
