# Instagram "Invalid App ID" - Troubleshooting Guide

## ✅ Environment Variables Already Set!

आपने confirm किया है कि Render में ये variables पहले से set हैं:

```bash
✅ INSTAGRAM_APP_ID=1318737043270340
✅ INSTAGRAM_APP_SECRET=1b7e43db79512e58430c8bae90b5db41
```

**तो फिर "Invalid App ID" error क्यों आ रहा है?**

---

## 🔍 Root Cause Analysis

यदि environment variables सही हैं, तो issue **Facebook App configuration** में है।

### Possible Reasons:

1. ❌ **OAuth Redirect URIs not configured** (सबसे common)
2. ❌ **App in Development Mode** (test user required)
3. ❌ **App Domain not added**
4. ❌ **Wrong App ID in Facebook Dashboard**
5. ❌ **App not approved for Instagram permissions**

---

## ✅ Solution: Fix Facebook App Configuration

### **Step 1: Verify Facebook App**

1. Go to: https://developers.facebook.com/apps/1318737043270340
2. Login with your Facebook account
3. Check if App ID matches: `1318737043270340`

---

### **Step 2: Configure App Domains**

1. In Facebook App, click **Settings** → **Basic**
2. Scroll to **App Domains**
3. Add:
   ```
   chatintegrator.onrender.com
   ```
4. Click **Save Changes**

---

### **Step 3: Configure OAuth Redirect URIs** ⭐ **MOST IMPORTANT**

This is the most common cause of "Invalid App ID" error!

#### For Instagram Basic Display:

1. In left sidebar, click **Products** → **Instagram Basic Display**
2. If not added, click **Set Up** to add it
3. Scroll to **Client OAuth Settings**
4. In **Valid OAuth Redirect URIs**, add:
   ```
   https://chatintegrator.onrender.com/api/auth/callback/instagram
   https://chatintegrator.onrender.com/api/oauth/callback/instagram
   ```
5. In **Deauthorize Callback URL**:
   ```
   https://chatintegrator.onrender.com/api/webhooks/instagram/deauth
   ```
6. In **Data Deletion Request URL**:
   ```
   https://chatintegrator.onrender.com/api/webhooks/instagram/data-deletion
   ```
7. Click **Save Changes**

#### For Instagram Messaging (if available):

1. Go to **Use Cases** → **Customize**
2. Find **Instagram** section
3. Click **Settings**
4. Add OAuth Redirect URIs:
   ```
   https://chatintegrator.onrender.com/api/auth/callback/instagram
   https://chatintegrator.onrender.com/api/oauth/callback/instagram
   ```
5. Click **Save**

---

### **Step 4: Check App Mode**

1. Top right of Facebook App Dashboard shows: **"Development"** or **"Live"**

#### If Development Mode:

**Option A: Add yourself as Test User**

1. Go to **Roles** → **Testers**
2. Click **Add Testers**
3. Enter your Instagram username or Facebook ID
4. Accept invitation on Instagram/Facebook

**Option B: Switch to Live Mode** (requires business verification)

1. Top right, click **Mode** toggle
2. Switch from Development to Live
3. Note: May require Business Verification

---

### **Step 5: Verify Permissions**

1. Go to **App Review** → **Permissions and Features**
2. Check if these are approved:
    - ✅ `instagram_basic` (usually auto-approved)
    - ⚠️ `instagram_manage_messages` (requires business verification)
    - ✅ `pages_show_list` (usually auto-approved)
    - ✅ `pages_messaging` (usually auto-approved)

If not approved:

- For testing: Add yourself as Tester (Step 4)
- For production: Submit for App Review

---

## 🧪 Testing & Verification

### Test 1: Check Environment Variables in Render

1. Go to Render Dashboard → Your Service → **Shell**
2. Run:
   ```bash
   echo $INSTAGRAM_APP_ID
   echo $INSTAGRAM_APP_SECRET
   ```
3. Should output:
   ```
   1318737043270340
   1b7e43db79512e58430c8bae90b5db41
   ```

---

### Test 2: Debug Endpoint (After Deployment)

Visit: https://chatintegrator.onrender.com/api/debug/instagram-config

Should show:

```json
{
  "success": true,
  "config": {
    "appIdConfigured": true,
    "appIdLength": 16,
    "appIdFirstChars": "1318",
    "appSecretConfigured": true,
    "appSecretLength": 32,
    "webhookBaseUrl": "https://chatintegrator.onrender.com",
    "redirectUri": "https://chatintegrator.onrender.com/api/auth/callback/instagram"
  }
}
```

If `appIdConfigured: false`, environment variable is not loading!

---

### Test 3: Manual OAuth URL Test

Open this URL directly in browser:

```
https://www.facebook.com/v18.0/dialog/oauth?client_id=1318737043270340&redirect_uri=https://chatintegrator.onrender.com/api/auth/callback/instagram&response_type=code&scope=instagram_basic,instagram_manage_messages,pages_show_list,pages_messaging&state=test123
```

**Expected Result:**

✅ **If Configuration is Correct:**

- Facebook login page appears
- "Log in to continue to Chat Integrator"

❌ **If Configuration is Wrong:**

- "Invalid App ID" error
- "Can't Load URL" error
- "Redirect URI mismatch" error

---

## 🔧 Common Errors & Fixes

### Error: "Invalid App ID"

**Causes:**

