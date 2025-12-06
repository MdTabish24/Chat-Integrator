"""
Django settings for messaging hub project.
Migrated from Node.js/Express backend
"""

import os
from pathlib import Path
from datetime import timedelta
import dj_database_url
from decouple import config

# Build paths inside the project
BASE_DIR = Path(__file__).resolve().parent.parent

# SECURITY WARNING: keep the secret key used in production secret!
SECRET_KEY = config('SECRET_KEY', default='django-insecure-change-this-in-production')

# SECURITY WARNING: don't run with debug turned on in production!
DEBUG = config('DEBUG', default=False, cast=bool)

ALLOWED_HOSTS = config('ALLOWED_HOSTS', default='localhost,127.0.0.1,.onrender.com', cast=lambda v: [s.strip() for s in v.split(',')])

# CSRF Trusted Origins (required for Django 4.0+)
CSRF_TRUSTED_ORIGINS = [
    'https://*.onrender.com',
    'http://localhost:5173',
    'http://localhost:8000',
]

# Application definition
INSTALLED_APPS = [
    'daphne',  # ASGI server (must be first)
    'django.contrib.admin',
    'django.contrib.auth',
    'django.contrib.contenttypes',
    'django.contrib.sessions',
    'django.contrib.messages',
    'django.contrib.staticfiles',
    
    # Third-party apps
    'rest_framework',
    'corsheaders',
    'channels',
    
    # Local apps
    'apps.core',
    'apps.authentication',
    'apps.oauth',
    'apps.conversations',
    'apps.messaging',  # Renamed to avoid conflict with django.contrib.messages
    'apps.webhooks',
    'apps.telegram',
    'apps.platforms',
    'apps.websocket',
    'apps.debug',
]

MIDDLEWARE = [
    'django.middleware.security.SecurityMiddleware',
    'corsheaders.middleware.CorsMiddleware',
    'django.contrib.sessions.middleware.SessionMiddleware',
    'django.middleware.common.CommonMiddleware',
    'django.middleware.csrf.CsrfViewMiddleware',
    'django.contrib.auth.middleware.AuthenticationMiddleware',
    'django.contrib.messages.middleware.MessageMiddleware',
    'django.middleware.clickjacking.XFrameOptionsMiddleware',
    
    # Custom middleware
    'apps.core.middleware.auth.JWTAuthenticationMiddleware',
    'apps.core.middleware.ratelimit.RateLimitMiddleware',
    'apps.core.exceptions.ErrorHandlerMiddleware',
    'apps.core.middleware.usage_logger.APIUsageLoggerMiddleware',
]

ROOT_URLCONF = 'config.urls'

TEMPLATES = [
    {
        'BACKEND': 'django.template.backends.django.DjangoTemplates',
        'DIRS': [],
        'APP_DIRS': True,
        'OPTIONS': {
            'context_processors': [
                'django.template.context_processors.debug',
                'django.template.context_processors.request',
                'django.contrib.auth.context_processors.auth',
                'django.contrib.messages.context_processors.messages',
            ],
        },
    },
]

WSGI_APPLICATION = 'config.wsgi.application'
ASGI_APPLICATION = 'config.asgi.application'

# Database (MySQL)
# Migrated from backend/src/config/database.ts
DATABASES = {
    'default': dj_database_url.config(
        default=config('DATABASE_URL', default=None),
        conn_max_age=600,
        conn_health_checks=True,
    ) if config('DATABASE_URL', default=None) else {
        'ENGINE': 'django.db.backends.mysql',
        'NAME': config('DB_NAME', default='messaging_hub'),
        'USER': config('DB_USER', default='root'),
        'PASSWORD': config('DB_PASSWORD', default=''),
        'HOST': config('DB_HOST', default='localhost'),
        'PORT': config('DB_PORT', default='3306'),
        'OPTIONS': {
            'charset': 'utf8mb4',
            'init_command': "SET sql_mode='STRICT_TRANS_TABLES'",
        },
        'CONN_MAX_AGE': 600,
    }
}

# Password validation
AUTH_PASSWORD_VALIDATORS = [
    {
        'NAME': 'django.contrib.auth.password_validation.UserAttributeSimilarityValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.MinimumLengthValidator',
        'OPTIONS': {
            'min_length': 8,
        }
    },
    {
        'NAME': 'django.contrib.auth.password_validation.CommonPasswordValidator',
    },
    {
        'NAME': 'django.contrib.auth.password_validation.NumericPasswordValidator',
    },
]

# Internationalization
LANGUAGE_CODE = 'en-us'
TIME_ZONE = 'UTC'
USE_I18N = True
USE_TZ = True

