"""
Instagram Private API Sidecar
Uses instagrapi to interact with Instagram's Mobile App API (i.instagram.com)
This is much faster and more reliable than browser automation.

Run: uvicorn engine:app --host 127.0.0.1 --port 5050 --reload
"""

import os
import json
import uuid
import logging
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from instagrapi import Client
from instagrapi.exceptions import (
    LoginRequired,
    ChallengeRequired,
    TwoFactorRequired,
    BadPassword,
    PleaseWaitFewMinutes,
    ClientError
)

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("instagram-sidecar")

# FastAPI app
app = FastAPI(
    title="Instagram Private API Sidecar",
    description="Lightweight local server for Instagram DM operations",
    version="1.0.0"
)

# CORS for Electron app
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Session file path - use user's AppData folder for write permissions
# This fixes the issue when app is installed in Program Files
def get_session_dir() -> Path:
    """Get session directory in user-writable location"""
    if os.name == 'nt':  # Windows
        app_data = os.environ.get('APPDATA', os.path.expanduser('~'))
        session_dir = Path(app_data) / 'Chat Orbitor' / 'instagram-sessions'
    else:  # macOS/Linux
        session_dir = Path.home() / '.chat-orbitor' / 'instagram-sessions'
    
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir

SESSION_DIR = get_session_dir()

# Global client instance
cl: Optional[Client] = None
current_user_id: Optional[str] = None
current_username: Optional[str] = None

# ============================================
# Pydantic Models
# ============================================

class LoginRequest(BaseModel):
    username: str
    password: str

class TwoFactorRequest(BaseModel):
    username: str
    code: str

class ChallengeRequest(BaseModel):
    username: str
    code: str

class SendMessageRequest(BaseModel):
    thread_id: str
    message: str

class SendMessageToUserRequest(BaseModel):
    user_id: str
    message: str

class StatusResponse(BaseModel):
    connected: bool
    user_id: Optional[str] = None
    username: Optional[str] = None
    error: Optional[str] = None

class InboxThread(BaseModel):
    thread_id: str
    thread_title: str
    users: List[Dict[str, Any]]
    last_message: Optional[str] = None
    last_message_at: Optional[str] = None
    is_group: bool = False
    unread_count: int = 0

class DirectMessage(BaseModel):
    id: str
    thread_id: str
    user_id: str
    username: str
    text: str
    timestamp: str
    is_outgoing: bool

# ============================================
# Helper Functions
# ============================================

def get_session_path(username: str) -> Path:
    """Get session file path for a username"""
    return SESSION_DIR / f"{username}_session.json"

def get_device_path(username: str) -> Path:
    """Get device settings file path"""
    return SESSION_DIR / f"{username}_device.json"

def generate_device_settings() -> Dict[str, Any]:
    """Generate realistic Android device settings"""
    return {
        "app_version": "269.0.0.18.75",
        "android_version": 31,
        "android_release": "12",
        "dpi": "480dpi",
        "resolution": "1080x2400",
        "manufacturer": "Samsung",
        "device": "SM-G991B",
        "model": "samsung",
        "cpu": "qcom",
        "version_code": "314665256",
        "uuid": str(uuid.uuid4()),
        "phone_id": str(uuid.uuid4()),
        "advertising_id": str(uuid.uuid4()),
        "device_id": f"android-{uuid.uuid4().hex[:16]}"
    }

def save_session(username: str):
    """Save session to file"""
    global cl
    if cl:
        session_path = get_session_path(username)
        session_data = cl.get_settings()
        with open(session_path, 'w') as f:
            json.dump(session_data, f, indent=2)
        logger.info(f"Session saved for {username}")

def load_session(username: str) -> bool:
    """Load session from file"""
    global cl, current_user_id, current_username
    
    session_path = get_session_path(username)
    device_path = get_device_path(username)
    
    if not session_path.exists():
        return False
    
    try:
        cl = Client()
        
        # Load device settings if exists
        if device_path.exists():
            with open(device_path, 'r') as f:
                device_settings = json.load(f)
            cl.set_device(device_settings)
        
        # Load session
        with open(session_path, 'r') as f:
            session_data = json.load(f)
        
        cl.set_settings(session_data)
        cl.login(username, "")  # Empty password, uses session
        
        # Verify session is valid
        user_info = cl.account_info()
        current_user_id = str(user_info.pk)
        current_username = user_info.username
        
        logger.info(f"Session loaded for {username}")
        return True
        
    except Exception as e:
        logger.error(f"Failed to load session: {e}")
        cl = None
        return False

