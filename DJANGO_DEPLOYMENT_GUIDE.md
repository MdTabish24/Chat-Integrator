# 🚀 Django Backend Deployment Guide

## ✅ FRONTEND UPDATED FOR DJANGO

**3 files changed to connect to Django (port 8000):**

1. ✅ `frontend/src/config/api.ts` - Updated to port 8000
2. ✅ `frontend/src/hooks/useWebSocket.ts` - Updated to port 8000
3. ✅ `frontend/vite.config.ts` - Proxy updated to port 8000

---

## 🔧 LOCAL DEVELOPMENT

### Option 1: Run Separately (Recommended for Development)

**Terminal 1: Start Django Backend**

```bash
cd backend_django
python -m venv venv
source venv/bin/activate  # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env
# Edit .env with your config

python manage.py makemigrations
python manage.py migrate
python manage.py createsuperuser
python manage.py runserver
# Server runs on http://localhost:8000
```

**Terminal 2: Start Celery Worker**

```bash
cd backend_django
source venv/bin/activate  # Windows: .\venv\Scripts\activate
celery -A config worker -l info
```

**Terminal 3: Start Celery Beat**

```bash
cd backend_django
source venv/bin/activate  # Windows: .\venv\Scripts\activate
celery -A config beat -l info
```

**Terminal 4: Start Frontend**

```bash
cd frontend
npm install
npm run dev
# Frontend runs on http://localhost:5173
```

**Terminal 5: Start Redis (if not installed)**

```bash
# Windows (WSL or Docker):
docker run -d -p 6379:6379 redis:7-alpine

# Linux/Mac:
redis-server
```

---

### Option 2: Docker Compose (Complete Stack)

```bash
# Use the Django docker-compose file
docker-compose -f docker-compose.django.yml up --build

# Services:
# - PostgreSQL: localhost:5432
# - Redis: localhost:6379
# - Django Backend: localhost:8000
# - Celery Worker: background
# - Celery Beat: background
# - Frontend: localhost:5173
```

---

## 🌐 PRODUCTION DEPLOYMENT

### 1. Railway/Render/Heroku

**Update environment variables to Django:**

```bash
# Backend service
PORT=8000
PYTHON_VERSION=3.11

# Add all environment variables from .env.example
SECRET_KEY=...
DATABASE_URL=...
REDIS_URL=...
JWT_SECRET=...
# etc.
```

**Procfile (if needed):**

```
web: daphne -b 0.0.0.0 -p $PORT config.asgi:application
worker: celery -A config worker -l info
beat: celery -A config beat -l info
```

**Start command:**

```bash
python manage.py migrate && python manage.py collectstatic --noinput && daphne -b 0.0.0.0 -p $PORT config.asgi:application
```

---

### 2. Update Frontend Environment

**Production `.env`:**

```bash
VITE_API_BASE_URL=https://your-django-backend.onrender.com
```

**Or set in deployment platform:**

- Railway: Add environment variable
- Vercel: Add in project settings
- Render: Add in environment section

---

## 🔄 SWITCHING FROM NODE.JS TO DJANGO

### Step 1: Stop Node.js Backend

```bash
# Stop the running Node.js server
# CTRL+C in terminal or:
pm2 stop backend
```

### Step 2: Start Django Backend

```bash
cd backend_django
python manage.py runserver 0.0.0.0:8000
```

### Step 3: Verify Frontend Connection

```bash
# Frontend should now connect to Django
# Test login/register
# Check browser console for API calls
```

### Step 4: Production Deployment

```bash
# Point your domain/service to Django backend
# Update environment variables
# Deploy!
```

---

## 📊 PORT CHANGES SUMMARY

| Service | Old (Node.js) | New (Django) |
|---------|---------------|--------------|
| Backend API | Port 3000 | Port 8000 |
| Frontend | Port 5173 | Port 5173 (same) |
| PostgreSQL | Port 5432 | Port 5432 (same) |
| Redis | Port 6379 | Port 6379 (same) |

---

## ✅ VERIFICATION CHECKLIST

After deployment, verify:

- [ ] Frontend loads at http://localhost:5173
- [ ] Backend health: http://localhost:8000/health
- [ ] Admin panel: http://localhost:8000/admin
- [ ] Register user works
- [ ] Login works
- [ ] OAuth connect works
- [ ] Send message works
- [ ] Webhooks receiving (test with platform)
- [ ] WebSocket connecting
- [ ] Real-time messages working

---

## 🔥 COMMON ISSUES & FIXES

### Issue 1: Frontend can't connect to backend

```bash
# Check if Django is running on port 8000
curl http://localhost:8000/health

# Check frontend .env
cat frontend/.env
# Should have: VITE_API_BASE_URL=http://localhost:8000
```

### Issue 2: CORS errors

```python
# In backend_django/config/settings.py
CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'https://your-frontend-domain.com',
]
```

### Issue 3: WebSocket not connecting

```bash
# Make sure you're using Daphne (ASGI server), not runserver
daphne -b 0.0.0.0 -p 8000 config.asgi:application

# Check WebSocket URL in frontend
# Should connect to: ws://localhost:8000/ws/messages/
```

### Issue 4: Database migrations

```bash
cd backend_django
python manage.py makemigrations
python manage.py migrate
```

### Issue 5: Celery not running

```bash
# Make sure Redis is running
redis-cli ping  # Should return PONG

# Start Celery worker
celery -A config worker -l info
```

---

## 🎯 FINAL VERIFICATION

**Test complete flow:**

1. Register user → ✅
2. Login → ✅
3. Connect platform → ✅
4. Send message → ✅
5. Receive message (webhook) → ✅
6. Real-time update (WebSocket) → ✅

**ALL WORKING = READY FOR PRODUCTION!** 🚀

---

**No more .md files bhai!** 😅

**Just deploy and enjoy!** 🎉
