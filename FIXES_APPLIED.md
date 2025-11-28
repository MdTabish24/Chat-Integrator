# Telegram Integration Fixes Applied

## Issues Fixed

### 1. **Async Context Error in Telegram Sync**
**Error:** `You cannot call this from an async context - use a thread or sync_to_async`

**Location:** `backend/apps/telegram/services/sync.py`

**Fix:**
- Moved message fetching OUTSIDE the `sync_to_async` wrapper
- Properly wrapped all database operations with `@sync_to_async`
- Fixed the closure issue by removing parameters from the inner function

**Changes:**
```python
# BEFORE: Messages fetched inside sync_to_async (WRONG)
@s2a
def save_conversation_and_messages(dialog_id, clean_name, avatar_url, dialog_date, messages_list):
    # ... database operations with messages_list

messages = await telegram_user_client.get_messages(account_id, dialog_id, 20)
saved_conversation = await save_conversation_and_messages(dialog_id, clean_name, avatar_url, dialog_date, messages)

# AFTER: Messages fetched before sync_to_async (CORRECT)
messages = await telegram_user_client.get_messages(account_id, dialog_id, 20)

@sync_to_async
def save_conversation_and_messages():
    # ... database operations using messages from closure
    
saved_conversation = await save_conversation_and_messages()
```

### 2. **Thread Executor Error in Session Loading**
**Error:** `You cannot submit onto CurrentThreadExecutor from its own thread`

**Location:** `backend/apps/telegram/services/client.py`

**Fix:**
- Changed TelegramClient initialization to use `run_in_executor` for thread-safe creation
- Added event loop parameter to TelegramClient
- Added connection check before operations

**Changes:**
```python
# BEFORE: Direct client creation (caused thread issues)
client = TelegramClient(
    StringSession(session_string),
    self.api_id,
    self.api_hash
)
await client.connect()

# AFTER: Thread-safe client creation
import asyncio
loop = asyncio.get_event_loop()

def create_client():
    return TelegramClient(
        StringSession(session_string),
        self.api_id,
        self.api_hash,
        loop=loop
    )

client = await loop.run_in_executor(None, create_client)

if not client.is_connected():
    await client.connect()
```

### 3. **Redis Connection Errors**
**Error:** `Connection closed by server` in WebSocket and rate limiter

**Location:** 
- `backend/apps/websocket/consumers.py`
- `backend/apps/core/middleware/ratelimit.py`

**Fix:**
- Added try-catch blocks around all Redis operations
- Made Redis failures non-fatal (graceful degradation)
- Added connection checks before Redis operations

**Changes:**
```python
# WebSocket consumer - graceful Redis handling
try:
    if self.channel_layer:
        await self.channel_layer.group_add(
            self.user_room,
            self.channel_name
        )
except Exception as e:
    print(f'[websocket] Redis error (non-fatal): {e}')

# Rate limiter - allow requests if Redis is down
try:
    requests_data = cache.get(key, [])
except (RedisConnectionError, Exception) as e:
    print(f'Rate limiter Redis error: {e}')
    return None  # Allow request if Redis is down
```

### 4. **Message Sending Error Handling**
**Location:** `backend/apps/telegram/services/client.py`

**Fix:**
- Added comprehensive error handling in `send_message()`
- Added connection checks before sending
- Added detailed error logging with traceback

**Changes:**
```python
async def send_message(self, account_id: str, chat_id: str, text: str) -> None:
    try:
        client = await self.load_session(account_id)
        if not client:
            raise Exception('Session not found')
        
        # Ensure client is connected
        if not client.is_connected():
            await client.connect()
        
        await client.send_message(int(chat_id), text)
        print(f'[telegram-user] Message sent to chat {chat_id}')
    except Exception as e:
        print(f'[telegram-user] Error sending message: {e}')
        import traceback
        traceback.print_exc()
        raise Exception(f'Failed to send message: {str(e)}')
```

## Testing

To test the fixes:

1. **Run the test script:**
   ```bash
   cd backend
   python test_telegram_fix.py
   ```

2. **Test message sending:**
   - Login to the app
   - Connect Telegram account
   - Try sending a message
   - Check logs for proper error handling

3. **Test sync:**
   - Click sync button in the UI
   - Check logs for successful sync without async errors

## Expected Behavior After Fixes

1. ✅ **Telegram sync works** without "async context" errors
2. ✅ **Message sending works** without "thread executor" errors
3. ✅ **Redis failures are graceful** - app continues to work even if Redis is down
4. ✅ **WebSocket connections** don't crash on Redis errors
5. ✅ **Rate limiting** degrades gracefully when Redis is unavailable

## Remaining Issues (If Any)

If you still see errors:

1. **Check Redis connection:**
   - Verify REDIS_URL in .env
   - Test Redis connection: `redis-cli ping`

2. **Check Telegram credentials:**
   - Verify TELEGRAM_API_ID and TELEGRAM_API_HASH
   - Ensure session is properly saved in database

3. **Check logs for specific errors:**
   - Look for traceback details
   - Check if it's a different error than the ones fixed

## Files Modified

1. `backend/apps/telegram/services/sync.py` - Fixed async context issues
2. `backend/apps/telegram/services/client.py` - Fixed thread executor and added error handling
3. `backend/apps/websocket/consumers.py` - Added Redis error handling
4. `backend/test_telegram_fix.py` - Created test script

## Next Steps

1. Deploy the changes
2. Test in production
3. Monitor logs for any new errors
4. If Redis keeps disconnecting, consider:
   - Increasing Redis connection timeout
   - Using Redis connection pooling
   - Switching to a more stable Redis provider