def init_client_with_device(username: str) -> Client:
    """Initialize client with device spoofing"""
    client = Client()
    
    device_path = get_device_path(username)
    
    # Load or generate device settings
    if device_path.exists():
        with open(device_path, 'r') as f:
            device_settings = json.load(f)
    else:
        device_settings = generate_device_settings()
        with open(device_path, 'w') as f:
            json.dump(device_settings, f, indent=2)
    
    client.set_device(device_settings)
    
    # Set delays to appear more human-like
    client.delay_range = [1, 3]
    
    return client

# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    """Health check"""
    return {"status": "ok", "service": "instagram-sidecar"}

@app.get("/status", response_model=StatusResponse)
async def get_status():
    """Get connection status"""
    global cl, current_user_id, current_username
    
    if cl and current_user_id:
        return StatusResponse(
            connected=True,
            user_id=current_user_id,
            username=current_username
        )
    
    return StatusResponse(connected=False)

@app.post("/login")
async def login(request: LoginRequest):
    """Login to Instagram"""
    global cl, current_user_id, current_username
    
    username = request.username
    password = request.password
    
    # Try to load existing session first
    if load_session(username):
        return {
            "success": True,
            "user_id": current_user_id,
            "username": current_username,
            "message": "Logged in using saved session"
        }
    
    # Fresh login
    try:
        cl = init_client_with_device(username)
        cl.login(username, password)
        
        user_info = cl.account_info()
        current_user_id = str(user_info.pk)
        current_username = user_info.username
        
        # Save session for future use
        save_session(username)
        
        logger.info(f"Login successful for {username}")
        
        return {
            "success": True,
            "user_id": current_user_id,
            "username": current_username
        }
        
    except TwoFactorRequired:
        logger.info(f"2FA required for {username}")
        return {
            "success": False,
            "requires_2fa": True,
            "error": "Two-factor authentication required"
        }
        
    except ChallengeRequired as e:
        logger.info(f"Challenge required for {username}: {e}")
        return {
            "success": False,
            "requires_challenge": True,
            "challenge_type": "email" if "email" in str(e).lower() else "sms",
            "error": "Security challenge required. Check your email/SMS."
        }
        
    except BadPassword:
        logger.error(f"Bad password for {username}")
        return {
            "success": False,
            "error": "Invalid password"
        }
        
    except PleaseWaitFewMinutes as e:
        logger.error(f"Rate limited: {e}")
        return {
            "success": False,
            "error": "Please wait a few minutes before trying again"
        }
        
    except Exception as e:
        logger.error(f"Login failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/verify-2fa")
async def verify_2fa(request: TwoFactorRequest):
    """Verify 2FA code"""
    global cl, current_user_id, current_username
    
    if not cl:
        raise HTTPException(status_code=400, detail="No pending login. Call /login first.")
    
    try:
        cl.two_factor_login(request.code)
        
        user_info = cl.account_info()
        current_user_id = str(user_info.pk)
        current_username = user_info.username
        
        save_session(request.username)
        
        return {
            "success": True,
            "user_id": current_user_id,
            "username": current_username
        }
        
    except Exception as e:
        logger.error(f"2FA verification failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/verify-challenge")
async def verify_challenge(request: ChallengeRequest):
    """Verify challenge code"""
    global cl, current_user_id, current_username
    
    if not cl:
        raise HTTPException(status_code=400, detail="No pending login. Call /login first.")
    
    try:
        cl.challenge_code_handler(request.username, request.code)
        
        user_info = cl.account_info()
        current_user_id = str(user_info.pk)
        current_username = user_info.username
        
        save_session(request.username)
        
        return {
            "success": True,
            "user_id": current_user_id,
            "username": current_username
        }
        
    except Exception as e:
        logger.error(f"Challenge verification failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/logout")
async def logout():
    """Logout and clear session"""
    global cl, current_user_id, current_username
    
    if cl and current_username:
        session_path = get_session_path(current_username)
        if session_path.exists():
            session_path.unlink()
    
    cl = None
    current_user_id = None
    current_username = None
    
    return {"success": True}

