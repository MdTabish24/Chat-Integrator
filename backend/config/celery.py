"""
Celery configuration for messaging hub.

Migrated from backend/src/config/queues.ts (Bull queues)
"""

import os
from celery import Celery
from celery.schedules import crontab

# Set the default Django settings module for the 'celery' program.
os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'config.settings')

app = Celery('messaging_hub')

# Using a string here means the worker doesn't have to serialize
# the configuration object to child processes.
# - namespace='CELERY' means all celery-related configuration keys
#   should have a `CELERY_` prefix.
app.config_from_object('django.conf:settings', namespace='CELERY')

# Load task modules from all registered Django apps.
app.autodiscover_tasks()

# Celery Beat schedule for periodic tasks
# Migrated from messagePollingQueue (backend/src/config/queues.ts)
app.conf.beat_schedule = {
    'poll-messages-every-30-seconds': {
        'task': 'apps.messages.tasks.poll_all_accounts_messages',
        'schedule': 30.0,  # Every 30 seconds
    },
    'cleanup-expired-tokens-daily': {
        'task': 'apps.authentication.tasks.cleanup_expired_tokens',
        'schedule': crontab(hour=2, minute=0),  # Every day at 2 AM
    },
}

# Celery configuration options
app.conf.update(
    task_serializer='json',
    accept_content=['json'],
    result_serializer='json',
    timezone='UTC',
    enable_utc=True,
    task_track_started=True,
    task_time_limit=30 * 60,  # 30 minutes
    task_soft_time_limit=25 * 60,  # 25 minutes
    task_acks_late=True,  # Acknowledge tasks after completion
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,  # Process one task at a time
    broker_connection_retry_on_startup=True,
)

@app.task(bind=True, ignore_result=True)
def debug_task(self):
    """Debug task to test Celery is working"""
    print(f'Request: {self.request!r}')
