"""
Base platform adapter with common functionality.

Migrated from backend/src/adapters/PlatformAdapter.ts and BasePlatformAdapter.ts
Updated to use the new RateLimiter service for platform-specific rate limiting.
"""

import time
from abc import ABC, abstractmethod
from typing import List, Optional, Dict, Any
from dataclasses import dataclass

from apps.messaging.models import Message
from apps.conversations.models import Conversation
from apps.core.services.rate_limiter import (
    RateLimiter,
    RateLimitConfig,
    PLATFORM_RATE_LIMITS,
    get_platform_rate_limiter,
)


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
    Updated to use RateLimiter service for platform-specific rate limiting.
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
        
        # Initialize rate limiter for this platform
        try:
            self.rate_limiter = get_platform_rate_limiter(platform)
            self.rate_limit_config = PLATFORM_RATE_LIMITS.get(platform)
        except ValueError:
            # Platform not in predefined list, use default config
            self.rate_limit_config = RateLimitConfig(
                requests_per_window=30,
                window_seconds=60,
                min_delay_ms=1000,
                max_delay_ms=3000,
                daily_limit=None
            )
            self.rate_limiter = RateLimiter(config=self.rate_limit_config)
    
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
        Updated to use RateLimiter service.
        
        Args:
            account_id: The connected account ID
            endpoint: The API endpoint being called
            
        Raises:
            RateLimitError if rate limit is exceeded
            
        Requirements: 12.1
        """
        if not self.rate_limiter.acquire(account_id, action_type=endpoint):
            # Calculate retry time
            wait_time = self.rate_limiter.wait_if_needed(account_id, action_type=endpoint)
            raise RateLimitError(
                f'Rate limit exceeded for {self.platform}',
                self.platform,
                int(wait_time)
            )
    
    def apply_human_delay(self, account_id: str) -> float:
        """
        Apply a random delay to simulate human-like behavior.
        
        Args:
            account_id: The connected account ID
            
        Returns:
            The delay that was applied (in seconds)
            
        Requirements: 12.2
        """
        if self.rate_limit_config:
            delay = self.rate_limiter.get_random_delay(
                self.rate_limit_config.min_delay_ms,
                self.rate_limit_config.max_delay_ms
            )
            time.sleep(delay)
            return delay
        return 0.0
    
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
                # MySQL compatible - use INSERT IGNORE
                cursor.execute(
                    """
                    INSERT IGNORE INTO api_usage_logs (account_id, platform, endpoint, request_count, timestamp)
                    VALUES (%s, %s, %s, %s, NOW())
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
        Updated to use RateLimiter service for exponential backoff.
        
        Args:
            fn: The function to execute
            account_id: The connected account ID for rate limiting
            endpoint: The API endpoint being called
            
        Returns:
            The result of the function
            
        Raises:
            PlatformAPIError or RateLimitError
            
        Requirements: 12.4
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
                
                # Reset error count on success
                self.rate_limiter.reset_error_count(account_id)
                
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
                
                # Increment error count and calculate exponential backoff
                error_count = self.rate_limiter.increment_error_count(account_id)
                delay = self.rate_limiter.calculate_exponential_backoff(attempt)
                
                print(f'Retry attempt {attempt + 1}/{self.MAX_RETRIES} for {self.platform} after {delay}s (error count: {error_count})')
                
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
