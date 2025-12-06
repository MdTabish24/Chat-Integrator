# Design Document: Chat Orbitor Fix & Platform Integration

## Overview

This design addresses the migration issues from TypeScript+PostgreSQL to Django+MySQL and adds new platform integrations. The primary focus is:

1. **Fix WebSocket routing** - Critical bug causing "No application configured for scope type 'websocket'"
2. **Fix Telegram sync** - Ensure all conversations sync properly
3. **Add cookie-based platform integrations** - Twitter, LinkedIn, Instagram, Facebook using unofficial libraries
4. **Add browser-based WhatsApp** - Using Playwright for WhatsApp Web automation
5. **Add OAuth integrations** - Teams, Gmail, Discord
6. **Update UI** - New dashboard layout per design mockup

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Frontend (React)                          │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌──────────┐        │
│  │ Dashboard │  │ Sidebar  │  │ Chat View│  │ Settings │        │
│  └──────────┘  └──────────┘  └──────────┘  └──────────┘        │
│                         │                                        │
│                    WebSocket + REST API                          │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                     Django Backend (ASGI)                        │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                   ASGI Application                       │    │
│  │  ┌─────────────┐  ┌─────────────────────────────────┐   │    │
│  │  │ HTTP Router │  │ WebSocket Router (FIXED)        │   │    │
│  │  └─────────────┘  └─────────────────────────────────┘   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                 Platform Adapters                        │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │    │
│  │  │Telegram│ │Twitter │ │LinkedIn│ │Instagram│           │    │
│  │  │Telethon│ │ twikit │ │linkedin│ │instagrapi│          │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘           │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐           │    │
│  │  │Facebook│ │WhatsApp│ │ Teams  │ │Discord │           │    │
│  │  │fbchat  │ │Playwrt │ │ Graph  │ │discord │           │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘           │    │
│  │  ┌────────┐                                             │    │
│  │  │ Gmail  │                                             │    │
│  │  │ OAuth  │                                             │    │
│  │  └────────┘                                             │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │              Shared Services                             │    │
│  │  ┌────────────┐ ┌────────────┐ ┌────────────┐          │    │
│  │  │ Encryption │ │Rate Limiter│ │ WebSocket  │          │    │
│  │  │  AES-256   │ │  Service   │ │  Service   │          │    │
│  │  └────────────┘ └────────────┘ └────────────┘          │    │
│  └─────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────┘
                              │
┌─────────────────────────────────────────────────────────────────┐
│                        MySQL Database                            │
│  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐           │
│  │  Users   │ │ Accounts │ │  Convos  │ │ Messages │           │
│  └──────────┘ └──────────┘ └──────────┘ └──────────┘           │
└─────────────────────────────────────────────────────────────────┘
```

## Components and Interfaces

### 1. WebSocket Router Fix

**Problem:** Current `routing.py` file is corrupted/truncated causing "No application configured for scope type 'websocket'" error.

**Solution:** Fix the WebSocket URL routing configuration.

```python
# backend/apps/websocket/routing.py
from django.urls import re_path
from . import consumers

websocket_urlpatterns = [
    re_path(r'ws/messages/$', consumers.MessagingConsumer.as_asgi()),
]
```

### 2. Platform Adapter Interface

All platform adapters implement a common interface:

```python
class BasePlatformAdapter:
    """Base class for all platform adapters"""
    
    platform_name: str
    rate_limit_config: RateLimitConfig
    
    async def connect(self, credentials: dict) -> ConnectedAccount
    async def disconnect(self, account_id: str) -> bool
    async def get_conversations(self, account_id: str, limit: int) -> List[Conversation]
    async def get_messages(self, account_id: str, conversation_id: str, limit: int) -> List[Message]
    async def send_message(self, account_id: str, conversation_id: str, text: str) -> Message
    async def sync_messages(self, account_id: str) -> None
```

### 3. Rate Limiter Service

```python
class RateLimitConfig:
    requests_per_window: int      # Max requests in window
    window_seconds: int           # Window duration
    min_delay_ms: int            # Minimum delay between requests
    max_delay_ms: int            # Maximum delay (for randomization)
    daily_limit: Optional[int]   # Daily message limit
    
