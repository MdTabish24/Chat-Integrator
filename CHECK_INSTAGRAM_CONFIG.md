# Instagram Configuration Status

## Current Configuration

### ✅ Local Environment (.env files)

```bash
INSTAGRAM_APP_ID=1318737043270340          # ✓ Present
INSTAGRAM_APP_SECRET=1b7e43db79512e58...   # ✓ Present
FACEBOOK_APP_ID=1318737043270340           # ✓ Present (same as Instagram)
```

### ❌ Render Environment (MISSING!)

```bash
INSTAGRAM_APP_ID=                          # ✗ NOT SET IN RENDER!
INSTAGRAM_APP_SECRET=                      # ✗ NOT SET IN RENDER!
```

---

## Why Instagram Connection is Failing

When you click "Connect Instagram", the backend code runs:

```typescript
// backend/src/services/oauth/InstagramOAuthService.ts
const config: OAuthConfig = {
  clientId: process.env.INSTAGRAM_APP_ID || '',  // ← Returns empty string!
  clientSecret: process.env.INSTAGRAM_APP_SECRET || '',
  redirectUri: `${process.env.WEBHOOK_BASE_URL}/api/auth/callback/instagram`,
  authorizationUrl: 'https://www.facebook.com/v18.0/dialog/oauth',
  // ...
};
```

This generates the OAuth URL:

```
https://www.facebook.com/v18.0/dialog/oauth?client_id=&redirect_uri=...
                                                      ↑
                                                  EMPTY!
```

Facebook sees `client_id=` (empty) and shows: **"Invalid App ID"**

---

## 🚀 Quick Fix (5 minutes)

### Option 1: Add to Render Dashboard (RECOMMENDED)

1. Go to: https://dashboard.render.com
2. Click your service: **chatintegrator**
3. Go to **Environment** tab
4. Click **Add Environment Variable**
5. Add:
   ```
   INSTAGRAM_APP_ID = 1318737043270340
   INSTAGRAM_APP_SECRET = 1b7e43db79512e58430c8bae90b5db41
   ```
6. Click **Save Changes**
7. Wait 2-3 minutes for auto-redeploy
8. Test: https://chatintegrator.onrender.com/accounts → Connect Instagram

---

### Option 2: Update via Render CLI

If you have Render CLI installed:

```bash
render env set INSTAGRAM_APP_ID=1318737043270340
render env set INSTAGRAM_APP_SECRET=1b7e43db79512e58430c8bae90b5db41
```

---

### Option 3: Update .env.render and Redeploy

1. Open `.env.render` file (already has the values!)
2. Copy all contents
3. Go to Render Dashboard → Environment
4. Paste all variables
5. Save and redeploy

---

## 🧪 Verify Fix

After adding environment variables, check if they're loaded:

### Method 1: Check via Render Shell

1. Go to Render Dashboard → Your Service
2. Click **Shell** tab
3. Run:
   ```bash
   echo $INSTAGRAM_APP_ID
   echo $INSTAGRAM_APP_SECRET
   ```
4. Should output:
   ```
   1318737043270340
   1b7e43db79512e58430c8bae90b5db41
   ```

---

### Method 2: Check via Debug Endpoint

I can add a debug endpoint to verify:

```typescript
// backend/src/routes/debugRoutes.ts
app.get('/api/debug/env', (req, res) => {
  res.json({
    instagram_configured: !!process.env.INSTAGRAM_APP_ID,
    instagram_app_id_length: process.env.INSTAGRAM_APP_ID?.length || 0,
    facebook_configured: !!process.env.FACEBOOK_APP_ID,
    // Don't expose actual secrets!
  });
});
```

Then visit: https://chatintegrator.onrender.com/api/debug/env

---

## 📊 Environment Variables Comparison

| Variable | Local (.env) | Render (Live) | Status |
|----------|--------------|---------------|--------|
| `INSTAGRAM_APP_ID` | ✅ Set | ❌ Missing | **FIX NEEDED** |
| `INSTAGRAM_APP_SECRET` | ✅ Set | ❌ Missing | **FIX NEEDED** |
| `FACEBOOK_APP_ID` | ✅ Set | ❓ Unknown | Check Render |
| `TELEGRAM_BOT_TOKEN` | ✅ Set | ✅ Set | ✓ Working |
| `TWITTER_CLIENT_ID` | ✅ Set | ✅ Set | ✓ Set |
| `LINKEDIN_CLIENT_ID` | ✅ Set | ✅ Set | ✓ Set |
| `MICROSOFT_CLIENT_ID` | ✅ Set | ✅ Set | ✓ Set |

---

## 🎯 Expected Result After Fix

### Before (Current):

```
User clicks "Connect Instagram"
  ↓
OAuth URL generated with empty client_id
  ↓
Facebook shows: "Invalid App ID"
  ❌ Connection fails
```

### After (Fixed):

```
User clicks "Connect Instagram"
  ↓
OAuth URL generated with client_id=1318737043270340
  ↓
Facebook shows: Login page
  ↓
User authorizes
  ↓
Redirects to callback
  ↓
  ✅ Connection succeeds!
```

---

## ⚠️ Additional Requirements

Even after fixing the App ID, Instagram connection requires:

1. **Instagram Business Account**
    - Must be Business or Creator account
    - Not Personal account

2. **Facebook Page**
    - Instagram must be linked to a Facebook Page
    - You must be admin of the Page

3. **App Permissions**
    - `instagram_basic` - Usually auto-approved
    - `instagram_manage_messages` - Requires business verification
    - `pages_show_list` - Usually auto-approved
    - `pages_messaging` - Usually auto-approved

4. **App Review** (for production)
    - For testing: Add your account to App Testers
    - For public use: Submit app for review

---

## 🔍 How to Check if You Have Instagram Business

1. Open Instagram app
2. Go to your profile
3. Look for:
    - "Professional Dashboard" button → ✓ Business/Creator
    - "Edit Profile" only → ✗ Personal account

If Personal:

- Go to Settings → Account
- Click "Switch to Professional Account"
- Choose "Business" or "Creator"
- Connect to a Facebook Page

---

## 📝 Summary

**Immediate Action Required:**

1. ✅ Add `INSTAGRAM_APP_ID` to Render environment variables
2. ✅ Add `INSTAGRAM_APP_SECRET` to Render environment variables
3. ✅ Wait for Render to redeploy (automatic)
4. ✅ Test connection again

**This will fix the "Invalid App ID" error!**

**Additional Setup (if needed):**

- Convert Instagram to Business account
- Create/link Facebook Page
- Configure Facebook App redirect URIs
- Request necessary permissions

---

**Priority:** 🔴 HIGH - Blocking Instagram integration  
**Time to Fix:** ⏱️ 5 minutes (just add env vars)  
**Difficulty:** 🟢 Easy (copy-paste values)
