# Facebook App Configuration - Step-by-Step Visual Guide

## 🎯 Problem

आपके Render में environment variables सही हैं, लेकिन "Invalid App ID" error आ रहा है।

**कारण:** Facebook App configuration incomplete है।

---

## ✅ Solution Steps (Screenshots के साथ)

### **Step 1: Open Facebook Developer Console**

1. Visit: https://developers.facebook.com/apps/1318737043270340
2. Login with your Facebook account
3. You should see: **"Chat Integrator"** app dashboard

```
┌────────────────────────────────────────────────────┐
│  Facebook for Developers                           │
├────────────────────────────────────────────────────┤
│  My Apps  >  Chat Integrator  >  Dashboard         │
│                                                     │
│  App ID: 1318737043270340                          │
│  Status: Development Mode                          │
└────────────────────────────────────────────────────┘
```

---

### **Step 2: Configure App Domains**

1. Click **Settings** (⚙️) in left sidebar
2. Click **Basic**
3. Scroll down to **App Domains** section
4. Click **Add Domain**
5. Enter: `chatintegrator.onrender.com`
6. Scroll to bottom, click **Save Changes**

```
┌────────────────────────────────────────────────────┐
│  Settings > Basic                                  │
├────────────────────────────────────────────────────┤
│  App Domains                                       │
│  ┌──────────────────────────────────────────────┐ │
│  │ chatintegrator.onrender.com                  │ │
│  └──────────────────────────────────────────────┘ │
│  [+ Add Domain]                                    │
│                                                     │
│  [Save Changes]                                    │
└────────────────────────────────────────────────────┘
```

---

### **Step 3: Add Instagram Product** ⭐

1. In left sidebar, look for **Products** or **Add Products**
2. Find **Instagram** section
3. Look for **Instagram Basic Display** or **Instagram Graph API**
4. Click **Set Up** button

```
┌────────────────────────────────────────────────────┐
│  Products                                          │
├────────────────────────────────────────────────────┤
│  ✅ Facebook Login                                 │
│  ✅ Webhooks                                       │
│  ➕ Instagram Basic Display        [Set Up]       │
│  ➕ Instagram Graph API            [Set Up]       │
│  ➕ WhatsApp                        [Set Up]       │
└────────────────────────────────────────────────────┘
```

---

### **Step 4: Configure OAuth Redirect URIs** 🔑 **MOST CRITICAL**

#### Option A: Instagram Basic Display (Recommended)

1. After setting up Instagram Basic Display
2. You'll see **Client OAuth Settings** section
3. Find **Valid OAuth Redirect URIs**
4. Click **Add OAuth Redirect URI**
5. Add these TWO URLs:

```
https://chatintegrator.onrender.com/api/auth/callback/instagram
https://chatintegrator.onrender.com/api/oauth/callback/instagram
```

6. Scroll down to **Deauthorize Callback URL**:

```
https://chatintegrator.onrender.com/api/webhooks/instagram/deauth
```

7. **Data Deletion Request URL**:

```
https://chatintegrator.onrender.com/api/webhooks/instagram/data-deletion
```

8. Click **Save Changes**

```
┌───────────────────────────────────────────────────────┐
│  Instagram Basic Display > Client OAuth Settings      │
├───────────────────────────────────────────────────────┤
│  Valid OAuth Redirect URIs                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://chatintegrator.onrender.com/api/auth/  │ │
│  │ callback/instagram                              │ │
│  └─────────────────────────────────────────────────┘ │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://chatintegrator.onrender.com/api/oauth/ │ │
│  │ callback/instagram                              │ │
│  └─────────────────────────────────────────────────┘ │
│  [+ Add OAuth Redirect URI]                           │
│                                                        │
│  Deauthorize Callback URL                             │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://chatintegrator.onrender.com/api/       │ │
│  │ webhooks/instagram/deauth                       │ │
│  └─────────────────────────────────────────────────┘ │
│                                                        │
│  Data Deletion Request URL                            │
│  ┌─────────────────────────────────────────────────┐ │
│  │ https://chatintegrator.onrender.com/api/       │ │
│  │ webhooks/instagram/data-deletion                │ │
│  └─────────────────────────────────────────────────┘ │
│                                                        │
│  [Save Changes]                                       │
└───────────────────────────────────────────────────────┘
```