class RateLimiter:
    async def acquire(self, key: str, config: RateLimitConfig) -> bool
    async def wait_if_needed(self, key: str, config: RateLimitConfig) -> None
    def get_random_delay(self, min_ms: int, max_ms: int) -> float
```

### 4. Encryption Service

```python
class EncryptionService:
    """AES-256-GCM encryption for credentials"""
    
    def encrypt(self, plaintext: str) -> str  # Returns base64 encoded
    def decrypt(self, ciphertext: str) -> str  # Returns plaintext
```

### 5. Platform-Specific Adapters

#### Twitter Adapter (twikit)
```python
class TwitterAdapter(BasePlatformAdapter):
    platform_name = "twitter"
    rate_limit_config = RateLimitConfig(
        requests_per_window=3,
        window_seconds=60,
        min_delay_ms=45000,
        max_delay_ms=90000,
        daily_limit=15
    )
```

#### LinkedIn Adapter (linkedin-api)
```python
class LinkedInAdapter(BasePlatformAdapter):
    platform_name = "linkedin"
    rate_limit_config = RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,
        max_delay_ms=60000,
        daily_limit=10
    )
```

#### Instagram Adapter (instagrapi)
```python
class InstagramAdapter(BasePlatformAdapter):
    platform_name = "instagram"
    rate_limit_config = RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,
        max_delay_ms=60000,
        daily_limit=20
    )
```

#### Facebook Adapter (fbchat-v2)
```python
class FacebookAdapter(BasePlatformAdapter):
    platform_name = "facebook"
    rate_limit_config = RateLimitConfig(
        requests_per_window=2,
        window_seconds=60,
        min_delay_ms=30000,
        max_delay_ms=60000,
        daily_limit=30
    )
```

#### WhatsApp Adapter (Playwright)
```python
class WhatsAppAdapter(BasePlatformAdapter):
    platform_name = "whatsapp"
    # Uses browser automation - special handling
```

#### Discord Adapter (discord.py)
```python
class DiscordAdapter(BasePlatformAdapter):
    platform_name = "discord"
    rate_limit_config = RateLimitConfig(
        requests_per_window=5,
        window_seconds=5,
        min_delay_ms=1000,
        max_delay_ms=2000,
        daily_limit=None  # Discord has built-in rate limiting
    )
```

#### Gmail Adapter (Google OAuth)
```python
class GmailAdapter(BasePlatformAdapter):
    platform_name = "gmail"
    # OAuth-based, uses Google API rate limits
```

## Data Models

### ConnectedAccount (Updated)
```python
class ConnectedAccount(models.Model):
    id = models.UUIDField(primary_key=True)
    user = models.ForeignKey(User, on_delete=models.CASCADE)
    platform = models.CharField(max_length=50)  # telegram, twitter, linkedin, etc.
    platform_user_id = models.CharField(max_length=255)
    platform_username = models.CharField(max_length=255)
    access_token = models.TextField()  # Encrypted
    refresh_token = models.TextField(null=True)  # Encrypted, for OAuth
    cookies = models.TextField(null=True)  # Encrypted JSON, for cookie-based
    is_active = models.BooleanField(default=True)
    last_sync_at = models.DateTimeField(null=True)
    daily_message_count = models.IntegerField(default=0)
    daily_count_reset_at = models.DateTimeField(null=True)
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
```

### RateLimitState
```python
class RateLimitState(models.Model):
    account = models.ForeignKey(ConnectedAccount, on_delete=models.CASCADE)
    action_type = models.CharField(max_length=50)  # fetch, send
    last_request_at = models.DateTimeField()
    request_count = models.IntegerField(default=0)
    window_start = models.DateTimeField()
    is_paused = models.BooleanField(default=False)
    pause_until = models.DateTimeField(null=True)
