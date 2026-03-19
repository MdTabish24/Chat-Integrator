# Facebook Messenger Private API Sidecar (fbchat-v2)

Python-based sidecar service for Facebook Messenger integration using **fbchat-v2** (MinhHuyDev fork) with MQTT protocol.

## 🚀 Why fbchat-v2?

| Feature | Browser Automation | fbchat-v2 (MQTT) |
|---------|-------------------|------------------|
| Speed | 🐢 5-10 sec | ⚡ <1 sec |
| RAM Usage | 🔴 500MB+ (Chromium) | 🟢 ~20MB |
| Reliability | ⚠️ UI changes break it | ✅ Backend-based |
| Protocol | HTTP/DOM scraping | MQTT (real-time) |

## 🔧 Hybrid Approach

1. **Auth (One-time)**: Use browser login to extract cookies (`c_user`, `xs`, `datr`)
2. **Messaging**: fbchat-v2 uses those cookies via MQTT protocol for instant messaging

## Setup

### Prerequisites
- Python 3.9 or higher
- pip (Python package manager)

### Quick Start (Windows)
```batch
start.bat
```

### Quick Start (macOS/Linux)
```bash
chmod +x start.sh
./start.sh
```

### Manual Setup
```bash
# Create virtual environment
python -m venv venv

# Activate (Windows)
venv\Scripts\activate

# Activate (macOS/Linux)
source venv/bin/activate

# Install dependencies (includes fbchat-v2 from GitHub)
pip install -r requirements.txt

# Run server
python -m uvicorn engine:app --host 127.0.0.1 --port 5001
```

## API Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/` | Health check (shows fbchat version & protocol) |
| GET | `/status` | Connection status |
| POST | `/login-cookies` | Login with Facebook cookies |
| POST | `/logout` | Logout and clear session |
| GET | `/fb/threads` | Fetch conversation threads (MQTT) |
| GET | `/fb/messages/{thread_id}` | Fetch messages for a thread (MQTT) |
| POST | `/fb/send` | Send a message (MQTT - instant) |

## Cookie Authentication

To login, extract cookies from a logged-in Facebook session:

1. Open Facebook in Chrome
2. Open DevTools (F12) → Application → Cookies → facebook.com
3. Copy values of: `c_user`, `xs`, `datr` (optional: `fr`)
4. Use the `/login-cookies` endpoint with these values

**Note**: The Desktop App handles this automatically via browser login popup.

## Port

The sidecar runs on `http://127.0.0.1:5001`

## Library

Using [MinhHuyDev/fbchat-v2](https://github.com/MinhHuyDev/fbchat-v2) - actively maintained fork (last update: Nov 2025) that supports Facebook's latest MQTT protocols and syncToken.
