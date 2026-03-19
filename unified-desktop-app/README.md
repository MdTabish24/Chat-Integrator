# Chat Orbitor - Desktop App

Multi-Platform DM Hub - A unified desktop application for managing direct messages across multiple social media platforms.

## 🚀 Quick Setup

**One command to set up everything:**

```bash
# Windows (PowerShell)
npm run setup

# Or directly
powershell -ExecutionPolicy Bypass -File setup.ps1

# macOS/Linux
npm run setup
# Or: bash setup.sh
```

This will:
1. ✅ Install Node.js dependencies
2. ✅ Setup Instagram Private API (instagrapi)
3. ✅ Setup Facebook Private API (fbchat-v2 MQTT)
4. ✅ Build the application

Then just run:
```bash
npm start
```

## Features

- 🔐 **Local Authentication**: All API calls happen from your PC using your residential IP
- 💬 **Unified Inbox**: View all DMs from Twitter, Instagram, Facebook, LinkedIn, WhatsApp, Telegram, and Discord in one place
- ⚡ **Real-Time Messaging**: Instant message delivery with WebSocket/MTProto support
- 🔒 **Secure Storage**: Credentials encrypted and stored locally using system keychain
- 🖥️ **System Tray**: Runs in background with quick access from system tray
- 🌙 **Dark Mode**: Beautiful light and dark themes

## Supported Platforms

| Platform | Auth Method | Speed | Protocol |
|----------|-------------|-------|----------|
| WhatsApp | QR Code | ⚡ Real-time | WebSocket |
| Telegram | Phone + 2FA | ⚡ Real-time | MTProto |
| Discord | User Token | ⚡ Real-time | Gateway |
| Twitter/X | Browser Cookies | 🔄 10s | Polling |
| Instagram | Private API / Browser | ⚡ <1s / 🔄 5s | instagrapi / Polling |
| **Facebook** | **Private API (fbchat-v2)** | **⚡ <1s** | **MQTT** |
| Facebook | Browser Automation | 🔄 5-10s | DOM Scraping |
| LinkedIn | Browser Cookies | 🔄 Polling | MutationObserver |

### Facebook Private API (fbchat-v2)

The app uses [fbchat-v2](https://github.com/MinhHuyDev/fbchat-v2) (maintained fork, Nov 2025) for fast Facebook messaging:

| Feature | Browser Automation | fbchat-v2 (MQTT) |
|---------|-------------------|------------------|
| Speed | 🐢 5-10 sec | ⚡ <1 sec |
| RAM | 🔴 ~500MB (Chromium) | 🟢 ~20MB |
| Reliability | ⚠️ UI changes break it | ✅ Backend-based |

**How it works:**
1. Login via browser (one-time) → Cookies extracted automatically
2. fbchat-v2 uses those cookies via MQTT protocol for instant messaging

## Development

### Prerequisites

- Node.js 18+
- Python 3.9+ (for Private APIs - optional but recommended)

### Manual Setup (if not using setup script)

```bash
# Install Node.js dependencies
npm install

# Setup Facebook sidecar (optional - for fast messaging)
cd facebook-sidecar
python -m venv venv
venv\Scripts\pip install -r requirements.txt  # Windows
# venv/bin/pip install -r requirements.txt    # macOS/Linux
cd ..

# Build
npm run build

# Run
npm start
```

### Building for Distribution

```bash
# Build for current platform
npm run package

# Build for specific platforms
npm run package:win     # Windows (NSIS installer + portable)
npm run package:mac     # macOS (DMG)
npm run package:linux   # Linux (AppImage)
npm run package:all     # All platforms
```

#### Build Output

Built packages are saved to `release/` directory:
- Windows: `Chat Orbitor-Setup-1.0.0.exe`, `Chat Orbitor-Portable-1.0.0.exe`
- macOS: `Chat Orbitor-1.0.0.dmg`
- Linux: `Chat Orbitor-1.0.0.AppImage`

### Project Structure

```
unified-desktop-app/
├── src/
│   ├── main/           # Electron main process
│   │   ├── adapters/   # Platform adapters (Facebook, Instagram, etc.)
│   │   └── services/   # Sidecar managers, session, etc.
│   ├── preload/        # IPC bridge
│   └── renderer/       # React frontend
├── facebook-sidecar/   # Python fbchat-v2 MQTT server
├── instagram-sidecar/  # Python instagrapi server
├── assets/             # App icons
├── dist/               # Build output
└── release/            # Packaged apps
```

## Security

- All credentials are stored locally using Electron's safeStorage API
- No data is sent to external servers
- API calls use your residential IP to avoid platform blocks
- Session data is encrypted at rest

## License

Private - All rights reserved