#### Option B: Use Cases (Alternative Method)

If you see **Use Cases** instead:

1. Click **Use Cases** in left sidebar
2. Click **Customize**
3. Find **Instagram** section
4. Click **Settings** or **Go to Settings**
5. Add OAuth Redirect URIs (same URLs as above)

```
┌───────────────────────────────────────────────────────┐
│  Use Cases > Customize                                 │
├───────────────────────────────────────────────────────┤
│  Instagram                                             │
│  ┌───────────────────────────────────────────────┐   │
│  │ ✅ Enabled                                    │   │
│  │ [Settings] [Go to Settings]                   │   │
│  └───────────────────────────────────────────────┘   │
│                                                        │
│  OAuth Redirect URIs                                  │
│  [+ Add Redirect URI]                                 │
└───────────────────────────────────────────────────────┘
```

---

### **Step 5: Add Yourself as Test User** (If in Development Mode)

1. Click **Roles** in left sidebar
2. Click **Testers** tab
3. Click **Add Testers**
4. Enter your:
    - Instagram username, OR
    - Facebook username, OR
    - Facebook User ID
5. Click **Submit**
6. Check your Instagram/Facebook for invitation
7. Accept the invitation

```
┌───────────────────────────────────────────────────────┐
│  Roles > Testers                                       │
├───────────────────────────────────────────────────────┤
│  Testers (0)                                          │
│                                                        │
│  [Add Testers]                                        │
│                                                        │
│  ┌─────────────────────────────────────────────────┐ │
│  │ Enter Instagram username or Facebook ID         │ │
│  └─────────────────────────────────────────────────┘ │
│  [Submit]                                             │
└───────────────────────────────────────────────────────┘
```

---

### **Step 6: Switch to Live Mode** (Optional - For Production)

⚠️ **Only do this after Business Verification**

1. Top right corner shows: **"Development Mode"**
2. Click the toggle switch
3. Select **Switch to Live**
4. Confirm

```
┌───────────────────────────────────────────────────────┐
│  Chat Integrator                      [ Development ] │ ← Click here
│                                        ↓              │
│                                    Switch to Live?    │
│                                    [Cancel] [Confirm] │
└───────────────────────────────────────────────────────┘
```

**Note:** For testing, stay in Development Mode and add yourself as Tester (Step 5)

---

## 🧪 Verification Steps

### Test 1: Check Configuration

Visit your app: https://developers.facebook.com/apps/1318737043270340

✅ Checklist:

- [ ] App Domain shows `chatintegrator.onrender.com`
- [ ] Instagram product is added
- [ ] OAuth Redirect URIs are configured
- [ ] You're added as Tester (if Development Mode)

---

### Test 2: Manual OAuth Test

Open this URL in browser:

```
https://www.facebook.com/v18.0/dialog/oauth?client_id=1318737043270340&redirect_uri=https://chatintegrator.onrender.com/api/auth/callback/instagram&response_type=code&scope=instagram_basic&state=test123
```

**Expected Result:**

✅ **If Correct:**

```
┌───────────────────────────────────────────┐
│  Facebook                                 │
│                                           │
│  Log in to continue to Chat Integrator   │
│                                           │
│  Email or Phone: [_______________]       │
│  Password:       [_______________]       │
│                                           │
│  [Log In]  [Forgot Password?]            │
│                                           │
│  Don't have an account? Sign Up          │
└───────────────────────────────────────────┘
```

❌ **If Wrong:**

```
┌───────────────────────────────────────────┐
│  Facebook                                 │
│                                           │
│  Invalid App ID                           │
│                                           │
│  The provided app ID does not look        │
│  like a valid app ID.                     │
│                                           │
│  [Return home]                            │
└───────────────────────────────────────────┘
```