# Static files (CSS, JavaScript, Images)
STATIC_URL = 'static/'
STATIC_ROOT = os.path.join(BASE_DIR, 'staticfiles')

# Frontend static files (if serving from Django)
STATICFILES_DIRS = [
    os.path.join(BASE_DIR, '../frontend/dist'),
] if os.path.exists(os.path.join(BASE_DIR, '../frontend/dist')) else []

# Default primary key field type
DEFAULT_AUTO_FIELD = 'django.db.models.BigAutoField'

# CORS Configuration
# Migrated from backend/src/index.ts CORS settings
CORS_ALLOW_ALL_ORIGINS = True  # Allow all origins for now (Render free tier issues)
CORS_ALLOWED_ORIGINS = [
    'http://localhost:5173',
    'http://localhost:3000',
    'https://chatintegrator.onrender.com',
    'https://chatorbitor.onrender.com',
    'https://chat-integrator.onrender.com',
]
CORS_ALLOW_CREDENTIALS = True
CORS_ALLOW_METHODS = ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS']
CORS_ALLOW_HEADERS = ['Content-Type', 'Authorization', 'X-CSRF-Token', 'Accept', 'Origin', 'X-Requested-With']

# Security Settings
# Migrated from backend/src/middleware/security.ts
# Note: Render handles HTTPS, so we don't need SECURE_SSL_REDIRECT
SECURE_SSL_REDIRECT = False  # Render already provides HTTPS
SECURE_PROXY_SSL_HEADER = ('HTTP_X_FORWARDED_PROTO', 'https')  # Trust Render's proxy
SECURE_HSTS_SECONDS = 31536000 if not DEBUG else 0
SECURE_HSTS_INCLUDE_SUBDOMAINS = not DEBUG
SECURE_HSTS_PRELOAD = not DEBUG
SECURE_CONTENT_TYPE_NOSNIFF = True
SECURE_BROWSER_XSS_FILTER = True
SESSION_COOKIE_SECURE = not DEBUG
CSRF_COOKIE_SECURE = not DEBUG
X_FRAME_OPTIONS = 'DENY'

# Redis Configuration
# Migrated from backend/src/config/redis.ts
REDIS_URL = config('REDIS_URL', default='redis://localhost:6379/0')

# Configure cache with SSL support for Upstash
CACHE_OPTIONS = {
    'CLIENT_CLASS': 'django_redis.client.DefaultClient',
    'CONNECTION_POOL_KWARGS': {
        'max_connections': 50,
        'retry_on_timeout': True,
    },
    'SOCKET_CONNECT_TIMEOUT': 30,
    'SOCKET_TIMEOUT': 30,
}

if 'rediss://' in REDIS_URL:
    CACHE_OPTIONS['CONNECTION_POOL_KWARGS']['ssl_cert_reqs'] = None

CACHES = {
    'default': {
        'BACKEND': 'django_redis.cache.RedisCache',
        'LOCATION': REDIS_URL,
        'OPTIONS': CACHE_OPTIONS
    }
}

# Channels Configuration (WebSocket)
# Configure Redis channel layer with proper SSL support for Upstash
def get_channel_layer_config():
    """Get channel layer config with Redis SSL support for Upstash"""
    
    # Check if we should use in-memory (for development or when Redis is unreliable)
    use_in_memory = config('USE_IN_MEMORY_CHANNEL_LAYER', default=False, cast=bool)
    
    if use_in_memory or not REDIS_URL:
        return {
            'default': {
                'BACKEND': 'channels.layers.InMemoryChannelLayer',
            }
        }
    
    # Parse Redis URL and configure SSL for Upstash
    redis_url = REDIS_URL
    
    # Upstash requires SSL - convert redis:// to rediss:// if needed
    if 'upstash.io' in redis_url and redis_url.startswith('redis://'):
        redis_url = redis_url.replace('redis://', 'rediss://', 1)
    
    # For channels-redis 4.1.0, we need to pass the URL directly
    # The library handles SSL automatically when using rediss://
    return {
        'default': {
            'BACKEND': 'channels_redis.core.RedisChannelLayer',
            'CONFIG': {
                'hosts': [redis_url],
                'capacity': 100,
                'expiry': 60,
                'group_expiry': 60,
            },
        },
    }

CHANNEL_LAYERS = get_channel_layer_config()

# Celery Configuration
# Migrated from backend/src/config/queues.ts
CELERY_BROKER_URL = REDIS_URL
CELERY_RESULT_BACKEND = REDIS_URL
CELERY_ACCEPT_CONTENT = ['json']
CELERY_TASK_SERIALIZER = 'json'
CELERY_RESULT_SERIALIZER = 'json'
CELERY_TIMEZONE = 'UTC'
CELERY_TASK_TRACK_STARTED = True
CELERY_TASK_TIME_LIMIT = 30 * 60  # 30 minutes
CELERY_BROKER_CONNECTION_RETRY_ON_STARTUP = True

