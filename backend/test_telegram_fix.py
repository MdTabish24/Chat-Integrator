"""
Quick test script to verify Telegram client fixes
"""
import os
import sys
import django

# Setup Django
sys.path.insert(0, os.path.dirname(__file__))
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')
django.setup()

import asyncio
from apps.telegram.services.client import telegram_user_client

async def test_client():
    print("Testing Telegram client initialization...")
    
    # Test with a dummy account ID
    try:
        # This should fail gracefully
        result = await telegram_user_client.load_session("test-account-id")
        print(f"Result: {result}")
    except Exception as e:
        print(f"Expected error: {e}")
    
    print("Test completed!")

if __name__ == "__main__":
    asyncio.run(test_client())
