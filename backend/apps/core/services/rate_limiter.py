"""
Rate limiter service for platform-specific rate limiting.

Implements per-platform rate limit configurations with request counting,
window management, random delays for human-like behavior, and exponential backoff.

Requirements: 12.1, 12.2, 12.4
"""

import time
import random
import asyncio
from dataclasses import dataclass, field
from typing import Optional, Dict, Any
from datetime import datetime, timedelta
from django.core.cache import cache


class RateLimitExceededError(Exception):
    """Raised when rate limit is exceeded."""
    
    def __init__(self, message: str, platform: str, retry_after: int):
        super().__init__(message)
        self.platform = platform
        self.retry_after = retry_after  # seconds until rate limit resets


@dataclass
class RateLimitConfig:
    """
    Configuration for platform-specific rate limiting.
    
    Attributes:
        requests_per_window: Maximum requests allowed in the time window
        window_seconds: Duration of the rate limit window in seconds
        min_delay_ms: Minimum delay between requests in milliseconds
        max_delay_ms: Maximum delay between requests in milliseconds (for randomization)
        daily_limit: Optional daily message limit (None for unlimited)
    """
    requests_per_window: int
    window_seconds: int
    min_delay_ms: int
    max_delay_ms: int
    daily_limit: Optional[int] = None
    
    def __post_init__(self):
        """Validate configuration values."""
        if self.requests_per_window < 1:
            raise ValueError("requests_per_window must be at least 1")
        if self.window_seconds < 1:
            raise ValueError("window_seconds must be at least 1")
        if self.min_delay_ms < 0:
            raise ValueError("min_delay_ms cannot be negative")
        if self.max_delay_ms < self.min_delay_ms:
            raise ValueError("max_delay_ms must be >= min_delay_ms")
        if self.daily_limit is not None and self.daily_limit < 1:
            raise ValueError("daily_limit must be at least 1 if set")


# Pre-configured rate limits for each platform (from design.md)
PLATFORM_RATE_LIMITS: Dict[str, RateLimitConfig] = {
    'telegram': RateLimitConfig(
        requests_per_window=30,
        window_seconds=60,
        min_delay_ms=1000,
        max_delay_ms=3000,
        daily_limit=None  # Telegram has no strict daily limit
    ),
    'twitter': RateLimitConfig(
        requests_per_window=3,
        window_seconds=60,
        min_delay_ms=45000,  # 45 seconds
        max_delay_ms=90000,  # 90 seconds
        daily_limit=15
    ),
    'linkedin': RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,  # 30 seconds
        max_delay_ms=60000,  # 60 seconds
        daily_limit=10
    ),
    'instagram': RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,
        max_delay_ms=60000,
        daily_limit=20
    ),
    'facebook': RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,
        max_delay_ms=60000,
        daily_limit=30
    ),
    'whatsapp': RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,
        max_delay_ms=60000,
        daily_limit=None  # WhatsApp uses browser automation
    ),
    'discord': RateLimitConfig(
        requests_per_window=5,
        window_seconds=5,
        min_delay_ms=1000,
        max_delay_ms=2000,
        daily_limit=None  # Discord has built-in rate limiting
    ),
    'teams': RateLimitConfig(
        requests_per_window=60,
        window_seconds=60,
        min_delay_ms=500,
        max_delay_ms=1500,
        daily_limit=None  # Teams uses OAuth with Graph API limits
    ),
    'gmail': RateLimitConfig(
        requests_per_window=100,
        window_seconds=60,
        min_delay_ms=100,
        max_delay_ms=500,
        daily_limit=None  # Gmail uses OAuth with Google API limits
    ),
}


@dataclass
class RateLimitState:
    """
    Tracks the current state of rate limiting for an account/action.
    
    Attributes:
        request_count: Number of requests in current window
        window_start: When the current window started
        last_request_at: Timestamp of last request
        is_paused: Whether requests are paused due to rate limit
        pause_until: When the pause ends (if paused)
        daily_count: Number of messages sent today
        daily_reset_at: When the daily count resets
    """
    request_count: int = 0
    window_start: float = field(default_factory=time.time)
    last_request_at: Optional[float] = None
    is_paused: bool = False
    pause_until: Optional[float] = None
    daily_count: int = 0
    daily_reset_at: Optional[float] = None


