# Create api_usage_logs table

from django.db import migrations


class Migration(migrations.Migration):

    dependencies = []

    operations = [
        migrations.RunSQL(
            sql="""
            CREATE TABLE IF NOT EXISTS api_usage_logs (
                id CHAR(36) PRIMARY KEY,
                account_id CHAR(36),
                user_id CHAR(36),
                platform VARCHAR(50),
                endpoint VARCHAR(255),
                request_count INT DEFAULT 1,
                timestamp TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                INDEX idx_platform_timestamp (platform, timestamp)
            );
            """,
            reverse_sql="DROP TABLE IF EXISTS api_usage_logs;"
        ),
    ]
