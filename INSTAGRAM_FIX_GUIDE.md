# Instagram Connection Fix Guide

## Problem

Getting "Invalid App ID" error when trying to connect Instagram account.

**Root Cause:** Environment variables not set in Render deployment.

---

## ✅ Solution

### Step 1: Add Environment Variables to Render

1. Go to https://dashboard.render.com
2. Select your service: **chatintegrator**
3. Click **Environment** tab
4. Click **Add Environment Variable**
5. Add these two variables:

```bash
Key: INSTAGRAM_APP_ID
Value: 1318737043270340

Key: INSTAGRAM_APP_SECRET
Value: 1b7e43db79512e58430c8bae90b5db41
```

6. Click **Save Changes**
7. Render will automatically redeploy your service

---

### Step 2: Configure Facebook App Settings

Instagram OAuth uses Facebook Graph API. You need to configure your Facebook App.

#### Go to Facebook Developers Console

1. Visit https://developers.facebook.com/apps/1318737043270340
2. Login with your Facebook account

#### Configure OAuth Redirect URLs

1. Go to **Settings** → **Basic**
2. Scroll to **App Domains**
    - Add: `chatintegrator.onrender.com`

3. Scroll to **Website** section
    - Site URL: `https://chatintegrator.onrender.com`

4. Click **Save Changes**

#### Add OAuth Redirect URIs

1. Go to **Use Cases** → **Customize**
2. Click on **Instagram** use case
3. Find **OAuth Redirect URIs** section
4. Add these URLs:
   ```
   https://chatintegrator.onrender.com/api/auth/callback/instagram
   https://chatintegrator.onrender.com/api/oauth/callback/instagram
   ```

5. Click **Save Changes**

---

### Step 3: Enable Instagram Basic Display & Instagram Business API

1. In Facebook App Dashboard, go to **Add Products**
2. Find **Instagram Basic Display** → Click **Set Up**
3. Configure:
    - **Valid OAuth Redirect URIs:**
      ```
      https://chatintegrator.onrender.com/api/auth/callback/instagram
      ```
    - **Deauthorize Callback URL:**
      ```
      https://chatintegrator.onrender.com/api/webhooks/instagram/deauth
      ```
    - **Data Deletion Request URL:**
      ```
      https://chatintegrator.onrender.com/api/webhooks/instagram/data-deletion
      ```

4. Click **Save Changes**

5. Go back and add **Instagram Messaging API** (if available)

---

### Step 4: Request Permissions

Your app needs these permissions:

**Instagram Permissions:**

- `instagram_basic` - Read basic profile info
- `instagram_manage_messages` - Read and send DMs
- `pages_show_list` - Access Facebook Pages
- `pages_messaging` - Manage Page messages

**To request permissions:**

1. Go to **App Review** → **Permissions and Features**
2. Search for:
    - `instagram_basic` → Request
    - `instagram_manage_messages` → Request (Business verification required)
    - `pages_show_list` → Request
    - `pages_messaging` → Request

3. Fill out the review form:
    - **How will you use this data?**
      ```
      We are building a multi-platform messaging hub that allows users to 
      manage their Instagram Business messages alongside other social media 
      platforms (Telegram, Twitter, LinkedIn, etc.) in a unified inbox. 
      Users can view, send, and manage their Instagram DMs directly from 
      our platform.
      ```

    - **Provide a step-by-step walkthrough:**
      ```
      1. User clicks "Connect Instagram" in our app
      2. User authorizes our app via Facebook OAuth
      3. User can view their Instagram Business conversations
      4. User can send and receive messages through our interface
      5. All data is encrypted and stored securely
      ```

4. Upload a **video demo** or **screenshots** showing the integration

5. Submit for review

---

### Step 5: Convert to Instagram Business Account

Instagram DM API only works with **Instagram Business** or **Creator** accounts.

#### Convert your Instagram account:

1. Open Instagram app on your phone
2. Go to **Settings** → **Account**
3. Click **Switch to Professional Account**
4. Choose **Business** or **Creator**
5. Connect to a **Facebook Page** (required)

If you don't have a Facebook Page:

1. Go to https://www.facebook.com/pages/create
2. Create a new Page
3. Name it (e.g., "Chat Integrator Test")
4. Category: **App Page** or **Website**
5. Connect this Page to your Instagram Business account

---

### Step 6: Test the Connection

After completing the above steps:

1. **Redeploy your Render service** (it will redeploy automatically after adding env vars)
2. Wait 2-3 minutes for deployment to complete
3. Go to https://chatintegrator.onrender.com/accounts
4. Click **Connect Instagram**
5. You should see the Facebook OAuth screen (not "Invalid App ID")
6. Login and authorize
7. Select your Facebook Page
8. Connection should succeed!

---

## 🐛 Troubleshooting

### Issue: "Invalid App ID" still appears

**Check:**

- Environment variables are added in Render dashboard
- Service has redeployed (check deployment logs)
- Clear browser cache and try again

**Verify environment variables are loaded:**

```bash
# In Render shell:
echo $INSTAGRAM_APP_ID
echo $INSTAGRAM_APP_SECRET
```

---

### Issue: "This app is not approved for Instagram"

**Solution:**

- Your app is still in Development Mode
- In Facebook App Dashboard:
    - Go to **Settings** → **Advanced**
    - Set **App Mode** to **Live**
    - Or add your Instagram account to **App Testers**

**Add test user:**

1. Go to **Roles** → **Testers**
2. Add Instagram username
3. Accept invitation on Instagram

---

### Issue: "No Facebook Pages found"

**Solution:**

- You need a Facebook Page connected to your Instagram Business account
- Create a Page: https://www.facebook.com/pages/create
- Connect Page to Instagram:
    - Instagram → Settings → Business → Page
    - Select your Page

---

### Issue: "No Instagram Business account connected"

**Solution:**

- Your Instagram account must be a **Business** or **Creator** account
- Convert: Instagram → Settings → Account → Switch to Professional Account
- Must be linked to a Facebook Page

---

## 📝 Quick Checklist

- [ ] Added `INSTAGRAM_APP_ID` to Render environment variables
- [ ] Added `INSTAGRAM_APP_SECRET` to Render environment variables
- [ ] Configured OAuth redirect URIs in Facebook App
- [ ] Set App Domain to `chatintegrator.onrender.com`
- [ ] Instagram account is Business/Creator type
- [ ] Instagram is linked to a Facebook Page
- [ ] App permissions requested (or added as test user)
- [ ] Service redeployed on Render
- [ ] Tested connection

---

## 🎯 Expected Result

After completing all steps, when you click "Connect Instagram":

1. ✅ Facebook OAuth page loads correctly (no "Invalid App ID")
2. ✅ You can login with Facebook
3. ✅ You can select your Facebook Page
4. ✅ Instagram Business account is detected
5. ✅ Connection succeeds
6. ✅ You can view Instagram conversations in dashboard

---

## 📞 Need Help?

If you're still having issues:

1. Check Render logs: https://dashboard.render.com → Your Service → Logs
2. Check browser console for errors (F12)
3. Verify Facebook App configuration
4. Make sure Instagram is Business account
5. Ensure Facebook Page is connected

---

## 🔐 Security Note

Your current credentials in the files:

```
INSTAGRAM_APP_ID=1318737043270340
INSTAGRAM_APP_SECRET=1b7e43db79512e58430c8bae90b5db41
```

These are already in your code repository. Consider:

- Rotating these credentials after fixing
- Adding `.env` to `.gitignore` (if not already)
- Using Render's secret management (already recommended)

---

**Last Updated:** November 24, 2025  
**Status:** Ready to implement