class RateLimiter:
    """
    Rate limiter service for enforcing platform-specific rate limits.
    
    Features:
    - Per-platform rate limit configurations
    - Request counting and window management
    - Random delays for human-like behavior
    - Exponential backoff for error handling
    - Daily limit tracking
    
    Requirements: 12.1, 12.2, 12.4
    """
    
    # Exponential backoff configuration
    BASE_BACKOFF_SECONDS = 1
    MAX_BACKOFF_SECONDS = 900  # 15 minutes max
    
    # Cache key prefixes
    CACHE_PREFIX = 'ratelimit:platform'
    BACKOFF_PREFIX = 'ratelimit:backoff'
    DAILY_PREFIX = 'ratelimit:daily'
    
    def __init__(self, config: Optional[RateLimitConfig] = None):
        """
        Initialize rate limiter with optional config.
        
        Args:
            config: Rate limit configuration (can be set per-call)
        """
        self.config = config
    
    def _get_cache_key(self, account_id: str, action_type: str = 'request') -> str:
        """Generate cache key for rate limit state."""
        return f'{self.CACHE_PREFIX}:{account_id}:{action_type}'
    
    def _get_backoff_key(self, account_id: str) -> str:
        """Generate cache key for backoff state."""
        return f'{self.BACKOFF_PREFIX}:{account_id}'
    
    def _get_daily_key(self, account_id: str) -> str:
        """Generate cache key for daily count."""
        return f'{self.DAILY_PREFIX}:{account_id}'
    
    def _get_state(self, account_id: str, action_type: str = 'request') -> RateLimitState:
        """Get current rate limit state from cache."""
        key = self._get_cache_key(account_id, action_type)
        state_dict = cache.get(key)
        
        if state_dict:
            return RateLimitState(**state_dict)
        return RateLimitState()
    
    def _save_state(self, account_id: str, state: RateLimitState, 
                    action_type: str = 'request', config: RateLimitConfig = None) -> None:
        """Save rate limit state to cache."""
        key = self._get_cache_key(account_id, action_type)
        cfg = config or self.config
        
        # Set timeout to window duration + buffer
        timeout = (cfg.window_seconds * 2) if cfg else 3600
        
        state_dict = {
            'request_count': state.request_count,
            'window_start': state.window_start,
            'last_request_at': state.last_request_at,
            'is_paused': state.is_paused,
            'pause_until': state.pause_until,
            'daily_count': state.daily_count,
            'daily_reset_at': state.daily_reset_at,
        }
        cache.set(key, state_dict, timeout=timeout)
    
    def get_random_delay(self, min_ms: int, max_ms: int) -> float:
        """
        Generate a random delay within the specified range for human-like behavior.
        
        Args:
            min_ms: Minimum delay in milliseconds
            max_ms: Maximum delay in milliseconds
            
        Returns:
            Random delay in seconds (float)
            
        Requirements: 12.2
        """
        if min_ms < 0:
            raise ValueError("min_ms cannot be negative")
        if max_ms < min_ms:
            raise ValueError("max_ms must be >= min_ms")
        
        # Generate random delay in milliseconds, convert to seconds
        delay_ms = random.randint(min_ms, max_ms)
        return delay_ms / 1000.0
    
    def calculate_exponential_backoff(self, error_count: int) -> float:
        """
        Calculate exponential backoff delay based on consecutive error count.
        
        Formula: delay = base * 2^error_count, capped at max
        
        Args:
            error_count: Number of consecutive errors (0-indexed)
            
        Returns:
            Backoff delay in seconds
            
        Requirements: 12.4
        """
        if error_count < 0:
            raise ValueError("error_count cannot be negative")
        
        # Calculate exponential delay: base * 2^n
        delay = self.BASE_BACKOFF_SECONDS * (2 ** error_count)
        
        # Cap at maximum
        return min(delay, self.MAX_BACKOFF_SECONDS)
    
    def get_error_count(self, account_id: str) -> int:
        """Get current consecutive error count for an account."""
        key = self._get_backoff_key(account_id)
        return cache.get(key, 0)
    
    def increment_error_count(self, account_id: str) -> int:
        """Increment error count and return new value."""
        key = self._get_backoff_key(account_id)
        count = cache.get(key, 0) + 1
        # Store for 1 hour
        cache.set(key, count, timeout=3600)
        return count
    
    def reset_error_count(self, account_id: str) -> None:
        """Reset error count after successful request."""
        key = self._get_backoff_key(account_id)
        cache.delete(key)
    
    def acquire(self, account_id: str, config: Optional[RateLimitConfig] = None,
                action_type: str = 'request') -> bool:
        """
        Try to acquire permission to make a request.
        
        Args:
            account_id: The account identifier
            config: Rate limit configuration (uses instance config if not provided)
            action_type: Type of action (e.g., 'fetch', 'send')
            
        Returns:
            True if request is allowed, False if rate limited
            
        Requirements: 12.1
        """
        cfg = config or self.config
        if not cfg:
            raise ValueError("No rate limit config provided")
        
        now = time.time()
        state = self._get_state(account_id, action_type)
        
        # Check if currently paused
        if state.is_paused and state.pause_until:
            if now < state.pause_until:
                return False
            # Pause expired, reset
            state.is_paused = False
            state.pause_until = None
        
        # Check if window has expired and reset if needed
        window_end = state.window_start + cfg.window_seconds
        if now >= window_end:
            # Reset window
            state.request_count = 0
            state.window_start = now
        
        # Check if within rate limit
        if state.request_count >= cfg.requests_per_window:
            return False
        
        # Check daily limit if configured
        if cfg.daily_limit is not None:
            # Check if daily reset is needed
            if state.daily_reset_at is None or now >= state.daily_reset_at:
                # Reset daily count at midnight
                tomorrow = datetime.now().replace(
                    hour=0, minute=0, second=0, microsecond=0
                ) + timedelta(days=1)
                state.daily_count = 0
                state.daily_reset_at = tomorrow.timestamp()
            
            if state.daily_count >= cfg.daily_limit:
                return False
        
        # Increment counters
        state.request_count += 1
        state.last_request_at = now
        
        if cfg.daily_limit is not None:
            state.daily_count += 1
        
        # Save state
        self._save_state(account_id, state, action_type, cfg)
        
        return True
    
    def wait_if_needed(self, account_id: str, config: Optional[RateLimitConfig] = None,
                       action_type: str = 'request') -> float:
        """
        Calculate wait time if rate limited.
        
        Args:
            account_id: The account identifier
            config: Rate limit configuration
            action_type: Type of action
            
        Returns:
            Seconds to wait (0 if no wait needed)
        """
        cfg = config or self.config
        if not cfg:
            raise ValueError("No rate limit config provided")
        
        now = time.time()
        state = self._get_state(account_id, action_type)
        
        # Check if paused
        if state.is_paused and state.pause_until:
            if now < state.pause_until:
                return state.pause_until - now
        
        # Check window
        window_end = state.window_start + cfg.window_seconds
        if state.request_count >= cfg.requests_per_window and now < window_end:
            return window_end - now
        
        # Check daily limit
        if cfg.daily_limit is not None and state.daily_count >= cfg.daily_limit:
            if state.daily_reset_at and now < state.daily_reset_at:
                return state.daily_reset_at - now
        
        return 0.0
    
    def pause_requests(self, account_id: str, duration_seconds: int,
                       action_type: str = 'request',
                       config: Optional[RateLimitConfig] = None) -> None:
        """
        Pause requests for a specified duration (e.g., after hitting rate limit).
        
        Args:
            account_id: The account identifier
            duration_seconds: How long to pause
            action_type: Type of action
            config: Rate limit configuration
            
        Requirements: 12.1
        """
        state = self._get_state(account_id, action_type)
        state.is_paused = True
        state.pause_until = time.time() + duration_seconds
        self._save_state(account_id, state, action_type, config)
    
    def get_remaining_requests(self, account_id: str, 
                               config: Optional[RateLimitConfig] = None,
                               action_type: str = 'request') -> int:
        """
        Get number of remaining requests in current window.
        
        Args:
            account_id: The account identifier
            config: Rate limit configuration
            action_type: Type of action
            
        Returns:
            Number of remaining requests
        """
        cfg = config or self.config
        if not cfg:
            raise ValueError("No rate limit config provided")
        
        now = time.time()
        state = self._get_state(account_id, action_type)
        
        # Check if window expired
        window_end = state.window_start + cfg.window_seconds
        if now >= window_end:
            return cfg.requests_per_window
        
        return max(0, cfg.requests_per_window - state.request_count)
    
    def get_daily_remaining(self, account_id: str,
                            config: Optional[RateLimitConfig] = None) -> Optional[int]:
        """
        Get remaining daily message count.
        
        Args:
            account_id: The account identifier
            config: Rate limit configuration
            
        Returns:
            Remaining daily count, or None if no daily limit
        """
        cfg = config or self.config
        if not cfg or cfg.daily_limit is None:
            return None
        
        now = time.time()
        state = self._get_state(account_id, 'send')
        
        # Check if daily reset is needed
        if state.daily_reset_at is None or now >= state.daily_reset_at:
            return cfg.daily_limit
        
        return max(0, cfg.daily_limit - state.daily_count)


def get_platform_rate_limiter(platform: str) -> RateLimiter:
    """
    Get a rate limiter configured for a specific platform.
    
    Args:
        platform: Platform name (e.g., 'twitter', 'linkedin')
        
    Returns:
        Configured RateLimiter instance
        
    Raises:
        ValueError: If platform is not supported
    """
    if platform not in PLATFORM_RATE_LIMITS:
        raise ValueError(f"Unknown platform: {platform}")
    
    return RateLimiter(config=PLATFORM_RATE_LIMITS[platform])
