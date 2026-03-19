"""
Facebook Messenger Private API Sidecar
Uses fbchat with patched fb_dtsg extraction for MQTT-based messaging

Hybrid Approach:
- Auth (One-time): Browser login to extract cookies (c_user, xs, datr)
- Messaging: fbchat MQTT protocol for instant messaging

Benefits over browser automation:
- Speed: Instant (<1 sec) vs 5-10 sec with browser
- RAM: ~20MB vs 500MB+ with Chromium
- Reliability: Backend-based, no UI changes break it

IMPORTANT: This file includes a monkey-patch for fb_dtsg extraction
because Facebook changed their API and the original regex doesn't work.

Run: uvicorn engine:app --host 127.0.0.1 --port 5001 --reload
"""

import os
import json
import random
import time
import logging
import re
from pathlib import Path
from datetime import datetime
from typing import Optional, List, Dict, Any

from fastapi import FastAPI, HTTPException, status
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

# ============================================
# MONKEY PATCH: Fix fb_dtsg extraction
# Facebook changed their HTML structure multiple times in 2024/2025
# This patch handles all known patterns
# ============================================
def patch_fbchat_state():
    """Patch fbchat's _state.py to handle new Facebook HTML structure"""
    try:
        import fbchat._state as state_module
        import requests
        
        # Multiple regex patterns for fb_dtsg (ordered by likelihood of success)
        FB_DTSG_PATTERNS = [
            # 2024/2025 Facebook patterns
            re.compile(r'"DTSGInitialData",\[\],\{"token":"([^"]+)"'),  # Most common 2024+
            re.compile(r'"DTSGInitData",\{"token":"([^"]+)"'),
            re.compile(r'"dtsg":\{"token":"([^"]+)"'),
            re.compile(r'name="fb_dtsg"\s+value="([^"]+)"'),  # Form field
            re.compile(r'"fb_dtsg":"([^"]+)"'),  # JSON field
            re.compile(r'"fb_dtsg_ag":"([^"]+)"'),  # Alternative
            re.compile(r'\["DTSGInitialData",\[\],\{"token":"([^"]+)"'),
            re.compile(r'"token":"([^"]{20,})".*?"async_get_token"'),  # Generic token + marker
            re.compile(r'fb_dtsg=([^\&"\']+)'),  # Query param style
            re.compile(r'"name":"fb_dtsg","value":"([^"]+)"'),  # Form JSON
        ]
        
        def extract_fb_dtsg(html_text: str, debug: bool = True) -> tuple:
            """Extract fb_dtsg and revision from Facebook HTML"""
            fb_dtsg = None
            revision = 1
            
            if debug:
                logging.info(f"[PATCH] Searching for fb_dtsg in {len(html_text)} bytes of HTML")
            
            for i, pattern in enumerate(FB_DTSG_PATTERNS):
                match = pattern.search(html_text)
                if match:
                    fb_dtsg = match.group(1)
                    if debug:
                        logging.info(f"[PATCH] Found fb_dtsg using pattern #{i+1}: {pattern.pattern[:40]}...")
                        logging.info(f"[PATCH] fb_dtsg value: {fb_dtsg[:20]}...{fb_dtsg[-10:]}")
                    break
            
            # Get revision
            rev_patterns = [
                re.compile(r'"client_revision":(\d+)'),
                re.compile(r'"revision":(\d+)'),
                re.compile(r'"__spin_r":(\d+)'),
            ]
            
            for pattern in rev_patterns:
                match = pattern.search(html_text)
                if match:
                    revision = int(match.group(1))
                    if debug:
                        logging.info(f"[PATCH] Found revision: {revision}")
                    break
            
            return fb_dtsg, revision
        
        # Store original methods
        original_from_session = state_module.State.from_session
        original_from_cookies = getattr(state_module.State, 'from_cookies', None)
        
        @classmethod  
        def patched_from_session(cls, session):
            """Patched version that tries multiple fb_dtsg patterns"""
            logging.info("[PATCH] patched_from_session called")
            
            # Add required headers
            headers = {
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.9",
                "Cache-Control": "no-cache",
                "Pragma": "no-cache",
                "Sec-Fetch-Dest": "document",
                "Sec-Fetch-Mode": "navigate",
                "Sec-Fetch-Site": "none",
                "Sec-Fetch-User": "?1",
                "Upgrade-Insecure-Requests": "1",
            }
            session.headers.update(headers)
            
            # Try multiple URLs in order of reliability
            urls_to_try = [
                "https://www.messenger.com/",
                "https://www.facebook.com/",
                "https://m.facebook.com/",
                "https://www.messenger.com/t/",
            ]
            
            fb_dtsg = None
            revision = 1
            last_error = None
            
            for url in urls_to_try:
                try:
                    logging.info(f"[PATCH] Fetching {url}...")
                    r = session.get(url, timeout=30, allow_redirects=True)
                    
                    logging.info(f"[PATCH] Response status: {r.status_code}, length: {len(r.text)}")
                    
                    # Check if we got a login page (means cookies are invalid)
                    if "/login" in r.url or "checkpoint" in r.url:
                        logging.warning(f"[PATCH] Redirected to login/checkpoint: {r.url}")
                        continue
                    
                    if r.status_code != 200:
                        logging.warning(f"[PATCH] Non-200 status from {url}: {r.status_code}")
                        continue
                    
                    if len(r.text) < 1000:
                        logging.warning(f"[PATCH] Response too short from {url}")
                        continue
                    
                    # Try to extract fb_dtsg
                    fb_dtsg, revision = extract_fb_dtsg(r.text)
                    
                    if fb_dtsg:
                        logging.info(f"[PATCH] Successfully extracted fb_dtsg from {url}")
                        break
                    else:
                        logging.warning(f"[PATCH] No fb_dtsg found in response from {url}")
                        # Log a snippet for debugging
                        if "DTSGInitialData" in r.text:
                            idx = r.text.find("DTSGInitialData")
                            logging.info(f"[PATCH] Found DTSGInitialData at pos {idx}, snippet: {r.text[idx:idx+200]}")
                        
                except Exception as e:
                    logging.warning(f"[PATCH] Failed to fetch {url}: {e}")
                    last_error = e
                    continue
            
            if not fb_dtsg:
                error_msg = f"Could not find fb_dtsg token. Session may be invalid. Last error: {last_error}"
                logging.error(f"[PATCH] {error_msg}")
                raise state_module.NotLoggedIn(error_msg)
            
            # Get user_id from cookies
            user_id = session.cookies.get("c_user")
            if not user_id:
                raise state_module.NotLoggedIn("Could not find user ID (c_user) in cookies")
            
            logging.info(f"[PATCH] Creating State for user {user_id}")
            
            return cls(
                user_id=user_id,
                fb_dtsg=fb_dtsg,
                revision=revision,
                session=session,
            )
        
        @classmethod
        def patched_from_cookies(cls, cookies, user_agent=None):
            """Patched version of from_cookies that uses our patched from_session"""
            logging.info("[PATCH] patched_from_cookies called")
            
            # Create a new requests session
            session = requests.Session()
            
            # Set user agent
            if not user_agent:
                user_agent = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
            
            session.headers["User-Agent"] = user_agent
            
            # Set cookies
            if isinstance(cookies, dict):
                for name, value in cookies.items():
                    if value:  # Only set non-empty values
                        session.cookies.set(name, value, domain=".facebook.com")
                        session.cookies.set(name, value, domain=".messenger.com")
            else:
                # If cookies is already a CookieJar or similar
                session.cookies.update(cookies)
            
            logging.info(f"[PATCH] Set cookies: {list(session.cookies.keys())}")
            
            # Use our patched from_session
            return cls.from_session(session=session)
        
        # Apply patches
        state_module.State.from_session = patched_from_session
        state_module.State.from_cookies = patched_from_cookies
        
        logging.info("[PATCH] Successfully patched fbchat State.from_session and State.from_cookies")
        return True
        
    except Exception as e:
        logging.error(f"[PATCH] Could not patch fbchat: {e}")
        import traceback
        traceback.print_exc()
        return False

