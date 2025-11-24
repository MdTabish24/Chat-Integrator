# Instagram Business Integration - Setup Guide

## ✅ Instagram Business Messaging is FREE!

Instagram Business API (via Facebook Graph API) allows you to:
- ✅ Read Instagram Direct Messages
- ✅ Send messages from Instagram Business account
- ✅ Get customer inquiries
- ✅ Manage conversations
- ✅ **100% FREE** - No paid plan required!

---

## 📋 Requirements

### 1. Instagram Business Account
- Must be an **Instagram Business** or **Creator** account
- Cannot be a personal Instagram account
- Convert to Business: Instagram App → Settings → Account → Switch to Professional Account

### 2. Facebook Page
- Instagram Business account must be connected to a Facebook Page
- You must be admin of the Facebook Page
- Link Instagram to Page: Instagram → Settings → Business → Linked Accounts → Facebook

### 3. Facebook App
- Already created: App ID `1318737043270340`
- Configured with Instagram permissions
- Ready to use!

---

## 🚀 Setup Steps

### Step 1: Convert to Instagram Business Account

1. Open Instagram mobile app
2. Go to **Settings** → **Account**
3. Select **Switch to Professional Account**
4. Choose **Business** (or Creator)
5. Complete the setup

### Step 2: Create/Link Facebook Page

**If you don't have a Facebook Page:**
1. Go to https://www.facebook.com/pages/create
2. Create a new Page (free)
3. Choose category (Business, Brand, etc.)
4. Fill in basic information

**Link Instagram to Facebook Page:**
1. Instagram App → Settings → Business
2. Select **Linked Accounts** → **Facebook**
3. Login to Facebook
4. Select the Page to link
5. Confirm connection

### Step 3: Connect to Dashboard

1. Go to https://chatintegrator.onrender.com
2. Click **Connect Instagram**
3. Login with Facebook account (that manages the Page)
4. Grant permissions:
   - `instagram_basic` - Basic profile info
   - `instagram_manage_messages` - Read/send messages
   - `pages_show_list` - List your pages
   - `pages_messaging` - Page messaging
5. Select the Facebook Page linked to your Instagram
6. Done! ✅

---

## 🔧 Technical Details

### OAuth Flow
```
User → Facebook OAuth → Select Page → Get Instagram Business Account ID → Fetch Messages
```

### API Endpoints Used
```javascript
// Get Facebook Pages
GET /v18.0/me/accounts

// Get Instagram Business Account from Page
GET /v18.0/{page-id}?fields=instagram_business_account

// Get Instagram Conversations
GET /v18.0/{ig-account-id}/conversations

// Get Messages in Conversation
GET /v18.0/{conversation-id}/messages

// Send Message
POST /v18.0/{ig-account-id}/messages
```

### Token Lifecycle
- **Short-lived token:** 1 hour (from OAuth)
- **Long-lived token:** 60 days (auto-exchanged)
- **Refresh:** Can be refreshed before expiry
- **No manual refresh needed** - App handles it automatically

---

## ⚠️ Important Notes

### What Works
- ✅ Instagram Business/Creator accounts
- ✅ Direct messages to your business account
- ✅ Customer inquiries
- ✅ Send replies
- ✅ Media messages (photos, videos)
- ✅ Story replies (if enabled)

### What Doesn't Work
- ❌ Personal Instagram accounts (must be Business/Creator)
- ❌ Instagram accounts not linked to Facebook Page
- ❌ Comments on posts (different API)
- ❌ Story mentions (different API)

### Limitations
- Must have Facebook Page
- Instagram must be Business/Creator account
- Page and Instagram must be linked
- You must be admin of the Page

---

## 🐛 Troubleshooting

### Error: "No Facebook pages found"
**Solution:**
- Create a Facebook Page first
- Make sure you're admin of the Page
- Try logging out and back in

### Error: "No Instagram Business account connected"
**Solution:**
- Link your Instagram to the Facebook Page
- Instagram → Settings → Business → Linked Accounts → Facebook
- Select the correct Page

### Error: "Permission denied"
**Solution:**
- Make sure Instagram account is Business/Creator (not personal)
- Re-authorize and grant all permissions
- Check if Page is properly linked to Instagram

### Messages not showing
**Solution:**
- Make sure people are messaging your Instagram Business account
- Check if messages are in "Primary" folder (not "General" or "Requests")
- Wait a few minutes for polling to fetch new messages
- Check backend logs for errors

---

## 📊 What You'll See

### Dashboard will show:
- **Conversations:** All Instagram DM conversations
- **Messages:** Full message history
- **Sender Info:** Username, profile picture
- **Media:** Photos and videos sent/received
- **Timestamps:** When messages were sent
- **Read Status:** Which messages you've read

### You can:
- ✅ View all Instagram DMs in one place
- ✅ Reply to messages from dashboard
- ✅ See customer inquiries
- ✅ Manage multiple conversations
- ✅ Get real-time notifications (via WebSocket)

---

## 🎯 Best Practices

1. **Respond Quickly**
   - Instagram users expect fast responses
   - Use dashboard for quick replies

2. **Professional Tone**
   - Remember it's a business account
   - Maintain professional communication

3. **Use Media**
   - Send photos/videos when helpful
   - Visual responses work better

4. **Monitor Regularly**
   - Check dashboard frequently
   - Don't miss customer inquiries

5. **Organize Conversations**
   - Mark important conversations
   - Archive resolved inquiries

---

## 🔐 Security & Privacy

- ✅ All tokens encrypted in database (AES-256)
- ✅ Secure OAuth flow
- ✅ No passwords stored
- ✅ Can revoke access anytime
- ✅ HTTPS only
- ✅ Rate limiting enabled

**To Revoke Access:**
1. Dashboard → Disconnect Instagram
2. Or: Facebook → Settings → Business Integrations → Remove App

---

## 📱 Mobile App Integration

Instagram Business API works with:
- ✅ Instagram mobile app
- ✅ Facebook Business Suite
- ✅ Your custom dashboard (this app)

All messages sync across platforms!

---

## 💡 Pro Tips

1. **Enable Quick Replies**
   - Set up common responses
   - Save time on frequent questions

2. **Use Story Replies**
   - Enable story reply messages
   - Engage with your audience

3. **Monitor Analytics**
   - Track response times
   - See message volume trends

4. **Automate Greetings**
   - Set up welcome messages
   - Improve customer experience

5. **Tag Conversations**
   - Organize by topic/priority
   - Better conversation management

---

## 🚀 Ready to Start?

1. ✅ Convert Instagram to Business account
2. ✅ Create/Link Facebook Page
3. ✅ Connect on Dashboard
4. ✅ Start managing Instagram DMs!

**Dashboard URL:** https://chatintegrator.onrender.com

---

## 📞 Support

**Issues?**
- Check troubleshooting section above
- Review Facebook/Instagram connection
- Check backend logs on Render
- Verify all permissions granted

**Still stuck?**
- Re-authorize the connection
- Try disconnecting and reconnecting
- Make sure Instagram is Business account
- Verify Page-Instagram link is active

---

**Last Updated:** November 24, 2025  
**Status:** Ready to Use ✅  
**Cost:** FREE 🎉
