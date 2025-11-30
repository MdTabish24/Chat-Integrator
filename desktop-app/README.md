# Chat Orbitor - Multi-Platform Sync

Desktop application to sync your messages from multiple platforms to Chat Orbitor.

## Supported Platforms

| Platform | Status | Cookies Required |
|----------|--------|------------------|
| 🐦 Twitter/X | ✅ | `auth_token`, `ct0` |
| 💼 LinkedIn | ✅ | `li_at`, `JSESSIONID` |
| 📷 Instagram | ✅ | `sessionid`, `csrftoken` |
| 👥 Facebook | ✅ | `c_user`, `xs` |

## Why is this needed?

Many platforms (Twitter, Instagram, etc.) block server-side access to their APIs from data center IPs. This desktop app runs on your computer using your residential IP, which these platforms allow.

## How it works

```
Your Computer (Desktop App)
    ↓
Fetches messages using your cookies
    ↓
Sends data to Chat Orbitor backend
    ↓
Messages appear in Chat Orbitor dashboard!
```

## Installation

### Option 1: Run from source (Development)

```bash
cd desktop-app
npm install
npm start
```

### Option 2: Build executable

```bash
cd desktop-app
npm install
npm run build:win   # Windows (.exe)
npm run build:mac   # macOS (.dmg)
npm run build:linux # Linux (.AppImage)
```

Built files will be in the `dist` folder.

## Usage

1. **Get Chat Orbitor Token**
   - Login to Chat Orbitor
   - Go to Settings → API Token
   - Copy the token

2. **Get Platform Cookies**
   - Open the platform (e.g., x.com) in your browser
   - Login to your account
   - Press `F12` to open Developer Tools
   - Go to `Application` → `Cookies`
   - Copy the required cookie values

3. **Configure the App**
   - Paste your Chat Orbitor token
   - Add cookies for each platform you want to sync
   - Click "Save" for each platform

4. **Sync**
   - App automatically syncs every 5 minutes
   - Click "Sync All" for immediate sync
   - App runs in system tray

## Cookie Locations

### Twitter/X (x.com)
- `auth_token` - Your login session
- `ct0` - CSRF token

### LinkedIn (linkedin.com)
- `li_at` - Main authentication cookie
- `JSESSIONID` - Session ID (include quotes if present)

### Instagram (instagram.com)
- `sessionid` - Your session ID
- `csrftoken` - CSRF token

### Facebook (facebook.com)
- `c_user` - Your user ID
- `xs` - Session cookie

## Security

- ✅ Credentials stored locally on your computer (encrypted)
- ✅ Cookies only sent to their respective platforms
- ✅ Only message data sent to Chat Orbitor
- ✅ No passwords stored

## Troubleshooting

### "Sync failed" error
- Check if your cookies are still valid (try logging in to the platform)
- Cookies expire periodically, you may need to update them

### App not starting
- Make sure you have the latest version
- Try running as administrator (Windows)

### Messages not appearing
- Check if the platform account is connected in Chat Orbitor
- Try manual sync with "Sync All" button

## Building for Distribution

```bash
# Install dependencies
npm install

# Build for all platforms
npm run build

# Or build for specific platform
npm run build:win    # Windows
npm run build:mac    # macOS  
npm run build:linux  # Linux
```

## License

MIT