1. OAuth Redirect URI not configured ← **Most Common**
2. App Domain not added
3. App ID mismatch

**Fix:**

- Add redirect URIs (Step 3)
- Add app domain (Step 2)
- Verify App ID in Facebook matches `1318737043270340`

---

### Error: "Can't Load URL"

**Cause:** Redirect URI mismatch

**Fix:**

1. Check exact spelling in Facebook App settings
2. Must match exactly: `https://chatintegrator.onrender.com/api/auth/callback/instagram`
3. No trailing slash, no extra characters

---

### Error: "App Not Set Up"

**Cause:** Instagram product not added to app

**Fix:**

1. Go to **Products** in left sidebar
2. Find **Instagram Basic Display**
3. Click **Set Up**
4. Configure settings (Step 3)

---

### Error: "This app is not approved"

**Cause:** App in Development Mode, you're not a tester

**Fix:**

1. Add yourself as Test User (Step 4, Option A)
2. Or switch to Live Mode (Step 4, Option B)

---

## 🎯 Quick Checklist

After completing all steps, verify:

- [ ] Facebook App ID is `1318737043270340`
- [ ] App Domain added: `chatintegrator.onrender.com`
- [ ] OAuth Redirect URIs added in Instagram Basic Display
- [ ] Either: App is Live OR you're added as Test User
- [ ] Environment variables set in Render (already done ✅)
- [ ] Render service redeployed after changes

---

## 📊 Complete Configuration Summary

### Render Environment Variables (Already Set ✅)

```bash
INSTAGRAM_APP_ID=1318737043270340
INSTAGRAM_APP_SECRET=1b7e43db79512e58430c8bae90b5db41
WEBHOOK_BASE_URL=https://chatintegrator.onrender.com
```

### Facebook App Configuration (Need to Set)

**Settings → Basic:**

- App Domains: `chatintegrator.onrender.com`

**Instagram Basic Display → Client OAuth Settings:**

- Valid OAuth Redirect URIs:
  ```
  https://chatintegrator.onrender.com/api/auth/callback/instagram
  https://chatintegrator.onrender.com/api/oauth/callback/instagram
  ```

**Roles → Testers:** (if Development Mode)

- Add your Instagram/Facebook account

---

## 🚀 Expected Flow After Fix

```
1. User clicks "Connect Instagram"
   ↓
2. Redirects to Facebook OAuth page
   ✅ Facebook login page (NOT "Invalid App ID")
   ↓
3. User logs in and authorizes
   ↓
4. Redirects to callback URL
   ↓
5. Backend exchanges code for token
   ↓
6. Token stored in database
   ↓
7. ✅ Instagram connected!
```

---

## 🆘 Still Not Working?

### Double-Check These:

1. **Clear browser cache** and try again
2. **Try incognito mode** to avoid cached errors
3. **Check Facebook App Status:**
    - Go to App Dashboard
    - Check if app is Active (not Disabled)
4. **Verify App Ownership:**
    - Make sure you're the owner/admin of the Facebook App
    - Check in **Roles** section

### Manual Test:

1. Go to Facebook App: https://developers.facebook.com/apps/1318737043270340
2. Click **App Review** → **Permissions and Features**
3. Test each permission manually

---

## 📞 Debug Information

If still having issues, check these logs:

### Backend Logs (Render):

```bash
# Look for Instagram OAuth initialization
grep -i "instagram" /var/log/app.log

# Check if App ID is loading
echo $INSTAGRAM_APP_ID
```

### Browser Console:

```javascript
// Check OAuth URL being generated
// Should see: client_id=1318737043270340 (not empty)
```

---

## 🎓 Understanding the Issue

**The Flow:**

```javascript
// Your code reads:
const clientId = process.env.INSTAGRAM_APP_ID;
// Returns: '1318737043270340' ✅

// Generates URL:
const authUrl = `https://www.facebook.com/v18.0/dialog/oauth?client_id=${clientId}...`;
// URL: ...?client_id=1318737043270340... ✅

// Facebook receives request
// Checks if App ID exists: ✅
// Checks if redirect_uri is allowed: ❌ (if not configured)
// Shows error: "Invalid App ID" or "Can't Load URL"
```

**The Real Issue:**

- Facebook shows "Invalid App ID" even for redirect URI mismatch!
- Misleading error message
- Actual issue: OAuth redirect URI not configured

---

## ✅ Final Action Items

1. **Facebook App Configuration** (Main Fix):
    - Add App Domain
    - Add OAuth Redirect URIs
    - Add yourself as Tester (if Development Mode)

2. **Deploy and Test:**
    - Push changes to GitHub (if any code changes)
    - Wait for Render to redeploy
    - Test Instagram connection

3. **Verify:**
    - Visit debug endpoint
    - Try manual OAuth URL
    - Check if Facebook login page appears

---

## 🎉 Expected Result

**Before Fix:**

```
Click "Connect Instagram"
  ↓
❌ "Invalid App ID" error page
```

**After Fix:**

```
Click "Connect Instagram"
  ↓
✅ Facebook login page
  ↓
Authorize app
  ↓
✅ Instagram connected!
```

---

**अगला कदम:** Facebook App Dashboard में जाकर OAuth Redirect URIs add करें!

**यह सबसे important step है!** 🔑

---

**Last Updated:** November 24, 2025  
**Status:** Configuration guide ready
