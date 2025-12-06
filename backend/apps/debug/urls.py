"""
Debug URL configuration.

Migrated from backend/src/routes/debugRoutes.ts
"""

from django.urls import path
from .views import (
    TriggerPollingView,
    PollingStatsView,
    InstagramConfigView,
)

app_name = 'debug'

urlpatterns = [
    # POST /api/debug/polling/:accountId
    path('polling/<uuid:account_id>', TriggerPollingView.as_view(), name='trigger_polling'),
    
    # GET /api/debug/polling/stats
    path('polling/stats', PollingStatsView.as_view(), name='polling_stats'),
    
    # GET /api/debug/instagram-config
    path('instagram-config', InstagramConfigView.as_view(), name='instagram_config'),
]
