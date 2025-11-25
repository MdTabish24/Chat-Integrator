"""
Base platform adapter with common functionality.

Migrated from backend/src/adapters/PlatformAdapter.ts and BasePlatformAdapter.ts
"""

import time
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from apps.messages.models import Message
from apps.conversations.models import Conversation


class PlatformAPIError(Exception):
    """
    Error thrown when a platform API call fails
    
    Migrated from: PlatformAPIError in PlatformAdapter.ts
    """
    def __init__(
        self,
        message: str,
        platform: str,
        status_code: Optional[int] = None,
        retryable: bool = False,
        original_error: Any = None
    ):
        super().__init__(message)
        self.platform = platform
        self.status_code = status_code
        self.retryable = retryable
        self.original_error = original_error
        self.name = 'PlatformAPIError'


class RateLimitError(Exception):
    """
    Error thrown when rate limit is exceeded
    
    Migrated from: RateLimitError in PlatformAdapter.ts
    """
    def __init__(self, message: str, platform: str, retry_after: int):
        super().__init__(message)
        self.platform = platform
        self.retry_after = retry_after  # seconds until rate limit resets
        self.name = 'RateLimitError'


class BasePlatformAdapter(ABC):
    """
    Abstract base class for platform adapters with common functionality
    
    Migrated from: BasePlatformAdapter in BasePlatformAdapter.ts
    """
    
    # Retry configuration
    MAX_RETRIES = 3
    BASE_DELAY_MS = 1000  # 1 second
    
    def __init__(self, platform: str):
        """
        Initialize base adapter
        
        Args:
            platform: Platform name
        """
        self.platform = platform
    
    @abstractmethod
    def fetch_messages(self, account_id: str, since: Optional[Any] = None) -> List[Dict]:
        """
        Fetch messages from the platform API
        
        Args:
            account_id: The connected account ID
            since: Optional date to fetch messages since
            
        Returns:
            List of messages
        """
        pass
    
    @abstractmethod
    def send_message(self, account_id: str, conversation_id: str, content: str) -> Dict:
        """
        Send a message through the platform API
        
        Args:
            account_id: The connected account ID
            conversation_id: The conversation/chat ID
            content: The message content to send
            
        Returns:
            The sent message
        """
        pass
    
    @abstractmethod
    def mark_as_read(self, account_id: str, message_id: str) -> None:
        """
        Mark a message as read on the platform
        
        Args:
            account_id: The connected account ID
            message_id: The platform-specific message ID
        """
        pass
    
    @abstractmethod
    def get_conversations(self, account_id: str) -> List[Dict]:
        """
        Get all conversations for the account
        
        Args:
            account_id: The connected account ID
            
        Returns:
            List of conversations
        """
        pass
    
    def check_rate_limit(self, account_id: str, endpoint: str = 'api') -> None:
        """
        Check and enforce rate limits using the platform rate limit service
        
        Migrated from: checkRateLimit() in BasePlatformAdapter.ts
        
        Args:
            account_id: The connected account ID
            endpoint: The API endpoint being called
            
        Raises:
            RateLimitError if rate limit is exceeded
        """
        # This will be implemented when platformRateLimitService is migrated
        pass
    
    def log_platform_api_usage(self, account_id: str, endpoint: str) -> None:
        """
        Log platform API usage to database
        
        Migrated from: logPlatformApiUsage() in BasePlatformAdapter.ts
        
        Args:
            account_id: The connected account ID
            endpoint: The API endpoint that was called
        """
        try:
            # This will log to api_usage_logs table
            from django.db import connection
            with connection.cursor() as cursor:
                cursor.execute(
                    """
                    INSERT INTO api_usage_logs (account_id, platform, endpoint, request_count, timestamp)
                    VALUES (%s, %s, %s, %s, NOW())
                    ON CONFLICT DO NOTHING
                    """,
                    [account_id, self.platform, endpoint, 1]
                )
        except Exception as e:
            # Log error but don't fail the request
            print(f'Failed to log API usage for {self.platform}: {e}')
    
    def execute_with_retry(self, fn, account_id: str, endpoint: str = 'api'):
        """
        Execute an API call with retry logic and exponential backoff
        
        Migrated from: executeWithRetry() in BasePlatformAdapter.ts
        
        Args:
            fn: The function to execute
            account_id: The connected account ID for rate limiting
            endpoint: The API endpoint being called
            
        Returns:
            The result of the function
            
        Raises:
            PlatformAPIError or RateLimitError
        """
        last_error = None
        
        for attempt in range(self.MAX_RETRIES):
            try:
                # Check rate limit before making the request
                self.check_rate_limit(account_id, endpoint)
                
                # Execute the function
                result = fn()
                
                # Log successful API usage
                self.log_platform_api_usage(account_id, endpoint)
                
                return result
            
            except RateLimitError:
                # Don't retry if it's a rate limit error
                raise
            
            except Exception as error:
                last_error = error
                
                # Check if error is retryable
                is_retryable = self.is_retryable_error(error)
                
                if not is_retryable or attempt == self.MAX_RETRIES - 1:
                    # Not retryable or last attempt, throw the error
                    raise self.wrap_error(error)
                
                # Calculate delay with exponential backoff
                delay = (self.BASE_DELAY_MS / 1000) * (2 ** attempt)
                print(f'Retry attempt {attempt + 1}/{self.MAX_RETRIES} for {self.platform} after {delay}s')
                
                # Wait before retrying
                time.sleep(delay)
        
        # Should never reach here
        raise self.wrap_error(last_error)
    
    def is_retryable_error(self, error: Any) -> bool:
        """
        Determine if an error is retryable
        
        Migrated from: isRetryableError() in BasePlatformAdapter.ts
        
        Args:
            error: The error to check
            
        Returns:
            True if the error is retryable
        """
        # Network errors are retryable
        error_code = getattr(error, 'code', None)
        if error_code in ['ECONNRESET', 'ETIMEDOUT', 'ENOTFOUND']:
            return True
        
        # HTTP 5xx errors are retryable
        if hasattr(error, 'response') and error.response is not None:
            status_code = getattr(error.response, 'status_code', None)
            if status_code and 500 <= status_code < 600:
                return True
            
            # HTTP 429 (Too Many Requests) can be retried
            if status_code == 429:
                return True
            
            # HTTP 408 (Request Timeout) is retryable
            if status_code == 408:
                return True
        
        return False
    
    def wrap_error(self, error: Any) -> PlatformAPIError:
        """
        Wrap an error in a PlatformAPIError
        
        Migrated from: wrapError() in BasePlatformAdapter.ts
        
        Args:
            error: The error to wrap
            
        Returns:
            A PlatformAPIError
        """
        if isinstance(error, PlatformAPIError):
            return error
        
        status_code = None
        if hasattr(error, 'response') and error.response is not None:
            status_code = getattr(error.response, 'status_code', None)
        
        retryable = self.is_retryable_error(error)
        
        message = str(error)
        if hasattr(error, 'response') and error.response is not None:
            try:
                response_data = error.response.json()
                message = response_data.get('message', str(error))
            except:
                pass
        
        return PlatformAPIError(
            f'{self.platform} API error: {message}',
            self.platform,
            status_code,
            retryable,
            error
        )
    
    @abstractmethod
    def get_access_token(self, account_id: str) -> str:
        """
        Get access token for an account from the database
        
        Args:
            account_id: The connected account ID
            
        Returns:
            The decrypted access token
        """
        pass
    
    @abstractmethod
    def refresh_token_if_needed(self, account_id: str) -> None:
        """
        Handle token refresh if needed
        
        Args:
            account_id: The connected account ID
        """
        pass