# Try to import fbchat-muqit (actively maintained async library)  
FBCHAT_MUQIT_AVAILABLE = False
FBCHAT_AVAILABLE = False
FBCHAT_VERSION = None

try:
    from fbchat_muqit import Client as MuqitClient
    FBCHAT_MUQIT_AVAILABLE = True
    FBCHAT_VERSION = "muqit-async"
    print(f"[INFO] fbchat-muqit loaded successfully")
except ImportError as e:
    print(f"[WARNING] fbchat-muqit not available: {e}")
    # Try legacy fbchat as fallback
    try:
        patch_applied = patch_fbchat_state()
        from fbchat import Client, Message, ThreadType
        try:
            from fbchat import Session
            FBCHAT_VERSION = "v2"
        except ImportError:
            FBCHAT_VERSION = "v1"
        FBCHAT_AVAILABLE = True
        print(f"[INFO] legacy fbchat loaded (version: {FBCHAT_VERSION}, patch: {patch_applied})")
    except ImportError:
        print(f"[WARNING] No fbchat library available. Running in browser-only mode.")

# Configure logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("facebook-sidecar")

# FastAPI app
app = FastAPI(
    title="Facebook Messenger Private API Sidecar",
    description="Lightweight local server for Facebook Messenger DM operations using fbchat-v2 MQTT",
    version="2.0.0"
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
def get_session_dir() -> Path:
    """Get session directory in user-writable location"""
    if os.name == 'nt':  # Windows
        app_data = os.environ.get('APPDATA', os.path.expanduser('~'))
        session_dir = Path(app_data) / 'Chat Orbitor' / 'facebook-sessions'
    else:  # macOS/Linux
        session_dir = Path.home() / '.chat-orbitor' / 'facebook-sessions'
    
    session_dir.mkdir(parents=True, exist_ok=True)
    return session_dir

SESSION_DIR = get_session_dir()
SESSION_FILE = SESSION_DIR / "fb_session.json"

# User-Agent for requests
USER_AGENT = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"

# ============================================
# Pydantic Models
# ============================================

class CookieLoginRequest(BaseModel):
    c_user: str
    xs: str
    fr: Optional[str] = None
    datr: Optional[str] = None

class SendMessageRequest(BaseModel):
    thread_id: str
    message: str

class StatusResponse(BaseModel):
    connected: bool
    user_id: Optional[str] = None
    username: Optional[str] = None
    fbchat_version: Optional[str] = None
    error: Optional[str] = None

# ============================================
# Helper Functions
# ============================================

def save_session(cookies: Dict[str, str], user_id: str):
    """Save session cookies to file"""
    session_data = {
        "cookies": cookies,
        "user_id": user_id,
        "saved_at": datetime.now().isoformat()
    }
    with open(SESSION_FILE, 'w') as f:
        json.dump(session_data, f, indent=2)
    logger.info(f"Session saved for user {user_id}")

def load_session() -> Optional[Dict[str, Any]]:
    """Load session from file"""
    if not SESSION_FILE.exists():
        return None
    
    try:
        with open(SESSION_FILE, 'r') as f:
            return json.load(f)
    except Exception as e:
        logger.error(f"Failed to load session: {e}")
        return None

def clear_session():
    """Clear saved session"""
    if SESSION_FILE.exists():
        SESSION_FILE.unlink()
        logger.info("Session cleared")

def human_like_delay(message_length: int = 0):
    """Add human-like delays between actions"""
    # Base delay with random jitter (shorter with MQTT)
    base_delay = random.uniform(0.5, 1.5)
    
    # Additional delay based on message length (30ms per character)
    typing_delay = (message_length * 0.03) if message_length > 0 else 0
    
    # Cap typing delay at 3 seconds
    typing_delay = min(typing_delay, 3.0)
    
    total_delay = base_delay + typing_delay
    time.sleep(total_delay)
    return total_delay

# ============================================
# Facebook Client Wrapper (fbchat-v2)
# ============================================

class FacebookClientWrapper:
    """Wrapper for fbchat-v2 client with cookie-based authentication"""
    
    def __init__(self):
        self.session = None
        self.client = None
        self.user_id = None
        self.username = None
        self.cookies = None
    
    def login_with_cookies(self, cookies: Dict[str, str]) -> bool:
        """Login using Facebook cookies via patched fbchat Session.from_cookies()"""
        if not FBCHAT_AVAILABLE:
            # Mock mode for testing
            self.user_id = cookies.get('c_user', 'mock_user')
            self.username = f"user_{self.user_id}"
            self.cookies = cookies
            logger.info(f"[MOCK] Logged in as {self.user_id}")
            return True
        
        try:
            import requests
            
            # Build cookies dict for fbchat
            session_cookies = {
                'c_user': cookies['c_user'],
                'xs': cookies['xs'],
            }
            if cookies.get('fr'):
                session_cookies['fr'] = cookies['fr']
            if cookies.get('datr'):
                session_cookies['datr'] = cookies['datr']
            
            # Create a requests session with cookies
            req_session = requests.Session()
            req_session.headers.update({
                "User-Agent": USER_AGENT,
                "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
                "Accept-Language": "en-US,en;q=0.5",
            })
            
            # Set cookies on the session
            for name, value in session_cookies.items():
                req_session.cookies.set(name, value, domain=".facebook.com")
            
            # Try to create fbchat client
            try:
                if FBCHAT_VERSION == "v2":
                    # fbchat-v2: Use Session.from_cookies()
                    from fbchat import Session
                    self.session = Session.from_cookies(session_cookies)
                    self.client = Client(session=self.session)
                else:
                    # fbchat v1: Create client and use setSession() 
                    # Note: fbchat v1 requires email/password in constructor but we bypass with setSession
                    logger.info("Using fbchat v1 with setSession() method...")
                    
                    # Create a minimal client class that bypasses login
                    class CookieClient(Client):
                        def __init__(self, cookies, user_agent=None):
                            # Don't call parent __init__ which requires email/password
                            # Instead, manually initialize required attributes
                            import fbchat._state as _state
                            
                            self._sticky = None
                            self._pool = None
                            self._seq = "0"
                            self._pull_channel = 0
                            self._mark_alive = True
                            self._buddylist = {}
                            
                            # Use our patched from_cookies
                            try:
                                self._state = _state.State.from_cookies(cookies, user_agent=user_agent)
                                self._uid = self._state.user_id
                                logger.info(f"CookieClient initialized with uid: {self._uid}")
                            except Exception as e:
                                logger.error(f"CookieClient state init failed: {e}")
                                raise
                    
                    self.client = CookieClient(session_cookies, user_agent=USER_AGENT)
                    
            except Exception as e:
                error_msg = str(e).lower()
                logger.warning(f"Standard fbchat login failed: {e}")
                
                # If fb_dtsg error, try manual approach
                if "fb_dtsg" in error_msg or "nonetype" in error_msg or "not logged in" in error_msg:
                    logger.info("Trying manual fb_dtsg extraction...")
                    
                    # Fetch messenger.com to get fb_dtsg
                    r = req_session.get("https://www.messenger.com/", timeout=30)
                    
                    # Try multiple patterns
                    fb_dtsg = None
                    patterns = [
                        r'"DTSGInitialData",\[\],\{"token":"([^"]+)"',
                        r'"name"\s*:\s*"fb_dtsg"\s*,\s*"value"\s*:\s*"([^"]+)"',
                        r'name="fb_dtsg"\s+value="([^"]+)"',
                        r'"fb_dtsg":"([^"]+)"',
                    ]
                    
                    import re
                    for pattern in patterns:
                        match = re.search(pattern, r.text)
                        if match:
                            fb_dtsg = match.group(1)
                            logger.info(f"Found fb_dtsg manually!")
                            break
                    
                    if not fb_dtsg:
                        raise Exception("Could not extract fb_dtsg token. Cookies may be invalid.")
                    
                    # Store for later use (simplified client)
                    self.user_id = cookies['c_user']
                    self.cookies = cookies
                    self.username = f"User {self.user_id}"
                    self._fb_dtsg = fb_dtsg
                    self._req_session = req_session
                    self._manual_mode = True
                    
                    logger.info(f"Manual login successful for user {self.user_id}")
                    return True
                else:
                    raise e
            
            self.user_id = cookies['c_user']
            self.cookies = cookies
            self._manual_mode = False
            
            # Try to get username from profile
            try:
                if FBCHAT_VERSION == "v2" and self.client:
                    user_info = self.client.fetch_users([self.user_id])
                    if user_info:
                        user = list(user_info.values())[0] if isinstance(user_info, dict) else user_info[0]
                        self.username = getattr(user, 'name', None) or getattr(user, 'first_name', f"User {self.user_id}")
                elif self.client:
                    user_info = self.client.fetchUserInfo(self.user_id)
                    if user_info and self.user_id in user_info:
                        self.username = user_info[self.user_id].name
            except Exception as e:
                logger.warning(f"Could not fetch username: {e}")
                self.username = f"User {self.user_id}"
            
            logger.info(f"Logged in as {self.username} ({self.user_id}) via fbchat-{FBCHAT_VERSION}")
            return True
            
        except Exception as e:
            logger.error(f"Login failed: {e}")
            raise e
    
    def _fetch_threads_direct(self, limit: int = 20) -> List[Dict[str, Any]]:
        """
        Fetch threads using direct Messenger GraphQL API
        This is a fallback when fbchat's internal query returns empty
        """
        import requests
        
        if not self.cookies:
            logger.error("[_fetch_threads_direct] No cookies available")
            return []
        
        try:
            # Create session with cookies
            session = requests.Session()
            session.headers.update({
                "User-Agent": USER_AGENT,
                "Accept": "*/*",
                "Accept-Language": "en-US,en;q=0.9",
                "Content-Type": "application/x-www-form-urlencoded",
                "Origin": "https://www.messenger.com",
                "Referer": "https://www.messenger.com/",
            })
            
            for name, value in self.cookies.items():
                if value:
                    session.cookies.set(name, value, domain=".messenger.com")
                    session.cookies.set(name, value, domain=".facebook.com")
            
            # First, get fb_dtsg token from messenger.com
            logger.info("[_fetch_threads_direct] Fetching Messenger page for token...")
            r = session.get("https://www.messenger.com/", timeout=30)
            
            if "/login" in r.url:
                logger.error("[_fetch_threads_direct] Session expired - redirected to login")
                return []
            
            # Extract fb_dtsg
            fb_dtsg = None
            patterns = [
                r'"DTSGInitialData",\[\],\{"token":"([^"]+)"',
                r'"fb_dtsg":"([^"]+)"',
                r'name="fb_dtsg"\s+value="([^"]+)"',
            ]
            
            for pattern in patterns:
                match = re.search(pattern, r.text)
                if match:
                    fb_dtsg = match.group(1)
                    logger.info(f"[_fetch_threads_direct] Found fb_dtsg")
                    break
            
            if not fb_dtsg:
                logger.error("[_fetch_threads_direct] Could not extract fb_dtsg")
                return []
            
            # Modern GraphQL query for inbox threads
            # This query gets the primary inbox
            doc_id = "9461647060530790"  # LSPlatformGraphQLLightspeedRequestQuery
            
            variables = {
                "limit": limit,
                "before": None,
                "includeDeliveryReceipts": True,
                "includeSeqID": False,
            }
            
            data = {
                "av": self.cookies.get("c_user"),
                "__user": self.cookies.get("c_user"),
                "__a": "1",
                "fb_dtsg": fb_dtsg,
                "fb_api_caller_class": "RelayModern",
                "fb_api_req_friendly_name": "MessengerThreadlistQuery",
                "variables": json.dumps(variables),
                "doc_id": doc_id,
            }
            
            logger.info("[_fetch_threads_direct] Sending GraphQL request...")
            r = session.post(
                "https://www.messenger.com/api/graphql/",
                data=data,
                timeout=30
            )
            
            logger.info(f"[_fetch_threads_direct] Response status: {r.status_code}, length: {len(r.text)}")
            
            if r.status_code != 200:
                logger.error(f"[_fetch_threads_direct] GraphQL request failed: {r.status_code}")
                return []
            
            # Try to parse response
            try:
                # Handle "for (;;);" prefix that Facebook adds
                text = r.text
                if text.startswith("for (;;);"):
                    text = text[9:]
                
                result = json.loads(text)
                logger.info(f"[_fetch_threads_direct] Response keys: {list(result.keys()) if isinstance(result, dict) else 'not a dict'}")
                
                # Try different response structures
                threads_data = []
                
                # Structure 1: data.viewer.message_threads.nodes
                if "data" in result:
                    viewer = result["data"].get("viewer", {})
                    if "message_threads" in viewer:
                        threads_data = viewer["message_threads"].get("nodes", [])
                    elif "threads" in viewer:
                        threads_data = viewer["threads"].get("nodes", [])
                
                # Structure 2: Direct nodes
                if not threads_data and "nodes" in result:
                    threads_data = result["nodes"]
                
                # Structure 3: payload.threads (newer API)
                if not threads_data and "payload" in result:
                    threads_data = result["payload"].get("threads", [])
                
                logger.info(f"[_fetch_threads_direct] Found {len(threads_data)} thread nodes")
                
                # Convert to our format
                threads = []
                for node in threads_data:
                    if not node:
                        continue
                    
                    thread_id = node.get("thread_key", {}).get("thread_fbid") or node.get("id") or node.get("thread_id")
                    if not thread_id:
                        continue
                    
                    # Get name from different possible fields
                    name = (node.get("name") or 
                           node.get("thread_name") or
                           (node.get("all_participants", {}).get("nodes", [{}])[0].get("name")) or
                           "Unknown")
                    
                    threads.append({
                        "thread_id": str(thread_id),
                        "thread_title": name,
                        "thread_type": "GROUP" if node.get("is_group_thread") else "USER",
                        "last_message": node.get("last_message", {}).get("text"),
                        "last_message_at": datetime.now().isoformat(),
                        "participants": [],
                        "unread_count": node.get("unread_count", 0) or 0,
                    })
                
                logger.info(f"[_fetch_threads_direct] Converted {len(threads)} threads")
                return threads
                
            except json.JSONDecodeError as e:
                logger.error(f"[_fetch_threads_direct] JSON parse error: {e}")
                logger.info(f"[_fetch_threads_direct] Response preview: {r.text[:500]}")
                return []
                
        except Exception as e:
            logger.error(f"[_fetch_threads_direct] Error: {e}")
            import traceback
            traceback.print_exc()
            return []
    
    def get_threads(self, limit: int = 20) -> List[Dict[str, Any]]:
        """Fetch recent threads/conversations using fbchat-v2"""
        if not FBCHAT_AVAILABLE:
            # Mock data for testing
            return [
                {
                    "thread_id": "100001234567890",
                    "thread_title": "Test User 1",
                    "thread_type": "USER",
                    "last_message": "Hello, this is a test message",
                    "last_message_at": datetime.now().isoformat(),
                    "participants": [{"user_id": "100001234567890", "name": "Test User 1"}],
                    "unread_count": 0
                },
                {
                    "thread_id": "100009876543210",
                    "thread_title": "Test User 2",
                    "thread_type": "USER",
                    "last_message": "Hey there!",
                    "last_message_at": datetime.now().isoformat(),
                    "participants": [{"user_id": "100009876543210", "name": "Test User 2"}],
                    "unread_count": 1
                }
            ]
        
        try:
            logger.info(f"[get_threads] Fetching threads, client: {self.client}, manual_mode: {getattr(self, '_manual_mode', 'not set')}")
            
            threads = []
            
            # First try fbchat if available
            if not getattr(self, '_manual_mode', False) and self.client:
                try:
                    if FBCHAT_VERSION == "v2":
                        logger.info("[get_threads] Using fbchat v2 fetch_thread_list")
                        threads = list(self.client.fetch_thread_list(limit=limit))
                    else:
                        logger.info("[get_threads] Using fbchat v1 fetchThreadList")
                        threads = self.client.fetchThreadList(limit=limit)
                    
                    logger.info(f"[get_threads] fbchat returned: {len(threads) if threads else 0} threads")
                except Exception as fbchat_err:
                    logger.warning(f"[get_threads] fbchat fetch failed: {fbchat_err}")
            
            # If fbchat returned empty, try direct GraphQL API
            if not threads:
                logger.info("[get_threads] fbchat empty, trying direct Messenger GraphQL API...")
                threads = self._fetch_threads_direct(limit)
            
            logger.info(f"[get_threads] Total threads: {len(threads) if threads else 0}")
            
            result = []
            
            for thread in threads:
                # Get thread ID
                thread_id = str(thread.id) if hasattr(thread, 'id') else str(thread.uid if hasattr(thread, 'uid') else thread)
                
                # Get thread info
                thread_title = getattr(thread, 'name', None) or getattr(thread, 'first_name', None) or "Unknown"
                if hasattr(thread, 'last_name') and thread.last_name:
                    thread_title = f"{thread_title} {thread.last_name}"
                
                # Determine thread type
                thread_type_attr = getattr(thread, 'type', None)
                if thread_type_attr:
                    thread_type = "GROUP" if str(thread_type_attr).upper() == "GROUP" else "USER"
                else:
                    thread_type = "USER"
                
                # Get last message timestamp
                last_message_at = None
                last_message_ts = getattr(thread, 'last_message_timestamp', None)
                if last_message_ts:
                    try:
                        # Handle both milliseconds and seconds
                        ts = float(last_message_ts)
                        if ts > 1e12:
                            ts = ts / 1000
                        last_message_at = datetime.fromtimestamp(ts).isoformat()
                    except:
                        last_message_at = datetime.now().isoformat()
                else:
                    last_message_at = datetime.now().isoformat()
                
                # Get participants for user threads
                participants = []
                if thread_type == "USER":
                    participants.append({
                        "user_id": thread_id,
                        "name": thread_title
                    })
                
                # Get photo URL
                photo_url = getattr(thread, 'photo', None) or getattr(thread, 'photo_url', None)
                
                result.append({
                    "thread_id": thread_id,
                    "thread_title": thread_title,
                    "thread_type": thread_type,
                    "last_message": None,  # Skip fetching last message for speed
                    "last_message_at": last_message_at,
                    "participants": participants,
                    "unread_count": getattr(thread, 'unread_count', 0) or 0,
                    "photo_url": str(photo_url) if photo_url else None
                })
            
            logger.info(f"Fetched {len(result)} threads via MQTT")
            return result
            
        except Exception as e:
            logger.error(f"Failed to fetch threads: {e}")
            raise e
    
    def get_messages(self, thread_id: str, limit: int = 50) -> List[Dict[str, Any]]:
        """Fetch messages for a specific thread using fbchat-v2"""
        if not FBCHAT_AVAILABLE:
            # Mock data
            return [
                {
                    "id": f"msg_{i}",
                    "thread_id": thread_id,
                    "user_id": self.user_id if i % 2 == 0 else thread_id,
                    "username": "You" if i % 2 == 0 else "Contact",
                    "text": f"Test message {i}",
                    "timestamp": datetime.now().isoformat(),
                    "is_outgoing": i % 2 == 0
                }
                for i in range(5)
            ]
        
        try:
            if FBCHAT_VERSION == "v2":
                # fbchat-v2: fetch_thread_messages returns generator
                messages = list(self.client.fetch_thread_messages(thread_id=thread_id, limit=limit))
            else:
                messages = self.client.fetchThreadMessages(thread_id, limit=limit)
            
            result = []
            
            for msg in messages:
                # Get message ID
                msg_id = str(getattr(msg, 'id', '') or getattr(msg, 'uid', ''))
                
                # Get author/sender
                author = str(getattr(msg, 'author', ''))
                
                # Get message text
                text = getattr(msg, 'text', '') or ''
                
                # Handle attachments
                attachments = getattr(msg, 'attachments', []) or []
                if attachments and not text:
                    text = "[Media]"
                
                # Handle stickers
                sticker = getattr(msg, 'sticker', None)
                if sticker and not text:
                    text = "[Sticker]"
                
                # Get timestamp
                msg_timestamp = getattr(msg, 'created_at', None) or getattr(msg, 'timestamp', None)
                if msg_timestamp:
                    if isinstance(msg_timestamp, datetime):
                        timestamp = msg_timestamp.isoformat()
                    elif isinstance(msg_timestamp, (int, float)):
                        # Handle both milliseconds and seconds
                        ts = float(msg_timestamp)
                        if ts > 1e12:
                            ts = ts / 1000
                        timestamp = datetime.fromtimestamp(ts).isoformat()
                    else:
                        timestamp = datetime.now().isoformat()
                else:
                    timestamp = datetime.now().isoformat()
                
                result.append({
                    "id": msg_id,
                    "thread_id": thread_id,
                    "user_id": author,
                    "username": "You" if author == self.user_id else "Contact",
                    "text": text,
                    "timestamp": timestamp,
                    "is_outgoing": author == self.user_id,
                    "is_read": getattr(msg, 'is_read', False)
                })
            
            # Reverse to get oldest first
            result.reverse()
            logger.info(f"Fetched {len(result)} messages for thread {thread_id} via MQTT")
            return result
            
        except Exception as e:
            logger.error(f"Failed to fetch messages: {e}")
            raise e
    
    def send_message(self, thread_id: str, message: str) -> Dict[str, Any]:
        """Send a message with human-like behavior using fbchat-v2 MQTT"""
        if not FBCHAT_AVAILABLE:
            # Mock sending
            human_like_delay(len(message))
            return {
                "success": True,
                "message_id": f"mock_msg_{int(time.time())}",
                "timestamp": datetime.now().isoformat()
            }
        
        try:
            # Step 1: Short delay (MQTT is fast)
            human_like_delay(len(message))
            
            # Step 2: Send the message
            if FBCHAT_VERSION == "v2":
                # fbchat-v2: Use Message class and send()
                msg = Message(text=message)
                message_id = self.client.send(msg, thread_id=thread_id, thread_type=ThreadType.USER)
            else:
                # Old fbchat
                msg = Message(text=message)
                message_id = self.client.send(msg, thread_id=thread_id, thread_type=ThreadType.USER)
            
            logger.info(f"Message sent to {thread_id} via MQTT: {message[:50]}...")
            
            return {
                "success": True,
                "message_id": str(message_id) if message_id else f"sent_{int(time.time())}",
                "timestamp": datetime.now().isoformat()
            }
            
        except Exception as e:
            logger.error(f"Failed to send message: {e}")
            raise e
    
    def logout(self):
        """Logout and clear session"""
        self.session = None
        self.client = None
        self.user_id = None
        self.username = None
        self.cookies = None
        clear_session()
        logger.info("Logged out and session cleared")

# Global client wrapper instance
fb_client = FacebookClientWrapper()

# ============================================
# API Endpoints
# ============================================

@app.get("/")
async def root():
    """Health check"""
    return {
        "status": "ok",
        "service": "facebook-sidecar",
        "fbchat_available": FBCHAT_AVAILABLE,
        "fbchat_version": FBCHAT_VERSION,
        "protocol": "MQTT" if FBCHAT_VERSION == "v2" else "HTTP"
    }

@app.get("/status", response_model=StatusResponse)
async def get_status():
    """Get connection status"""
    if fb_client.user_id:
        return StatusResponse(
            connected=True,
            user_id=fb_client.user_id,
            username=fb_client.username,
            fbchat_version=FBCHAT_VERSION
        )
    
    return StatusResponse(connected=False, fbchat_version=FBCHAT_VERSION)

@app.post("/login-cookies")
async def login_with_cookies(request: CookieLoginRequest):
    """Login to Facebook using session cookies (extracted from browser)"""
    
    # Check if already logged in
    if fb_client.user_id:
        return {
            "success": True,
            "user_id": fb_client.user_id,
            "username": fb_client.username,
            "message": "Already logged in",
            "protocol": "MQTT" if FBCHAT_VERSION == "v2" else "HTTP"
        }
    
    # Try to login with cookies
    try:
        cookies = {
            "c_user": request.c_user,
            "xs": request.xs,
            "fr": request.fr,
            "datr": request.datr
        }
        
        fb_client.login_with_cookies(cookies)
        
        # Save session for future use
        save_session(cookies, fb_client.user_id)
        
        return {
            "success": True,
            "user_id": fb_client.user_id,
            "username": fb_client.username,
            "protocol": "MQTT" if FBCHAT_VERSION == "v2" else "HTTP"
        }
        
    except Exception as e:
        error_msg = str(e).lower()
        
        # Check for checkpoint/2FA
        if "checkpoint" in error_msg or "two-factor" in error_msg or "2fa" in error_msg:
            return {
                "success": False,
                "status": "needs_verification",
                "error": "Facebook security checkpoint. Please complete verification in browser and re-extract cookies."
            }
        
        # Check for invalid/expired cookies
        if "invalid" in error_msg or "expired" in error_msg or "login" in error_msg:
            return {
                "success": False,
                "status": "cookies_expired",
                "error": "Cookies expired or invalid. Please re-login via browser and extract new cookies."
            }
        
        logger.error(f"Login failed: {e}")
        return {
            "success": False,
            "error": str(e)
        }

@app.post("/logout")
async def logout():
    """Logout and clear session"""
    fb_client.logout()
    return {"success": True}

@app.get("/fb/threads")
async def get_threads(limit: int = 20):
    """Fetch recent conversation threads via MQTT"""
    if not fb_client.user_id:
        raise HTTPException(status_code=401, detail="Not logged in. Please login with cookies first.")
    
    try:
        threads = fb_client.get_threads(limit=limit)
        return {
            "success": True,
            "threads": threads,
            "count": len(threads),
            "protocol": "MQTT" if FBCHAT_VERSION == "v2" else "HTTP"
        }
    except Exception as e:
        logger.error(f"Failed to fetch threads: {e}")
        
        # Check for session expired
        error_msg = str(e).lower()
        if "invalid" in error_msg or "expired" in error_msg or "login" in error_msg:
            fb_client.logout()
            raise HTTPException(
                status_code=401,
                detail="Session expired. Please re-login via browser and extract new cookies."
            )
        
        raise HTTPException(status_code=500, detail=str(e))

@app.get("/fb/messages/{thread_id}")
async def get_messages(thread_id: str, limit: int = 50):
    """Fetch messages for a specific thread via MQTT"""
    if not fb_client.user_id:
        raise HTTPException(status_code=401, detail="Not logged in. Please login with cookies first.")
    
    try:
        messages = fb_client.get_messages(thread_id, limit=limit)
        return {
            "success": True,
            "messages": messages,
            "count": len(messages),
            "protocol": "MQTT" if FBCHAT_VERSION == "v2" else "HTTP"
        }
    except Exception as e:
        logger.error(f"Failed to fetch messages: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/fb/send")
async def send_message(request: SendMessageRequest):
    """Send a message to a thread via MQTT (instant delivery)"""
    if not fb_client.user_id:
        raise HTTPException(status_code=401, detail="Not logged in. Please login with cookies first.")
    
    try:
        result = fb_client.send_message(request.thread_id, request.message)
        return result
    except Exception as e:
        logger.error(f"Failed to send message: {e}")
        return {"success": False, "error": str(e)}

@app.on_event("startup")
async def startup_event():
    """Try to restore session on startup"""
    logger.info(f"Starting Facebook Sidecar with fbchat-{FBCHAT_VERSION or 'MOCK'}")
    
    session = load_session()
    if session and session.get("cookies"):
        try:
            logger.info("Restoring saved session...")
            fb_client.login_with_cookies(session["cookies"])
            logger.info(f"Session restored for user {fb_client.user_id}")
        except Exception as e:
            logger.warning(f"Failed to restore session: {e}")
            clear_session()

# ============================================
# Main Entry Point
# ============================================

if __name__ == "__main__":
    import uvicorn
    print(f"Starting Facebook Sidecar with fbchat-{FBCHAT_VERSION or 'MOCK'}")
    print("Protocol: MQTT (fast, ~20MB RAM)" if FBCHAT_VERSION == "v2" else "HTTP")
    uvicorn.run(app, host="127.0.0.1", port=5001, log_level="info")
