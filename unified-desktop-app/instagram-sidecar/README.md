# Instagram Private API Sidecar

Lightweight Python server using `instagrapi` to interact with Instagram's Mobile App API.

## Why Private API?

| Feature | Browser Automation | Private API (This) |
|---------|-------------------|-------------------|
| Speed | Slow (3-5s per action) | Fast (<500ms) |
| RAM Usage | ~200MB (Chromium) | ~20MB |
| Reliability | Breaks with UI changes | Stable API |
| Detection Risk | High | Low (device spoofing) |

## Quick Start

### Windows
```batch
start.bat
```

### Linux/Mac
```bash
chmod +x start.sh
./start.sh
```

### Manual
```bash
pip install -r requirements.txt
uvicorn engine:app --host 127.0.0.1 --port 5050
```

## API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/status` | GET | Check connection status |
| `/login` | POST | Login with username/password |
| `/verify-2fa` | POST | Submit 2FA code |
| `/verify-challenge` | POST | Submit challenge code |
| `/logout` | POST | Logout and clear session |
| `/inbox` | GET | Fetch DM threads |
| `/thread/{id}/messages` | GET | Fetch thread messages |
| `/send` | POST | Send message to thread |
| `/send-to-user` | POST | Send message to user |
| `/user/{username}` | GET | Get user info |

## Session Management

Sessions are saved in `sessions/` folder:
- `{username}_session.json` - Login session
- `{username}_device.json` - Device fingerprint

Sessions are reused automatically to avoid "Suspicious Login" flags.

## Toggle in React Native

In `InstagramAdapter.ts`:
```typescript
const USE_PRIVATE_API = true;  // true = Private API, false = Browser
```

## Security Notes

- Device spoofing mimics real Android device
- Sessions are stored locally only
- 2FA and challenges are handled gracefully