@app.get("/inbox")
async def get_inbox(limit: int = 20):
    """Fetch DM inbox threads"""
    global cl, current_user_id
    
    if not cl:
        raise HTTPException(status_code=401, detail="Not logged in")
    
    try:
        threads = cl.direct_threads(amount=limit)
        
        result = []
        for thread in threads:
            # Get thread users
            users = []
            for user in thread.users:
                users.append({
                    "user_id": str(user.pk),
                    "username": user.username,
                    "full_name": user.full_name,
                    "profile_pic_url": str(user.profile_pic_url) if user.profile_pic_url else None
                })
            
            # Get last message
            last_message = None
            last_message_at = None
            if thread.messages:
                last_msg = thread.messages[0]
                last_message = last_msg.text if last_msg.text else "[Media]"
                last_message_at = last_msg.timestamp.isoformat() if last_msg.timestamp else None
            
            # Determine thread title
            if thread.thread_title:
                thread_title = thread.thread_title
            elif len(users) == 1:
                thread_title = users[0].get("full_name") or users[0].get("username", "Unknown")
            else:
                thread_title = ", ".join([u.get("username", "Unknown") for u in users[:3]])
            
            result.append({
                "thread_id": str(thread.id),
                "thread_title": thread_title,
                "users": users,
                "last_message": last_message,
                "last_message_at": last_message_at,
                "is_group": thread.is_group,
                "unread_count": 0  # instagrapi doesn't provide this directly
            })
        
        logger.info(f"Fetched {len(result)} threads")
        return {"success": True, "threads": result}
        
    except LoginRequired:
        logger.error("Session expired")
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
        
    except Exception as e:
        logger.error(f"Failed to fetch inbox: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/thread/{thread_id}/messages")
async def get_thread_messages(thread_id: str, limit: int = 50):
    """Fetch messages for a specific thread"""
    global cl, current_user_id
    
    if not cl:
        raise HTTPException(status_code=401, detail="Not logged in")
    
    try:
        messages = cl.direct_messages(thread_id, amount=limit)
        
        result = []
        for msg in messages:
            result.append({
                "id": str(msg.id),
                "thread_id": thread_id,
                "user_id": str(msg.user_id),
                "text": msg.text if msg.text else "[Media]",
                "timestamp": msg.timestamp.isoformat() if msg.timestamp else None,
                "is_outgoing": str(msg.user_id) == current_user_id,
                "item_type": msg.item_type
            })
        
        # Reverse to get oldest first
        result.reverse()
        
        logger.info(f"Fetched {len(result)} messages for thread {thread_id}")
        return {"success": True, "messages": result}
        
    except LoginRequired:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
        
    except Exception as e:
        logger.error(f"Failed to fetch messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/send")
async def send_message(request: SendMessageRequest):
    """Send a message to a thread"""
    global cl
    
    if not cl:
        raise HTTPException(status_code=401, detail="Not logged in")
    
    try:
        result = cl.direct_send(request.message, thread_ids=[request.thread_id])
        
        logger.info(f"Message sent to thread {request.thread_id}")
        
        return {
            "success": True,
            "message_id": str(result.id) if result else None,
            "timestamp": result.timestamp.isoformat() if result and result.timestamp else datetime.now().isoformat()
        }
        
    except LoginRequired:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
        
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/send-to-user")
async def send_message_to_user(request: SendMessageToUserRequest):
    """Send a message to a user by user_id"""
    global cl
    
    if not cl:
        raise HTTPException(status_code=401, detail="Not logged in")
    
    try:
        result = cl.direct_send(request.message, user_ids=[request.user_id])
        
        logger.info(f"Message sent to user {request.user_id}")
        
        return {
            "success": True,
            "message_id": str(result.id) if result else None,
            "thread_id": str(result.thread_id) if result else None,
            "timestamp": result.timestamp.isoformat() if result and result.timestamp else datetime.now().isoformat()
        }
        
    except LoginRequired:
        raise HTTPException(status_code=401, detail="Session expired. Please login again.")
        
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@app.get("/user/{username}")
async def get_user_info(username: str):
    """Get user info by username"""
    global cl
    
    if not cl:
        raise HTTPException(status_code=401, detail="Not logged in")
    
    try:
        user = cl.user_info_by_username(username)
        
        return {
            "success": True,
            "user": {
                "user_id": str(user.pk),
                "username": user.username,
                "full_name": user.full_name,
                "profile_pic_url": str(user.profile_pic_url) if user.profile_pic_url else None,
                "is_private": user.is_private,
                "follower_count": user.follower_count,
                "following_count": user.following_count
            }
        }
        
    except Exception as e:
        logger.error(f"Failed to get user info: {e}")
        return {
            "success": False,
            "error": str(e)
        }

# ============================================
# Main Entry Point
# ============================================

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="127.0.0.1", port=5050, log_level="info")
