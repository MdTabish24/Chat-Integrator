"""
Rate limiting middleware using Redis.

Migrated from backend/src/middleware/rateLimiter.ts
"""

import time
from django.core.cache import cache
from django.http import JsonResponse
from django.utils.deprecation import MiddlewareMixin
from django.conf import settings
from datetime import datetime


class RateLimitMiddleware(MiddlewareMixin):
    """
    Rate limiting middleware using Redis sorted sets
    
    Migrated from: createRateLimiter() in rateLimiter.ts
    Default: 100 requests per minute per user
    """
    
    def __init__(self, get_response):
        self.get_response = get_response
        self.window_ms = settings.RATE_LIMIT_WINDOW * 1000  # Convert to milliseconds
        self.max_requests = settings.RATE_LIMIT_MAX_REQUESTS
        self.key_prefix = 'ratelimit:api'
    
    def process_request(self, request):
        """
        Check rate limit before processing request
        """
        # Skip rate limiting for public endpoints
        public_paths = [
            '/health',
            '/api/auth/register',
            '/api/auth/login',
            '/api/csrf-token',
            '/admin/',
        ]
        
        if any(request.path.startswith(path) for path in public_paths):
            return None
        
        # Only rate limit authenticated users
        if not hasattr(request, 'user_jwt') or not request.user_jwt:
            return None
        
        user_id = request.user_jwt.get('user_id')
        if not user_id:
            return None
        
        # Create Redis key
        key = f'{self.key_prefix}:{user_id}'
        now = int(time.time() * 1000)  # Current time in milliseconds
        window_start = now - self.window_ms
        
        try:
            from redis.exceptions import ConnectionError as RedisConnectionError
            
            # Get all requests in current window from Redis
            # We'll use a simple list approach since Django cache doesn't support sorted sets natively
            try:
                requests_data = cache.get(key, [])
            except (RedisConnectionError, Exception) as e:
                print(f'Rate limiter Redis error: {e}')
                return None  # Allow request if Redis is down
            
            # Remove old entries outside the time window
            requests_data = [ts for ts in requests_data if ts > window_start]
            
            # Check if rate limit exceeded
            request_count = len(requests_data)
            
            if request_count >= self.max_requests:
                # Calculate retry after time
                oldest_request = min(requests_data) if requests_data else now
                retry_after = int((oldest_request + self.window_ms - now) / 1000)
                
                response = JsonResponse({
                    'error': {
                        'code': 'RATE_LIMIT_EXCEEDED',
                        'message': 'Rate limit exceeded. Please try again later.',
                        'retryable': True,
                        'details': {
                            'limit': self.max_requests,
                            'windowMs': self.window_ms,
                            'retryAfter': retry_after,
                        }
                    }
                }, status=429)
                
                response['X-RateLimit-Limit'] = str(self.max_requests)
                response['X-RateLimit-Remaining'] = '0'
                response['X-RateLimit-Reset'] = datetime.fromtimestamp((now + retry_after * 1000) / 1000).isoformat()
                response['Retry-After'] = str(retry_after)
                
                return response
            
            # Add current request
            requests_data.append(now)
            
            # Store back in cache with expiry
            cache.set(key, requests_data, timeout=int(self.window_ms / 1000) + 1)
            
            # Set rate limit headers
            remaining = self.max_requests - request_count - 1
            request.rate_limit_remaining = remaining
            request.rate_limit_limit = self.max_requests
            
        except Exception as e:
            # On Redis failure, allow the request through
            print(f'Rate limiter error: {e}')
            return None
        
        return None
    
    def process_response(self, request, response):
        """
        Add rate limit headers to response
        """
        if hasattr(request, 'rate_limit_remaining'):
            response['X-RateLimit-Limit'] = str(request.rate_limit_limit)
            response['X-RateLimit-Remaining'] = str(request.rate_limit_remaining)
            response['X-RateLimit-Reset'] = datetime.fromtimestamp(
                (int(time.time() * 1000) + self.window_ms) / 1000
            ).isoformat()
        
        return response


class StrictRateLimitMiddleware(RateLimitMiddleware):
    """
    Strict rate limiter for sensitive operations: 20 requests per minute
    
    Migrated from: strictRateLimiter in rateLimiter.ts
    """
    
    def __init__(self, get_response):
        super().__init__(get_response)
        self.max_requests = settings.RATE_LIMIT_STRICT_MAX_REQUESTS
        self.key_prefix = 'ratelimit:strict'
