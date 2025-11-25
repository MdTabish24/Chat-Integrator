# Django Messaging Hub Backend

**Migrated from Node.js/Express to Django/DRF**

Complete migration of the multi-platform messaging hub backend from TypeScript/Node.js to
Python/Django.

---

## 🎯 Migration Status

### ✅ Phase 1: Core & Authentication (100% Complete)

- Django project structure
- PostgreSQL integration
- Redis caching & Celery
- JWT authentication
- User registration & login
- Token refresh & revocation
- Rate limiting
- API usage logging
- Error handling
- Encryption utilities

### ⏳ Phase 2-7: Remaining (0%)

- OAuth integration (8 platforms)
- Message aggregation
- Conversation management
- Webhook handling
- Platform adapters
- Telegram integration
- WebSocket real-time messaging

---

## 🚀 Quick Start

### 1. Install Dependencies

```bash
pip install -r requirements.txt
```

### 2. Environment Setup

```bash
cp .env.example .env
# Edit .env with your configuration
```

### 3. Database Setup

```bash
# Run migrations
python manage.py makemigrations
python manage.py migrate

# Create superuser
python manage.py createsuperuser
```

### 4. Start Services

**Development Server (Django only):**

```bash
python manage.py runserver
```

**Production Server (with WebSocket support):**

```bash
daphne -b 0.0.0.0 -p 8000 config.asgi:application
```

**Celery Worker:**

```bash
celery -A config worker -l info
```

**Celery Beat (Scheduler):**

```bash
celery -A config beat -l info
```

---

## 📁 Project Structure

```
backend_django/
├── config/                     # Django configuration
│   ├── settings.py            # Main settings
│   ├── urls.py                # Root URL routing
│   ├── wsgi.py                # WSGI server
│   ├── asgi.py                # ASGI server (WebSocket)
│   └── celery.py              # Celery configuration
│
├── apps/                       # Django apps
│   ├── core/                  # Core utilities & middleware
│   │   ├── utils/
│   │   │   └── crypto.py     # Encryption utilities
│   │   ├── middleware/
│   │   │   ├── auth.py       # JWT middleware
│   │   │   ├── ratelimit.py  # Rate limiting
│   │   │   └── usage_logger.py
│   │   ├── exceptions.py      # Error handling
│   │   └── authentication.py  # DRF JWT auth
│   │
│   ├── authentication/        # User auth
│   │   ├── models.py          # User, RefreshToken
│   │   ├── services.py        # Auth business logic
│   │   ├── views.py           # API endpoints
│   │   ├── serializers.py     # Validation
│   │   ├── urls.py            # URL routing
│   │   └── tasks.py           # Celery tasks
│   │
│   ├── oauth/                 # OAuth integration (TODO)
│   ├── messages/              # Message handling (TODO)
│   ├── conversations/         # Conversations (TODO)
│   ├── webhooks/              # Webhook receivers (TODO)
│   ├── platforms/             # Platform adapters (TODO)
│   ├── telegram/              # Telegram integration (TODO)
│   └── websocket/             # WebSocket service (TODO)
│
├── manage.py                   # Django CLI
├── requirements.txt            # Python dependencies
└── Dockerfile                  # Docker configuration
```

---

## 🔌 API Endpoints (Phase 1)

### Authentication

```
POST   /api/auth/register      # Register new user
POST   /api/auth/login         # Login user
POST   /api/auth/refresh       # Refresh access token
POST   /api/auth/logout        # Logout user
GET    /api/auth/me            # Get current user (protected)
```

### Health & Utility

```
GET    /health                 # Health check
GET    /api/csrf-token         # Get CSRF token
```

---

## 🔐 Authentication Flow

### 1. Register

```bash
POST /api/auth/register
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

**Response:**

```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "createdAt": "2025-01-01T00:00:00Z"
  },
  "tokens": {
    "accessToken": "jwt_access_token",
    "refreshToken": "jwt_refresh_token"
  }
}
```

### 2. Login

```bash
POST /api/auth/login
{
  "email": "user@example.com",
  "password": "secure_password"
}
```

### 3. Protected Requests

```bash
GET /api/auth/me
Authorization: Bearer <access_token>
```

### 4. Refresh Token

```bash
POST /api/auth/refresh
{
  "refreshToken": "jwt_refresh_token"
}
```

---

## 🛡️ Security Features

- ✅ JWT Authentication (access + refresh tokens)
- ✅ Password hashing with bcrypt
- ✅ AES-256-CBC encryption for sensitive data
- ✅ Rate limiting (100 requests/min)
- ✅ CORS protection
- ✅ HTTPS redirect (production)
- ✅ CSRF protection
- ✅ XSS protection
- ✅ SQL injection protection (Django ORM)

---

## 🔧 Configuration

### Database

Uses PostgreSQL with connection pooling:

- Max connections: 600 seconds
- Health checks enabled

### Redis

Used for:

- Caching
- Rate limiting
- Celery broker/backend
- WebSocket channel layer

### JWT Tokens

- Access token: 15 minutes
- Refresh token: 7 days
- Algorithm: HS256

### Rate Limiting

- Standard: 100 requests/minute
- Strict: 20 requests/minute

---

## 🧪 Testing

```bash
# Run all tests
python manage.py test

# Run specific app tests
python manage.py test apps.authentication

# With coverage
coverage run --source='.' manage.py test
coverage report
```

---

## 🐳 Docker Deployment

```bash
# Build image
docker build -t messaging-hub-django .

# Run container
docker run -p 8000:8000 --env-file .env messaging-hub-django
```

---

## 📊 Migration from Node.js

### Equivalents

| Node.js | Django |
|---------|--------|
| Express.js | Django + DRF |
| TypeScript | Python 3.11+ |
| JWT (jsonwebtoken) | PyJWT |
| bcrypt | bcrypt |
| Joi validation | DRF Serializers |
| Socket.io | Django Channels |
| Bull (Redis queue) | Celery |
| pg (PostgreSQL) | Django ORM |
| Nodemon | Django auto-reload |

### File Mapping

See `MIGRATION_PROGRESS.md` for detailed file-by-file migration mapping.

---

## 🚨 Troubleshooting

### Database Connection Error

```bash
# Check PostgreSQL is running
pg_isready

# Test connection
psql -U postgres -d messaging_hub
```

### Redis Connection Error

```bash
# Check Redis is running
redis-cli ping

# Should return: PONG
```

### Celery Not Starting

```bash
# Check Redis connection
celery -A config inspect ping

# Check for syntax errors
celery -A config check
```

---

## 📝 TODO

- [ ] Complete OAuth integration (8 platforms)
- [ ] Implement message polling service
- [ ] Set up webhook receivers
- [ ] Create platform adapters
- [ ] Integrate Telegram user client
- [ ] Implement WebSocket consumers
- [ ] Add comprehensive tests
- [ ] Set up CI/CD pipeline
- [ ] Write API documentation (OpenAPI/Swagger)
- [ ] Performance optimization

---

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch
3. Make your changes
4. Write tests
5. Submit a pull request

---

## 📄 License

Same as original Node.js project.

---

## 🎉 Credits

Migrated from the original Node.js/Express backend with careful attention to:

- Maintaining exact API compatibility
- Preserving business logic
- Matching error responses
- Keeping same token expiry times
- Frontend requires ZERO changes!