Or:

```
┌───────────────────────────────────────────┐
│  Facebook                                 │
│                                           │
│  Can't Load URL                           │
│                                           │
│  The domain of this URL isn't included   │
│  in the app's domains.                    │
│                                           │
│  [Go Back]                                │
└───────────────────────────────────────────┘
```

---

### Test 3: Test from Your App

1. Go to: https://chatintegrator.onrender.com/accounts
2. Click **"Connect Instagram"**
3. Should redirect to Facebook login (not error page)

---

## ⚠️ Common Mistakes

### ❌ Wrong Redirect URI Format

**Wrong:**

```
http://chatintegrator.onrender.com/api/auth/callback/instagram  ← http (no 's')
https://chatintegrator.onrender.com/api/auth/callback/instagram/  ← trailing slash
https://chatintegrator.onrender.com/callback/instagram  ← wrong path
```

**Correct:**

```
https://chatintegrator.onrender.com/api/auth/callback/instagram
```

---

### ❌ Domain Mismatch

**App Domain:** `chatintegrator.onrender.com`
**Redirect URI Domain:** Must be same!

---

### ❌ Not Added as Tester

If App is in Development Mode and you're NOT added as Tester:

- You'll see: "This app is not approved"
- Solution: Add yourself in Step 5

---

## 📊 Configuration Summary Table

| Setting | Location | Value |
|---------|----------|-------|
| **App ID** | Settings > Basic | `1318737043270340` ✅ |
| **App Domain** | Settings > Basic | `chatintegrator.onrender.com` |
| **OAuth Redirect URI 1** | Instagram Basic Display | `https://chatintegrator.onrender.com/api/auth/callback/instagram` |
| **OAuth Redirect URI 2** | Instagram Basic Display | `https://chatintegrator.onrender.com/api/oauth/callback/instagram` |
| **Deauth Callback** | Instagram Basic Display | `https://chatintegrator.onrender.com/api/webhooks/instagram/deauth` |
| **Data Deletion URL** | Instagram Basic Display | `https://chatintegrator.onrender.com/api/webhooks/instagram/data-deletion` |
| **Test User** | Roles > Testers | Your Instagram/Facebook account |

---

## 🎯 Priority Actions

### **Must Do (Critical):**

1. ✅ Add App Domain
2. ✅ Add OAuth Redirect URIs
3. ✅ Add yourself as Tester (if Development Mode)

### **Should Do (Recommended):**

4. ✅ Configure Deauth and Data Deletion URLs
5. ✅ Test with manual OAuth URL
6. ✅ Verify all settings are saved

### **Optional (For Production):**

7. Request permissions (instagram_manage_messages)
8. Submit for App Review
9. Switch to Live Mode

---

## 🚀 After Configuration

1. **Save all changes** in Facebook App Dashboard
2. **Wait 1-2 minutes** for changes to propagate
3. **Clear browser cache** (or use Incognito mode)
4. **Test Instagram connection** from your app

---

## 📞 Need Help?

### If Still Not Working:

1. **Double-check** all URLs (no typos!)
2. **Clear browser cache** completely
3. **Try different browser** or Incognito mode
4. **Check Facebook App Status:**
    - Not Disabled
    - You're the owner/admin
5. **Verify App ID** in Facebook matches exactly: `1318737043270340`

### Debug Information:

Visit: https://chatintegrator.onrender.com/api/debug/instagram-config

Should show:

```json
{
  "appIdConfigured": true,
  "appIdLength": 16,
  "appIdFirstChars": "1318"
}
```

---

## ✅ Success Criteria

After completing all steps, you should see:

1. ✅ Facebook login page (not "Invalid App ID")
2. ✅ Can authorize the app
3. ✅ Redirects back to your app
4. ✅ Instagram account connected successfully

---

**सबसे important:** OAuth Redirect URIs correctly configure करना है! 🔑

**इसके बिना Instagram connection नहीं होगा!**

---

**Last Updated:** November 24, 2025  
**Status:** Complete configuration guide with visual aids