# JWT Configuration
# Migrated from backend/src/services/authService.ts
JWT_SECRET_KEY = config('JWT_SECRET', default='your-secret-key-change-in-production')
JWT_REFRESH_SECRET_KEY = config('JWT_REFRESH_SECRET', default='your-refresh-secret-key-change-in-production')
JWT_ACCESS_TOKEN_LIFETIME = timedelta(days=7)  # 7 days
JWT_REFRESH_TOKEN_LIFETIME = timedelta(days=30)  # 30 days
JWT_ALGORITHM = 'HS256'

# Encryption Configuration
# Migrated from backend/src/utils/encryption.ts
ENCRYPTION_KEY = config('ENCRYPTION_KEY', default='default-key-change-in-production!!')

# REST Framework Configuration
REST_FRAMEWORK = {
    'DEFAULT_AUTHENTICATION_CLASSES': [],  # Use middleware instead
    'DEFAULT_PERMISSION_CLASSES': [
        'rest_framework.permissions.AllowAny',  # Use view-level permissions
    ],
    'DEFAULT_RENDERER_CLASSES': [
        'rest_framework.renderers.JSONRenderer',
    ],
    'DEFAULT_PARSER_CLASSES': [
        'rest_framework.parsers.JSONParser',
    ],
    'EXCEPTION_HANDLER': 'apps.core.exceptions.custom_exception_handler',
    'DEFAULT_PAGINATION_CLASS': 'rest_framework.pagination.LimitOffsetPagination',
    'PAGE_SIZE': 50,
}

# Platform API Keys
TELEGRAM_BOT_TOKEN = config('TELEGRAM_BOT_TOKEN', default='')
TELEGRAM_API_ID = config('TELEGRAM_API_ID', default='')
TELEGRAM_API_HASH = config('TELEGRAM_API_HASH', default='')

TWITTER_CLIENT_ID = config('TWITTER_CLIENT_ID', default='')
TWITTER_CLIENT_SECRET = config('TWITTER_CLIENT_SECRET', default='')
TWITTER_BEARER_TOKEN = config('TWITTER_BEARER_TOKEN', default='')

FACEBOOK_APP_ID = config('FACEBOOK_APP_ID', default='')
FACEBOOK_APP_SECRET = config('FACEBOOK_APP_SECRET', default='')

INSTAGRAM_APP_ID = config('INSTAGRAM_APP_ID', default='')
INSTAGRAM_APP_SECRET = config('INSTAGRAM_APP_SECRET', default='')

WHATSAPP_PHONE_NUMBER_ID = config('WHATSAPP_PHONE_NUMBER_ID', default='')
WHATSAPP_BUSINESS_ACCOUNT_ID = config('WHATSAPP_BUSINESS_ACCOUNT_ID', default='')
WHATSAPP_ACCESS_TOKEN = config('WHATSAPP_ACCESS_TOKEN', default='')

LINKEDIN_CLIENT_ID = config('LINKEDIN_CLIENT_ID', default='')
LINKEDIN_CLIENT_SECRET = config('LINKEDIN_CLIENT_SECRET', default='')

MICROSOFT_CLIENT_ID = config('MICROSOFT_CLIENT_ID', default='')
MICROSOFT_CLIENT_SECRET = config('MICROSOFT_CLIENT_SECRET', default='')
MICROSOFT_TENANT_ID = config('MICROSOFT_TENANT_ID', default='')

# Webhook Configuration
WEBHOOK_BASE_URL = config('WEBHOOK_BASE_URL', default='https://chatintegrator.onrender.com')

# Rate Limiting Configuration
# Migrated from backend/src/middleware/rateLimiter.ts
RATE_LIMIT_WINDOW = 60  # seconds
RATE_LIMIT_MAX_REQUESTS = 100  # per window
RATE_LIMIT_STRICT_MAX_REQUESTS = 20  # for sensitive operations

# Logging Configuration
LOGGING = {
    'version': 1,
    'disable_existing_loggers': False,
    'formatters': {
        'verbose': {
            'format': '{levelname} {asctime} {module} {message}',
            'style': '{',
        },
    },
    'handlers': {
        'console': {
            'class': 'logging.StreamHandler',
            'formatter': 'verbose',
        },
    },
    'root': {
        'handlers': ['console'],
        'level': 'INFO',
    },
    'loggers': {
        'django': {
            'handlers': ['console'],
            'level': 'INFO',
            'propagate': False,
        },
    },
}