```

## Correctness Properties

*A property is a characteristic or behavior that should hold true across all valid executions of a system-essentially, a formal statement about what the system should do. Properties serve as the bridge between human-readable specifications and machine-verifiable correctness guarantees.*

Based on the prework analysis, the following properties have been identified:

### Property 1: WebSocket JWT Authentication
*For any* WebSocket connection attempt with a valid JWT token, the connection SHALL be accepted; *for any* connection attempt with an invalid or missing JWT token, the connection SHALL be rejected with code 4001.
**Validates: Requirements 1.2**

### Property 2: Encryption Round-Trip
*For any* credential string (cookie, token, session), encrypting then decrypting SHALL return the original string unchanged.
**Validates: Requirements 11.1, 3.1, 4.1**

### Property 3: Rate Limiter Enforcement
*For any* sequence of N requests where N exceeds the configured rate limit, the rate limiter SHALL block requests until the window resets.
**Validates: Requirements 12.1, 3.2, 3.3, 4.2, 4.3**

### Property 4: Random Delay Range
*For any* generated random delay with configured min and max values, the delay SHALL be within the inclusive range [min, max].
**Validates: Requirements 12.2, 3.4**

### Property 5: Exponential Backoff
*For any* sequence of consecutive errors, the backoff delay SHALL increase exponentially (delay_n = base * 2^n) up to a maximum cap.
**Validates: Requirements 12.4**

### Property 6: Message Encryption on Storage
*For any* message stored in the database, the content field SHALL be encrypted (not plaintext).
**Validates: Requirements 2.2**

### Property 7: WebSocket Notification on New Message
*For any* new message saved to a conversation, a WebSocket notification SHALL be emitted to the conversation owner.
**Validates: Requirements 2.4**

### Property 8: Gmail Filter - Primary Only
*For any* list of emails returned by the Gmail adapter, all emails SHALL have category "Primary" and is_read=False.
**Validates: Requirements 10.2**

### Property 9: Account Disconnect Cleanup
*For any* account that is disconnected, querying for that account's credentials SHALL return empty/null.
**Validates: Requirements 11.3**

### Property 10: Daily Limit Enforcement
*For any* platform with a daily message limit, after reaching the limit, subsequent send attempts SHALL be rejected until the next day.
**Validates: Requirements 3.3, 4.3, 5.3**

## Error Handling

### Platform-Specific Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Rate Limit (429) | Pause requests, respect retry-after header, notify user |
| Auth Expired | Mark account inactive, prompt re-authentication |
| Session Invalid | Clear stored credentials, prompt re-login |
| Network Error | Retry with exponential backoff (max 3 attempts) |
| Challenge Required | Notify user to complete verification in browser |

### WebSocket Errors

| Error Type | Handling Strategy |
|------------|-------------------|
| Connection Failed | Client-side exponential backoff reconnection |
| Auth Failed (4001) | Redirect to login |
| Redis Unavailable | Graceful degradation, continue without real-time |

## Testing Strategy

### Dual Testing Approach

This project uses both unit tests and property-based tests:

1. **Unit Tests**: Verify specific examples, edge cases, and integration points
2. **Property-Based Tests**: Verify universal properties across all valid inputs

### Property-Based Testing Framework

**Library**: `hypothesis` (Python's most popular PBT library)

**Configuration**:
```python
from hypothesis import settings, Verbosity

settings.register_profile("ci", max_examples=100)
settings.register_profile("dev", max_examples=50)
```

### Test Categories

1. **Encryption Tests**
   - Property: Round-trip encryption/decryption
   - Unit: Edge cases (empty string, unicode, very long strings)

2. **Rate Limiter Tests**
   - Property: Rate limit enforcement across request sequences
   - Property: Random delay within bounds
   - Unit: Window reset behavior

3. **WebSocket Tests**
   - Property: JWT validation (valid/invalid tokens)
   - Unit: Connection lifecycle

4. **Platform Adapter Tests**
   - Unit: Mock API responses
   - Integration: End-to-end with test accounts (manual)

### Test Annotation Format

All property-based tests MUST include:
```python
# **Feature: chat-orbitor-fix, Property 2: Encryption Round-Trip**
# **Validates: Requirements 11.1, 3.1, 4.1**
@given(st.text())
def test_encryption_round_trip(plaintext):
    ...
```
